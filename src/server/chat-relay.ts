/**
 * The community chat (about:chat): holt's chatbox served on Fracital's own origin.
 *
 * holt (github.com/y9x/holt) is the chat service shared by several sites. A site "proxy-embeds" it: every
 * request under one path of its own is forwarded to holt's `/<platform id>/`, with the site's license in
 * `X-Holt-License` (never sent to the browser). The chat page then runs same-origin with the app, so the
 * visitor's Fracital session cookie comes along; holt asks Fracital who that is by calling the user-state
 * endpoint registered in holt's config (`GET /api/me/chat` in accounts.ts) with that cookie, server to
 * server. Discord bridging, channels, moderation and the bot are holt's; nothing here talks to Discord.
 *
 * The path is keyed like the relay (relay-gate.ts): derived from WISP_GATE_KEY, so every host (decoys
 * included) has it, but no scanner can find it by probing a well-known name. The client learns it from the
 * injected config block (`talk`). Without HOLT_LICENSE the chat is off: no path, no route, no upgrade.
 *
 * What it deliberately does not do: cache, rewrite bodies, or forward the license, CDN or proxy headers the
 * browser sent. The client address it forwards is the one OpenResty on this host set (X-Real-IP).
 */
import { createHash } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import type { Context } from "hono";

const DEFAULT_ORIGIN = "https://holt.abstracteducation.loan";
const DEFAULT_PLATFORM = "fracital";
/** holt-service.ts PROXY_PATH grammar. */
const PLATFORM_ID = /^[a-z][a-z0-9-]{0,31}$/;
const DEV_PATH = "/room/";
/** The only socket under the chat path (holt-service.ts RT_PATH). */
const RT_REST = "_holt/api/rt";

/** Never forwarded upstream: hop-by-hop, length/encoding (fetch sets its own), and anything the browser could use to pose as a proxy. */
const DROP_REQUEST = new Set(["host", "connection", "keep-alive", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "accept-encoding", "x-holt-license", "x-real-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "true-client-ip"]);
/** Never passed back: hop-by-hop, and length/encoding (fetch already decoded the body). */
const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "set-cookie"]);

const license = () => process.env.HOLT_LICENSE?.trim() || "";

function upstreamOrigin(): URL {
	const url = new URL(process.env.HOLT_ORIGIN?.trim() || DEFAULT_ORIGIN);
	return new URL(url.origin);
}

function platformId(): string {
	const id = process.env.HOLT_PLATFORM?.trim() || DEFAULT_PLATFORM;
	return PLATFORM_ID.test(id) ? id : DEFAULT_PLATFORM;
}

export const chatEnabled = (): boolean => license() !== "";

/** Where the chat lives on every host (trailing slash), or "" when it is off. */
export function chatPath(): string {
	if (!chatEnabled()) return "";
	// The relay's gate key (relay-gate.ts), read here so the two modules need not import each other.
	const key = process.env.WISP_GATE_KEY ?? "";
	if (!key) return DEV_PATH;
	return `/${createHash("sha256").update(`${key}:room`).digest("hex").slice(0, 12)}/`;
}

