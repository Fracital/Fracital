/**
 * Artist banners and the radio mix algorithm, powered by Deezer's free
 * catalog graph (artist search, top tracks, related artists).
 *
 * Radio algorithm: a seed artist's top tracks are blended with the top
 * tracks of Deezer's related artists. The `variety` knob (0..100) controls
 * the blend: 0 is pure seed artist, 100 is almost all related artists.
 * Tracks are interleaved with weighted randomness so every mix differs.
 */

interface DeezerArtist {
	id: number;
	name: string;
	picture_xl?: string;
	picture_big?: string;
	picture_medium?: string;
	nb_fan?: number;
}

interface DeezerTrack {
	id: number;
	title: string;
	title_short?: string;
	duration?: number;
	preview?: string;
	explicit_lyrics?: boolean;
	artist?: { id: number; name: string };
	album?: { id: number; title: string; cover_xl?: string; cover_big?: string; cover_medium?: string };
}

export interface RadioTrack {
	id: string;
	title: string;
	artist: string;
	album?: string;
	duration: number;
	artwork: string;
	streamUrl: string;
	previewUrl: string;
	explicit: boolean;
}

const DZ = "https://api.deezer.com";

// Deezer allows ~50 requests per 5 seconds; queue calls so big batches
// (e.g. resolving a Last.fm library) don't trip the quota.
const DZ_MAX_CONCURRENT = 6;
let dzActive = 0;
const dzWaiting: (() => void)[] = [];

/** Thrown for transient failures (quota, network) so callers don't cache them as "not found". */
class DeezerUnavailable extends Error {}

async function dzStrict<T>(path: string, attempt = 0): Promise<T> {
	if (dzActive >= DZ_MAX_CONCURRENT) await new Promise<void>(resolve => dzWaiting.push(resolve));
	dzActive++;
	let data: (T & { error?: { code?: number } }) | null = null;
	try {
		const res = await fetch(`${DZ}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
		data = res.ok ? ((await res.json()) as T & { error?: { code?: number } }) : null;
	} catch {
		data = null;
	} finally {
		dzActive--;
		dzWaiting.shift()?.();
	}
	// Code 4 = quota exceeded: back off and retry a couple of times.
	if (data?.error?.code === 4 && attempt < 3) {
		await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
		return dzStrict<T>(path, attempt + 1);
	}
	if (!data || data.error) throw new DeezerUnavailable(`Deezer request failed: ${path}`);
	return data;
}

async function dz<T>(path: string): Promise<T | null> {
	return dzStrict<T>(path).catch(() => null);
}

const artistCache = new Map<string, { at: number; artist: DeezerArtist | null }>();
const ARTIST_TTL = 60 * 60_000;

/** Finds the Deezer artist for a name (banner art + catalog graph entry point). */
export async function findDeezerArtist(name: string): Promise<DeezerArtist | null> {
	const key = name.toLowerCase().trim();
	const cached = artistCache.get(key);
	if (cached && Date.now() - cached.at < ARTIST_TTL) return cached.artist;
	let artist: DeezerArtist | null;
	try {
		artist = (await dzStrict<{ data?: DeezerArtist[] }>(`/search/artist?q=${encodeURIComponent(name)}&limit=1`)).data?.[0] ?? null;
	} catch {
		return null; // transient — don't cache
	}
	artistCache.set(key, { at: Date.now(), artist });
	return artist;
}

/** Full-size artist image for page banners. */
export async function artistBanner(name: string): Promise<string> {
	const artist = await findDeezerArtist(name);
	return artist?.picture_xl || artist?.picture_big || "";
}

const bioCache = new Map<string, { at: number; bio: string }>();

interface WikiSummary {
	type?: string;
	extract?: string;
	title?: string;
	description?: string;
}

async function wikiSummary(title: string): Promise<WikiSummary | null> {
	try {
		const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`, { headers: { "User-Agent": "Fracital/2.0" }, signal: AbortSignal.timeout(6000) });
		return res.ok ? ((await res.json()) as WikiSummary) : null;
	} catch {
		return null;
	}
}

