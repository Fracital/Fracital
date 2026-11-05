/**
 * Minimal Last.fm API client: read calls, signed (authenticated) calls, and a
 * shared concurrency limiter so the server stays under Last.fm's ~5 req/s guideline.
 */
import { createHash } from "node:crypto";

export const lastfmKey = () => process.env.LASTFM_API_KEY?.trim() || "";
export const lastfmSecret = () => process.env.LASTFM_API_SECRET?.trim() || "";

const API = "https://ws.audioscrobbler.com/2.0/";
const MAX_CONCURRENT = 4;
let active = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
	if (active >= MAX_CONCURRENT) await new Promise<void>(resolve => waiting.push(resolve));
	active++;
	try {
		return await fn();
	} finally {
		active--;
		waiting.shift()?.();
	}
}

export class LastfmError extends Error {
	code: number;
	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

/** api_sig: md5 of every param (except format/callback) sorted by name as key+value, then the shared secret. */
export function signParams(params: Record<string, string>, secret: string): string {
	const base = Object.keys(params)
		.filter(k => k !== "format" && k !== "callback")
		.sort()
		.map(k => `${k}${params[k]}`)
		.join("");
	return createHash("md5")
		.update(base + secret, "utf8")
		.digest("hex");
}

/**
 * Calls a Last.fm method. Unsigned GET by default; `signed` adds api_sig (and is
 * required for auth.* and anything taking a session key); `post` for write methods.
 * Returns null when unconfigured; throws LastfmError for API errors when `throwOnError`.
 */
export async function lastfmCall<T>(params: Record<string, string>, opts: { signed?: boolean; post?: boolean; throwOnError?: boolean } = {}): Promise<T | null> {
	const key = lastfmKey();
	if (!key) return null;
	const all: Record<string, string> = { ...params, api_key: key };
	if (opts.signed) {
		const secret = lastfmSecret();
		if (!secret) throw new LastfmError(0, "LASTFM_API_SECRET is not configured");
		all.api_sig = signParams(all, secret);
	}
	all.format = "json";
	const body = new URLSearchParams(all);

	return limited(async () => {
		try {
			const res = await fetch(opts.post ? API : `${API}?${body}`, {
				method: opts.post ? "POST" : "GET",
				headers: { Accept: "application/json", "User-Agent": "Fracital/2.0", ...(opts.post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
				body: opts.post ? body : undefined,
				signal: AbortSignal.timeout(8000),
			});
			const data = (await res.json().catch(() => null)) as (T & { error?: number; message?: string }) | null;
			if (!data || data.error) {
				if (opts.throwOnError) throw new LastfmError(data?.error ?? res.status, data?.message ?? `Last.fm ${res.status}`);
				return null;
			}
			return data;
		} catch (err) {
			if (opts.throwOnError) throw err instanceof LastfmError ? err : new LastfmError(0, err instanceof Error ? err.message : "Last.fm request failed");
			return null;
		}
	});
}

export const toCount = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Last.fm returns a single object instead of an array when there's one result. */
export const asArray = <T>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v ? [v] : []);

/** Last.fm's grey-star placeholder (served for most images since 2019). */
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";

/** Largest real image from a Last.fm image array, or "" when only the placeholder exists. */
export function lastfmImage(images: { "#text"?: string; size?: string }[] | undefined): string {
	const list = asArray(images);
	const url = [...list].reverse().find(i => i["#text"])?.["#text"] || "";
	return url && !url.includes(PLACEHOLDER) ? url : "";
}
