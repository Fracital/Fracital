import LibcurlTransport, { type LibcurlClientOptions } from "@mercuryworkshop/libcurl-transport";
import type { ProxyTransport, RawHeaders, TransferrableResponse } from "@mercuryworkshop/proxy-transports";

// The controller never passes an AbortSignal, so a request that stalls holds one of libcurl's connection slots
// (6 per host, 50 total) forever. A few heavy sites are enough to fill them, after which every later page hangs.
// This wrapper gives each request a deadline, cancels upstream when the page drops a body, and moves hosts whose
// HTTP/2 connection wedges (streams that never get headers) over to HTTP/1.1.

const HEADERS_TIMEOUT_MS = 8_000;
const RETRY_HEADERS_TIMEOUT_MS = 30_000;
const UNSAFE_HEADERS_TIMEOUT_MS = 30_000;
const BODY_IDLE_TIMEOUT_MS = 60_000;
// CURLE_HTTP2, CURLE_HTTP2_STREAM, CURLE_SEND_ERROR, CURLE_RECV_ERROR, CURLE_GOT_NOTHING
const RETRYABLE_CURL_CODES = new Set([16, 92, 55, 56, 52]);
const H2_CURL_CODES = new Set([16, 92]);

type LibcurlSession = {
	fetch: (url: string, init: Record<string, unknown>) => Promise<Response & { raw_headers: RawHeaders }>;
};

class TimeoutError extends Error {}

const curlCode = (error: unknown) => {
	const match = /error code (\d+)/.exec(String((error as Error)?.message ?? error));
	return match ? Number(match[1]) : undefined;
};

const guardBody = (body: ReadableStream<Uint8Array>, abort: () => void, idleMs: number | undefined) => {
	const reader = body.getReader();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const clear = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			// Only time the upstream while a read is pending, so a slow consumer (paused media) isn't cut off.
			if (idleMs) {
				timer = setTimeout(() => {
					abort();
					reader.cancel().catch(() => undefined);
					controller.error(new TypeError("Upstream stalled"));
				}, idleMs);
			}
			try {
				const { done, value } = await reader.read();
				clear();
				if (done) controller.close();
				else controller.enqueue(value);
			} catch (error) {
				clear();
				try {
					controller.error(error);
				} catch {
					// already errored by the idle timer
				}
			}
		},
		cancel(reason) {
			clear();
			abort();
			return reader.cancel(reason).catch(() => undefined);
		},
	});
};

/** Asked before each request: a response to give instead of sending it, or null to send it. */
export type RequestGate = (remote: URL, headers: RawHeaders) => TransferrableResponse | null;

export class ResilientTransport implements ProxyTransport {
	private inner: LibcurlTransport;
	private h1Hosts = new Set<string>();
	private gate?: RequestGate;

	constructor(options: LibcurlClientOptions & { gate?: RequestGate }) {
		const { gate, ...libcurl } = options;
		this.inner = new LibcurlTransport(libcurl);
		this.gate = gate;
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

	connect: ProxyTransport["connect"] = (...args) => this.inner.connect(...args);

	private async attempt(remote: URL, method: string, body: BodyInit | null, headers: RawHeaders, timeoutMs: number, h1: boolean, signal: AbortSignal | undefined): Promise<TransferrableResponse> {
		const session = this.inner.session as LibcurlSession;
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		const headersObj: Record<string, string> = {};
		for (const [key, value] of headers) headersObj[key] = value;

		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			abort();
		}, timeoutMs);

		let response: Response & { raw_headers: RawHeaders };
		try {
			response = await session.fetch(remote.href, {
				method,
				headers: headersObj,
				body,
				redirect: "manual",
				signal: controller.signal,
				...(h1 ? { _libcurl_http_version: 1.1 } : {}),
			});
		} catch (error) {
			if (timedOut) throw new TimeoutError(`No response from ${remote.host} after ${timeoutMs}ms`);
			throw error;
		} finally {
			clearTimeout(timer);
		}

		const contentType = response.headers.get("content-type") ?? "";
		const idleMs = contentType.includes("text/event-stream") ? undefined : BODY_IDLE_TIMEOUT_MS;
		return {
			body: (response.body ? guardBody(response.body, abort, idleMs) : response.body) as TransferrableResponse["body"],
			headers: response.raw_headers,
			status: response.status,
			statusText: response.statusText,
		};
	}

	async request(remote: URL, method: string, body: BodyInit | null, headers: RawHeaders, signal: AbortSignal | undefined): Promise<TransferrableResponse> {
		const answered = this.gate?.(remote, headers);
		if (answered) return answered;
		if (!this.inner.ready) await this.inner.init();
		if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

		const host = remote.host;
		const replayable = (method === "GET" || method === "HEAD") && body == null;
		const h1 = this.h1Hosts.has(host);

		try {
			return await this.attempt(remote, method, body, headers, replayable ? HEADERS_TIMEOUT_MS : UNSAFE_HEADERS_TIMEOUT_MS, h1, signal);
		} catch (error) {
			const code = curlCode(error);
			const timedOut = error instanceof TimeoutError;
			if (!h1 && (timedOut || (code !== undefined && H2_CURL_CODES.has(code)))) this.h1Hosts.add(host);
			if (signal?.aborted || !replayable || !(timedOut || (code !== undefined && RETRYABLE_CURL_CODES.has(code)))) {
				throw timedOut ? new TypeError((error as Error).message) : error;
			}
			try {
				return await this.attempt(remote, method, body, headers, RETRY_HEADERS_TIMEOUT_MS, this.h1Hosts.has(host), signal);
			} catch (retryError) {
				throw retryError instanceof TimeoutError ? new TypeError(retryError.message) : retryError;
			}
		}
	}
}
