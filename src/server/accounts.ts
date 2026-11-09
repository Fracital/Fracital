/**
 * Fracital Accounts: email/password, Last.fm, OAuth, passkey and Terbium sign-in
 * (better-auth on Postgres; providers in auth-providers.ts), settings sync, and the
 * signed-in user's listening library/stats/scrobbling from Last.fm or ListenBrainz
 * (listenbrainz.ts), plus the opt-in Discord status (discord-presence.ts).
 *
 * Mounted by both the production Hono server (backend.ts) and the Vite dev server
 * (music-api.ts) via `getAccountsApp()`. Disabled (503) when DATABASE_URL is unset.
 *
 * Env: DATABASE_URL, BETTER_AUTH_SECRET, LASTFM_API_KEY, LASTFM_API_SECRET,
 *      optional BETTER_AUTH_URL (public origin) and BETTER_AUTH_TRUSTED_ORIGINS (comma list),
 *      DISCORD_PRESENCE=1 (Discord status; needs the Discord sign-in credentials too),
 *      BETTER_AUTH_API_KEY (Better Auth dashboard via @better-auth/infra's dash(); off when unset).
 */
import { createHash, randomInt } from "node:crypto";
import { dash } from "@better-auth/infra";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { getMigrations } from "better-auth/db/migration";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { Pool } from "pg";
import * as z from "zod";
import { asArray, lastfmCall, LastfmError, lastfmImage, lastfmKey, lastfmSecret, toCount } from "./lastfm";
import { findDeezerArtist, findDeezerTrack, type RadioTrack } from "./music-radio";
import { isBanned, migrateArtistTables, registerArtistRoutes, userMeta } from "./artists";
import { mailEnabled, sendAccountDeletedEmail, sendDeleteAccountEmail, sendPasswordResetEmail, sendVerificationEmail } from "./mail";
import { enabledSocialProviders, passkeyPlugin, passkeyRpId, socialProviders, terbiumEnabled, terbiumPlugin } from "./auth-providers";
import { setStatStore } from "./music-stats";
import { clientNegotiated } from "./api-crypto";
import { authOrigin, handoffPlugin, hubOrigin, ownOrigin, registerHubRoutes } from "./cross-site";
import { lbFeedback, lbListenCount, lbLookupRecording, lbLoved, lbRecent, lbRevoked, lbSubmit, lbTemporary, lbTopAlbums, lbTopArtists, lbTopTracks, lbValidateToken, type ListenTrack } from "./listenbrainz";
import { discordPresenceEnabled, hasPresenceScope, migratePresence, readPresence, sendPresence, writePresence, type NowPlaying } from "./discord-presence";
import { discordBotStatus, discordBotToken, discordPresenceFor } from "./discord-bot";
import { migratePlaylists, registerPlaylistRoutes } from "./playlists";
import { buildExport, migrateExports, purgeExpiredExports, registerExportRoutes, saveExport } from "./data-export";

const MUSIC_API = "/api/music";
const STATE_COOKIE = "fracital_lastfm_state";

// ============================================================
// Last.fm sign-in / connect plugin (Last.fm web auth isn't OAuth2, so it's custom)
// ============================================================

/** Where the popup lands after Last.fm auth; it messages the opener and closes. */
const donePath = (status: "ok" | "error", message = "") => `/api/me/lastfm/done?status=${status}${message ? `&message=${encodeURIComponent(message)}` : ""}`;

interface LastfmSession {
	session?: { name?: string; key?: string };
}
interface LastfmUserInfo {
	user?: { name?: string; realname?: string; image?: { "#text"?: string; size?: string }[]; playcount?: string; url?: string; registered?: { unixtime?: string } };
}

const LASTFM_UNCONFIGURED = "Last.fm isn't configured on this server";
const lastfmModeQuery = z.object({ mode: z.enum(["signin", "link"]).default("signin") });

/**
 * Begins Last.fm's web auth for the request: remembers the mode in the signed
 * state cookie and returns Last.fm's auth page URL with our callback as `cb`.
 * Shared by the redirecting start route (the popup path) and the JSON route
 * (the proxied path, which opens the URL in a proxy tab instead).
 */
async function beginLastfmAuth(ctx: { query: { mode: "signin" | "link" }; headers?: Headers; context: { secret: string; baseURL: string }; setSignedCookie: (name: string, value: string, secret: string, opts: Record<string, unknown>) => Promise<unknown> }) {
	const nonce = createHash("sha256").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 24);
	await ctx.setSignedCookie(STATE_COOKIE, JSON.stringify({ mode: ctx.query.mode, nonce }), ctx.context.secret, { maxAge: 600, httpOnly: true, sameSite: "lax", path: "/" });
	// Last.fm takes any callback, so it returns to the site the user started on (any of our
	// hosts, where the state cookie and session belong) instead of only BETTER_AUTH_URL.
	const own = ownOrigin(ctx.headers);
	const callback = own ? `${own}/api/auth/lastfm/callback` : `${ctx.context.baseURL}/lastfm/callback`;
	return { url: `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(lastfmKey())}&cb=${encodeURIComponent(callback)}`, callback };
}

const lastfmPlugin = (): BetterAuthPlugin => ({
	id: "lastfm",
	endpoints: {
		lastfmStart: createAuthEndpoint("/lastfm/start", { method: "GET", query: lastfmModeQuery }, async ctx => {
			if (!lastfmKey() || !lastfmSecret()) throw ctx.redirect(donePath("error", LASTFM_UNCONFIGURED));
			throw ctx.redirect((await beginLastfmAuth(ctx)).url);
		}),
		// The same beginning as /lastfm/start, answered as JSON instead of a redirect: the
		// client opens `url` itself (in a proxy tab when the proxied flow is on) and
		// watches for `callback`, which it then calls first-party with the token.
		lastfmUrl: createAuthEndpoint("/lastfm/url", { method: "GET", query: lastfmModeQuery }, async ctx => {
			if (!lastfmKey() || !lastfmSecret()) throw new APIError("SERVICE_UNAVAILABLE", { message: LASTFM_UNCONFIGURED });
			return beginLastfmAuth(ctx);
		}),
		lastfmCallback: createAuthEndpoint("/lastfm/callback", { method: "GET", query: z.object({ token: z.string().optional() }) }, async ctx => {
			const raw = await ctx.getSignedCookie(STATE_COOKIE, ctx.context.secret);
			ctx.setCookie(STATE_COOKIE, "", { maxAge: 0, path: "/" });
			const mode = raw ? (JSON.parse(raw) as { mode?: string }).mode : undefined;
			if (!mode) throw ctx.redirect(donePath("error", "Your Last.fm sign-in expired — try again"));
			if (!ctx.query.token) throw ctx.redirect(donePath("error", "Last.fm sign-in was cancelled"));

			let name = "";
			let key = "";
			try {
				const res = await lastfmCall<LastfmSession>({ method: "auth.getSession", token: ctx.query.token }, { signed: true, throwOnError: true });
				name = res?.session?.name ?? "";
				key = res?.session?.key ?? "";
			} catch (err) {
				throw ctx.redirect(donePath("error", err instanceof Error ? err.message : "Last.fm sign-in failed"));
			}
			if (!name || !key) throw ctx.redirect(donePath("error", "Last.fm sign-in failed"));

			const adapter = ctx.context.internalAdapter;
			const existing = await adapter.findAccountByKey({ providerId: "lastfm", accountId: name });

			if (mode === "link") {
				const current = await getSessionFromCtx(ctx);
				if (!current) throw ctx.redirect(donePath("error", "Sign in to Fracital first"));
				if (existing && existing.userId !== current.user.id) throw ctx.redirect(donePath("error", `@${name} is already connected to another Fracital account`));
				// One Last.fm account per user: replace any previously linked one.
				for (const acc of await adapter.findAccounts(current.user.id)) {
					if (acc.providerId === "lastfm" && acc.accountId !== name) await adapter.deleteAccount(acc.id);
				}
				if (existing) await adapter.updateAccount(existing.id, { accessToken: key });
				else await adapter.linkAccount({ userId: current.user.id, providerId: "lastfm", accountId: name, accessToken: key });
				invalidateUser(current.user.id);
				throw ctx.redirect(donePath("ok"));
			}

			// Sign in (or sign up) with Last.fm.
			let userId = existing?.userId;
			if (existing) await adapter.updateAccount(existing.id, { accessToken: key });
			else {
				const info = await lastfmCall<LastfmUserInfo>({ method: "user.getInfo", user: name });
				try {
					const created = await adapter.createOAuthUser(
						// Last.fm doesn't share emails; a reserved .invalid address keeps the unique column happy.
						{ name: info?.user?.realname || name, email: `${name.toLowerCase()}@lastfm.invalid`, emailVerified: false, image: lastfmImage(info?.user?.image) || null },
						{ providerId: "lastfm", accountId: name, accessToken: key },
					);
					userId = created.user.id;
				} catch {
					throw ctx.redirect(donePath("error", "Couldn't create your account"));
				}
			}
			const user = userId ? await adapter.findUserById(userId) : null;
			if (!user) throw ctx.redirect(donePath("error", "Couldn't find your account"));
			const session = await adapter.createSession(user.id);
			await setSessionCookie(ctx, { session, user });
			throw ctx.redirect(donePath("ok"));
		}),
	},
});

// ============================================================
// Setup
// ============================================================

