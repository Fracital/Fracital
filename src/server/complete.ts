/**
 * Search-box completions: what the user's search engine would suggest for the text typed so far, fetched here
 * (the engines' suggest endpoints have no CORS) and handed back as a plain list. Any upstream trouble is an
 * empty list, never an error: the box just shows nothing extra.
 */
import type { Hono } from "hono";
import type { Env } from "./accounts";

const MAX_QUERY = 200;
const MAX_RESULTS = 8;
const TTL_MS = 5 * 60_000;
const CACHE_MAX = 2000;
const TIMEOUT_MS = 2500;

/** Each engine's OpenSearch suggest endpoint: all answer `[query, [suggestions…]]`. Startpage has none, so DuckDuckGo stands in. */
const UPSTREAMS: Record<string, (q: string) => string> = {
	duckduckgo: q => `https://duckduckgo.com/ac/?q=${q}&type=list`,
	google: q => `https://suggestqueries.google.com/complete/search?client=firefox&q=${q}`,
	bing: q => `https://www.bing.com/osjson.aspx?query=${q}`,
};
UPSTREAMS.startpage = UPSTREAMS.duckduckgo;
// Brave answers every request from Node (any headers, any TLS settings) with 429, as a bot check, and
// curl from the same host with 200: so Google's completions stand in, as DuckDuckGo's do for Startpage.
UPSTREAMS.brave = UPSTREAMS.google;
/** Bing's endpoint answers 204 without a browser's User-Agent. */
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36";

const fold = (s: string) => s.normalize("NFKD").toLowerCase().replace(/\s+/g, " ").trim();

/** The suggestions in an OpenSearch reply, trimmed, deduped, without the query itself; [] for anything malformed. */
export function parseCompletions(json: unknown, q: string): string[] {
	if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
	const fq = fold(q);
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of json[1] as unknown[]) {
		// DuckDuckGo's default shape is [{ phrase }], its list shape plain strings.
		const text = typeof item === "string" ? item : item && typeof item === "object" && typeof (item as { phrase?: unknown }).phrase === "string" ? (item as { phrase: string }).phrase : "";
		const t = text.replace(/\s+/g, " ").trim();
		const key = fold(t);
		if (!t || key === fq || seen.has(key)) continue;
		seen.add(key);
		out.push(t);
		if (out.length >= MAX_RESULTS) break;
	}
	return out;
}

const cache = new Map<string, { at: number; s: string[] }>();

async function complete(engine: string, q: string): Promise<string[]> {
	const key = `${engine}|${fold(q)}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.s;
	let s: string[] = [];
	try {
		const res = await fetch(UPSTREAMS[engine](encodeURIComponent(q)), { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (res.ok) s = parseCompletions(await res.json(), q);
	} catch {
		// Slow or down: nothing to suggest this time.
	}
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	cache.set(key, { at: Date.now(), s });
	return s;
}

export function registerCompleteRoutes(app: Hono<Env>) {
	// GET /api/complete?q=<text>&e=<engine id>  →  { s: string[] }
	app.get("/api/complete", async c => {
		const q = (c.req.query("q") ?? "").replace(/\s+/g, " ").trim();
		const e = c.req.query("e") ?? "duckduckgo";
		if (!q || q.length > MAX_QUERY || !UPSTREAMS[e]) return c.json({ s: [] });
		return c.json({ s: await complete(e, q) });
	});
}
