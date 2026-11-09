/**
 * Fracital API crypto — server side (Hono).
 *
 * A single middleware seals every /api/* JSON response for clients that
 * negotiate it (cryptoFetch sends the header). The seed lives in the `wcs`
 * cookie, minted on the app shell and on any API call that lacks one; both
 * ends derive the same directional keys from it (HKDF, domain-separated from
 * the relay codec). Sealed bodies are per-session ciphertext, so they are
 * always `private, no-store` and `Vary` on the negotiation header.
 *
 * Non-JSON responses (streams, binaries, redirects) pass through untouched,
 * as do plaintext clients — sealing is transparent and opt-in.
 */

import type { Context, MiddlewareHandler } from "hono";
import { generateSeed, encodeSeed, WCS_COOKIE_NAME } from "../libs/seal-codec";
import { deriveApiKeys, sealText, seedFromCookieHeader, API_CRYPTO_HEADER, API_CRYPTO_TOKEN, API_CRYPTO_CONTENT_TYPE } from "../libs/api-crypto-codec";

function hasSeedCookie(c: Context): boolean {
	return seedFromCookieHeader(c.req.header("cookie")) !== null;
}

/** Mint the seed cookie when the request doesn't carry a usable one. */
export function ensureSeedCookie(c: Context): void {
	if (hasSeedCookie(c)) return;
	const seed = encodeSeed(generateSeed());
	const secure = c.req.url.startsWith("https:");
	c.header("Set-Cookie", `${WCS_COOKIE_NAME}=${seed}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`, { append: true });
}

/** The client asked for sealed responses (the app's cryptoFetch does; a plain request doesn't). */
export function clientNegotiated(c: Context): boolean {
	const value = c.req.header(API_CRYPTO_HEADER) || "";
	return value.split(",").some(t => t.trim() === API_CRYPTO_TOKEN);
}

// ---------------------------------------------------------------------------
// Framework-free helpers (unit-tested directly; the Hono middleware wraps them).
// ---------------------------------------------------------------------------

/** True when the request headers advertise our sealing version. */
export function clientAcceptsCrypto(request: { headers: Record<string, unknown> }): boolean {
	const raw = request.headers[API_CRYPTO_HEADER];
	const value = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
	if (!value) return false;
	return value.split(",").some(token => token.trim() === API_CRYPTO_TOKEN);
}

interface MockResponse {
	statusCode: number;
	headers: Record<string, string>;
	setHeader(name: string, value: string): void;
	end(body: Uint8Array): void;
}

/**
 * Seal `bodyText` for the requester when they negotiated it and a seed is
 * available. Returns true when it wrote the sealed response (caller must stop),
 * false when the caller should send plaintext. Mirrors abulxt's helper so the
 * codec test suite exercises the exact negotiation/ sealing path.
 */
export function writeSealedJson(request: { headers: Record<string, unknown> }, response: MockResponse, bodyText: string, status = 200): boolean {
	if (!clientAcceptsCrypto(request)) return false;
	const seed = seedFromCookieHeader(request.headers.cookie as string | undefined);
	if (!seed) return false;
	let keyRes: Uint8Array;
	try {
		keyRes = deriveApiKeys(seed).keyRes;
	} catch {
		return false;
	}
	const frame = sealText(keyRes, bodyText);
	response.statusCode = status;
	response.setHeader("Content-Type", API_CRYPTO_CONTENT_TYPE);
	response.setHeader(API_CRYPTO_HEADER, API_CRYPTO_TOKEN);
	response.setHeader("Vary", API_CRYPTO_HEADER);
	response.setHeader("Cache-Control", "private, no-store");
	response.end(Buffer.from(frame));
	return true;
}

/**
 * Seal /api/* JSON responses for negotiating clients. Mount before the API
 * routes: app.use("/api/*", sealApiResponses())
 */
export function sealApiResponses(): MiddlewareHandler {
	return async (c, next) => {
		// Seed for THIS response: the request's cookie when present, else the one
		// we mint right now (the Set-Cookie lands before the body is read).
		const existing = seedFromCookieHeader(c.req.header("cookie"));
		const seed = existing ?? generateSeed();
		await next();
		// Appended to the route's response, not set before it runs: Hono replaces the cookies a
		// handler's own Response sets with ones set beforehand, which dropped better-auth's session
		// and OAuth state cookies on any request that came without a seed (a first OAuth callback).
		if (!existing) c.header("Set-Cookie", `${WCS_COOKIE_NAME}=${encodeSeed(seed)}; Path=/; SameSite=Lax${c.req.url.startsWith("https:") ? "; Secure" : ""}`, { append: true });
		if (!clientNegotiated(c)) return;
		const res = c.res;
		if (!(res.headers.get("content-type") || "").includes("application/json")) return;
		let keyRes: Uint8Array;
		try {
			keyRes = deriveApiKeys(seed).keyRes;
		} catch {
			return;
		}
		const text = await res.text();
		const frame = sealText(keyRes, text);
		const headers = new Headers(res.headers);
		headers.set("Content-Type", API_CRYPTO_CONTENT_TYPE);
		headers.set(API_CRYPTO_HEADER, API_CRYPTO_TOKEN);
		headers.set("Vary", API_CRYPTO_HEADER);
		headers.set("Cache-Control", "private, no-store");
		headers.delete("content-length");
		// Fresh copy so the body is Uint8Array<ArrayBuffer> (BodyInit-safe).
		c.res = new Response(new Uint8Array(frame), { status: res.status, statusText: res.statusText, headers });
	};
}