function trustedOrigins(request?: Request): string[] {
	const fromEnv = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
		.split(",")
		.map(s => s.trim())
		.filter(Boolean);
	if (process.env.BETTER_AUTH_URL) fromEnv.push(new URL(process.env.BETTER_AUTH_URL).origin);
	// Same-host requests are always trusted (either scheme, since TLS may terminate at a proxy).
	const host = request?.headers.get("host");
	return host ? [...fromEnv, `http://${host}`, `https://${host}`] : fromEnv;
}

// Cloudflare's published ranges: on the pre-cutover :80 path nginx appends the Cloudflare hop to X-Forwarded-For.
const CLOUDFLARE_PROXIES = [
	"173.245.48.0/20",
	"103.21.244.0/22",
	"103.22.200.0/22",
	"103.31.4.0/22",
	"141.101.64.0/18",
	"108.162.192.0/18",
	"190.93.240.0/20",
	"188.114.96.0/20",
	"197.234.240.0/22",
	"198.41.128.0/17",
	"162.158.0.0/15",
	"104.16.0.0/13",
	"104.24.0.0/14",
	"172.64.0.0/13",
	"131.0.72.0/22",
	"2400:cb00::/32",
	"2606:4700::/32",
	"2803:f800::/32",
	"2405:b500::/32",
	"2405:8100::/32",
	"2a06:98c0::/29",
	"2c0f:f248::/32",
];

const MINUTE = 60;

const authOptions = (pool: Pool) => ({
	database: pool,
	secret: process.env.BETTER_AUTH_SECRET,
	baseURL: process.env.BETTER_AUTH_URL || undefined,
	basePath: "/api/auth",
	trustedOrigins,
	emailAndPassword: {
		enabled: true,
		autoSignIn: true,
		minPasswordLength: 8,
		maxPasswordLength: 120,
		revokeSessionsOnPasswordReset: true,
		resetPasswordTokenExpiresIn: 60 * MINUTE,
		sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
			if (!mailEnabled() || user.email.endsWith("@lastfm.invalid")) return;
			// Not awaited, so response timing doesn't reveal whether the address exists.
			void sendPasswordResetEmail(user.email, url).catch(err => console.error("Password reset email failed:", err instanceof Error ? err.message : err));
		},
	},
	socialProviders: socialProviders(),
	account: {
		// Last.fm-only accounts have a placeholder email, so linking can't require matching emails.
		accountLinking: { enabled: true, allowDifferentEmails: true },
	},
	emailVerification: {
		sendOnSignUp: mailEnabled(),
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
			if (!mailEnabled() || user.email.endsWith("@lastfm.invalid")) return;
			// Not awaited, so response timing doesn't reveal whether the address exists.
			void sendVerificationEmail(user.email, url).catch(err => console.error("Verification email failed:", err instanceof Error ? err.message : err));
		},
	},
	rateLimit: {
		enabled: true,
		customRules: {
			"/sign-in/*": { window: 15 * MINUTE, max: 30 },
			"/sign-up/*": { window: 15 * MINUTE, max: 5 },
			"/request-password-reset": { window: 15 * MINUTE, max: 5 },
			"/send-verification-email": { window: 15 * MINUTE, max: 5 },
			"/passkey/*": { window: 15 * MINUTE, max: 60 },
		},
	},
	advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: CLOUDFLARE_PROXIES } },
	session: { expiresIn: 60 * 60 * 24 * 30 },
	plugins: [lastfmPlugin(), passkeyPlugin(), terbiumPlugin(userId => invalidateUser(userId)), handoffPlugin(), ...(process.env.BETTER_AUTH_API_KEY?.trim() ? [dash()] : [])],
	hooks: {
		// Removing the last passkey from an account with no other sign-in method would lock it out.
		before: createAuthMiddleware(async ctx => {
			if (ctx.path !== "/passkey/delete-passkey") return;
			const session = await getSessionFromCtx(ctx);
			if (!session) return;
			const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
			if (accounts.length) return;
			const { rows } = await pool.query<{ n: string }>('select count(*) as n from passkey where "userId" = $1', [session.user.id]);
			if (Number(rows[0]?.n) <= 1) throw new APIError("BAD_REQUEST", { message: "This passkey is your account's only way to sign in" });
		}),
	},
	databaseHooks: {
		session: {
			create: {
				// Banned accounts can't sign in.
				before: async (session: { userId: string }) => ((await isBanned(pool, session.userId).catch(() => false)) ? false : undefined),
			},
		},
	},
});

const createAuth = (pool: Pool) => betterAuth(authOptions(pool));

type Auth = ReturnType<typeof createAuth>;

/**
 * Pool config with libpq-like SSL defaults (psql negotiates SSL; node-postgres doesn't):
 * remote hosts use TLS without CA verification (like sslmode=require), localhost uses none.
 * `sslmode=disable` / `verify-full` in the URL override that.
 */
function poolConfig(url: string) {
	const parsed = new URL(url);
	const mode = parsed.searchParams.get("sslmode");
	parsed.searchParams.delete("sslmode");
	const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) || parsed.hostname === "";
	const ssl = mode === "disable" ? false : mode === "verify-full" || mode === "verify-ca" ? { rejectUnauthorized: true } : mode || !local ? { rejectUnauthorized: false } : false;
	return { connectionString: parsed.toString(), ssl, max: 10 };
}

let ready: Promise<{ auth: Auth; pool: Pool } | null> | null = null;

/** Connects, runs migrations once, and returns the auth instance (null when DATABASE_URL is unset or unreachable). */
function init() {
	ready ??= (async () => {
		const url = process.env.DATABASE_URL;
		if (!url) {
			console.log("Fracital Accounts disabled (no DATABASE_URL)");
			return null;
		}
		try {
			const pool = new Pool(poolConfig(url));
			// Migrate before constructing auth, which checks the schema on startup.
			const { runMigrations } = await getMigrations(authOptions(pool));
			await runMigrations();
			const auth = createAuth(pool);
			await pool.query(`create table if not exists fracital_settings (
				user_id text primary key references "user"(id) on delete cascade,
				value text not null,
				updated_at timestamptz not null default now()
			)`);
			await pool.query(`create table if not exists fracital_saved_artists (
				user_id text not null references "user"(id) on delete cascade,
				artist_id text not null,
				name text not null,
				picture text not null default '',
				created_at timestamptz not null default now(),
				primary key (user_id, artist_id)
			)`);
			await pool.query(`create table if not exists fracital_saved_items (
				user_id text not null references "user"(id) on delete cascade,
				kind text not null,
				item_id text not null,
				data jsonb not null,
				created_at timestamptz not null default now(),
				primary key (user_id, kind, item_id)
			)`);
			await pool.query(`create table if not exists fracital_game_saves (
				user_id text not null references "user"(id) on delete cascade,
				game_key text not null,
				title text not null,
				hash text not null,
				data text not null,
				size integer not null,
				updated_at timestamptz not null default now(),
				primary key (user_id, game_key)
			)`);
			await migrateArtistTables(pool);
			// ListenBrainz isn't a sign-in method, so its link lives here instead of in "account".
			// An empty token means ListenBrainz rejected it; the row stays so a reconnect keeps the account.
			await pool.query(`create table if not exists fracital_listenbrainz (
				user_id text primary key references "user"(id) on delete cascade,
				username text not null unique,
				token text not null,
				updated_at timestamptz not null default now()
			)`);
			await migratePresence(pool);
			await migratePlaylists(pool);
			// Deleted accounts' downloadable copies are erased after 30 days.
			await migrateExports(pool);
			setInterval(() => void purgeExpiredExports(pool), 6 * 60 * 60 * 1000).unref();
			// Play/listener counts survive restarts and are shared between deploys on the same database.
			await pool.query(`create table if not exists fracital_stat_cache (
				key text primary key,
				value jsonb,
				updated_at timestamptz not null default now()
			)`);
			setStatStore({
				get: async key => {
					const { rows } = await pool.query<{ value: unknown; updated_at: Date }>("select value, updated_at from fracital_stat_cache where key = $1", [key]);
					return rows[0] ? { value: rows[0].value, at: rows[0].updated_at.getTime() } : null;
				},
				set: async (key, value) => {
					await pool.query("insert into fracital_stat_cache (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()", [key, JSON.stringify(value)]);
				},
			});
			console.log("Fracital Accounts ready");
			return { auth, pool };
		} catch (err) {
			console.error("Fracital Accounts failed to start:", err);
			ready = null; // retry on the next request
			return null;
		}
	})();
	return ready;
}

/** Warm up (connect + migrate) at server start instead of on the first request. */
export const initAccounts = () => init();

// ============================================================
// Last.fm data helpers
// ============================================================

interface LastfmTrack {
	name?: string;
	artist?: { name?: string; "#text"?: string } | string;
	album?: { "#text"?: string };
	image?: { "#text"?: string; size?: string }[];
	playcount?: string;
	date?: { uts?: string };
	"@attr"?: { nowplaying?: string; rank?: string };
}

const artistName = (a: LastfmTrack["artist"]) => (typeof a === "string" ? a : a?.name || a?.["#text"] || "");

export type LibraryTrack = RadioTrack & { userPlays?: number; lovedAt?: number; playedAt?: number; nowPlaying?: boolean };

