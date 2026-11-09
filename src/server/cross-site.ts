/**
 * Staying signed in across our sites. Every host this server answers for (the
 * decoys, the direct hosts) shares one account database, but each has its own
 * cookies, so a browser signed in on one is signed out on the next. The hub, one
 * of our hosts (SIGNIN_HUB_URL, default the BETTER_AUTH_URL origin), remembers a
 * browser that opted in with its own third-party cookie and hands sign-ins out.
 *
 * The app talks to the hub through a hidden frame (/api/me/hub/frame):
 * - link: a signed-in host asks its own server for a one-time code for the hub,
 *   and the frame redeems it at the hub, which sets the hub cookie.
 * - bridge: a signed-out host asks the frame for a sign-in. The hub reads its
 *   cookie and issues a one-time code for that host, which the app redeems on its
 *   own server (/api/auth/handoff/redeem) for a session of its own.
 * - unlink and status: what they say.
 *
 * Codes are PKCE-bound (only the page that asked holds the verifier), bound to
 * one host, single-use, and live two minutes. They only go to our hosts. The hub
 * endpoints only answer the hub's own frame (Origin check). Needs third-party
 * cookies on the hub; where the browser blocks them, nothing happens.
 *
 * OAuth from any of our hosts: providers only call back to the auth host
 * (BETTER_AUTH_URL), so another host runs OAuth there in a popup:
 * - /api/me/hub/signin (auth host) starts the provider's sign-in, or, to connect a
 *   provider, first signs the popup in with a code the app got from its own host.
 * - /api/me/hub/done (auth host) is where the provider returns; it issues a code for
 *   the app's host and sends the popup back there, to /api/me/hub/back.
 * - /api/me/hub/back (the app's host) hands the result to the app on the same origin
 *   (BroadcastChannel, so it works even when the provider's pages cut the popup off
 *   from its opener) and closes. The code only ever lands in the browser that runs the
 *   flow, on our own origin, and is useless without the app's verifier.
 */
import { createHash, randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import * as z from "zod";
import { servedHosts } from "./cloak-routing";

const CODE_TTL_MS = 2 * 60 * 1000;
const HUB_TTL_S = 60 * 60 * 24 * 30;
const CODE_PREFIX = "handoff:";
const HUB_PREFIX = "hub:";
const HUB_COOKIE = "frh";
const OFF_COOKIE = "frh_off";
const PAUSE_COOKIE = "frh_pause";
const HUB_PATH = "/api/me/hub";

const base64url = (buf: Buffer) => buf.toString("base64url");
const sha256 = (value: string) => base64url(createHash("sha256").update(value).digest());
const stripPort = (host: string) => host.toLowerCase().replace(/:\d+$/, "");
const env = (key: string) => process.env[key]?.trim() || "";

/** The request's public host name (no port). */
const requestHost = (headers: Headers | undefined) => stripPort(headers?.get("x-forwarded-host") || headers?.get("host") || "");

/** The hub's origin, or null when neither SIGNIN_HUB_URL nor BETTER_AUTH_URL is set. */
export function hubOrigin(): string | null {
	const raw = env("SIGNIN_HUB_URL") || env("BETTER_AUTH_URL");
	if (!raw) return null;
	try {
		return new URL(raw).origin;
	} catch {
		return null;
	}
}

/** The auth host's origin (BETTER_AUTH_URL): where OAuth providers call back. null when unset. */
export function authOrigin(): string | null {
	try {
		return env("BETTER_AUTH_URL") ? new URL(env("BETTER_AUTH_URL")).origin : null;
	} catch {
		return null;
	}
}

const hubHost = () => {
	const origin = hubOrigin();
	return origin ? new URL(origin).hostname.toLowerCase() : "";
};

/** Hosts that may receive a sign-in: ours (decoys, direct hosts), the auth host, the hub and BETTER_AUTH_TRUSTED_ORIGINS. */
function hostAllowed(hostname: string): boolean {
	const host = stripPort(hostname);
	if (!host) return false;
	if (servedHosts().has(host) || host === hubHost()) return true;
	const origins = [env("BETTER_AUTH_URL"), ...env("BETTER_AUTH_TRUSTED_ORIGINS").split(",")].map(s => s.trim()).filter(Boolean);
	return origins.some(origin => {
		try {
			return new URL(origin).hostname.toLowerCase() === host;
		} catch {
			return false;
		}
	});
}

/**
 * The public origin a request came in on, when it's one of our hosts (else null). Lets
 * flows that return to us (Last.fm's callback) come back to the site the user is on.
 */
export function ownOrigin(headers: Headers | undefined): string | null {
	const host = (headers?.get("x-forwarded-host") || headers?.get("host") || "").toLowerCase();
	if (!host || !hostAllowed(host)) return null;
	const local = ["localhost", "127.0.0.1"].includes(stripPort(host));
	const proto = headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
	if (proto !== "https" && !(proto === "http" && local)) return null;
	return `${proto}://${host}`;
}

/** Parses an origin the app sent (`https://host[:port]`), or null when it isn't one of ours. */
export function allowedOrigin(value: string | undefined | null): URL | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.origin !== value.replace(/\/+$/, "")) return null;
		const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
		if (url.protocol !== "https:" && !local) return null;
		return hostAllowed(url.hostname) ? url : null;
	} catch {
		return null;
	}
}

