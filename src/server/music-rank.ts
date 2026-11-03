/**
 * Relevance ranking for music search results.
 *
 * iTunes returns results in an opaque order full of karaoke/tribute junk and
 * duplicate releases. Everything that reaches the client goes through here:
 * junk filtering, query-relevance scoring, and duplicate collapsing.
 */

export interface RankableTrack {
	title: string;
	artist: string;
	album?: string;
	[key: string]: unknown;
}

export interface RankableAlbum {
	title: string;
	artist: string;
	[key: string]: unknown;
}

export interface RankableArtist {
	name: string;
	[key: string]: unknown;
}

const normalize = (value: string): string =>
	value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const tokens = (value: string): string[] => normalize(value).split(" ").filter(Boolean);

const editDistance = (a: string, b: string): number => {
	if (a === b) return 0;
	if (!a.length || !b.length) return Math.max(a.length, b.length);
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = row;
	}
	return prev[b.length];
};

// Tokens this close count as the same word (typos, plural "s").
const tokensEqual = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 1);

const hasToken = (haystack: string[], needle: string) => haystack.some(token => tokensEqual(token, needle));

/**
 * 0..1+: how well a result's fields satisfy the query. Every query token must
 * land somewhere; title hits count most, artist close behind, album least.
 * Unmatched title words (long noisy versions, karaoke suffixes) subtract a bit.
 */
const queryScore = (query: string, title: string, artist: string, album = ""): number => {
	const want = tokens(query);
	if (want.length === 0) return 0;
	const inTitle = tokens(title);
	const inArtist = tokens(artist);
	const inAlbum = tokens(album);

	let credited = 0;
	let total = 0;
	for (const token of want) {
		total += token.length;
		if (hasToken(inTitle, token)) credited += token.length;
		else if (hasToken(inArtist, token)) credited += token.length * 0.95;
		else if (hasToken(inAlbum, token)) credited += token.length * 0.55;
	}
	const coverage = credited / total;

	const wanted = (token: string) => hasToken(want, token);
	const titleChars = inTitle.reduce((sum, token) => sum + token.length, 0) || 1;
	const noise = inTitle.reduce((sum, token) => sum + (wanted(token) ? 0 : token.length), 0) / titleChars;

	return coverage - noise * 0.18;
};

// Karaoke/tribute/cover shovelware — filtered unless the user asked for it.
const JUNK = /\b(karaoke|tribute|originally performed|in the style of|made famous|cover version|covered by|8[ -]?bit|ringtone|lullaby version|music box version|workout remix)\b/i;

const isJunk = (query: string, ...fields: (string | undefined)[]) => !JUNK.test(query) && fields.some(field => field && JUNK.test(field));

const SINGLE_SUFFIX = /\s*-\s*(single|ep)\s*$/i;

/**
 * Filters junk, scores every track against the query, collapses duplicate
 * releases of the same recording (keeping the album version over the single),
 * and returns tracks in relevance order.
 */
export function rankTracks<T extends RankableTrack>(query: string, tracks: T[], minScore = 0.45): T[] {
	const scored = tracks
		.filter(track => !isJunk(query, track.title, track.artist, track.album))
		.map((track, index) => ({
			track,
			// A light prior from iTunes's own order breaks score ties sensibly.
			score: queryScore(query, track.title, track.artist, track.album) + ((tracks.length - index) / tracks.length) * 0.05,
		}))
		.filter(({ score }) => score >= minScore)
		.sort((a, b) => b.score - a.score);

	const seen = new Map<string, { score: number; index: number }>();
	const out: T[] = [];
	for (const { track, score } of scored) {
		const key = `${normalize(track.title)}|${normalize(track.artist)}`;
		const existing = seen.get(key);
		if (existing === undefined) {
			seen.set(key, { score, index: out.length });
			out.push(track);
			continue;
		}
		// Same recording seen again: swap in the album release over a single.
		const kept = out[existing.index];
		if (SINGLE_SUFFIX.test(kept.album ?? "") && !SINGLE_SUFFIX.test(track.album ?? "")) out[existing.index] = track;
	}
	return out;
}

/** Filters junk albums and orders them by query relevance. */
export function rankAlbums<T extends RankableAlbum>(query: string, albums: T[], minScore = 0.45): T[] {
	const seen = new Set<string>();
	return albums
		.filter(album => !isJunk(query, album.title, album.artist))
		.map((album, index) => ({ album, score: queryScore(query, album.title, album.artist) + ((albums.length - index) / albums.length) * 0.05 }))
		.filter(({ score }) => score >= minScore)
		.sort((a, b) => b.score - a.score)
		.map(({ album }) => album)
		.filter(album => {
			const key = `${normalize(album.title)}|${normalize(album.artist)}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

/** Orders artists by name relevance to the query. */
export function rankArtists<T extends RankableArtist>(query: string, artists: T[], minScore = 0.5): T[] {
	return artists
		.map((artist, index) => ({ artist, score: queryScore(query, artist.name, "") + ((artists.length - index) / artists.length) * 0.05 }))
		.filter(({ score }) => score >= minScore)
		.sort((a, b) => b.score - a.score)
		.map(({ artist }) => artist);
}
