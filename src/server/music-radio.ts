/**
 * Artist banners, bios, related artists, and the radio station algorithm.
 *
 * Radio: candidates come from Last.fm's listening graph (songs similar to the seed
 * song, artists similar to the seed artist, each with a 0–1 match score) plus the
 * seed artist's popular tracks on Deezer. A station is then drawn by weighted
 * sampling with rules: the seed song plays first, no artist repeats within 3 songs,
 * per-artist caps, no duplicate versions, and `variety` (0..100) setting how much of
 * the station is the seed artist vs. similar artists (and how far out it reaches).
 * Falls back to Deezer's related-artists graph when Last.fm isn't configured.
 */
import { asArray, lastfmCall, lastfmKey } from "./lastfm";

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
	rank?: number;
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
			// Deezer's field search sometimes returns unrelated songs, so pool both searches and verify.
			const [strict, loose] = await Promise.all([
				dzStrict<{ data?: DeezerTrack[] }>(`/search/track?q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}&limit=5`),
				dzStrict<{ data?: DeezerTrack[] }>(`/search/track?q=${encodeURIComponent(`${artist} ${title}`)}&limit=10`),
			]);
			track = bestTrackMatch([...(strict.data ?? []), ...(loose.data ?? [])], title, artist);
		} catch {
			return null; // transient — don't cache, so the next request retries
		}
		trackCache.set(key, { at: Date.now(), track });
	}
	return track ? toRadioTrack(track, apiBase) : null;
}

const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const titleCore = (s: string) => plain(s.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s-\s.*$/, " ").replace(/\b(feat|ft)\.?\b.*$/i, " "));

/**
 * The candidate that's really this song: the artist must match (any credited artist)
 * and the title must match; prefers the original over acoustic/remix/live versions.
 */
function bestTrackMatch(list: DeezerTrack[], title: string, artist: string): DeezerTrack | null {
	const wantTitle = titleCore(title);
	const wantArtists = artist
		.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bwith\b|\bx\b)\s*/i)
		.map(plain)
		.filter(Boolean);
	const wantsVersion = /\b(acoustic|remix|live|sped|slowed|instrumental|edit)\b/i.test(title);
	let best: { t: DeezerTrack; score: number } | null = null;
	for (const t of list) {
		const got = plain(t.artist?.name ?? "");
		const artistOk = !!got && wantArtists.some(a => a === got || (a.length >= 4 && (got.includes(a) || a.includes(got))));
		const gotTitle = titleCore(t.title_short || t.title);
		const titleOk = !!wantTitle && (gotTitle === wantTitle || (wantTitle.length >= 4 && (gotTitle.startsWith(wantTitle) || wantTitle.startsWith(gotTitle))));
		if (!artistOk || !titleOk) continue;
		let score = gotTitle === wantTitle ? 2 : 1;
		if (!wantsVersion && /\b(acoustic|remix|live|sped|slowed|instrumental|edit)\b/i.test(t.title)) score -= 1.5;
		if (!best || score > best.score) best = { t, score };
	}
	return best?.t ?? null;
}

export interface RadioOptions {
	/** Seed artist name (required). */
	artist: string;
	/** Optional seed song title — the station starts with it and follows its sound. */
	title?: string;
	/** 0..100: 0 = mostly the seed artist, 100 = mostly similar artists, reaching further out. */
	variety: number;
	limit: number;
}

interface Candidate {
	title: string;
	artist: string;
	/** 0..1 — how well this fits the station. */
	score: number;
	/** Already-resolved Deezer track, when it came from Deezer. */
	dz?: DeezerTrack;
}

/** Comparable song identity: no "(feat. …)", "[Remastered]", " - Radio Edit", punctuation or case. */
const songKey = (title: string, artist: string) =>
	`${artist.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}|${title
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, " ")
		.replace(/\s-\s.*$/, " ")
		.replace(/\b(feat|ft)\.?\b.*$/, " ")
		.replace(/[^\p{L}\p{N}]+/gu, "")}`;

const artistKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Skits, interludes, live cuts, sped-up edits etc. don't belong on a station. */
const NOT_A_SONG = /\b(skit|interlude|intro|outro|live|instrumental|acapella|a cappella|sped up|slowed|reverb|commentary|voice memo)\b/i;