/** A real article about a musical act — not one of their albums, a namesake, or a disambiguation page. */
const isMusicalAct = (s: WikiSummary | null): s is WikiSummary =>
	s?.type === "standard" &&
	!!s.extract &&
	/\b(band|musician|rapper|singer|songwriter|dj|producer|group|duo|trio|artist|composer|vocalist|guitarist|drummer|pianist|entertainer)\b/i.test(s.description ?? "") &&
	!/\b(album|song|single|ep|mixtape|soundtrack|film|tour)\b/i.test(s.description ?? "");

const norm = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Short Wikipedia bio for an artist (cached; empty string when none exists). */
export async function artistBio(name: string): Promise<string> {
	const key = name.toLowerCase().trim();
	const cached = bioCache.get(key);
	if (cached && Date.now() - cached.at < ARTIST_TTL) return cached.bio;
	let bio = "";
	// The exact page (Wikipedia follows redirects like "Kanye West" → "Ye"), then common disambiguations.
	for (const title of [name, `${name} (band)`, `${name} (rapper)`, `${name} (singer)`, `${name} (musician)`]) {
		const summary = await wikiSummary(title);
		if (isMusicalAct(summary)) {
			bio = summary.extract!;
			break;
		}
	}
	// Last resort: search, but only accept a page titled after the artist.
	if (!bio) {
		try {
			const search = (await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${name} musician`)}&format=json&srlimit=3`, { signal: AbortSignal.timeout(6000) })).json()) as {
				query?: { search?: { title?: string }[] };
			};
			const hit = search.query?.search?.find(r => r.title && norm(r.title) === norm(name));
			const summary = hit?.title ? await wikiSummary(hit.title) : null;
			if (isMusicalAct(summary)) bio = summary.extract!;
		} catch {
			/* no bio */
		}
	}
	bioCache.set(key, { at: Date.now(), bio });
	return bio;
}

export interface SimilarArtist {
	name: string;
	picture: string;
	/** Deezer fan count. */
	fans?: number;
}

/** Deezer's related-artists graph for "Similar Artists" shelves. */
export async function relatedArtists(name: string, limit = 10): Promise<SimilarArtist[]> {
	const seed = await findDeezerArtist(name);
	if (!seed) return [];
	const related = await dz<{ data?: DeezerArtist[] }>(`/artist/${seed.id}/related?limit=${limit}`);
	return (related?.data ?? []).filter(a => a.name).map(a => ({ name: a.name, picture: a.picture_big || a.picture_medium || "", fans: a.nb_fan }));
}

/**
 * The artist's top songs ranked by real streaming popularity (Deezer's rank
 * score), mapped to playable tracks. Returns [] when the artist is unknown.
 */
export async function artistTopTracks(name: string, apiBase: string, limit = 20): Promise<RadioTrack[]> {
	const artist = await findDeezerArtist(name);
	if (!artist) return [];
	const top = await dz<{ data?: (DeezerTrack & { rank?: number })[] }>(`/artist/${artist.id}/top?limit=${limit}`);
	const tracks = (top?.data ?? []).slice().sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
	return tracks.map(t => toRadioTrack(t, apiBase));
}

const toRadioTrack = (t: DeezerTrack, apiBase: string): RadioTrack => ({
	id: `dz-${t.id}`,
	title: t.title_short || t.title,
	artist: t.artist?.name || "",
	album: t.album?.title,
	duration: t.duration || 0,
	artwork: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || "",
	// The playback route resolves via the title/artist hints (yt-search → yt-dlp).
	streamUrl: `${apiBase}/playback/${t.id}?fallback=${encodeURIComponent(t.preview || "")}&title=${encodeURIComponent(t.title_short || t.title)}&artist=${encodeURIComponent(t.artist?.name || "")}`,
	previewUrl: t.preview || "",
	explicit: !!t.explicit_lyrics,
});

