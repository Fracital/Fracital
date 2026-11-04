/**
 * Fracital Accounts: email/password + Last.fm sign-in (better-auth on Postgres),
 * settings sync, and the signed-in user's Last.fm library/stats/scrobbling.
 *
 * Mounted by both the production Hono server (backend.ts) and the Vite dev server
 * (music-api.ts) via `getAccountsApp()`. Disabled (503) when DATABASE_URL is unset.
 *
 * Env: DATABASE_URL, BETTER_AUTH_SECRET, LASTFM_API_KEY, LASTFM_API_SECRET,
 *      optional BETTER_AUTH_URL (public origin) and BETTER_AUTH_TRUSTED_ORIGINS (comma list).
 */
import { createHash } from "node:crypto";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { getMigrations } from "better-auth/db/migration";
import { Hono, type MiddlewareHandler } from "hono";
import { Pool } from "pg";
import * as z from "zod";
import { asArray, lastfmCall, lastfmImage, lastfmKey, lastfmSecret, toCount } from "./lastfm";
import { findDeezerArtist, findDeezerTrack, type RadioTrack } from "./music-radio";
import { isBanned, migrateArtistTables, registerArtistRoutes, userMeta } from "./artists";

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

const lastfmPlugin = (): BetterAuthPlugin => ({
	id: "lastfm",
	endpoints: {
		lastfmStart: createAuthEndpoint(
			"/lastfm/start",
			{ method: "GET", query: z.object({ mode: z.enum(["signin", "link"]).default("signin") }) },
			async ctx => {
				if (!lastfmKey() || !lastfmSecret()) throw ctx.redirect(donePath("error", "Last.fm isn't configured on this server"));
				const nonce = createHash("sha256").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 24);
				await ctx.setSignedCookie(STATE_COOKIE, JSON.stringify({ mode: ctx.query.mode, nonce }), ctx.context.secret, { maxAge: 600, httpOnly: true, sameSite: "lax", path: "/" });
				const cb = `${ctx.context.baseURL}/lastfm/callback`;
				throw ctx.redirect(`https://www.last.fm/api/auth/?api_key=${encodeURIComponent(lastfmKey())}&cb=${encodeURIComponent(cb)}`);
			},
		),
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

const authOptions = (pool: Pool) => ({
	database: pool,
	secret: process.env.BETTER_AUTH_SECRET,
	baseURL: process.env.BETTER_AUTH_URL || undefined,
	basePath: "/api/auth",
	trustedOrigins,
	emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8 },
	session: { expiresIn: 60 * 60 * 24 * 30 },
	plugins: [lastfmPlugin()],
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
			await migrateArtistTables(pool);
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
function invalidateUser(userId: string, section?: string) {
	for (const key of userCache.keys()) if (key.startsWith(`${userId}:${section ?? ""}`)) userCache.delete(key);
}

const PERIODS = new Set(["7day", "1month", "3month", "6month", "12month", "overall"]);

// ============================================================
// HTTP routes
// ============================================================

export type Env = { Variables: { user: { id: string; name: string; email: string; image?: string | null }; auth: Auth; pool: Pool } };

const escapeForScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

let app: Hono<Env> | null = null;

/** Hono app serving /api/auth/* (better-auth) and /api/me/* (account + Last.fm). */
export function getAccountsApp() {
	if (app) return app;
	app = new Hono<Env>();

	// Popup landing page for Last.fm auth: tells the opener how it went, then closes.
	app.get("/api/me/lastfm/done", c => {
		const status = c.req.query("status") === "ok" ? "ok" : "error";
		const message = c.req.query("message") || "";
		return c.html(`<!doctype html><meta charset="utf-8"><title>Last.fm</title>
<body style="background:#1a1a1d;color:#eee;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>${status === "ok" ? "Connected to Last.fm. You can close this window." : "Last.fm sign-in failed."}</p>
<script>
const data = { type: "fracital:lastfm", status: ${escapeForScript(status)}, message: ${escapeForScript(message)} };
if (window.opener) { window.opener.postMessage(data, location.origin); window.close(); }
else setTimeout(() => location.replace("/"), 1500);
</script></body>`);
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

	const lastfmLink = async (c: { get: <K extends keyof Env["Variables"]>(k: K) => Env["Variables"][K] }) => {
		const adapter = (await c.get("auth").$context).internalAdapter;
		const accounts = await adapter.findAccounts(c.get("user").id);
		const acc = accounts.find(a => a.providerId === "lastfm");
		return { link: acc ? { id: acc.id, username: acc.accountId, sessionKey: acc.accessToken || "" } : null, hasPassword: accounts.some(a => a.providerId === "credential") };
	};

	// --- Profile ---

	app.get("/api/me", async c => {
		const user = c.get("user");
		const { link, hasPassword } = await lastfmLink(c);
		let lastfm = null;
		if (link) {
			const info = await cached(`${user.id}:profile`, 10 * 60_000, () => lastfmCall<LastfmUserInfo>({ method: "user.getInfo", user: link.username }));
			lastfm = {
				username: link.username,
				image: lastfmImage(info?.user?.image),
				playcount: toCount(info?.user?.playcount),
				url: info?.user?.url || `https://www.last.fm/user/${encodeURIComponent(link.username)}`,
				registered: info?.user?.registered?.unixtime ? Number(info.user.registered.unixtime) * 1000 : undefined,
			};
		}
		const { isAdmin, username, premium } = await userMeta(c.get("pool"), user);
		return c.json({ user: { id: user.id, name: user.name, email: user.email.endsWith("@lastfm.invalid") ? null : user.email, image: user.image ?? null }, hasPassword, lastfm, lastfmAvailable: !!(lastfmKey() && lastfmSecret()), isAdmin, username, premium });
	});

	app.delete("/api/me/lastfm", async c => {
		const { link, hasPassword } = await lastfmLink(c);
		if (!link) return c.json({ ok: true });
		// Last.fm-only accounts would be locked out without it.
		if (!hasPassword) return c.json({ error: "This account signs in with Last.fm, so it can't be disconnected" }, 400);
		await (await c.get("auth").$context).internalAdapter.deleteAccount(link.id);
		invalidateUser(c.get("user").id);
		return c.json({ ok: true });
	});

	// --- Settings sync (replaces the old Terbium KV store) ---

	app.get("/api/me/settings", async c => {
		const { rows } = await c.get("pool").query<{ value: string; updated_at: Date }>("select value, updated_at from fracital_settings where user_id = $1", [c.get("user").id]);
		return c.json(rows[0] ? { value: rows[0].value, updatedAt: rows[0].updated_at } : { value: null });
	});

	app.put("/api/me/settings", async c => {
		const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
		if (typeof body?.value !== "string" || body.value.length > 512_000) return c.json({ error: "value must be a string under 500KB" }, 400);
		await c
			.get("pool")
			.query("insert into fracital_settings (user_id, value, updated_at) values ($1, $2, now()) on conflict (user_id) do update set value = excluded.value, updated_at = now()", [c.get("user").id, body.value]);
		return c.json({ ok: true });
	});

	// --- Saved artists (the artist page's "add to library" button) ---

	app.get("/api/me/artists", async c => {
		const { rows } = await c
			.get("pool")
			.query<{ artist_id: string; name: string; picture: string }>("select artist_id, name, picture from fracital_saved_artists where user_id = $1 order by created_at desc", [c.get("user").id]);
		return c.json({ artists: rows.map(r => ({ id: r.artist_id, name: r.name, picture: r.picture })) });
	});

	app.put("/api/me/artists/:id", async c => {
		const body = z.object({ name: z.string().min(1).max(300), picture: z.string().max(2000).optional() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		await c
			.get("pool")
			.query("insert into fracital_saved_artists (user_id, artist_id, name, picture) values ($1, $2, $3, $4) on conflict (user_id, artist_id) do update set name = excluded.name, picture = excluded.picture", [
				c.get("user").id,
				c.req.param("id"),
				body.data.name,
				body.data.picture ?? "",
			]);
		return c.json({ ok: true, saved: true });
	});

	app.delete("/api/me/artists/:id", async c => {
		await c.get("pool").query("delete from fracital_saved_artists where user_id = $1 and artist_id = $2", [c.get("user").id, c.req.param("id")]);
		return c.json({ ok: true, saved: false });
	});

	// --- Last.fm library ---

	const requireLink = async (c: Parameters<typeof lastfmLink>[0]) => {
		const { link } = await lastfmLink(c);
		return link;
	};

	app.get("/api/me/library/:section", async c => {
		const link = await requireLink(c);
		if (!link) return c.json({ error: "Connect Last.fm first" }, 409);
		const userId = c.get("user").id;
		const user = link.username;
		const section = c.req.param("section");
		const period = PERIODS.has(c.req.query("period") || "") ? c.req.query("period")! : "6month";
		const limit = String(Math.min(Number(c.req.query("limit")) || 30, 50));

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
						const artists = await Promise.all(asArray(res?.topartists?.artist).filter(a => a.name).map(a => artistCard(a.name!, { userPlays: toCount(a.playcount) })));
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
		if (!link) return c.json({ error: "Connect Last.fm first" }, 409);
		const user = link.username;
		return c.json(
			await cached(`${c.get("user").id}:recs`, 30 * 60_000, async () => {
				type Named = { name?: string; match?: string; artist?: { name?: string } };
				const [topArtistsRes, topTracksRes] = await Promise.all([
					lastfmCall<{ topartists?: { artist?: Named | Named[] } }>({ method: "user.getTopArtists", user, period: "3month", limit: "50" }),
					lastfmCall<{ toptracks?: { track?: LastfmTrack | LastfmTrack[] } }>({ method: "user.getTopTracks", user, period: "1month", limit: "8" }),
				]);
				const topArtists = asArray(topArtistsRes?.topartists?.artist).map(a => a.name || "").filter(Boolean);
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
				const similarTracks = (
					await Promise.all(
						asArray(topTracksRes?.toptracks?.track)
							.slice(0, 6)
							.map(t => lastfmCall<{ similartracks?: { track?: LastfmTrack | LastfmTrack[] } }>({ method: "track.getSimilar", artist: artistName(t.artist), track: t.name || "", limit: "6" })),
					)
				)
					.flatMap(r => asArray(r?.similartracks?.track))
					.filter(t => {
						const key = `${artistName(t.artist)}|${t.name}`.toLowerCase();
						if (seen.has(key) || known.has(artistName(t.artist).toLowerCase())) return false;
						seen.add(key);
						return true;
					})
					.slice(0, 20);
				return { artists, tracks: await playableAll(similarTracks) };
			}),
		);
	});

	// The user's own play counts + loved state for a batch of songs.
	app.post("/api/me/stats/tracks", async c => {
		const link = await requireLink(c);
		if (!link) return c.json({});
		const body = (await c.req.json().catch(() => null)) as { tracks?: { key?: string; title?: string; artist?: string }[] } | null;
		const tracks = (body?.tracks ?? []).filter(t => t.key && t.title && t.artist).slice(0, 25);
		const entries = await Promise.all(
			tracks.map(async t => {
				const info = await cached(`${c.get("user").id}:stat:${t.artist}|${t.title}`.toLowerCase(), 5 * 60_000, () =>
					lastfmCall<{ track?: { userplaycount?: string; userloved?: string } }>({ method: "track.getInfo", artist: t.artist!, track: t.title!, username: link.username, autocorrect: "1" }),
				);
				return [t.key!, { userPlays: toCount(info?.track?.userplaycount), loved: info?.track?.userloved === "1" }] as const;
			}),
		);
		return c.json(Object.fromEntries(entries));
	});

	app.get("/api/me/stats/artist", async c => {
		const link = await requireLink(c);
		const name = c.req.query("name")?.trim();
		if (!link || !name) return c.json({ userPlays: null });
		const info = await cached(`${c.get("user").id}:artist:${name}`.toLowerCase(), 10 * 60_000, () =>
			lastfmCall<{ artist?: { stats?: { userplaycount?: string } } }>({ method: "artist.getInfo", artist: name, username: link.username }),
		);
		return c.json({ userPlays: toCount(info?.artist?.stats?.userplaycount) });
	});

	// --- Writes: love, now playing, scrobble ---

	const writeBody = z.object({ title: z.string().min(1).max(500), artist: z.string().min(1).max(500), album: z.string().max(500).optional(), duration: z.number().int().positive().max(86_400).optional() });

	app.post("/api/me/love", async c => {
		const link = await requireLink(c);
		if (!link) return c.json({ error: "Connect Last.fm first" }, 409);
		const body = writeBody.extend({ loved: z.boolean() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const { title, artist, loved } = body.data;
		const ok = await lastfmCall({ method: loved ? "track.love" : "track.unlove", track: title, artist, sk: link.sessionKey }, { signed: true, post: true });
		if (!ok) return c.json({ error: "Last.fm rejected the request" }, 502);
		invalidateUser(c.get("user").id, "loved");
		invalidateUser(c.get("user").id, `stat:${artist}|${title}`.toLowerCase());
		return c.json({ ok: true, loved });
	});

	app.post("/api/me/nowplaying", async c => {
		const link = await requireLink(c);
		if (!link) return c.json({ ok: false });
		const body = writeBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const { title, artist, album, duration } = body.data;
		const params: Record<string, string> = { method: "track.updateNowPlaying", track: title, artist, sk: link.sessionKey };
		if (album) params.album = album;
		if (duration) params.duration = String(duration);
		return c.json({ ok: !!(await lastfmCall(params, { signed: true, post: true })) });
	});

	app.post("/api/me/scrobble", async c => {
		const link = await requireLink(c);
		if (!link) return c.json({ ok: false });
		const body = writeBody.extend({ timestamp: z.number().int().positive() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const { title, artist, album, duration, timestamp } = body.data;
		const params: Record<string, string> = { method: "track.scrobble", track: title, artist, timestamp: String(timestamp), sk: link.sessionKey };
		if (album) params.album = album;
		if (duration) params.duration = String(duration);
		const ok = !!(await lastfmCall(params, { signed: true, post: true }));
		if (ok) invalidateUser(c.get("user").id, "recent");
		return c.json({ ok });
	});

	return app;
}
