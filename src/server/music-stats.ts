/**
 * Play and listener counts.
 *
 * - Last.fm (when LASTFM_API_KEY is set): per-song scrobble counts and per-artist listeners.
 * - YouTube view counts (keyless, via yt-search): fallback for songs Last.fm doesn't know.
 */
import ytSearch from "yt-search";
import { splitArtistCredit } from "../libs/artistCredit";
import { lastfmCall, lastfmKey, toCount } from "./lastfm";

export type PlaysSource = "lastfm" | "youtube";

export interface TrackPlays {
	plays: number;
	/** Unique Last.fm listeners (Last.fm only). */
	listeners?: number;
	source: PlaysSource;
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

/** Lowercased title without bracketed credits like "(feat. X)" or "[From Y]". */
const core = (s: string) =>
	s
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, " ")
		.replace(/\b(feat|ft)\.?\b.*$/, " ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** Title with bracketed credits removed but original casing kept, for Last.fm lookups. */
const bareTitle = (s: string) =>
	s
		.replace(/\(.*?\)|\[.*?\]/g, " ")
		.replace(/\s+-\s+.*$/, " ")
		.replace(/\s+/g, " ")
		.trim();

// ============================================================
// Last.fm
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

async function lastfmTrackPlays(title: string, artist: string): Promise<TrackPlays | null> {
	type Info = { track?: { playcount?: string; listeners?: string } };
	// Last.fm splits a collab's scrobbles across credit spellings ("A, B & C", "A", "B"…),
	// so look the song up under the full credit and each artist, and keep the biggest entry.
	const artists = [...new Set([artist, ...splitArtistCredit(artist)])].filter(Boolean);
	// Try the catalog title first, then without "(feat. …)" / "[From …]" decorations.
	for (const name of [...new Set([title, bareTitle(title)])].filter(Boolean)) {
		// Exact and autocorrected entries can both exist with different counts; consider both.
		const infos = (
			await Promise.all(artists.map(a => Promise.all([false, true].map(ac => lastfmOnce<Info>({ method: "track.getInfo", artist: a, track: name }, ac)))))
		).flat();
		const best = infos.reduce<TrackPlays | null>((top, info) => {
			const plays = toCount(info?.track?.playcount);
			return plays > (top?.plays ?? 0) ? { plays, listeners: toCount(info?.track?.listeners) || undefined, source: "lastfm" } : top;
		}, null);
		if (best) return best;
	}
	return null;
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
// YouTube fallback
// ============================================================

async function youtubePlays(title: string, artist: string): Promise<TrackPlays | null> {
	try {
		const result = (await ytSearch(`${artist} ${title}`)) as { videos?: { title?: string; views?: number; author?: { name?: string } }[] };
		const wantTitle = core(title);
		const wantArtist = core(artist);
		const matches = (result.videos ?? []).slice(0, 10).filter(v => {
			const vt = core(v.title ?? "");
			const author = core(v.author?.name ?? "");
			// The song title must appear, and the upload must be by (or credit) the artist.
			return !!wantTitle && vt.includes(wantTitle) && (vt.includes(wantArtist) || author.includes(wantArtist.split(" ")[0]));
		});
		const best = matches.reduce((max, v) => Math.max(max, v.views ?? 0), 0);
		return best > 0 ? { plays: best, source: "youtube" } : null;
	} catch {
		return null;
	}
}

const inflight = new Map<string, Promise<TrackPlays | null>>();

/** A song's play count: Last.fm scrobbles when configured and known, otherwise YouTube views. */
export async function trackPlays(title: string, artist: string): Promise<TrackPlays | null> {
	const key = `${artist}|${title}`.toLowerCase();
	const cached = playsCache.get(key);
	if (cached && Date.now() - cached.at < TTL) return cached.value;

	// Many views can ask for the same song at once; share one lookup.
	let pending = inflight.get(key);
	if (!pending) {
		pending = (async () => (await lastfmTrackPlays(title, artist)) ?? (await youtubePlays(title, artist)))().then(value => {
			playsCache.set(key, { at: Date.now(), value });
			return value;
		});
		pending.finally(() => inflight.delete(key)).catch(() => {});
		inflight.set(key, pending);
	}
	return pending;
}
