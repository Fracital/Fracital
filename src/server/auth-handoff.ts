/**
 * Sign-in handoff: signing in on the auth host (BETTER_AUTH_URL) for another of
 * this server's hosts, for when the auth host is blocked on the user's network
 * or the sign-in method needs a redirect that only comes back to the auth host.
 *
 * 1. The app on host A (a decoy or mirror) opens the auth host's handoff page
 *    (/api/me/handoff) in a stomp proxy tab, passing its own origin and a
 *    PKCE-style challenge (sha256 of a verifier only the app holds).
 * 2. The user signs in there with any method. The page then asks for a
 *    one-time code (/api/auth/handoff/code), bound to the signed-in user, the
 *    challenge and host A, and navigates to host A's landing URL with it.
 * 3. The proxy refuses to proxy its own origin, so the app sees that URL
 *    without it ever loading, and redeems the code on host A
 *    (/api/auth/handoff/redeem) with the verifier: host A gets its own session.
 *
 * Codes only go to hosts this server serves (the decoys, the direct hosts and
 * BETTER_AUTH_TRUSTED_ORIGINS), live two minutes, and are single-use.
 */
import { createHash, randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { servedHosts } from "./cloak-routing";

const CODE_TTL_MS = 2 * 60 * 1000;
const PREFIX = "handoff:";

export const HANDOFF_PAGE = "/api/me/handoff";
export const HANDOFF_LANDING = "/api/me/handoff/land";

const base64url = (buf: Buffer) => buf.toString("base64url");
const sha256 = (value: string) => base64url(createHash("sha256").update(value).digest());

const authBase = () => process.env.BETTER_AUTH_URL?.trim() || "";

const stripPort = (host: string) => host.toLowerCase().replace(/:\d+$/, "");

/** The request's public host name (no port). */
export const requestHost = (headers: Headers | undefined) => stripPort(headers?.get("x-forwarded-host") || headers?.get("host") || "");

/** Whether a sign-in may be handed off to `hostname`: only hosts this server answers for. */
export function handoffHostAllowed(hostname: string): boolean {
	const host = stripPort(hostname);
	if (!host) return false;
	if (servedHosts().has(host)) return true;
	const trusted = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
		.split(",")
		.map(s => s.trim())
		.filter(Boolean);
	for (const origin of trusted) {
		try {
			if (new URL(origin).hostname.toLowerCase() === host) return true;
		} catch {
			// not a URL; skip
		}
	}
	return false;
}

/** The handoff page URL for a request on `hostname`, or null when that host signs in directly or isn't ours. */
export function handoffUrlFor(hostname: string): string | null {
	const base = authBase();
	if (!base) return null;
	const auth = new URL(base);
	if (auth.hostname.toLowerCase() === stripPort(hostname)) return null;
	return handoffHostAllowed(hostname) ? `${auth.origin}${HANDOFF_PAGE}` : null;
}

/** Parses an `https://host[:port]` origin the app sent, or null when it isn't one of ours. */
export function allowedReturnOrigin(value: string | undefined | null): URL | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.origin !== value.replace(/\/+$/, "")) return null;
		if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
		return handoffHostAllowed(url.hostname) ? url : null;
	} catch {
		return null;
	}
}

interface HandoffRecord {
	userId: string;
	challenge: string;
	host: string;
}