/** Turns Last.fm's metadata-only track into a playable one (Deezer match, else YouTube via hints). */
async function playable(t: LastfmTrack): Promise<LibraryTrack | null> {
	const title = t.name || "";
	const artist = artistName(t.artist);
	if (!title || !artist) return null;
	const resolved = await findDeezerTrack(title, artist, MUSIC_API).catch(() => null);
	const extras = {
		userPlays: toCount(t.playcount) || undefined,
		playedAt: t.date?.uts ? Number(t.date.uts) * 1000 : undefined,
		nowPlaying: t["@attr"]?.nowplaying === "true" || undefined,
	};
	if (resolved) return { ...resolved, title, artist, album: resolved.album || t.album?.["#text"], ...extras };
	const id = `lfm-${createHash("md5").update(`${artist}|${title}`.toLowerCase()).digest("hex").slice(0, 16)}`;
	return {
		id,
		title,
		artist,
		album: t.album?.["#text"] || undefined,
		duration: 0,
		artwork: lastfmImage(t.image),
		streamUrl: `${MUSIC_API}/playback/${id}?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
		previewUrl: "",
		explicit: false,
		...extras,
	};
}

const playableAll = async (tracks: LastfmTrack[]) => (await Promise.all(tracks.map(playable))).filter((t): t is LibraryTrack => !!t);

/** A ListenBrainz song in Last.fm's shape, so both go through the same `playable`. */
const fromListen = (t: ListenTrack): LastfmTrack => ({ name: t.title, artist: t.artist, album: t.album ? { "#text": t.album } : undefined, playcount: t.plays ? String(t.plays) : undefined, date: t.at ? { uts: String(t.at) } : undefined, "@attr": t.nowPlaying ? { nowplaying: "true" } : undefined });
const playableListens = (tracks: ListenTrack[]) => playableAll(tracks.map(fromListen));

async function artistCard(name: string, extra: Record<string, unknown> = {}) {
	const dz = await findDeezerArtist(name).catch(() => null);
	return { name, picture: dz?.picture_big || dz?.picture_medium || "", fans: dz?.nb_fan, ...extra };
}

// Per-user response cache (library sections change slowly; recent plays quickly).
const userCache = new Map<string, { at: number; ttl: number; value: unknown }>();
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
	const hit = userCache.get(key);
	if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.value as T);
	return load().then(value => {
		// Responses where many songs lack artwork were likely rate-limited mid-resolve; retry soon.
		const tracks = (value as { tracks?: { artwork?: string }[] } | null)?.tracks;
		const degraded = !!tracks?.length && tracks.filter(t => !t.artwork).length > tracks.length / 2;
		userCache.set(key, { at: Date.now(), ttl: degraded ? Math.min(ttlMs, 20_000) : ttlMs, value });
		return value;
	});
}
const statSection = (artist: string, title: string) => `stat:${artist}|${title}`.toLowerCase();
const statKey = (userId: string, artist: string, title: string) => `${userId}:${statSection(artist, title)}`;
function invalidateUser(userId: string, section?: string) {
	for (const key of userCache.keys()) if (key.startsWith(`${userId}:${section ?? ""}`)) userCache.delete(key);
}

const PERIODS = new Set(["7day", "1month", "3month", "6month", "12month", "overall"]);

// ============================================================
// HTTP routes
// ============================================================

export type Env = { Variables: { user: { id: string; name: string; email: string; image?: string | null }; auth: Auth; pool: Pool } };

const escapeForScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** Readable text for better-auth's OAuth error codes. */
function oauthErrorMessage(code: string) {
	const c = code.toLowerCase();
	if (c.includes("already_linked") || c.includes("account_already")) return "That account is already connected to another Fracital account";
	if (c.includes("account_not_linked")) return "An account with this email already exists. Sign in to it first, then connect this provider from your account page.";
	if (c.includes("access_denied") || c.includes("cancel")) return "Sign-in was cancelled";
	if (c.includes("state")) return "Your sign-in expired. Try again.";
	if (c.includes("banned") || c.includes("forbidden")) return "This account can't sign in";
	return "Sign-in failed. Try again.";
}

// Last.fm errors: 9 = the session key was revoked (the user removed access on Last.fm);
// 11/16/29 and network failures are temporary.
const LASTFM_REVOKED = new Set([9]);
const LASTFM_TEMPORARY = new Set([0, 8, 11, 16, 29]);

let app: Hono<Env> | null = null;

/** Hono app serving /api/auth/* (better-auth) and /api/me/* (account + Last.fm). */
export function getAccountsApp() {
	if (app) return app;
	app = new Hono<Env>();

	// Popup landing page for Last.fm and OAuth sign-in: tells the opener how it went, then closes.
	// OAuth errors arrive as ?error=<code> from better-auth.
	const popupDone = (type: string, title: string) => (c: Context<Env>) => {
		const status = c.req.query("status") === "ok" && !c.req.query("error") ? "ok" : "error";
		const code = c.req.query("error") || "";
		const message = c.req.query("message") || (code ? oauthErrorMessage(code) : "");
		return c.html(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="background:#1a1a1d;color:#eee;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>${status === "ok" ? "Signed in. You can close this window." : "Sign-in didn't finish. You can close this window."}</p>
<script>
const data = { type: ${escapeForScript(type)}, status: ${escapeForScript(status)}, message: ${escapeForScript(message)} };
if (window.opener) { window.opener.postMessage(data, location.origin); window.close(); }
else setTimeout(() => location.replace("/"), 1500);
</script></body>`);
	};
	app.get("/api/me/lastfm/done", popupDone("fracital:lastfm", "Last.fm"));
	app.get("/api/me/oauth/done", popupDone("fracital:oauth", "Sign in"));

	// Staying signed in across our sites (cross-site.ts): the hub's frame and endpoints.
	registerHubRoutes(
		app,
		async () => {
			const ctx = await init();
			if (!ctx) return null;
			return {
				adapter: (await ctx.auth.$context).internalAdapter,
				sessionUserId: async headers => (await ctx.auth.api.getSession({ headers }).catch(() => null))?.user.id ?? null,
			};
		},
		oauthErrorMessage,
	);

	// Downloads of deleted accounts' data (data-export.ts): public, the link's token is the key.
	registerExportRoutes(app, async () => (await init())?.pool ?? null);

	// Which sign-in methods this server offers (public; the sign-in page builds its buttons from it).
	app.get("/api/me/options", c => {
		// Redirect-based sign-in comes back to BETTER_AUTH_URL's host, so it only works there.
		const base = process.env.BETTER_AUTH_URL;
		// Host names only come from the request; the real hosts (hub, auth host) are only told to the
		// app (sealed responses), so a plain request to a decoy host never learns them.
		const host = c.req.header("x-forwarded-host") || c.req.header("host") || "";
		const hostname = host.replace(/:\d+$/, "");
		const redirectOk = !base || new URL(base).host === host;
		const rp = passkeyRpId();
		const sealed = clientNegotiated(c);
		return c.json({
			social: enabledSocialProviders(),
			lastfm: !!(lastfmKey() && lastfmSecret()),
			terbium: terbiumEnabled(),
			passkeys: hostname === rp || hostname.endsWith(`.${rp}`),
			mail: mailEnabled(),
			redirectOk,
			// Where this browser's cross-site sign-in lives (cross-site.ts); null when it isn't set up.
			hub: sealed ? hubOrigin() : null,
			// Off the auth host, OAuth runs there in a popup and hands the session back (cross-site.ts).
			authHost: sealed && !redirectOk ? authOrigin() : null,
		});
	});

	app.on(["GET", "POST"], "/api/auth/*", async c => {
		const ctx = await init();
		if (!ctx) return c.json({ error: "Fracital Accounts aren't configured on this server" }, 503);
		return ctx.auth.handler(c.req.raw);
	});

	// Everything below requires a signed-in user.
	const requireUser: MiddlewareHandler<Env> = async (c, next) => {
		const ctx = await init();
		if (!ctx) return c.json({ error: "Fracital Accounts aren't configured on this server" }, 503);
		const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.json({ error: "Not signed in" }, 401);
		if (await isBanned(ctx.pool, session.user.id)) return c.json({ error: "This account has been banned" }, 403);
		c.set("user", session.user);
		c.set("auth", ctx.auth);
		c.set("pool", ctx.pool);
		await next();
	};
	app.use("/api/me", requireUser);
	app.use("/api/me/*", requireUser);
	registerArtistRoutes(app, { init, requireUser });
	registerPlaylistRoutes(app);

	type Ctx = { get: <K extends keyof Env["Variables"]>(k: K) => Env["Variables"][K] };

	const countPasskeys = async (c: Ctx) => {
		const { rows } = await c
			.get("pool")
			.query<{ n: string }>('select count(*) as n from passkey where "userId" = $1', [c.get("user").id])
			.catch(() => ({ rows: [{ n: "0" }] }));
		return Number(rows[0]?.n) || 0;
	};

	const lastfmLink = async (c: Ctx) => {
		const adapter = (await c.get("auth").$context).internalAdapter;
		const accounts = await adapter.findAccounts(c.get("user").id);
		const acc = accounts.find(a => a.providerId === "lastfm");
		return {
			// An empty session key means Last.fm revoked it; the link stays so a reconnect keeps the same account.
			link: acc ? { id: acc.id, username: acc.accountId, sessionKey: acc.accessToken || "" } : null,
			discord: accounts.find(a => a.providerId === "discord") ?? null,
			hasPassword: accounts.some(a => a.providerId === "credential"),
			providers: [...new Set(accounts.map(a => a.providerId))],
		};
	};

	/** Clears a revoked Last.fm session key so the account shows "Reconnect" instead of failing silently. */
	const markRevoked = async (c: Ctx, linkId: string) => {
		await (await c.get("auth").$context).internalAdapter.updateAccount(linkId, { accessToken: "" }).catch(() => {});
		invalidateUser(c.get("user").id, "profile");
	};

	/** A signed Last.fm write. `revoked`: reconnect needed; `retry`: temporary, safe to send again later. */
	const lastfmWrite = async <T>(c: Ctx, link: { id: string; sessionKey: string }, params: Record<string, string>) => {
		if (!link.sessionKey) return { data: null, revoked: true, retry: true };
		try {
			const data = await lastfmCall<T>({ ...params, sk: link.sessionKey }, { signed: true, post: true, throwOnError: true });
			return { data, revoked: false, retry: false };
		} catch (err) {
			const code = err instanceof LastfmError ? err.code : 0;
			if (LASTFM_REVOKED.has(code)) {
				await markRevoked(c, link.id);
				return { data: null, revoked: true, retry: true };
			}
			return { data: null, revoked: false, retry: LASTFM_TEMPORARY.has(code) || code >= 500 };
		}
	};

	/** The ListenBrainz link, or null. An empty token means ListenBrainz rejected it (reconnect needed). */
	const lbLink = async (c: Ctx) => {
		const { rows } = await c.get("pool").query<{ username: string; token: string }>("select username, token from fracital_listenbrainz where user_id = $1", [c.get("user").id]);
		return rows[0] ?? null;
	};

	const lbMarkRevoked = async (c: Ctx) => {
		await c
			.get("pool")
			.query("update fracital_listenbrainz set token = '', updated_at = now() where user_id = $1", [c.get("user").id])
			.catch(() => {});
		invalidateUser(c.get("user").id, "profile");
	};

	/** A ListenBrainz write, answered like `lastfmWrite`: `revoked`: reconnect needed; `retry`: temporary. */
	const lbWrite = async (c: Ctx, lb: { token: string }, write: (token: string) => Promise<void>) => {
		if (!lb.token) return { ok: false, revoked: true, retry: true };
		try {
			await write(lb.token);
			return { ok: true, revoked: false, retry: false };
		} catch (err) {
			if (lbRevoked(err)) {
				await lbMarkRevoked(c);
				return { ok: false, revoked: true, retry: true };
			}
			return { ok: false, revoked: false, retry: lbTemporary(err) };
		}
	};

	// --- Profile ---

	const lbProfile = async (userId: string, lb: { username: string; token: string }) => ({ username: lb.username, listenCount: await cached(`${userId}:profile-lb`, 10 * 60_000, () => lbListenCount(lb.username)), url: `https://listenbrainz.org/user/${encodeURIComponent(lb.username)}/`, needsReconnect: !lb.token });

	const presenceStatus = async (c: Ctx, discord: { scope?: string | null } | null) => {
		if (!discordPresenceEnabled()) return null;
		const row = await readPresence(c.get("pool"), c.get("user").id).catch(() => null);
		return { discord: !!discord, connected: hasPresenceScope(discord?.scope), enabled: row?.enabled ?? true, error: row?.error || undefined };
	};

	const lastfmProfile = async (userId: string, username: string, sessionKey: string) => {
		const info = await cached(`${userId}:profile`, 10 * 60_000, () => lastfmCall<LastfmUserInfo>({ method: "user.getInfo", user: username }));
		return {
			username,
			image: lastfmImage(info?.user?.image),
			playcount: toCount(info?.user?.playcount),
			url: info?.user?.url || `https://www.last.fm/user/${encodeURIComponent(username)}`,
			registered: info?.user?.registered?.unixtime ? Number(info.user.registered.unixtime) * 1000 : undefined,
			needsReconnect: !sessionKey,
		};
	};

	app.get("/api/me", async c => {
		const user = c.get("user") as Env["Variables"]["user"] & { emailVerified?: boolean };
		const [{ link, discord, hasPassword, providers }, passkeys, lb] = await Promise.all([lastfmLink(c), countPasskeys(c), lbLink(c)]);
		const [lastfm, listenbrainz, discordPresence] = await Promise.all([link ? lastfmProfile(user.id, link.username, link.sessionKey) : null, lb ? lbProfile(user.id, lb) : null, presenceStatus(c, discord)]);
		const { isAdmin, username, premium } = await userMeta(c.get("pool"), user);
		const placeholderEmail = user.email.endsWith("@lastfm.invalid");
		return c.json({
			user: { id: user.id, name: user.name, email: placeholderEmail ? null : user.email, image: user.image ?? null, emailVerified: !placeholderEmail && !!user.emailVerified },
			hasPassword,
			providers,
			passkeys,
			lastfm,
			lastfmAvailable: !!(lastfmKey() && lastfmSecret()),
			listenbrainz,
			discordPresence,
			discordActivity: !!discordBotToken(),
			isAdmin,
			username,
			premium,
		});
	});

	/** Re-reads the Last.fm profile now instead of waiting out the cache. */
	app.post("/api/me/lastfm/refresh", async c => {
		const { link } = await lastfmLink(c);
		if (!link) return c.json({ error: "Connect Last.fm first" }, 409);
		invalidateUser(c.get("user").id);
		return c.json({ lastfm: await lastfmProfile(c.get("user").id, link.username, link.sessionKey) });
	});

	// Disconnects a sign-in provider, unless it's the account's last way to sign in.
	const disconnect = async (c: Ctx, providerId: string) => {
		const adapter = (await c.get("auth").$context).internalAdapter;
		const accounts = await adapter.findAccounts(c.get("user").id);
		const targets = accounts.filter(a => a.providerId === providerId);
		if (!targets.length) return { ok: true as const };
		const otherSignIn = accounts.some(a => a.providerId !== providerId) || (await countPasskeys(c)) > 0;
		if (!otherSignIn) return { error: "This is your account's only way to sign in. Add a password, passkey or another sign-in method first." };
		for (const acc of targets) await adapter.deleteAccount(acc.id);
		invalidateUser(c.get("user").id);
		return { ok: true as const };
	};

	app.delete("/api/me/lastfm", async c => {
		const res = await disconnect(c, "lastfm");
		return "error" in res ? c.json(res, 400) : c.json(res);
	});

	app.delete("/api/me/accounts/:provider", async c => {
		const provider = c.req.param("provider");
		// Removing the password isn't offered here; resetting it is.
		if (provider === "credential" || !/^[a-z0-9-]{2,30}$/.test(provider)) return c.json({ error: "Invalid request" }, 400);
		const res = await disconnect(c, provider);
		return "error" in res ? c.json(res, 400) : c.json(res);
	});

	// Import loved tracks into the Fracital library: from the linked account, or any public
	// Last.fm profile by username (no connection needed — loved tracks are public).
	app.post("/api/me/lastfm/import", async c => {
		const body = z
			.object({
				username: z
					.string()
					.trim()
					.min(2)
					.max(64)
					.regex(/^[\w.-]+$/)
					.optional(),
			})
			.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "Enter a valid Last.fm username" }, 400);
		if (!lastfmKey()) return c.json({ error: "Last.fm isn't configured on this server" }, 503);
		const username = body.data.username || (await lastfmLink(c)).link?.username;
		if (!username) return c.json({ error: "Connect Last.fm or enter a Last.fm username" }, 409);

		const loved: LastfmTrack[] = [];
		try {
			for (let page = 1; page <= 2; page++) {
				type Loved = { lovedtracks?: { track?: LastfmTrack | LastfmTrack[]; "@attr"?: { totalPages?: string } } };
				const res = await lastfmCall<Loved>({ method: "user.getLovedTracks", user: username, limit: "100", page: String(page) }, { throwOnError: true });
				loved.push(...asArray(res?.lovedtracks?.track));
				if (page >= toCount(res?.lovedtracks?.["@attr"]?.totalPages)) break;
			}
		} catch (err) {
			const code = err instanceof LastfmError ? err.code : 0;
			return c.json({ error: code === 6 ? `Last.fm user @${username} doesn't exist` : code === 17 ? `@${username}'s Last.fm profile is private` : "Couldn't reach Last.fm. Try again." }, code === 6 || code === 17 ? 404 : 502);
		}

		return c.json({ ok: true, username, found: loved.length, added: await saveTracks(c, await playableAll(loved)) });
	});

	/** Adds songs to the user's saved library; returns how many weren't there yet. */
	const saveTracks = async (c: Ctx, tracks: LibraryTrack[]) => {
		const perUser = new Set(["lovedAt", "playedAt", "userPlays", "nowPlaying"]);
		let added = 0;
		for (const t of tracks) {
			const data = Object.fromEntries(Object.entries(t).filter(([k]) => !perUser.has(k)));
			const res = await c.get("pool").query("insert into fracital_saved_items (user_id, kind, item_id, data) values ($1, 'track', $2, $3) on conflict do nothing", [c.get("user").id, t.id, JSON.stringify(data)]);
			added += res.rowCount ?? 0;
		}
		return added;
	};

	// --- ListenBrainz (connect with the user token from listenbrainz.org/settings) ---

	app.post("/api/me/listenbrainz", async c => {
		const body = z
			.object({
				token: z
					.string()
					.trim()
					.min(8)
					.max(100)
					.regex(/^[\w-]+$/),
			})
			.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Paste the user token from your ListenBrainz settings page" }, 400);
		let username: string | null;
		try {
			username = await lbValidateToken(body.data.token);
		} catch {
			return c.json({ error: "Couldn't reach ListenBrainz. Try again." }, 502);
		}
		if (!username) return c.json({ error: "ListenBrainz didn't accept that token. Copy it again from your ListenBrainz settings." }, 400);
		const userId = c.get("user").id;
		try {
			await c.get("pool").query("insert into fracital_listenbrainz (user_id, username, token, updated_at) values ($1, $2, $3, now()) on conflict (user_id) do update set username = excluded.username, token = excluded.token, updated_at = now()", [userId, username, body.data.token]);
		} catch (err) {
			if ((err as { code?: string }).code === "23505") return c.json({ error: `${username} is already connected to another Fracital account` }, 409);
			throw err;
		}
		invalidateUser(userId);
		return c.json({ ok: true, username });
	});

	app.delete("/api/me/listenbrainz", async c => {
		await c.get("pool").query("delete from fracital_listenbrainz where user_id = $1", [c.get("user").id]);
		invalidateUser(c.get("user").id);
		return c.json({ ok: true });
	});

	// Loved songs are public on ListenBrainz too: import from the linked account or any username.
	app.post("/api/me/listenbrainz/import", async c => {
		const body = z
			.object({
				username: z
					.string()
					.trim()
					.min(1)
					.max(64)
					.regex(/^[\w.-]+$/)
					.optional(),
			})
			.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "Enter a valid ListenBrainz username" }, 400);
		const username = body.data.username || (await lbLink(c))?.username;
		if (!username) return c.json({ error: "Connect ListenBrainz or enter a ListenBrainz username" }, 409);
		const loved: ListenTrack[] = [];
		for (let offset = 0; offset < 200; offset += 100) {
			const page = await lbLoved(username, 100, offset);
			loved.push(...page.tracks);
			if (loved.length >= page.total || page.tracks.length < 100) break;
		}
		return c.json({ ok: true, username, found: loved.length, added: await saveTracks(c, await playableListens(loved)) });
	});

	// --- Settings sync (replaces the old Terbium KV store) ---

	app.get("/api/me/settings", async c => {
		const { rows } = await c.get("pool").query<{ value: string; updated_at: Date }>("select value, updated_at from fracital_settings where user_id = $1", [c.get("user").id]);
		return c.json(rows[0] ? { value: rows[0].value, updatedAt: rows[0].updated_at } : { value: null });
	});

	app.put("/api/me/settings", async c => {
		const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
		if (typeof body?.value !== "string" || body.value.length > 512_000) return c.json({ error: "value must be a string under 500KB" }, 400);
		await c.get("pool").query("insert into fracital_settings (user_id, value, updated_at) values ($1, $2, now()) on conflict (user_id) do update set value = excluded.value, updated_at = now()", [c.get("user").id, body.value]);
		return c.json({ ok: true });
	});

	// --- Saved artists (the artist page's "add to library" button) ---

	app.get("/api/me/artists", async c => {
		const { rows } = await c.get("pool").query<{ artist_id: string; name: string; picture: string }>("select artist_id, name, picture from fracital_saved_artists where user_id = $1 order by created_at desc", [c.get("user").id]);
		return c.json({ artists: rows.map(r => ({ id: r.artist_id, name: r.name, picture: r.picture })) });
	});

	app.put("/api/me/artists/:id", async c => {
		const body = z.object({ name: z.string().min(1).max(300), picture: z.string().max(2000).optional() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		await c.get("pool").query("insert into fracital_saved_artists (user_id, artist_id, name, picture) values ($1, $2, $3, $4) on conflict (user_id, artist_id) do update set name = excluded.name, picture = excluded.picture", [c.get("user").id, c.req.param("id"), body.data.name, body.data.picture ?? ""]);
		return c.json({ ok: true, saved: true });
	});

	app.delete("/api/me/artists/:id", async c => {
		await c.get("pool").query("delete from fracital_saved_artists where user_id = $1 and artist_id = $2", [c.get("user").id, c.req.param("id")]);
		return c.json({ ok: true, saved: false });
	});

	// --- Saved songs & albums ("add to library" buttons) ---

	const savedKind = z.enum(["track", "album"]);

	app.get("/api/me/saved", async c => {
		const { rows } = await c.get("pool").query<{ kind: string; data: unknown }>("select kind, data from fracital_saved_items where user_id = $1 order by created_at desc limit 2000", [c.get("user").id]);
		return c.json({ tracks: rows.filter(r => r.kind === "track").map(r => r.data), albums: rows.filter(r => r.kind === "album").map(r => r.data) });
	});

	app.put("/api/me/saved/:kind/:id", async c => {
		const kind = savedKind.safeParse(c.req.param("kind"));
		const body = z.object({ data: z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(500), artist: z.string().max(500) }).passthrough() }).safeParse(await c.req.json().catch(() => null));
		if (!kind.success || !body.success || body.data.data.id !== c.req.param("id")) return c.json({ error: "Invalid request" }, 400);
		const data = JSON.stringify(body.data.data);
		if (data.length > 8000) return c.json({ error: "Item too large" }, 400);
		await c.get("pool").query("insert into fracital_saved_items (user_id, kind, item_id, data) values ($1, $2, $3, $4) on conflict (user_id, kind, item_id) do update set data = excluded.data", [c.get("user").id, kind.data, c.req.param("id"), data]);
		return c.json({ ok: true, saved: true });
	});

	app.delete("/api/me/saved/:kind/:id", async c => {
		const kind = savedKind.safeParse(c.req.param("kind"));
		if (!kind.success) return c.json({ error: "Invalid request" }, 400);
		await c.get("pool").query("delete from fracital_saved_items where user_id = $1 and kind = $2 and item_id = $3", [c.get("user").id, kind.data, c.req.param("id")]);
		return c.json({ ok: true, saved: false });
	});

	// --- Game save backups (per-game localStorage snapshots, see src/libs/gameSaves.ts) ---

	const gameKey = z.string().regex(/^[a-z0-9-]{1,100}$/);
	const MAX_GAME_SAVE_BYTES = 4_000_000;
	const MAX_GAME_SAVES = 500;

	app.get("/api/me/game-saves", async c => {
		const { rows } = await c.get("pool").query<{ game_key: string; title: string; hash: string; size: number; updated_at: Date }>("select game_key, title, hash, size, updated_at from fracital_game_saves where user_id = $1 order by updated_at desc", [c.get("user").id]);
		return c.json({ saves: rows.map(r => ({ key: r.game_key, title: r.title, hash: r.hash, size: r.size, updatedAt: r.updated_at })) });
	});

	app.get("/api/me/game-saves/:key", async c => {
		const key = gameKey.safeParse(c.req.param("key"));
		if (!key.success) return c.json({ error: "Invalid request" }, 400);
		const { rows } = await c.get("pool").query<{ title: string; hash: string; data: string; updated_at: Date }>("select title, hash, data, updated_at from fracital_game_saves where user_id = $1 and game_key = $2", [c.get("user").id, key.data]);
		if (!rows[0]) return c.json({ error: "No backup for this game" }, 404);
		return c.json({ key: key.data, title: rows[0].title, hash: rows[0].hash, data: rows[0].data, updatedAt: rows[0].updated_at });
	});

	app.put("/api/me/game-saves/:key", async c => {
		const key = gameKey.safeParse(c.req.param("key"));
		const body = z.object({ title: z.string().min(1).max(300), hash: z.string().min(1).max(64), data: z.string().min(2).max(MAX_GAME_SAVE_BYTES) }).safeParse(await c.req.json().catch(() => null));
		if (!key.success || !body.success) return c.json({ error: "Invalid request" }, 400);
		try {
			const parsed = JSON.parse(body.data.data) as { v?: unknown; ls?: unknown };
			if (parsed?.v !== 1 || typeof parsed.ls !== "object" || parsed.ls === null) throw new Error();
		} catch {
			return c.json({ error: "Invalid save data" }, 400);
		}
		const pool = c.get("pool");
		const userId = c.get("user").id;
		const { rows: count } = await pool.query<{ n: string }>("select count(*) as n from fracital_game_saves where user_id = $1 and game_key <> $2", [userId, key.data]);
		if (Number(count[0]?.n) >= MAX_GAME_SAVES) return c.json({ error: "Too many game backups" }, 409);
		const { rows } = await pool.query<{ updated_at: Date }>(
			"insert into fracital_game_saves (user_id, game_key, title, hash, data, size, updated_at) values ($1, $2, $3, $4, $5, $6, now()) on conflict (user_id, game_key) do update set title = excluded.title, hash = excluded.hash, data = excluded.data, size = excluded.size, updated_at = now() returning updated_at",
			[userId, key.data, body.data.title, body.data.hash, body.data.data, body.data.data.length],
		);
		return c.json({ ok: true, updatedAt: rows[0].updated_at });
	});

	app.delete("/api/me/game-saves/:key", async c => {
		const key = gameKey.safeParse(c.req.param("key"));
		if (!key.success) return c.json({ error: "Invalid request" }, 400);
		await c.get("pool").query("delete from fracital_game_saves where user_id = $1 and game_key = $2", [c.get("user").id, key.data]);
		return c.json({ ok: true });
	});

	// --- ListenBrainz library (the same sections and shapes as Last.fm's below) ---

	const listenbrainzSection = (userId: string, user: string, section: string, period: string, limit: number) => {
		switch (section) {
			case "loved":
				return cached(`${userId}:loved:${limit}`, 3 * 60_000, async () => {
					const res = await lbLoved(user, limit);
					const tracks = await playableListens(res.tracks);
					return { total: res.total, tracks: tracks.map(t => ({ ...t, lovedAt: t.playedAt, playedAt: undefined })) };
				});
			case "recent":
				return cached(`${userId}:recent:${limit}`, 30_000, async () => {
					const seen = new Set<string>();
					const unique = (await lbRecent(user, Math.min(limit, 30))).filter(t => {
						const key = `${t.artist}|${t.title}`.toLowerCase();
						if (seen.has(key)) return false;
						seen.add(key);
						return true;
					});
					return { tracks: await playableListens(unique) };
				});
			case "top-tracks":
				return cached(`${userId}:top-tracks:${period}:${limit}`, 10 * 60_000, async () => ({ period, tracks: await playableListens(await lbTopTracks(user, period, limit)) }));
			case "top-artists":
				return cached(`${userId}:top-artists:${period}:${limit}`, 10 * 60_000, async () => ({ period, artists: await Promise.all((await lbTopArtists(user, period, limit)).map(a => artistCard(a.name, { userPlays: a.plays }))) }));
			case "top-albums":
				return cached(`${userId}:top-albums:${period}:${limit}`, 10 * 60_000, async () => ({ period, albums: (await lbTopAlbums(user, period, limit)).map(a => ({ title: a.title, artist: a.artist, artwork: a.artwork, userPlays: a.plays })) }));
			default:
				return null;
		}
	};

	/** The user's loved songs (by songKey) and all-time play counts on ListenBrainz, for the per-song stats. */
	const lbLovedSet = (userId: string, user: string) => cached(`${userId}:loved-set`, 10 * 60_000, async () => new Set((await lbLoved(user, 1000)).tracks.map(t => `${t.artist}|${t.title}`.toLowerCase())));
	const lbPlays = (userId: string, user: string) => cached(`${userId}:plays-all`, 30 * 60_000, async () => new Map((await lbTopTracks(user, "overall", 1000)).map(t => [`${t.artist}|${t.title}`.toLowerCase(), t.plays ?? 0])));
	const lbArtistPlays = (userId: string, user: string) => cached(`${userId}:plays-artists`, 30 * 60_000, async () => new Map((await lbTopArtists(user, "overall", 1000)).map(a => [a.name.toLowerCase(), a.plays])));

	/**
	 * Artists similar to the user's top artists, and songs similar to their top songs. Similarity
	 * comes from Last.fm's public data (the server's API key), whichever service the listening is on.
	 */
	const recommend = async (topArtists: string[], topTracks: { title: string; artist: string }[]) => {
		type Named = { name?: string; match?: string; artist?: { name?: string } };
		const known = new Set(topArtists.map(n => n.toLowerCase()));

		// Score similar artists across the user's top 6, so overlapping taste ranks higher.
		const scores = new Map<string, { name: string; score: number; because: string }>();
		const similarLists = await Promise.all(topArtists.slice(0, 6).map(seed => lastfmCall<{ similarartists?: { artist?: Named | Named[] } }>({ method: "artist.getSimilar", artist: seed, limit: "15" }).then(r => ({ seed, list: asArray(r?.similarartists?.artist) }))));
		for (const { seed, list } of similarLists) {
			for (const a of list) {
				if (!a.name || known.has(a.name.toLowerCase())) continue;
				const prev = scores.get(a.name.toLowerCase());
				const score = (prev?.score ?? 0) + Number(a.match || 0);
				scores.set(a.name.toLowerCase(), { name: a.name, score, because: prev?.because ?? seed });
			}
		}
		const artistPicks = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 18);
		const artists = await Promise.all(artistPicks.map(a => artistCard(a.name, { because: a.because })));

		const seen = new Set<string>();
		const similarTracks = (await Promise.all(topTracks.slice(0, 6).map(t => lastfmCall<{ similartracks?: { track?: LastfmTrack | LastfmTrack[] } }>({ method: "track.getSimilar", artist: t.artist, track: t.title, limit: "6" }))))
			.flatMap(r => asArray(r?.similartracks?.track))
			.filter(t => {
				const key = `${artistName(t.artist)}|${t.name}`.toLowerCase();
				if (seen.has(key) || known.has(artistName(t.artist).toLowerCase())) return false;
				seen.add(key);
				return true;
			})
			.slice(0, 20);
		return { artists, tracks: await playableAll(similarTracks) };
	};

	// --- Last.fm library ---

	const requireLink = async (c: Parameters<typeof lastfmLink>[0]) => {
		const { link } = await lastfmLink(c);
		return link;
	};

	app.get("/api/me/library/:section", async c => {
		const link = await requireLink(c);
		const userId = c.get("user").id;
		const section = c.req.param("section");
		const period = PERIODS.has(c.req.query("period") || "") ? c.req.query("period")! : "6month";
		const limit = String(Math.min(Number(c.req.query("limit")) || 30, 50));
		if (!link) {
			// Last.fm is the library's source when both are connected; otherwise ListenBrainz.
			const lb = await lbLink(c);
			if (!lb) return c.json({ error: "Connect Last.fm or ListenBrainz first" }, 409);
			const res = await listenbrainzSection(userId, lb.username, section, period, Number(limit));
			return res ? c.json(res) : c.json({ error: "Unknown section" }, 404);
		}
		const user = link.username;

		switch (section) {
			case "loved":
				return c.json(
					await cached(`${userId}:loved:${limit}`, 3 * 60_000, async () => {
						const res = await lastfmCall<{ lovedtracks?: { track?: LastfmTrack | LastfmTrack[]; "@attr"?: { total?: string } } }>({ method: "user.getLovedTracks", user, limit });
						const tracks = await playableAll(asArray(res?.lovedtracks?.track));
						return { total: toCount(res?.lovedtracks?.["@attr"]?.total), tracks: tracks.map(t => ({ ...t, lovedAt: t.playedAt, playedAt: undefined })) };
					}),
				);
			case "recent":
				return c.json(
					await cached(`${userId}:recent:${limit}`, 30_000, async () => {
						const res = await lastfmCall<{ recenttracks?: { track?: LastfmTrack | LastfmTrack[] } }>({ method: "user.getRecentTracks", user, limit: String(Math.min(Number(limit), 30)) });
						// The same song can appear several times in a row; keep the latest play.
						const seen = new Set<string>();
						const unique = asArray(res?.recenttracks?.track).filter(t => {
							const key = `${artistName(t.artist)}|${t.name}`.toLowerCase();
							if (seen.has(key)) return false;
							seen.add(key);
							return true;
						});
						return { tracks: await playableAll(unique) };
					}),
				);
			case "top-tracks":
				return c.json(
					await cached(`${userId}:top-tracks:${period}:${limit}`, 10 * 60_000, async () => {
						const res = await lastfmCall<{ toptracks?: { track?: LastfmTrack | LastfmTrack[] } }>({ method: "user.getTopTracks", user, period, limit });
						return { period, tracks: await playableAll(asArray(res?.toptracks?.track)) };
					}),
				);
			case "top-artists":
				return c.json(
					await cached(`${userId}:top-artists:${period}:${limit}`, 10 * 60_000, async () => {
						const res = await lastfmCall<{ topartists?: { artist?: { name?: string; playcount?: string } | { name?: string; playcount?: string }[] } }>({ method: "user.getTopArtists", user, period, limit });
						const artists = await Promise.all(
							asArray(res?.topartists?.artist)
								.filter(a => a.name)
								.map(a => artistCard(a.name!, { userPlays: toCount(a.playcount) })),
						);
						return { period, artists };
					}),
				);
			case "top-albums":
				return c.json(
					await cached(`${userId}:top-albums:${period}:${limit}`, 10 * 60_000, async () => {
						type A = { name?: string; artist?: { name?: string }; playcount?: string; image?: { "#text"?: string; size?: string }[] };
						const res = await lastfmCall<{ topalbums?: { album?: A | A[] } }>({ method: "user.getTopAlbums", user, period, limit });
						const albums = asArray(res?.topalbums?.album)
							.filter(a => a.name && a.artist?.name)
							.map(a => ({ title: a.name!, artist: a.artist!.name!, artwork: lastfmImage(a.image), userPlays: toCount(a.playcount) }));
						return { period, albums };
					}),
				);
			default:
				return c.json({ error: "Unknown section" }, 404);
		}
	});

	// Recommendations: artists similar to the user's top artists, and songs similar to their top songs.
	app.get("/api/me/recommendations", async c => {
		const link = await requireLink(c);
		const lb = link ? null : await lbLink(c);
		if (!link && !lb) return c.json({ error: "Connect Last.fm or ListenBrainz first" }, 409);
		return c.json(
			await cached(`${c.get("user").id}:recs`, 30 * 60_000, async () => {
				if (lb) {
					// Stats only cover ranges with listens; someone who hasn't listened lately is seeded by all time.
					const [recentArtists, recentTracks] = await Promise.all([lbTopArtists(lb.username, "3month", 50), lbTopTracks(lb.username, "1month", 8)]);
					const artists = recentArtists.length ? recentArtists : await lbTopArtists(lb.username, "overall", 50);
					const tracks = recentTracks.length ? recentTracks : await lbTopTracks(lb.username, "overall", 8);
					return recommend(
						artists.map(a => a.name),
						tracks,
					);
				}
				const user = link!.username;
				type Named = { name?: string };
				const [topArtistsRes, topTracksRes] = await Promise.all([
					lastfmCall<{ topartists?: { artist?: Named | Named[] } }>({ method: "user.getTopArtists", user, period: "3month", limit: "50" }),
					lastfmCall<{ toptracks?: { track?: LastfmTrack | LastfmTrack[] } }>({ method: "user.getTopTracks", user, period: "1month", limit: "8" }),
				]);
				return recommend(
					asArray(topArtistsRes?.topartists?.artist)
						.map(a => a.name || "")
						.filter(Boolean),
					asArray(topTracksRes?.toptracks?.track).map(t => ({ title: t.name || "", artist: artistName(t.artist) })),
				);
			}),
		);
	});

	// The user's own play counts + loved state for a batch of songs.
	app.post("/api/me/stats/tracks", async c => {
		const link = await requireLink(c);
		const body = (await c.req.json().catch(() => null)) as { tracks?: { key?: string; title?: string; artist?: string }[] } | null;
		const tracks = (body?.tracks ?? []).filter(t => t.key && t.title && t.artist).slice(0, 50);
		if (!link) {
			const lb = await lbLink(c);
			if (!lb) return c.json({});
			const userId = c.get("user").id;
			const [loved, plays] = await Promise.all([lbLovedSet(userId, lb.username), lbPlays(userId, lb.username)]);
			return c.json(Object.fromEntries(tracks.map(t => [t.key!, { userPlays: plays.get(`${t.artist}|${t.title}`.toLowerCase()) ?? 0, loved: loved.has(`${t.artist}|${t.title}`.toLowerCase()) }])));
		}
		const entries = await Promise.all(
			tracks.map(async t => {
				// Long-lived: scrobbles and likes made here invalidate the song's entry.
				const info = await cached(statKey(c.get("user").id, t.artist!, t.title!), 30 * 60_000, () => lastfmCall<{ track?: { userplaycount?: string; userloved?: string } }>({ method: "track.getInfo", artist: t.artist!, track: t.title!, username: link.username, autocorrect: "1" }));
				return [t.key!, { userPlays: toCount(info?.track?.userplaycount), loved: info?.track?.userloved === "1" }] as const;
			}),
		);
		return c.json(Object.fromEntries(entries));
	});

	app.get("/api/me/stats/artist", async c => {
		const link = await requireLink(c);
		const name = c.req.query("name")?.trim();
		if (!name) return c.json({ userPlays: null });
		if (!link) {
			const lb = await lbLink(c);
			return c.json({ userPlays: lb ? ((await lbArtistPlays(c.get("user").id, lb.username)).get(name.toLowerCase()) ?? 0) : null });
		}
		const info = await cached(`${c.get("user").id}:artist:${name.toLowerCase()}`, 30 * 60_000, () => lastfmCall<{ artist?: { stats?: { userplaycount?: string } } }>({ method: "artist.getInfo", artist: name, username: link.username }));
		return c.json({ userPlays: toCount(info?.artist?.stats?.userplaycount) });
	});

	// --- Writes: love, now playing, scrobble ---

	const writeBody = z.object({ title: z.string().min(1).max(500), artist: z.string().min(1).max(500), album: z.string().max(500).optional(), duration: z.number().int().positive().max(86_400).optional() });

	/** ListenBrainz feedback is per MusicBrainz recording; matches are stable, so they're kept (misses aren't: they may be a failed lookup). */
	const recordingIds = new Map<string, string>();
	const lbLove = async (c: Ctx, lb: { token: string }, title: string, artist: string, loved: boolean) => {
		if (!lb.token) return { ok: false, revoked: true, retry: true, unmatched: false };
		const key = `${artist}|${title}`.toLowerCase();
		if (!recordingIds.has(key)) {
			const found = await lbLookupRecording(lb.token, title, artist);
			if (recordingIds.size > 5000) recordingIds.clear();
			if (found) recordingIds.set(key, found);
		}
		const mbid = recordingIds.get(key);
		if (!mbid) return { ok: false, revoked: false, retry: false, unmatched: true };
		return { ...(await lbWrite(c, lb, token => lbFeedback(token, mbid, loved ? 1 : 0))), unmatched: false };
	};

	// Likes go to every connected service; the library's source (Last.fm when both) decides the answer.
	app.post("/api/me/love", async c => {
		const [link, lb] = await Promise.all([requireLink(c), lbLink(c)]);
		if (!link && !lb) return c.json({ error: "Connect Last.fm or ListenBrainz first" }, 409);
		const body = writeBody.extend({ loved: z.boolean() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const { title, artist, loved } = body.data;
		const [lf, lbRes] = await Promise.all([link ? lastfmWrite(c, link, { method: loved ? "track.love" : "track.unlove", track: title, artist }) : null, lb ? lbLove(c, lb, title, artist, loved) : null]);
		invalidateUser(c.get("user").id, "loved");
		invalidateUser(c.get("user").id, statSection(artist, title));
		if (lf) {
			if (lf.revoked) return c.json({ error: "Last.fm access was removed. Reconnect Last.fm from your account page.", revoked: true }, 409);
			if (!lf.data) return c.json({ error: "Last.fm rejected the request" }, 502);
		} else if (lbRes && !lbRes.ok) {
			if (lbRes.revoked) return c.json({ error: "ListenBrainz didn't accept your token anymore. Reconnect ListenBrainz from your account page.", revoked: true }, 409);
			return c.json({ error: lbRes.unmatched ? "ListenBrainz couldn't find this song to like" : "ListenBrainz rejected the request" }, 502);
		}
		return c.json({ ok: true, loved });
	});

	app.post("/api/me/nowplaying", async c => {
		const [link, lb] = await Promise.all([requireLink(c), lbLink(c)]);
		if (!link && !lb) return c.json({ ok: false });
		const body = writeBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const { title, artist, album, duration } = body.data;
		const params: Record<string, string> = { method: "track.updateNowPlaying", track: title, artist };
		if (album) params.album = album;
		if (duration) params.duration = String(duration);
		const [lf, lbRes] = await Promise.all([link ? lastfmWrite(c, link, params) : null, lb ? lbWrite(c, lb, token => lbSubmit(token, "playing_now", [{ title, artist, album, duration }])) : null]);
		return c.json({ ok: !!lf?.data || !!lbRes?.ok, revoked: !!lf?.revoked || !!lbRes?.revoked });
	});

	// One scrobble, or a batch of up to 50 (the client's offline queue), for one service: the
	// client keeps a queue per service, so a failure on one never re-sends to the other. `retry`
	// tells the client whether to keep them queued; Last.fm-ignored scrobbles (e.g. too old) are final.
	const scrobbleItem = writeBody.extend({ timestamp: z.number().int().positive() });
	app.post("/api/me/scrobble", async c => {
		const raw = (await c.req.json().catch(() => null)) as { service?: unknown } | null;
		const service = raw?.service === "listenbrainz" ? "listenbrainz" : "lastfm";
		const body = z.union([z.object({ scrobbles: z.array(scrobbleItem).min(1).max(50) }), scrobbleItem]).safeParse(raw);
		if (!body.success) return c.json({ error: "Invalid request", retry: false }, 400);
		const items = "scrobbles" in body.data ? body.data.scrobbles : [body.data];
		const userId = c.get("user").id;

		if (service === "listenbrainz") {
			const lb = await lbLink(c);
			if (!lb) return c.json({ ok: false, retry: false, error: "Connect ListenBrainz first" }, 409);
			const listens = items.map(s => ({ title: s.title, artist: s.artist, album: s.album, duration: s.duration, at: s.timestamp }));
			const res = await lbWrite(c, lb, token => lbSubmit(token, listens.length === 1 ? "single" : "import", listens));
			if (!res.ok) return c.json({ ok: false, revoked: res.revoked, retry: res.retry });
			invalidateUser(userId, "recent");
			invalidateUser(userId, "profile");
			return c.json({ ok: true, accepted: items.length, ignored: 0, retry: false });
		}

		const link = await requireLink(c);
		if (!link) return c.json({ ok: false, retry: false, error: "Connect Last.fm first" }, 409);
		const params: Record<string, string> = { method: "track.scrobble" };
		items.forEach((s, i) => {
			params[`track[${i}]`] = s.title;
			params[`artist[${i}]`] = s.artist;
			params[`timestamp[${i}]`] = String(s.timestamp);
			if (s.album) params[`album[${i}]`] = s.album;
			if (s.duration) params[`duration[${i}]`] = String(s.duration);
		});
		const res = await lastfmWrite<{ scrobbles?: { "@attr"?: { accepted?: number | string; ignored?: number | string } } }>(c, link, params);
		if (!res.data) return c.json({ ok: false, revoked: res.revoked, retry: res.retry });

		invalidateUser(userId, "recent");
		invalidateUser(userId, "profile");
		for (const s of items) {
			invalidateUser(userId, statSection(s.artist, s.title));
			invalidateUser(userId, `artist:${s.artist.toLowerCase()}`);
		}
		const attr = res.data.scrobbles?.["@attr"];
		return c.json({ ok: true, accepted: toCount(attr?.accepted), ignored: toCount(attr?.ignored), retry: false });
	});

	// A code typed into the account page rather than an emailed link, because a link only works in a
	// browser signed in on the site it points at, and accounts are used across all of our sites.

	const DELETE_CODE_TTL_MS = 15 * 60_000;
	const DELETE_MAX_TRIES = 5;
	const deleteCodeId = (userId: string) => `delete-account:${userId}`;
	const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
	type DeleteCode = { hash: string; tries: number; sentAt: number };

	app.post("/api/me/delete/request", async c => {
		const user = c.get("user");
		if (user.email.endsWith("@lastfm.invalid")) return c.json({ error: "Your account has no email address to confirm with. Email contact@fracit.al and tell us your username to delete it.", noEmail: true }, 409);
		if (!mailEnabled()) return c.json({ error: "We can't send email right now. Email contact@fracit.al to delete your account." }, 503);
		const adapter = (await c.get("auth").$context).internalAdapter;
		const existing = await adapter.findVerificationValue(deleteCodeId(user.id));
		const previous = existing ? (JSON.parse(existing.value) as DeleteCode) : null;
		if (previous && Date.now() - previous.sentAt < 60_000) return c.json({ error: "We just sent a code. Wait a minute before asking for another." }, 429);
		const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
		await adapter.deleteVerificationByIdentifier(deleteCodeId(user.id));
		await adapter.createVerificationValue({ identifier: deleteCodeId(user.id), value: JSON.stringify({ hash: hashCode(code), tries: 0, sentAt: Date.now() } satisfies DeleteCode), expiresAt: new Date(Date.now() + DELETE_CODE_TTL_MS) });
		try {
			await sendDeleteAccountEmail(user.email, code);
		} catch (err) {
			console.error("Delete account email failed:", err instanceof Error ? err.message : err);
			await adapter.deleteVerificationByIdentifier(deleteCodeId(user.id));
			return c.json({ error: "Couldn't send the email. Try again." }, 502);
		}
		return c.json({ ok: true, email: user.email });
	});

	app.post("/api/me/delete/confirm", async c => {
		const body = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Enter the 6-digit code from the email" }, 400);
		const user = c.get("user");
		const adapter = (await c.get("auth").$context).internalAdapter;
		const row = await adapter.findVerificationValue(deleteCodeId(user.id));
		if (!row || new Date(row.expiresAt).getTime() < Date.now()) return c.json({ error: "That code expired. Ask for a new one." }, 400);
		const record = JSON.parse(row.value) as DeleteCode;
		if (hashCode(body.data.code) !== record.hash) {
			await adapter.deleteVerificationByIdentifier(deleteCodeId(user.id));
			if (record.tries + 1 >= DELETE_MAX_TRIES) return c.json({ error: "Too many wrong codes. Ask for a new one." }, 400);
			await adapter.createVerificationValue({ identifier: deleteCodeId(user.id), value: JSON.stringify({ ...record, tries: record.tries + 1 }), expiresAt: new Date(row.expiresAt) });
			return c.json({ error: "That code isn't right." }, 400);
		}
		const res = await removeUser(c.get("auth"), c.get("pool"), user.id, c.req.raw.headers, false);
		return c.json({ ok: true, ...res });
	});

	/**
	 * Deletes a user, keeping a 30-day downloadable copy (data-export.ts). Connections are deleted
	 * explicitly, not only by cascade, so the same provider accounts can be linked to a new account
	 * right away. Returns the download link (null when there's no such user).
	 */
	const removeUser = async (auth: Auth, pool: Pool, userId: string, headers: Headers, byAdmin: boolean) => {
		const adapter = (await auth.$context).internalAdapter;
		const user = await adapter.findUserById(userId);
		if (!user) return null;
		// The copy comes first, so nothing is deleted unless it was saved.
		const { path, expires } = await saveExport(pool, user.name, await buildExport(pool, userId));
		const download = `${authOrigin() ?? ownOrigin(headers) ?? ""}${path}`;
		// A Discord status Fracital set would otherwise linger until it times out.
		const presence = await readPresence(pool, userId).catch(() => null);
		const discord = (await adapter.findAccounts(userId)).find(a => a.providerId === "discord");
		if (presence?.session_token && discord) {
			const token = await auth.api.getAccessToken({ body: { accountId: discord.id, userId } }).catch(() => null);
			if (token?.accessToken) await sendPresence(token.accessToken, presence.session_token, null).catch(() => undefined);
		}
		// Plays stay in the totals, no longer tied to anyone.
		await pool.query("update music_play_events set user_id = null where user_id = $1", [userId]);
		await adapter.deleteAccounts(userId);
		await pool.query("delete from fracital_listenbrainz where user_id = $1", [userId]);
		await pool.query('delete from passkey where "userId" = $1', [userId]).catch(() => undefined);
		await pool.query("delete from fracital_discord_presence where user_id = $1", [userId]);
		// Cross-site sign-in links, codes in flight and a pending deletion code all point at the user.
		await pool.query("delete from verification where value = $1 or identifier = $2", [userId, deleteCodeId(userId)]);
		await adapter.deleteUserSessions(userId);
		// The rest (settings, saved music, playlists, game saves, profile…) goes with the user row.
		await adapter.deleteUser(userId);
		invalidateUser(userId);
		const emailed = mailEnabled() && !user.email.endsWith("@lastfm.invalid");
		if (emailed) void sendAccountDeletedEmail(user.email, download, expires, byAdmin).catch(err => console.error("Account deleted email failed:", err instanceof Error ? err.message : err));
		return { download, expires, emailed };
	};

	// Admins delete accounts the same way (with the same 30-day copy and email), except admins'.
	app.delete("/api/admin/users/:id", async c => {
		const target = c.req.param("id");
		if (target === c.get("user").id) return c.json({ error: "Delete your own account from your account page" }, 400);
		const pool = c.get("pool");
		const user = await (await c.get("auth").$context).internalAdapter.findUserById(target);
		if (!user) return c.json({ error: "No such account" }, 404);
		if ((await userMeta(pool, user)).isAdmin) return c.json({ error: "Remove their admin role before deleting the account" }, 400);
		const res = await removeUser(c.get("auth"), pool, target, c.req.raw.headers, true);
		return c.json({ ok: true, ...res });
	});

	app.get("/api/me/discord/activity", async c => {
		if (!discordBotToken()) return c.json({ available: false });
		const { discord } = await lastfmLink(c);
		if (!discord) return c.json({ available: true, connected: false });
		if (!(await readPresence(c.get("pool"), c.get("user").id)).show_activity) return c.json({ available: true, connected: true, disabled: true });
		const bot = discordBotStatus();
		if (bot.state !== "ready") return c.json({ available: true, connected: true, bot: bot.state });
		return c.json({ available: true, connected: true, bot: bot.state, presence: discordPresenceFor(discord.accountId) });
	});

	app.put("/api/me/discord/activity/settings", async c => {
		const body = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		await writePresence(c.get("pool"), c.get("user").id, { show_activity: body.data.enabled });
		return c.json({ ok: true, enabled: body.data.enabled });
	});

	// --- Discord status (discord-presence.ts; off unless DISCORD_PRESENCE=1) ---

	/** A refused scope isn't retried for this long, unless the user reconnects or turns it back on. */
	const PRESENCE_BACKOFF_MS = 10 * 60_000;
	const presenceSentAt = new Map<string, number>();

	app.post("/api/me/presence", async c => {
		if (!discordPresenceEnabled()) return c.json({ ok: false, error: "Discord status isn't available" }, 404);
		const nowPlaying = z.object({ title: z.string().min(1).max(500), artist: z.string().min(1).max(500), album: z.string().max(500).optional(), artwork: z.string().max(2000).optional(), duration: z.number().positive().max(86_400).optional(), position: z.number().min(0).max(86_400).optional() });
		const body = z.object({ song: nowPlaying.nullable() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const song: NowPlaying | null = body.data.song;
		const userId = c.get("user").id;
		const { discord } = await lastfmLink(c);
		if (!discord || !hasPresenceScope(discord.scope)) return c.json({ ok: false, connected: false });
		const pool = c.get("pool");
		const row = await readPresence(pool, userId);
		if (!row.enabled) return c.json({ ok: true, enabled: false });
		if (!song && !row.session_token) return c.json({ ok: true });
		if (song && row.error && row.error_at && Date.now() - row.error_at.getTime() < PRESENCE_BACKOFF_MS) return c.json({ ok: false, error: row.error });
		// Songs change at most every couple of seconds; clearing always goes through.
		if (song && Date.now() - (presenceSentAt.get(userId) ?? 0) < 2000) return c.json({ ok: true, throttled: true });
		presenceSentAt.set(userId, Date.now());

		let accessToken = "";
		try {
			// Refreshes the Discord token when it has expired.
			accessToken = (await c.get("auth").api.getAccessToken({ body: { accountId: discord.id, userId } })).accessToken;
		} catch {
			// handled below
		}
		if (!accessToken) {
			const error = "Discord sign-in expired. Reconnect Discord to show your status.";
			await writePresence(pool, userId, { session_token: "", error });
			return c.json({ ok: false, error });
		}
		const res = await sendPresence(accessToken, row.session_token, song);
		if (res.ok) {
			if (res.token !== row.session_token || row.error) await writePresence(pool, userId, { session_token: res.token, error: "" });
			return c.json({ ok: true });
		}
		if (!res.temporary) await writePresence(pool, userId, { session_token: "", error: res.error });
		return c.json({ ok: false, error: res.error, retry: res.temporary });
	});

	// Turning it on (also after reconnecting Discord) clears an earlier refusal; turning it off clears the status.
	app.put("/api/me/presence/settings", async c => {
		if (!discordPresenceEnabled()) return c.json({ ok: false, error: "Discord status isn't available" }, 404);
		const body = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const pool = c.get("pool");
		const userId = c.get("user").id;
		const row = await readPresence(pool, userId);
		if (!body.data.enabled && row.session_token) {
			const { discord } = await lastfmLink(c);
			const token = discord
				? await c
						.get("auth")
						.api.getAccessToken({ body: { accountId: discord.id, userId } })
						.catch(() => null)
				: null;
			if (token?.accessToken) await sendPresence(token.accessToken, row.session_token, null);
		}
		await writePresence(pool, userId, { enabled: body.data.enabled, session_token: body.data.enabled ? row.session_token : "", error: "" });
		return c.json({ ok: true, enabled: body.data.enabled });
	});

	return app;
}
