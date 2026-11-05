/**
 * Music service client.
 *
 * Talks to the Fracital music backend which uses iTunes for catalog metadata
 * and yt-dlp for full-length audio streaming. The backend handles all
 * YouTube resolution + stream extraction so the browser only sees clean
 * audio URLs.
 *
 * Configure the base URL via `configureMusicApi()` in init.ts.
 */

import { fileExists, type Track } from "../types";
import { rememberArtistNames, splitArtistCredit } from "./artistCredit";

// ============================================================
// Configuration
// ============================================================

const CONFIG_PATH = "/music_service.json";

export interface MusicApiConfig {
	/** Base URL of the music API, e.g. "https://api.yoursite.com/api/music" */
	baseUrl: string;
}

let _config: MusicApiConfig | null = null;

export function configureMusicApi(config: MusicApiConfig) {
	_config = config;
}

export function getMusicApiConfig(): MusicApiConfig | null {
	return _config;
}

function apiBase(): string {
	if (!_config?.baseUrl) throw new Error("Music API not configured. Call configureMusicApi() first.");
	return _config.baseUrl.replace(/\/+$/, "");
}

// ============================================================
// Types
// ============================================================

export interface MusicTrack {
	id: string;
	title: string;
	artist: string;
	artistId?: string;
	album?: string;
	albumId?: string;
	duration: number;
	artwork: string;
	streamUrl: string;
	previewUrl?: string;
	explicit?: boolean;
}

export interface MusicAlbum {
	id: string;
	title: string;
	artist: string;
	artistId?: string;
	artwork: string;
	releaseDate?: string;
	trackCount?: number;
	/** Release kind, derived from iTunes's " - Single" / " - EP" title suffixes. */
	type?: "album" | "single" | "ep";
	explicit?: boolean;
}

/** Album title without iTunes's " - Single" / " - EP" suffix. */
export function cleanAlbumTitle(title: string): string {
	return title.replace(/\s*-\s*(Single|EP)\s*$/i, "");
}

export interface MusicArtist {
	id: string;
	name: string;
	picture: string;
	/** Full-size image for the artist page hero banner. */
	banner?: string;
	/** Short Wikipedia bio shown on the artist page hero. */
	bio?: string;
	/** Deezer fan count. */
	fans?: number;
	/** Last.fm unique listeners (only when the server has a Last.fm key). */
	listeners?: number;
	/** Last.fm total scrobbles. */
	scrobbles?: number;
}

/** A related artist from Deezer's graph — has no catalog id, so it's opened by name. */
export interface SimilarArtist {
	name: string;
	picture: string;
	fans?: number;
	listeners?: number;
}

export interface TrackPlays {
	/** Total YouTube streams across the song's official uploads. */
	plays: number;
	source: "youtube";
	/** How many uploads were summed. */
	uploads: number;
	/** False when only fan uploads exist (then it's the single most-played one). */
	official: boolean;
}

export interface SearchResults {
	tracks: MusicTrack[];
	albums: MusicAlbum[];
	artists?: MusicArtist[];
}

export interface AlbumDetail {
	album: MusicAlbum;
	tracks: MusicTrack[];
}

export interface ArtistDetail {
	artist: MusicArtist;
	albums: MusicAlbum[];
	tracks: MusicTrack[];
	similar?: SimilarArtist[];
}

// ============================================================
// API client
// ============================================================