/** The client address OpenResty on this host forwarded (it overwrites both headers), else the socket's. */
function clientAddress(headers: Headers | IncomingMessage["headers"], socketAddress?: string): string {
	const read = (name: string) => {
		const value = headers instanceof Headers ? headers.get(name) : headers[name];
		return (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim() || "";
	};
	return read("x-real-ip") || read("x-forwarded-for") || socketAddress || "";
}

/** holt's absolute redirects to `/<platform>/…` point back under the chat path. */
function rewriteLocation(location: string, base: string): string {
	try {
		const origin = upstreamOrigin();
		const url = new URL(location, origin);
		const prefix = `/${platformId()}/`;
		if (url.origin !== origin.origin) return location;
		if (url.pathname === `/${platformId()}`) return `${base}${url.search}`;
		if (url.pathname.startsWith(prefix)) return `${base}${url.pathname.slice(prefix.length)}${url.search}`;
	} catch {
		// Not a URL: pass it on as is.
	}
	return location;
}

/** HTTP under the chat path → holt `/<platform>/…`. */
export async function proxyChat(c: Context): Promise<Response> {
	const base = chatPath();
	const url = new URL(c.req.url);
	if (!base || !url.pathname.startsWith(base)) return c.text("Not found", 404);
	const target = new URL(`/${platformId()}/${url.pathname.slice(base.length)}${url.search}`, upstreamOrigin());

	const headers = new Headers();
	for (const [name, value] of c.req.raw.headers) {
		if (!DROP_REQUEST.has(name) && !name.startsWith("cf-")) headers.set(name, value);
	}
	const address = clientAddress(c.req.raw.headers);
	if (address) {
		headers.set("x-forwarded-for", address);
		headers.set("x-real-ip", address);
	}
	headers.set("x-holt-license", license());

	const method = c.req.method;
	const hasBody = method !== "GET" && method !== "HEAD";
	let upstream: Response;
	try {
		upstream = await fetch(target, {
			method,
			headers,
			body: hasBody ? c.req.raw.body : undefined,
			redirect: "manual",
			signal: c.req.raw.signal,
			// @ts-expect-error Node's fetch needs this to stream a request body.
			duplex: hasBody ? "half" : undefined,
		});
	} catch {
		return c.text("The chat is unavailable right now.", 502);
	}

	const out = new Headers();
	for (const [name, value] of upstream.headers) {
		if (DROP_RESPONSE.has(name)) continue;
		out.set(name, name === "location" ? rewriteLocation(value, base) : value);
	}
	for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
	// holt sets its own cache policy; never fall into the static one (backend.ts) by leaving it out.
	if (!out.has("cache-control")) out.set("cache-control", "no-store");
	return new Response(method === "HEAD" || upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
}

/**
 * The chat's realtime socket (`<path>_holt/api/rt`) → holt, as a raw upgrade pass-through. Returns false
 * when the request is not under the chat path (the caller handles it); true once it took the socket.
 */
export function chatUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
	const base = chatPath();
	if (!base || !req.url?.startsWith(base)) return false;
	const refuse = (status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
	const url = new URL(req.url, "http://local");
	if (url.pathname !== `${base}${RT_REST}`) {
		refuse("404 Not Found");
		return true;
	}

	const origin = upstreamOrigin();
	const secure = origin.protocol === "https:";
	const headers: http.OutgoingHttpHeaders = {};
	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined || name.startsWith("cf-")) continue;
		// The upgrade's own Connection/Upgrade headers go through; everything else DROP_REQUEST names does not.
		if (DROP_REQUEST.has(name) && name !== "upgrade") continue;
		headers[name] = value;
	}
	headers.connection = "Upgrade";
	headers.host = origin.host;
	headers["x-holt-license"] = license();
	const address = clientAddress(req.headers, req.socket.remoteAddress);
	if (address) {
		headers["x-forwarded-for"] = address;
		headers["x-real-ip"] = address;
	}

	const upstream = (secure ? https : http).request({
		host: origin.hostname,
		port: origin.port || (secure ? 443 : 80),
		servername: secure ? origin.hostname : undefined,
		method: "GET",
		path: `/${platformId()}/${RT_REST}${url.search}`,
		headers,
	});
	upstream.on("upgrade", (answer, upstreamSocket, upstreamHead) => {
		let raw = `HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}\r\n`;
		for (let i = 0; i < answer.rawHeaders.length; i += 2) raw += `${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}\r\n`;
		socket.write(`${raw}\r\n`);
		if (upstreamHead.length) socket.write(upstreamHead);
		if (head.length) upstreamSocket.write(head);
		upstreamSocket.pipe(socket).pipe(upstreamSocket);
		const close = () => {
			socket.destroy();
			upstreamSocket.destroy();
		};
		socket.on("error", close);
		upstreamSocket.on("error", close);
		socket.on("close", close);
		upstreamSocket.on("close", close);
	});
	upstream.on("response", answer => {
		refuse(`${answer.statusCode ?? 502} ${answer.statusMessage ?? "Bad Gateway"}`);
		answer.resume();
	});
	upstream.on("error", () => refuse("502 Bad Gateway"));
	socket.on("error", () => upstream.destroy());
	upstream.end();
	return true;
}