const trackCache = new Map<string, { at: number; track: DeezerTrack | null }>();

/**
 * Resolves a song by title + artist to a playable track (Deezer id, artwork, preview).
 * Used to turn Last.fm's metadata-only tracks into playable ones. Cached.
 */
export async function findDeezerTrack(title: string, artist: string, apiBase: string): Promise<RadioTrack | null> {
	const key = `${artist}|${title}`.toLowerCase();
	const cached = trackCache.get(key);
	let track: DeezerTrack | null;
	if (cached && Date.now() - cached.at < ARTIST_TTL) track = cached.track;
	else {
		try {
			const strict = await dzStrict<{ data?: DeezerTrack[] }>(`/search/track?q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}&limit=1`);
			track = strict.data?.[0] ?? (await dzStrict<{ data?: DeezerTrack[] }>(`/search/track?q=${encodeURIComponent(`${artist} ${title}`)}&limit=1`)).data?.[0] ?? null;
		} catch {
			return null; // transient — don't cache, so the next request retries
		}
		trackCache.set(key, { at: Date.now(), track });
	}
	return track ? toRadioTrack(track, apiBase) : null;
}

const shuffle = <T,>(list: T[]): T[] => {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
};

export interface RadioOptions {
	/** Seed artist name (required). */
	artist: string;
	/** Optional seed track title — its artist mix leads the station. */
	title?: string;
	/** 0..100: 0 = only the seed artist, 100 = almost all related artists. */
	variety: number;
	limit: number;
}

export async function buildRadio({ artist, title, variety, limit }: RadioOptions, apiBase: string): Promise<{ seed: { artist: string; banner: string }; tracks: RadioTrack[] } | null> {
	const seed = await findDeezerArtist(artist);
	if (!seed) return null;

	const v = Math.min(100, Math.max(0, variety)) / 100;

	// Pool A: the seed artist's top tracks.
	const topData = await dz<{ data?: DeezerTrack[] }>(`/artist/${seed.id}/top?limit=40`);
	let seedPool = topData?.data ?? [];
	// A track seed leads the station with that song first.
	if (title) {
		const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
		seedPool = [...seedPool].sort((a, b) => (norm(b.title).includes(norm(title)) ? 1 : 0) - (norm(a.title).includes(norm(title)) ? 1 : 0));
	}

	// Pool B: top tracks of related artists, breadth scaled by variety.
	let relatedPool: DeezerTrack[] = [];
	if (v > 0) {
		const related = await dz<{ data?: DeezerArtist[] }>(`/artist/${seed.id}/related?limit=12`);
		const take = Math.max(1, Math.round((related?.data?.length ?? 0) * Math.min(1, v + 0.2)));
		const chosen = shuffle(related?.data ?? []).slice(0, take);
		const tops = await Promise.all(chosen.map(a => dz<{ data?: DeezerTrack[] }>(`/artist/${a.id}/top?limit=10`)));
		relatedPool = shuffle(tops.flatMap(t => t?.data ?? []));
	}

	// Blend: each slot picks from the related pool with probability `v`.
	const seedShuffled = title ? [...seedPool.slice(0, 1), ...shuffle(seedPool.slice(1))] : shuffle(seedPool);
	const out: DeezerTrack[] = [];
	const seen = new Set<string>();
	let a = 0;
	let b = 0;
	while (out.length < limit && (a < seedShuffled.length || b < relatedPool.length)) {
		const useRelated = (Math.random() < v && b < relatedPool.length) || a >= seedShuffled.length;
		const track = useRelated ? relatedPool[b++] : seedShuffled[a++];
		if (!track) continue;
		const key = `${track.title.toLowerCase()}|${track.artist?.name?.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(track);
	}

	return {
		seed: { artist: seed.name, banner: seed.picture_xl || seed.picture_big || "" },
		tracks: out.map(t => toRadioTrack(t, apiBase)),
	};
}