// The parts of better-auth's internal adapter this file uses.
interface Adapter {
	createVerificationValue(data: { identifier: string; value: string; expiresAt: Date }): Promise<unknown>;
	findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null>;
	consumeVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null>;
	deleteVerificationByIdentifier(identifier: string): Promise<void>;
}

interface CodeRecord {
	userId: string;
	challenge: string;
	host: string;
}

export async function issueCode(adapter: Adapter, userId: string, challenge: string, host: string): Promise<string> {
	const code = base64url(randomBytes(32));
	const record: CodeRecord = { userId, challenge, host: host.toLowerCase() };
	await adapter.createVerificationValue({ identifier: `${CODE_PREFIX}${code}`, value: JSON.stringify(record), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
	return code;
}

/** The user a code was issued for, when the verifier and host match; consumes it either way. */
async function consumeCode(adapter: Adapter, code: string, verifier: string, host: string): Promise<string | null> {
	const row = await adapter.consumeVerificationValue(`${CODE_PREFIX}${code}`);
	if (!row || new Date(row.expiresAt).getTime() < Date.now()) return null;
	try {
		const record = JSON.parse(row.value) as CodeRecord;
		return sha256(verifier) === record.challenge && host === record.host ? record.userId : null;
	} catch {
		return null;
	}
}

const challengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);

/** better-auth endpoints: a signed-in host issues a code for another of our hosts; a host redeems one for a session. */
export const handoffPlugin = (): BetterAuthPlugin => ({
	id: "handoff",
	endpoints: {
		handoffCode: createAuthEndpoint("/handoff/code", { method: "POST", body: z.object({ returnTo: z.string().max(300), challenge: challengeSchema }) }, async ctx => {
			const session = await getSessionFromCtx(ctx);
			if (!session) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
			const target = allowedOrigin(ctx.body.returnTo);
			if (!target) throw new APIError("BAD_REQUEST", { message: "That site can't receive a sign-in" });
			return ctx.json({ code: await issueCode(ctx.context.internalAdapter, session.user.id, ctx.body.challenge, target.hostname) });
		}),
		handoffRedeem: createAuthEndpoint("/handoff/redeem", { method: "POST", body: z.object({ code: z.string().min(20).max(100), verifier: z.string().min(43).max(128) }) }, async ctx => {
			const adapter = ctx.context.internalAdapter;
			const userId = await consumeCode(adapter, ctx.body.code, ctx.body.verifier, requestHost(ctx.headers));
			if (!userId) throw new APIError("BAD_REQUEST", { message: "That sign-in expired. Try again." });
			const user = await adapter.findUserById(userId);
			if (!user) throw new APIError("NOT_FOUND", { message: "Couldn't find your account" });
			const session = await adapter.createSession(user.id);
			if (!session) throw new APIError("FORBIDDEN", { message: "This account can't sign in" });
			await setSessionCookie(ctx, { session, user });
			return ctx.json({ ok: true });
		}),
	},
	rateLimit: [{ pathMatcher: path => path.startsWith("/handoff/"), window: 15 * 60, max: 60 }],
});

// ============================================================
// Hub routes
// ============================================================

/** The hub frame's script: relays the app's requests to the hub endpoints and answers the asking window only. */
const FRAME_HTML = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title></title><script>
(() => {
	const post = (path, body) => fetch(${JSON.stringify(HUB_PATH)} + "/" + path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).then(r => r.json().catch(() => ({})));
	const ops = {
		status: () => post("status"),
		link: d => post("link", { code: d.code, verifier: d.verifier, reason: d.reason }),
		bridge: (d, origin) => post("bridge", { returnTo: origin, challenge: d.challenge }),
		unlink: d => post("unlink", { off: !!d.off }),
	};
	addEventListener("message", e => {
		const d = e.data;
		if (!d || d.type !== "fr:hub" || !ops[d.op] || !e.source) return;
		Promise.resolve(ops[d.op](d, e.origin)).catch(() => ({ error: "unavailable" })).then(result => e.source.postMessage({ type: "fr:hub", id: d.id, result }, e.origin));
	});
	parent.postMessage({ type: "fr:hub", ready: true }, "*");
})();
</script>`;

/** The OAuth popup's first page on the auth host: starts the provider's sign-in (see the top of this file). */
const signinPage = (cfg: { method: string; mode: "signin" | "link"; scopes: string[]; returnTo: string; challenge: string }) => `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title></title>
<body style="background:#1a1a1d;color:#eee;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>…</p><script>
(async () => {
	const cfg = ${JSON.stringify(cfg).replace(/</g, "\\u003c")};
	// The connect flow's code is in the fragment (never sent to a server); drop it from the address bar.
	const frag = new URLSearchParams(location.hash.slice(1));
	history.replaceState(null, "", location.pathname + location.search);
	const done = (status, message) => ${JSON.stringify(HUB_PATH)} + "/done?" + new URLSearchParams({ return: cfg.returnTo, challenge: cfg.challenge, mode: cfg.mode, status, ...(message ? { message } : {}) });
	const post = (path, body) => fetch("/api/auth" + path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));
	try {
		if (cfg.mode === "link") {
			const signedIn = await post("/handoff/redeem", { code: frag.get("c") || "", verifier: frag.get("v") || "" });
			if (!signedIn.ok) return location.replace(done("error", signedIn.data.message || "Your sign-in expired. Try again."));
		}
		const urls = { callbackURL: done("ok"), errorCallbackURL: done("error"), disableRedirect: true };
		const res = cfg.mode === "link" ? await post("/link-social", { provider: cfg.method, ...(cfg.scopes.length ? { scopes: cfg.scopes } : {}), ...urls }) : await post("/sign-in/social", { provider: cfg.method, newUserCallbackURL: urls.callbackURL, ...urls });
		if (!res.ok || !res.data.url) return location.replace(done("error", res.data.message || ""));
		location.replace(res.data.url);
	} catch {
		location.replace(done("error"));
	}
})();
</script></body>`;

/** The popup's last page, on the app's own host: passes the result to the app and closes. */
const BACK_HTML = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title></title>
<body style="background:#1a1a1d;color:#eee;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>You can close this window.</p><script>
(() => {
	const result = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
	history.replaceState(null, "", location.pathname);
	try { new BroadcastChannel("frh").postMessage(result); } catch {}
	setTimeout(() => close(), 400);
})();
</script></body>`;