export const handoffPlugin = (): BetterAuthPlugin => ({
	id: "handoff",
	endpoints: {
		handoffCode: createAuthEndpoint("/handoff/code", { method: "POST", body: z.object({ returnTo: z.string().max(300), challenge: z.string().min(43).max(128) }) }, async ctx => {
			const session = await getSessionFromCtx(ctx);
			if (!session) throw new APIError("UNAUTHORIZED", { message: "Sign in first" });
			const target = allowedReturnOrigin(ctx.body.returnTo);
			if (!target) throw new APIError("BAD_REQUEST", { message: "That site can't receive a sign-in" });
			const code = base64url(randomBytes(32));
			const record: HandoffRecord = { userId: session.user.id, challenge: ctx.body.challenge, host: target.hostname.toLowerCase() };
			await ctx.context.internalAdapter.createVerificationValue({ identifier: `${PREFIX}${code}`, value: JSON.stringify(record), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
			return ctx.json({ code });
		}),
		handoffRedeem: createAuthEndpoint("/handoff/redeem", { method: "POST", body: z.object({ code: z.string().min(20).max(100), verifier: z.string().min(43).max(128) }) }, async ctx => {
			const expired = new APIError("BAD_REQUEST", { message: "That sign-in expired. Try again." });
			const row = await ctx.context.internalAdapter.consumeVerificationValue(`${PREFIX}${ctx.body.code}`);
			if (!row || new Date(row.expiresAt).getTime() < Date.now()) throw expired;
			let record: HandoffRecord;
			try {
				record = JSON.parse(row.value) as HandoffRecord;
			} catch {
				throw expired;
			}
			if (sha256(ctx.body.verifier) !== record.challenge || requestHost(ctx.headers) !== record.host) throw expired;
			const user = await ctx.context.internalAdapter.findUserById(record.userId);
			if (!user) throw new APIError("NOT_FOUND", { message: "Couldn't find your account" });
			const session = await ctx.context.internalAdapter.createSession(user.id);
			if (!session) throw new APIError("FORBIDDEN", { message: "This account can't sign in" });
			await setSessionCookie(ctx, { session, user });
			return ctx.json({ ok: true });
		}),
	},
	rateLimit: [{ pathMatcher: path => path.startsWith("/handoff/"), window: 15 * 60, max: 30 }],
});

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => HTML_ESCAPES[c] ?? c);
const escapeForScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const PROVIDER_LABELS: Record<string, string> = { google: "Google", discord: "Discord", github: "GitHub", microsoft: "Microsoft" };

export interface HandoffPageOptions {
	returnTo: URL;
	challenge: string;
	method: string;
	social: string[];
	lastfm: boolean;
	terbium: boolean;
}

/** The sign-in page on the auth host that the app opens in a proxy tab. Self-contained: no app bundle, no third-party requests. */
export function renderHandoffPage(o: HandoffPageOptions): string {
	const cfg = { returnTo: o.returnTo.origin, challenge: o.challenge, method: o.method, landing: HANDOFF_LANDING };
	const social = o.social.map(p => `<button type="button" class="btn social" data-provider="${escapeHtml(p)}">${escapeHtml(PROVIDER_LABELS[p] || p)}</button>`).join("");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sign in</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1a1a1d;color:#eee;font:15px system-ui,sans-serif}
main{width:min(380px,92vw);display:flex;flex-direction:column;gap:12px;padding:24px 0}
h1{margin:0;font-size:24px;text-align:center}.sub{margin:0 0 4px;text-align:center;opacity:.65;font-size:13px}
.btn{width:100%;padding:10px;border:0;border-radius:8px;font:600 14px system-ui,sans-serif;cursor:pointer;background:#ffffff18;color:#eee}.btn:hover{background:#ffffff28}.btn:disabled{opacity:.5;cursor:default}
.primary{background:#6d5dfc}.primary:hover{background:#7f71ff}.lastfm{background:#d51007;color:#fff}.lastfm:hover{background:#e5200f}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px}
input{width:100%;padding:10px;border-radius:8px;border:1px solid #ffffff22;background:#ffffff0d;color:#eee;font:14px system-ui,sans-serif}
form{display:flex;flex-direction:column;gap:8px}.sep{display:flex;align-items:center;gap:10px;font-size:12px;opacity:.55}.sep:before,.sep:after{content:"";flex:1;height:1px;background:currentColor;opacity:.4}
.link{background:none;border:0;color:#aaa;font:600 13px system-ui,sans-serif;cursor:pointer;padding:4px}.link:hover{color:#fff}
.err{display:none;padding:10px;border-radius:8px;background:#ff4d4d22;color:#ff9a9a;font-size:13px}.err.on{display:block}
[hidden]{display:none!important}
</style></head><body><main>
<h1 id="title">Sign in</h1><p class="sub">to continue on ${escapeHtml(o.returnTo.hostname)}</p>
<div class="err" id="err"></div>
<section id="who" hidden><p class="sub">Signed in as <b id="who-name"></b></p><button class="btn primary" id="continue">Continue</button><button class="link" id="switch">Use a different account</button></section>
<section id="pick" hidden style="display:flex;flex-direction:column;gap:10px">
${o.lastfm ? '<button type="button" class="btn lastfm" id="lastfm">Continue with Last.fm</button>' : ""}
${social ? `<div class="row">${social}</div>` : ""}
<div class="sep">or with email</div>
<form id="email"><input id="name" placeholder="Name" autocomplete="name" hidden><input id="mail" type="email" placeholder="Email" autocomplete="email" required><input id="pass" type="password" placeholder="Password" autocomplete="current-password" required><button class="btn primary" id="submit">Sign in</button></form>
<button class="link" id="mode">Don't have an account? Register</button>
${o.terbium ? '<button class="link" id="terbium">Sign in with Terbium instead</button>' : ""}
</section>
</main><script>
(() => {
const cfg = ${escapeForScript(cfg)};
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
// The done pages (Last.fm, OAuth) come back here when they have no opener.
const here = new URL(location.href);
["done", "error", "error_message"].forEach(k => here.searchParams.delete(k));
sessionStorage.setItem("fr:handoff", here.href);
let mode = "signin";
const fail = msg => { $("err").textContent = msg; $("err").classList.add("on"); document.querySelectorAll("button").forEach(b => (b.disabled = false)); };
const busy = () => { $("err").classList.remove("on"); document.querySelectorAll("button").forEach(b => (b.disabled = true)); };
const api = async (path, body) => {
	const res = await fetch("/api/auth" + path, { method: body ? "POST" : "GET", credentials: "include", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error((data && (data.message || data.error)) || "Request failed (" + res.status + ")");
	return data;
};
const handOff = async () => {
	busy();
	try {
		const { code } = await api("/handoff/code", { returnTo: cfg.returnTo, challenge: cfg.challenge });
		sessionStorage.removeItem("fr:handoff");
		location.replace(cfg.returnTo + cfg.landing + "?code=" + encodeURIComponent(code));
	} catch (e) { fail(e.message); }
};
const social = async provider => {
	busy();
	try {
		const res = await api("/sign-in/social", { provider, callbackURL: "/api/me/oauth/done?status=ok", errorCallbackURL: "/api/me/oauth/done?status=error", newUserCallbackURL: "/api/me/oauth/done?status=ok", disableRedirect: true });
		if (!res || !res.url) throw new Error("Couldn't start sign-in");
		location.href = res.url;
	} catch (e) { fail(e.message); }
};
const showPick = () => { $("who").hidden = true; $("pick").hidden = false; };
document.querySelectorAll("[data-provider]").forEach(b => b.addEventListener("click", () => social(b.dataset.provider)));
if ($("lastfm")) $("lastfm").addEventListener("click", () => { busy(); location.href = "/api/auth/lastfm/start?mode=signin"; });
$("continue").addEventListener("click", handOff);
$("switch").addEventListener("click", async () => { busy(); await api("/sign-out", {}).catch(() => {}); document.querySelectorAll("button").forEach(b => (b.disabled = false)); showPick(); });
$("mode").addEventListener("click", () => {
	mode = mode === "terbium" || mode === "register" ? "signin" : "register";
	$("name").hidden = mode !== "register";
	$("name").required = mode === "register";
	$("title").textContent = mode === "register" ? "Create an account" : "Sign in";
	$("submit").textContent = mode === "register" ? "Create account" : "Sign in";
	$("mode").textContent = mode === "register" ? "Have an account? Sign in" : "Don't have an account? Register";
});
if ($("terbium")) $("terbium").addEventListener("click", () => {
	mode = "terbium";
	$("name").hidden = true;
	$("name").required = false;
	$("title").textContent = "Sign in with Terbium";
	$("submit").textContent = "Sign in";
	$("mode").textContent = "Use an email account instead";
});
$("email").addEventListener("submit", async e => {
	e.preventDefault();
	const email = $("mail").value.trim(), password = $("pass").value;
	busy();
	try {
		if (mode === "terbium") await api("/terbium/sign-in", { email, password, mode: "signin" });
		else if (mode === "register") await api("/sign-up/email", { name: $("name").value.trim(), email, password });
		else await api("/sign-in/email", { email, password });
		await handOff();
	} catch (err) { fail(err.message); }
});

(async () => {
	const error = q.get("error_message");
	const session = await api("/get-session").catch(() => null);
	if (session && session.user) {
		if (q.get("done") === "1") return handOff();
		$("who-name").textContent = session.user.name || session.user.email || "";
		$("who").hidden = false;
		return;
	}
	showPick();
	if (error) return fail(error);
	// One click in the app: start the chosen method right away.
	if (cfg.method === "lastfm" && $("lastfm")) $("lastfm").click();
	else if (cfg.method && document.querySelector('[data-provider="' + cfg.method + '"]')) social(cfg.method);
})();
})();
</script></body></html>`;
}