/** Last.fm's "similar" lists, keyed off the seed artist / song (empty without a key). */
async function lastfmSimilar(artist: string, title?: string) {
	type Sim = { name?: string; match?: string; artist?: { name?: string } | string };
	const [artists, tracks] = await Promise.all([
		lastfmCall<{ similarartists?: { artist?: Sim | Sim[] } }>({ method: "artist.getSimilar", artist, limit: "30", autocorrect: "1" }),
		title ? lastfmCall<{ similartracks?: { track?: Sim | Sim[] } }>({ method: "track.getSimilar", artist, track: title, limit: "100", autocorrect: "1" }) : Promise.resolve(null),
	]);
	return {
		artists: asArray(artists?.similarartists?.artist)
			.filter(a => a.name)
			.map(a => ({ name: a.name!, match: Number(a.match) || 0 })),
		tracks: asArray(tracks?.similartracks?.track)
			.map(t => ({ title: t.name || "", artist: typeof t.artist === "string" ? t.artist : t.artist?.name || "", match: Number(t.match) || 0 }))
			.filter(t => t.title && t.artist),
	};
}

/** Weighted random pick (weights ≥ 0). */
function pickWeighted<T>(items: T[], weight: (item: T) => number): T | undefined {
	const total = items.reduce((sum, it) => sum + Math.max(0, weight(it)), 0);
	if (total <= 0) return items[0];
	let r = Math.random() * total;
	for (const it of items) {
		r -= Math.max(0, weight(it));
		if (r <= 0) return it;
	}
	return items[items.length - 1];
}