/** Resolve a relative path like /api/music/playback/... against the server origin. */
function resolveUrl(url: string): string {
	if (!url) return "";
	if (/^https?:\/\//i.test(url)) return url;
	// Extract origin from the configured base URL
	const base = apiBase();
	try {
		const origin = new URL(base).origin;
		return `${origin}${url}`;
	} catch {
		return url;
	}
}

function resolveTrackUrls(track: MusicTrack): MusicTrack {
	return { ...track, streamUrl: resolveUrl(track.streamUrl), previewUrl: track.previewUrl || "" };
}

async function apiFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
	const res = await fetch(`${apiBase()}${path}`, { signal });
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Music API error ${res.status}: ${text}`);
	}
	const data = await res.json();
	// Resolve relative stream URLs in track responses
	if (data.tracks && Array.isArray(data.tracks)) {
		data.tracks = data.tracks.map(resolveTrackUrls);
	}
	return data;
}

// --- Search ---

/**
 * iTunes lists a song's clean and explicit editions as separate tracks, and the clean one
 * can come first. Keep one per song (in the first one's position), preferring explicit.
 */
export function preferExplicit<T extends { title: string; artist: string; explicit?: boolean }>(tracks: T[]): T[] {
	const key = (t: T) => `${t.title.toLowerCase().replace(/\(clean( version)?\)/g, "").replace(/[^\p{L}\p{N}]+/gu, "")}|${t.artist.toLowerCase()}`;
	const best = new Map<string, T>();
	for (const t of tracks) {
		const seen = best.get(key(t));
		if (!seen || (t.explicit && !seen.explicit)) best.set(key(t), t);
	}
	const used = new Set<string>();
	return tracks.flatMap(t => (used.has(key(t)) ? [] : (used.add(key(t)), [best.get(key(t))!])));
}

export async function searchTracks(query: string, limit = 24, signal?: AbortSignal): Promise<SearchResults> {
	const res = await apiFetch<SearchResults>(`/search?q=${encodeURIComponent(query)}&limit=${limit}`, signal);
	rememberArtistNames((res.artists ?? []).map(a => a.name));
	return { ...res, tracks: preferExplicit(res.tracks ?? []) };
}

// --- Albums ---

export async function getAlbum(id: string): Promise<AlbumDetail> {
	return apiFetch(`/album/${encodeURIComponent(id)}`);
}

// --- Artists ---

export async function getArtist(id: string): Promise<ArtistDetail> {
	const res = await apiFetch<ArtistDetail>(`/artist/${encodeURIComponent(id)}`);
	rememberArtistNames([res.artist?.name, ...(res.similar ?? []).map(s => s.name)]);
	return { ...res, tracks: preferExplicit(res.tracks ?? []) };
}

const playsCache = new Map<string, Promise<TrackPlays | null>>();
/** Settled results, readable synchronously so re-mounted rows don't flash a placeholder. */
const playsResolved = new Map<string, TrackPlays | null>();

const playsKey = (title: string, artist: string) => `${artist}|${title}`.toLowerCase();

/** The cached play count if already loaded: TrackPlays, null (unknown), or undefined (not loaded yet). */
export function peekTrackPlays(title: string, artist: string): TrackPlays | null | undefined {
	return playsResolved.get(playsKey(title, artist));
}

/** A song's total YouTube streams across its official uploads; null when unknown. */
export function getTrackPlays(title: string, artist: string): Promise<TrackPlays | null> {
	const key = playsKey(title, artist);
	let pending = playsCache.get(key);
	if (!pending) {
		// v=3 skips browser-cached responses from when plays were Last.fm scrobbles.
		pending = apiFetch<{ plays: number | null; uploads: number | null; official: boolean | null; source: TrackPlays["source"] | null }>(`/plays?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&v=3`)
			.then(r => {
				const value = r.plays && r.source ? { plays: r.plays, source: r.source, uploads: r.uploads ?? 1, official: r.official ?? true } : null;
				playsResolved.set(key, value);
				return value;
			})
			.catch(() => {
				playsCache.delete(key);
				return null;
			});
		playsCache.set(key, pending);
	}
	return pending;
}

// --- Artist page extras (social links + gallery photos) ---

export type ArtistLinkKind = "instagram" | "spotify" | "youtube" | "tidal" | "apple" | "soundcloud" | "x" | "tiktok" | "facebook" | "bandcamp" | "deezer" | "website";

export interface ArtistExtras {
	links: { kind: ArtistLinkKind; url: string }[];
	images: string[];
}

export function getArtistExtras(name: string): Promise<ArtistExtras> {
	return apiFetch<ArtistExtras>(`/artist-extras?name=${encodeURIComponent(name)}`).catch(() => ({ links: [], images: [] }));
}

// --- Your Library (Fracital Account + Last.fm; same-origin /api/me) ---

export type LibraryTrack = MusicTrack & { userPlays?: number; lovedAt?: number; playedAt?: number; nowPlaying?: boolean };
export interface LibraryArtist {
	name: string;
	picture: string;
	fans?: number;
	userPlays?: number;
	because?: string;
}
export interface LibraryAlbum {
	title: string;
	artist: string;
	artwork: string;
	userPlays?: number;
}
export type LastfmPeriod = "7day" | "1month" | "3month" | "6month" | "12month" | "overall";

async function meJson<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(path, { ...init, credentials: "include", headers: init.body ? { "Content-Type": "application/json" } : undefined });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || `Request failed (${res.status})`), { status: res.status });
	return data as T;
}

const resolveLibrary = <T extends { tracks?: MusicTrack[] }>(data: T): T => ({ ...data, tracks: data.tracks?.map(resolveTrackUrls) });

export const library = {
	loved: () => meJson<{ total: number; tracks: LibraryTrack[] }>("/api/me/library/loved?limit=50").then(resolveLibrary),
	recent: () => meJson<{ tracks: LibraryTrack[] }>("/api/me/library/recent?limit=30").then(resolveLibrary),
	topTracks: (period: LastfmPeriod) => meJson<{ tracks: LibraryTrack[] }>(`/api/me/library/top-tracks?period=${period}&limit=30`).then(resolveLibrary),
	topArtists: (period: LastfmPeriod) => meJson<{ artists: LibraryArtist[] }>(`/api/me/library/top-artists?period=${period}&limit=30`),
	topAlbums: (period: LastfmPeriod) => meJson<{ albums: LibraryAlbum[] }>(`/api/me/library/top-albums?period=${period}&limit=30`),
	recommendations: () => meJson<{ artists: LibraryArtist[]; tracks: LibraryTrack[] }>("/api/me/recommendations").then(resolveLibrary),
	savedArtists: () => meJson<{ artists: { id: string; name: string; picture: string }[] }>("/api/me/artists"),
	saveArtist: (id: string, name: string, picture: string, saved: boolean) =>
		meJson<{ saved: boolean }>(`/api/me/artists/${encodeURIComponent(id)}`, saved ? { method: "PUT", body: JSON.stringify({ name, picture }) } : { method: "DELETE" }),
	saved: () => meJson<{ tracks: MusicTrack[]; albums: MusicAlbum[] }>("/api/me/saved").then(r => ({ ...r, tracks: r.tracks.map(resolveTrackUrls) })),
	saveItem: (kind: "track" | "album", item: MusicTrack | MusicAlbum, saved: boolean) =>
		meJson<{ saved: boolean }>(`/api/me/saved/${kind}/${encodeURIComponent(item.id)}`, saved ? { method: "PUT", body: JSON.stringify({ data: item }) } : { method: "DELETE" }),
	/** The user's own plays + loved state per song, keyed by the caller's keys. */
	trackStats: (tracks: { key: string; title: string; artist: string }[]) =>
		meJson<Record<string, { userPlays: number; loved: boolean }>>("/api/me/stats/tracks", { method: "POST", body: JSON.stringify({ tracks }) }),
	artistStats: (name: string) => meJson<{ userPlays: number | null }>(`/api/me/stats/artist?name=${encodeURIComponent(name)}`),
	love: (title: string, artist: string, loved: boolean) => meJson<{ loved: boolean }>("/api/me/love", { method: "POST", body: JSON.stringify({ title, artist, loved }) }),
};

/** Compact count like Spotify's: 271M, 2.75M, 84.8K. */
export function formatCount(n: number): string {
	return new Intl.NumberFormat("en", { notation: "compact", maximumSignificantDigits: 3 }).format(n);
}

// --- Now Playing details ---

export interface SongCredits {
	sections: { title: string; credits: { name: string; roles: string[] }[] }[];
	url: string | null;
}

const songParams = (title: string, artist: string) => `title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;

/** Release date of the song's album or single. */
export function getSongInfo(title: string, artist: string, albumId?: string): Promise<{ releaseDate: string | null }> {
	return apiFetch(`/song-info?${songParams(title, artist)}${albumId ? `&albumId=${encodeURIComponent(albumId)}` : ""}`);
}

export interface AlbumInfo {
	releaseDate: string | null;
	genre: string | null;
	copyright: string | null;
	label: string | null;
	bio: { summary: string; full: string; url: string | null } | null;
	listeners: number | null;
	playcount: number | null;
	tags: string[];
	credits: SongCredits["sections"];
	creditsUrl: string | null;
}

/** Release details, bio and credits for an album, EP or single. */
export function getAlbumInfo(album: MusicAlbum): Promise<AlbumInfo> {
	return apiFetch(`/album-info?${songParams(album.title, album.artist)}&id=${encodeURIComponent(album.id)}${album.trackCount ? `&tracks=${album.trackCount}` : ""}`);
}

/** Writers, producers, engineers and musicians (MusicBrainz). */
export function getSongCredits(title: string, artist: string): Promise<SongCredits> {
	return apiFetch(`/song-credits?${songParams(title, artist)}`);
}

export async function getArtistTop(id: string, limit = 20): Promise<{ tracks: MusicTrack[] }> {
	const res = await apiFetch<{ tracks: MusicTrack[] }>(`/artist/${encodeURIComponent(id)}/top?limit=${limit}`);
	return { ...res, tracks: preferExplicit(res.tracks ?? []) };
}

// --- Charts ---

export async function getCharts(limit = 25): Promise<{ tracks: MusicTrack[]; albums: MusicAlbum[] }> {
	const res = await apiFetch<{ tracks: MusicTrack[]; albums: MusicAlbum[] }>(`/charts?limit=${limit}`);
	return { ...res, tracks: preferExplicit(res.tracks ?? []) };
}

// --- Radio ---

export interface RadioOptions {
	/** Seed artist name. */
	artist: string;
	/** Optional seed track title — the station leads with it. */
	title?: string;
	/** 0..100: 0 = only the seed artist, 100 = mostly related artists. */
	variety?: number;
	limit?: number;
}

export async function getRadio({ artist, title, variety = 40, limit = 25 }: RadioOptions): Promise<{ seed: { artist: string; banner: string }; tracks: MusicTrack[] }> {
	const params = new URLSearchParams({ artist, variety: String(variety), limit: String(limit) });
	if (title) params.set("title", title);
	return apiFetch(`/radio?${params}`);
}

// --- Stream URL ---

/**
 * Get a playable stream URL for a track.
 * The server resolves the YouTube audio URL and proxies it.
 * Falls back to the iTunes 30s preview if the server can't resolve.
 */
export function getStreamUrl(track: MusicTrack): string {
	return track.streamUrl || track.previewUrl || "";
}

/**
 * Warm the server cache for a track's stream URL (call for the next track
 * in queue so playback starts instantly).
 */
export function warmStream(track: MusicTrack | undefined): void {
	if (!track?.streamUrl || !track.streamUrl.includes("/playback/")) return;
	fetch(`${track.streamUrl}${track.streamUrl.includes("?") ? "&" : "?"}warm=1`, {
		cache: "no-store",
		mode: "no-cors",
	}).catch(() => {});
}

// ============================================================
// Helpers
// ============================================================

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

export { splitArtistCredit };

export function trackToFracital(track: MusicTrack): Track {
	const artists = splitArtistCredit(track.artist);
	return {
		source: "digital-library",
		artistId: track.artistId,
		albumId: track.albumId,
		libraryId: track.id,
		id: `ms-${track.id}`,
		title: track.title,
		// An array lets the player render collab credits individually.
		artists: artists.length > 1 ? artists : track.artist,
		album: track.album || "",
		genre: "",
		year: "",
		cover: track.artwork,
		explicit: track.explicit || false,
		src: track.streamUrl || track.previewUrl || "",
	};
}

export function artworkHighRes(url: string): string {
	if (!url) return "";
	// iTunes artwork: swap size to 600x600
	return url.replace(/\d+x\d+bb/, "600x600bb");
}

// ============================================================
// Persistence (saved config)
// ============================================================

export async function saveConfig(config: MusicApiConfig): Promise<void> {
	await window.fr.fs.promises.writeFile(CONFIG_PATH, JSON.stringify(config), "utf8");
}

export async function loadSavedConfig(): Promise<MusicApiConfig | null> {
	if (!(await fileExists(CONFIG_PATH))) return null;
	try {
		return JSON.parse(await window.fr.fs.promises.readFile(CONFIG_PATH, "utf8"));
	} catch {
		return null;
	}
}