interface HubAuth {
	adapter: Adapter & { findUserById(id: string): Promise<{ id: string } | null> };
	/** The signed-in user on this request, or null. */
	sessionUserId(headers: Headers): Promise<string | null>;
}

/**
 * Mounts the hub frame, its endpoints and the OAuth popup pages. `auth` resolves the auth context
 * (null when accounts are off); `oauthError` turns better-auth's error codes into text for the user.
 */
export function registerHubRoutes<E extends object>(app: Hono<{ Variables: E }>, auth: () => Promise<HubAuth | null>, oauthError: (code: string) => string) {
	const onHub = (c: Context) => requestHost(c.req.raw.headers) === hubHost();
	// Browsers accept Secure cookies on http://localhost, which lets the dev server exercise the hub.
	const secure = (c: Context) => c.req.url.startsWith("https:") || c.req.header("x-forwarded-proto") === "https" || requestHost(c.req.raw.headers) === "localhost";
	// Only the hub's own frame may call these: a page on another site posting here would carry its own Origin.
	const fromFrame = (c: Context) => {
		const origin = hubOrigin();
		const got = c.req.header("origin");
		return !!origin && got === origin && c.req.header("sec-fetch-site") !== "cross-site";
	};
	const cookieOpts = (c: Context, maxAge: number) => ({ path: HUB_PATH, httpOnly: true, maxAge, ...(secure(c) ? { secure: true, sameSite: "None" as const } : { sameSite: "Lax" as const }) });
	const tokenId = (token: string) => `${HUB_PREFIX}${sha256(token)}`;

	app.get(`${HUB_PATH}/frame`, c => {
		if (!onHub(c)) return c.notFound();
		c.header("Cache-Control", "no-store");
		c.header("Referrer-Policy", "no-referrer");
		return c.html(FRAME_HTML);
	});

	// --- OAuth from any of our hosts (see the top of this file) ---

	const onAuthHost = (c: Context) => {
		const origin = authOrigin();
		return !!origin && requestHost(c.req.raw.headers) === new URL(origin).hostname.toLowerCase();
	};
	const flowQuery = z.object({ return: z.string().max(300), challenge: challengeSchema, mode: z.enum(["signin", "link"]).default("signin") });

	app.get(`${HUB_PATH}/signin`, c => {
		if (!onAuthHost(c)) return c.notFound();
		const q = flowQuery.extend({ method: z.enum(["google", "discord", "github", "microsoft"]), scopes: z.string().max(200).optional() }).safeParse(c.req.query());
		const target = q.success ? allowedOrigin(q.data.return) : null;
		if (!q.success || !target) return c.text("This sign-in link isn't valid.", 400);
		c.header("Cache-Control", "no-store");
		c.header("Referrer-Policy", "no-referrer");
		const scopes = (q.data.scopes || "").split(/[\s,]+/).filter(s => /^[\w.:-]{1,60}$/.test(s));
		return c.html(signinPage({ method: q.data.method, mode: q.data.mode, scopes, returnTo: target.origin, challenge: q.data.challenge }));
	});

	app.get(`${HUB_PATH}/done`, async c => {
		if (!onAuthHost(c)) return c.notFound();
		const q = flowQuery.extend({ status: z.string().optional(), error: z.string().max(200).optional(), message: z.string().max(300).optional() }).safeParse(c.req.query());
		const target = q.success ? allowedOrigin(q.data.return) : null;
		if (!q.success || !target) return c.text("This sign-in link isn't valid.", 400);
		c.header("Cache-Control", "no-store");
		c.header("Referrer-Policy", "no-referrer");
		const back = (result: Record<string, string>) => c.redirect(`${target.origin}${HUB_PATH}/back#${new URLSearchParams({ s: q.data.challenge, ...result })}`, 302);
		const failed = (message: string) => back({ e: message });
		if (q.data.status !== "ok" || q.data.error) return failed(q.data.message || (q.data.error ? oauthError(q.data.error) : "") || "Sign-in didn't finish. Try again.");
		if (q.data.mode === "link") return back({ ok: "1" });
		const ctx = await auth();
		const userId = ctx ? await ctx.sessionUserId(c.req.raw.headers) : null;
		if (!ctx || !userId) return failed("Sign-in didn't finish. Try again.");
		return back({ c: await issueCode(ctx.adapter, userId, q.data.challenge, target.hostname) });
	});

	app.get(`${HUB_PATH}/back`, c => {
		c.header("Cache-Control", "no-store");
		c.header("Referrer-Policy", "no-referrer");
		return c.html(BACK_HTML);
	});

	app.post(`${HUB_PATH}/:op{status|link|bridge|unlink}`, async c => {
		if (!onHub(c) || !fromFrame(c)) return c.json({ error: "forbidden" }, 403);
		const ctx = await auth();
		if (!ctx) return c.json({ error: "unavailable" }, 503);
		const { adapter } = ctx;
		const body = ((await c.req.json().catch(() => null)) || {}) as Record<string, unknown>;
		const token = getCookie(c, HUB_COOKIE);
		const linkedUser = async () => {
			if (!token) return null;
			const row = await adapter.findVerificationValue(tokenId(token));
			return row && new Date(row.expiresAt).getTime() > Date.now() ? row.value : null;
		};

		switch (c.req.param("op")) {
			case "status":
				return c.json({ linked: !!(await linkedUser()), off: getCookie(c, OFF_COOKIE) === "1" });

			case "link": {
				// "toggle": the user's own switch. "signin": right after they signed in. "startup": a
				// signed-in site linking an unlinked browser on load. Turned off here: only the toggle
				// relinks. Signed out here: the next sign-in relinks, a still-signed-in site doesn't.
				const reason = body.reason === "toggle" || body.reason === "signin" ? body.reason : "startup";
				if (reason !== "toggle" && getCookie(c, OFF_COOKIE) === "1") return c.json({ linked: false, off: true });
				if (reason === "startup" && getCookie(c, PAUSE_COOKIE) === "1") return c.json({ linked: false });
				const userId = await consumeCode(adapter, String(body.code || ""), String(body.verifier || ""), hubHost());
				if (!userId) return c.json({ error: "expired" }, 400);
				if (token) await adapter.deleteVerificationByIdentifier(tokenId(token)).catch(() => {});
				const fresh = base64url(randomBytes(32));
				await adapter.createVerificationValue({ identifier: tokenId(fresh), value: userId, expiresAt: new Date(Date.now() + HUB_TTL_S * 1000) });
				setCookie(c, HUB_COOKIE, fresh, cookieOpts(c, HUB_TTL_S));
				if (reason === "toggle") setCookie(c, OFF_COOKIE, "", cookieOpts(c, 0));
				setCookie(c, PAUSE_COOKIE, "", cookieOpts(c, 0));
				return c.json({ linked: true });
			}

			case "bridge": {
				const target = allowedOrigin(typeof body.returnTo === "string" ? body.returnTo : "");
				const challenge = challengeSchema.safeParse(body.challenge);
				if (!target || !challenge.success) return c.json({ error: "bad request" }, 400);
				const userId = await linkedUser();
				if (!userId || !(await adapter.findUserById(userId))) return c.json({ linked: false });
				return c.json({ code: await issueCode(adapter, userId, challenge.data, target.hostname) });
			}

			case "unlink":
				if (token) await adapter.deleteVerificationByIdentifier(tokenId(token)).catch(() => {});
				setCookie(c, HUB_COOKIE, "", cookieOpts(c, 0));
				if (body.off === true) setCookie(c, OFF_COOKIE, "1", cookieOpts(c, 60 * 60 * 24 * 365));
				else setCookie(c, PAUSE_COOKIE, "1", cookieOpts(c, HUB_TTL_S));
				return c.json({ linked: false });
		}
		return c.json({ error: "unknown" }, 404);
	});
}