export async function buildRadio({ artist, title, variety, limit }: RadioOptions, apiBase: string): Promise<{ seed: { artist: string; banner: string }; tracks: RadioTrack[] } | null> {
	const seed = await findDeezerArtist(artist);
	if (!seed) return null;
	const v = Math.min(100, Math.max(0, variety)) / 100;
	const seedKey = artistKey(seed.name);

	const [seedSong, seedTop, similar] = await Promise.all([
		title ? findDeezerTrack(title, seed.name, apiBase).catch(() => null) : Promise.resolve(null),
		dz<{ data?: DeezerTrack[] }>(`/artist/${seed.id}/top?limit=50`),
		lastfmKey() ? lastfmSimilar(seed.name, title) : Promise.resolve({ artists: [], tracks: [] }),
	]);

	// Similar artists: Last.fm (with match scores), else Deezer's related list ranked by position.
	let similarArtists = similar.artists;
	if (!similarArtists.length) {
		const related = await dz<{ data?: DeezerArtist[] }>(`/artist/${seed.id}/related?limit=20`);
		similarArtists = (related?.data ?? []).map((a, i, all) => ({ name: a.name, match: 1 - i / Math.max(1, all.length) }));
	}
	similarArtists = similarArtists.filter(a => artistKey(a.name) !== seedKey);
	// Low variety stays close (top matches only); high variety reaches further down the list.
	const reach = Math.round(5 + v * 13);
	const chosenArtists = similarArtists.slice(0, reach);

	const candidates = new Map<string, Candidate>();
	const add = (c: Candidate) => {
		if (!c.title || !c.artist || NOT_A_SONG.test(c.title)) return;
		const key = songKey(c.title, c.artist);
		const prev = candidates.get(key);
		if (!prev || c.score > prev.score) candidates.set(key, { ...c, dz: c.dz ?? prev?.dz });
	};

	// The seed artist's catalog, weighted by popularity (Deezer rank).
	const top = seedTop?.data ?? [];
	const maxRank = Math.max(1, ...top.map(t => t.rank ?? 0));
	for (const t of top) add({ title: t.title_short || t.title, artist: t.artist?.name || seed.name, score: 0.35 + 0.65 * ((t.rank ?? 0) / maxRank), dz: t });

	// Songs that sound like the seed song (strongest signal for a song station).
	const maxTrackMatch = Math.max(0.01, ...similar.tracks.map(t => t.match));
	for (const t of similar.tracks) add({ title: t.title, artist: t.artist, score: 0.5 + 0.7 * (t.match / maxTrackMatch) });

	// Popular songs from similar artists, weighted by how similar the artist is.
	const tops = await Promise.all(
		chosenArtists.map(async a => {
			const dzArtist = await findDeezerArtist(a.name).catch(() => null);
			const res = dzArtist ? await dz<{ data?: DeezerTrack[] }>(`/artist/${dzArtist.id}/top?limit=10`) : null;
			return { match: a.match, tracks: res?.data ?? [] };
		}),
	);
	const maxArtistMatch = Math.max(0.01, ...chosenArtists.map(a => a.match));
	for (const { match, tracks } of tops) {
		const tMax = Math.max(1, ...tracks.map(t => t.rank ?? 0));
		for (const t of tracks) {
			add({ title: t.title_short || t.title, artist: t.artist?.name || "", score: (title ? 0.75 : 1) * (match / maxArtistMatch) * (0.4 + 0.6 * ((t.rank ?? 0) / tMax)), dz: t });
		}
	}

	// --- Draw the station ---
	const seedShare = 0.85 - 0.75 * v; // v=0 → 85% seed artist, v=0.4 → 55%, v=1 → 10%
	const otherCap = Math.max(2, Math.ceil(limit / 10)); // max songs per non-seed artist
	const spacing = 3; // other artists can't repeat within this many songs
	// The seed artist may repeat sooner when the station is mostly them (low variety).
	const seedSpacing = seedShare >= 0.6 ? 0 : seedShare >= 0.35 ? 1 : 2;

	const picked: Candidate[] = [];
	const used = new Set<string>();
	const perArtist = new Map<string, number>();
	const take = (c: Candidate) => {
		picked.push(c);
		used.add(songKey(c.title, c.artist));
		perArtist.set(artistKey(c.artist), (perArtist.get(artistKey(c.artist)) ?? 0) + 1);
	};

	const pool = [...candidates.values()];
	const isSeed = (c: Candidate) => artistKey(c.artist) === seedKey;

	// A song station opens with that song; an artist station with one of their popular songs.
	if (title) take(seedSong ? { title: seedSong.title, artist: seedSong.artist, score: 1 } : { title, artist: seed.name, score: 1 });
	else {
		const opener = pickWeighted(
			pool.filter(c => isSeed(c) && c.score >= 0.7),
			c => c.score,
		);
		if (opener) take(opener);
	}

	while (picked.length < limit) {
		const recentOther = new Set(picked.slice(-spacing).map(c => artistKey(c.artist)));
		const recentSeed = seedSpacing > 0 && picked.slice(-seedSpacing).some(isSeed);
		const open = pool.filter(c => !used.has(songKey(c.title, c.artist)));
		if (!open.length) break;
		const allowed = (c: Candidate, strict: boolean) => {
			const ak = artistKey(c.artist);
			if (strict && (isSeed(c) ? recentSeed : recentOther.has(ak))) return false;
			return isSeed(c) || (perArtist.get(ak) ?? 0) < otherCap;
		};
		// Keep the seed-artist share on target, with some randomness so stations differ.
		const seedCount = picked.filter(isSeed).length;
		const wantSeed = seedCount < seedShare * (picked.length + 1) - Math.random() * 0.8;
		const bucket = (strict: boolean) => {
			const ok = open.filter(c => allowed(c, strict));
			const preferred = ok.filter(c => isSeed(c) === wantSeed);
			return preferred.length ? preferred : ok;
		};
		const choices = bucket(true).length ? bucket(true) : bucket(false);
		// Squaring the score favors strong matches without making stations predictable.
		const next = pickWeighted(choices, c => c.score * c.score);
		if (!next) break;
		take(next);
	}

	// Resolve Last.fm-only picks to playable tracks (Deezer match, else YouTube via hints).
	const tracks = await Promise.all(
		picked.map(async c => {
			if (c.dz) return toRadioTrack(c.dz, apiBase);
			if (title && c === picked[0] && seedSong) return seedSong;
			const resolved = await findDeezerTrack(c.title, c.artist, apiBase).catch(() => null);
			if (resolved) return { ...resolved, title: c.title, artist: c.artist };
			const id = `lfm-${Buffer.from(songKey(c.title, c.artist)).toString("hex").slice(0, 16)}`;
			return {
				id,
				title: c.title,
				artist: c.artist,
				duration: 0,
				artwork: "",
				streamUrl: `${apiBase}/playback/${id}?title=${encodeURIComponent(c.title)}&artist=${encodeURIComponent(c.artist)}`,
				previewUrl: "",
				explicit: false,
			};
		}),
	);

	return {
		seed: { artist: seed.name, banner: seed.picture_xl || seed.picture_big || "" },
		tracks,
	};
}
