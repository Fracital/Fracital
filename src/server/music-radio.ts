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

async function dz<T>(path: string): Promise<T | null> {
	try {
		const res = await fetch(`${DZ}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

const artistCache = new Map<string, { at: number; artist: DeezerArtist | null }>();
const ARTIST_TTL = 60 * 60_000;

/** Finds the Deezer artist for a name (banner art + catalog graph entry point). */
export async function findDeezerArtist(name: string): Promise<DeezerArtist | null> {
	const key = name.toLowerCase().trim();
	const cached = artistCache.get(key);
	if (cached && Date.now() - cached.at < ARTIST_TTL) return cached.artist;
	const data = await dz<{ data?: DeezerArtist[] }>(`/search/artist?q=${encodeURIComponent(name)}&limit=1`);
	const artist = data?.data?.[0] ?? null;
	artistCache.set(key, { at: Date.now(), artist });
	return artist;
}

/** Full-size artist image for page banners. */
export async function artistBanner(name: string): Promise<string> {
	const artist = await findDeezerArtist(name);
	return artist?.picture_xl || artist?.picture_big || "";
}

const bioCache = new Map<string, { at: number; bio: string }>();

/** Short Wikipedia bio for an artist (cached; empty string when none exists). */
export async function artistBio(name: string): Promise<string> {
	const key = name.toLowerCase().trim();
	const cached = bioCache.get(key);
	if (cached && Date.now() - cached.at < ARTIST_TTL) return cached.bio;
	let bio = "";
	try {
		// Search (biased to musicians) then fetch the page summary.
		const search = (await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${name} musician`)}&format=json&srlimit=1`, { signal: AbortSignal.timeout(6000) })).json()) as {
			query?: { search?: { title?: string }[] };
		};
		const title = search.query?.search?.[0]?.title;
		if (title) {
			const summary = (await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, { signal: AbortSignal.timeout(6000) })).json()) as {
				type?: string;
				extract?: string;
				title?: string;
			};
			// Only use real articles that are actually about this artist.
			if (summary.type === "standard" && summary.extract && (summary.title ?? "").toLowerCase().includes(name.toLowerCase().split(" ")[0])) bio = summary.extract;
			else if (summary.type === "standard" && summary.extract && summary.extract.toLowerCase().includes(name.toLowerCase())) bio = summary.extract;
		}
	} catch {
		/* no bio */
	}
	bioCache.set(key, { at: Date.now(), bio });
	return bio;
}

export interface SimilarArtist {
	name: string;
	picture: string;
}

/** Deezer's related-artists graph for "Similar Artists" shelves. */
export async function relatedArtists(name: string, limit = 10): Promise<SimilarArtist[]> {
	const seed = await findDeezerArtist(name);
	if (!seed) return [];
	const related = await dz<{ data?: DeezerArtist[] }>(`/artist/${seed.id}/related?limit=${limit}`);
	return (related?.data ?? []).filter(a => a.name).map(a => ({ name: a.name, picture: a.picture_big || a.picture_medium || "" }));
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
