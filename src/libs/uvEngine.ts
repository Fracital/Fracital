import { BareMuxConnection, type BareHeaders, type BareTransport } from "@mercuryworkshop/bare-mux";
import type { ProxyTransport, RawHeaders } from "@mercuryworkshop/proxy-transports";
import { type RequestGate, ResilientTransport } from "./resilientTransport";
import { requestVerdict, verdictResponse } from "../extensions/runtime";
import XOR from "./XOR";
import { wispURL } from "../types";

/**
 * The UV engine. Its files ship renamed under /vendor/ (vite.config.ts UV_FILES); the service worker
 * (public/sw.js) routes everything under UV_PREFIX to it. Its requests go through bare-mux's shared
 * worker, which hands them back to this page: the same libcurl transport over the gated relay that
 * Scramjet uses, so UV opens no network path of its own.
 */

declare const __BUILD_STAMP__: string;
const stamped = (name: string) => name.replace(/\.(?=[^.]+$)/, `.${__BUILD_STAMP__}.`);

/** Where UV's proxied URLs live (the config vite writes says the same). */
export const UV_PREFIX = "/~/v/";
/** bare-mux's shared worker, which every UV page and the service worker reach the transport through. */
const MUX_WORKER = stamped("/vendor/mx.js");

export const encodeUvUrl = (url: string) => `${UV_PREFIX}${XOR.encode(url)}`;

/** The real URL of a UV-proxied href, or null when it isn't one. */
export const decodeUvUrl = (href: string): string | null => {
	try {
		const url = new URL(href, location.origin);
		if (url.origin !== location.origin || !url.pathname.startsWith(UV_PREFIX)) return null;
		return XOR.decode(url.pathname.slice(UV_PREFIX.length) + url.search + url.hash);
	} catch {
		return null;
	}
};

const toRaw = (headers: BareHeaders): RawHeaders => Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value.map(v => [name, v] as [string, string]) : [[name, value] as [string, string]]));

const toBare = (headers: RawHeaders): BareHeaders => {
	const out: BareHeaders = {};
	for (const [name, value] of headers) {
		const prev = out[name];
		out[name] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
	}
	return out;
};

/** bare-mux speaks header records; the relay transports speak header lists. */
class BareAdapter implements BareTransport {
	private inner: ProxyTransport;

	constructor(inner: ProxyTransport) {
		this.inner = inner;
	}

	get ready() {
		return this.inner.ready;
	}

	set ready(value: boolean) {
		this.inner.ready = value;
	}

	init() {
		return this.inner.init();
	}

	meta() {
		return {};
	}

	async request(remote: URL, method: string, body: BodyInit | null, headers: BareHeaders, signal: AbortSignal | undefined) {
		const response = await this.inner.request(remote, method, body, toRaw(headers), signal);
		return { ...response, headers: toBare(response.headers) };
	}

	connect(url: URL, protocols: string[], requestHeaders: BareHeaders, onopen: (protocol: string) => void, onmessage: (data: Blob | ArrayBuffer | string) => void, onclose: (code: number, reason: string) => void, onerror: (error: string) => void) {
		return this.inner.connect(url, protocols, toRaw(requestHeaders), protocol => onopen(protocol), onmessage, onclose, onerror);
	}
}

/**
 * UV's requests reach the extensions here, in the page's transport: UV's own hooks run in the service worker, which
 * the extensions don't. Only the URL and headers are known, so the requesting page comes from the Referer when sent.
 */
const uvGate: RequestGate = (remote, headers) => {
	const referer = headers.find(([name]) => name.toLowerCase() === "referer")?.[1];
	const accept = headers.find(([name]) => name.toLowerCase() === "accept")?.[1] ?? "";
	// A navigation asks for HTML; anything else is a resource (its exact kind isn't known here).
	const verdict = requestVerdict({ url: remote.href, pageUrl: referer, destination: accept.startsWith("text/html") ? "document" : undefined });
	return verdict ? verdictResponse(verdict) : null;
};

let boot: Promise<void> | null = null;

/** Starts UV's transport once per page; tabs on UV wait for it before loading. */
export const bootUv = () => {
	boot ??= (async () => {
		const connection = new BareMuxConnection(MUX_WORKER);
		await connection.setRemoteTransport(new BareAdapter(new ResilientTransport({ wisp: wispURL, gate: uvGate })), "relay");
	})().catch(error => {
		boot = null;
		throw error;
	});
	return boot;
};
