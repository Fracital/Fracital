/**
 * Play and listener counts.
 *
 * - Song plays: real YouTube streams — the summed view counts of the song's official
 *   uploads (the artist's own music video, official audio, lyric video), via yt-search.
 * - Artist listeners: Last.fm (when LASTFM_API_KEY is set).
 */
import ytSearch from "yt-search";
import { splitArtistCredit } from "../libs/artistCredit";
import { lastfmCall, lastfmKey, toCount } from "./lastfm";

export type PlaysSource = "youtube";

export interface TrackPlays {
	plays: number;
	source: PlaysSource;
	/** How many uploads were summed. */
	uploads: number;
	/** True when the uploads are the artist's own (vs. the best fan upload as a last resort). */
	official: boolean;
}

export interface ArtistStats {
	/** Unique Last.fm listeners, all time. */
	listeners: number;
	/** Total Last.fm scrobbles. */
	plays: number;
}

const TTL = 6 * 60 * 60_000;
const playsCache = new Map<string, { at: number; value: TrackPlays | null }>();
const artistCache = new Map<string, { at: number; value: ArtistStats | null }>();

// ============================================================
// Last.fm artist listeners
// ============================================================

export { lastfmKey };

const lastfmOnce = <T,>(params: Record<string, string>, autocorrect: boolean) => lastfmCall<T>({ ...params, autocorrect: autocorrect ? "1" : "0" });

/**
 * Exact-name lookup first; Last.fm's autocorrect only as a fallback, since it can
 * redirect to stale profiles (e.g. "Travis Scott" → "Travi$ Scott").
 */
async function lastfm<T>(params: Record<string, string>, hasData: (data: T) => boolean): Promise<T | null> {
	const exact = await lastfmOnce<T>(params, false);
	if (exact && hasData(exact)) return exact;
	return lastfmOnce<T>(params, true);
}

/** Last.fm listener + scrobble totals for an artist; null when unconfigured or unknown. */
export async function artistStats(name: string): Promise<ArtistStats | null> {
	if (!lastfmKey() || !name) return null;
	const key = name.toLowerCase().trim();
	const cached = artistCache.get(key);
	if (cached && Date.now() - cached.at < TTL) return cached.value;
	const info = await lastfm<{ artist?: { stats?: { listeners?: string; playcount?: string } } }>({ method: "artist.getInfo", artist: name }, d => toCount(d.artist?.stats?.listeners) > 0);
	const listeners = toCount(info?.artist?.stats?.listeners);
	const value = listeners ? { listeners, plays: toCount(info?.artist?.stats?.playcount) } : null;
	artistCache.set(key, { at: Date.now(), value });
	return value;
}

// ============================================================
// YouTube streams
// ============================================================

/** Lowercased title without bracketed credits like "(feat. X)" or "[From Y]". */
const core = (s: string) =>
	s
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, " ")
		.replace(/\b(feat|ft)\.?\b.*$/, " ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** Channel-name form for matching: "TheWeekndVEVO", "Tyler, The Creator - Topic" → "theweeknd", "tylerthecreator". */
const channel = (s: string) =>
	s
		.toLowerCase()
		.replace(/\s*-\s*topic$/, "")
		.replace(/[^\p{L}\p{N}]+/gu, "")
		.replace(/^(official)|(vevo|official|music|tv)$/g, "");

/** Different recordings or re-edits of a song — not plays of the song itself. */
const VERSION_WORDS =
	/\b(live|remix|chopped|screwed|sped|slowed|reverb|nightcore|8d|instrumental|acapella|a cappella|karaoke|cover|reaction|loop|hour|extended|mashup|432hz|clean|edit|acoustic|demo|snippet|teaser|trailer|behind the scenes|bass boosted|tiktok|performance|session|sessions|concert|tour|festival|unplugged|rehearsal|tiny desk|mtv|ema|vmas|bet|grammys|awards|mama|snl)\b/;

// yt-search scrapes YouTube; keep a few in flight at most.
const YT_MAX_CONCURRENT = 3;
let ytActive = 0;
const ytWaiting: (() => void)[] = [];
async function search(query: string) {
	if (ytActive >= YT_MAX_CONCURRENT) await new Promise<void>(resolve => ytWaiting.push(resolve));
	ytActive++;
	try {
		const result = (await ytSearch(query)) as { videos?: { videoId?: string; title?: string; views?: number; seconds?: number; author?: { name?: string } }[] };
		return result.videos ?? [];
	} catch {
		return [];
	} finally {
		ytActive--;
		ytWaiting.shift()?.();
	}
}

async function youtubePlays(title: string, artist: string): Promise<TrackPlays | null> {
	const wantTitle = core(title);
	if (!wantTitle) return null;
	const artists = [...new Set([artist, ...splitArtistCredit(artist)])].map(channel).filter(a => a.length >= 2);
	// Words like "remix" that are part of the song's own title don't disqualify an upload.
	const ownVersionWords = new Set(title.toLowerCase().match(new RegExp(VERSION_WORDS.source, "g")) ?? []);

	const [general, audio] = await Promise.all([search(`${artist} ${title}`), search(`${artist} ${title} official audio`)]);
	const seen = new Set<string>();
	const candidates = [...general, ...audio].filter(v => {
		if (!v.videoId || seen.has(v.videoId)) return false;
		seen.add(v.videoId);
		const vt = core(v.title ?? "");
		// "@ Venue" titles are concert clips.
		if (!vt.includes(wantTitle) || (v.seconds ?? 0) > 900 || /\s@\s/.test(v.title ?? "")) return false;
		const extra = (v.title ?? "").toLowerCase().match(new RegExp(VERSION_WORDS.source, "g")) ?? [];
		return extra.every(w => ownVersionWords.has(w));
	});

	// Exact channel match only, so fan channels like "The Weeknd Fanmade Albums" don't count.
	const byArtist = (name: string | undefined) => {
		const ch = channel(name ?? "");
		return !!ch && artists.includes(ch);
	};
	const official = candidates.filter(v => byArtist(v.author?.name) && (v.views ?? 0) > 0);
	if (official.length) {
		return { plays: official.reduce((sum, v) => sum + (v.views ?? 0), 0), source: "youtube", uploads: official.length, official: true };
	}
	// No official uploads (common for smaller artists): the most-played matching upload.
	const best = candidates
		.filter(v => core(v.title ?? "").includes(core(artist).split(" ")[0] ?? "") || byArtist(v.author?.name))
		.reduce((max, v) => Math.max(max, v.views ?? 0), 0);
	return best > 0 ? { plays: best, source: "youtube", uploads: 1, official: false } : null;
}

const inflight = new Map<string, Promise<TrackPlays | null>>();

/** A song's total YouTube streams across its official uploads (null when it can't be found). */
export async function trackPlays(title: string, artist: string): Promise<TrackPlays | null> {
	const key = `${artist}|${title}`.toLowerCase();
	const cached = playsCache.get(key);
	if (cached && Date.now() - cached.at < TTL) return cached.value;

	// Many views can ask for the same song at once; share one lookup.
	let pending = inflight.get(key);
	if (!pending) {
		pending = youtubePlays(title, artist).then(value => {
			playsCache.set(key, { at: Date.now(), value });
			return value;
		});
		pending.finally(() => inflight.delete(key)).catch(() => {});
		inflight.set(key, pending);
	}
	return pending;
}
