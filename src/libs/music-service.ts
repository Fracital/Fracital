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

import { fileExists } from "../types";

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

export async function searchTracks(query: string, limit = 24, signal?: AbortSignal): Promise<SearchResults> {
	return apiFetch(`/search?q=${encodeURIComponent(query)}&limit=${limit}`, signal);
}

// --- Albums ---

export async function getAlbum(id: string): Promise<AlbumDetail> {
	return apiFetch(`/album/${encodeURIComponent(id)}`);
}

// --- Artists ---

export async function getArtist(id: string): Promise<ArtistDetail> {
	return apiFetch(`/artist/${encodeURIComponent(id)}`);
}

export async function getArtistTop(id: string, limit = 20): Promise<{ tracks: MusicTrack[] }> {
	return apiFetch(`/artist/${encodeURIComponent(id)}/top?limit=${limit}`);
}

// --- Charts ---

export async function getCharts(limit = 25): Promise<{ tracks: MusicTrack[]; albums: MusicAlbum[] }> {
	return apiFetch(`/charts?limit=${limit}`);
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

/** Splits a combined credit like "Jenny Rejects & ilostmykeys" into individual artist names. */
export function splitArtistCredit(credit: string): string[] {
	return credit
		.split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bvs\.?\b|\bx\b)\s*/i)
		.map(s => s.trim())
		.filter(Boolean);
}

export function trackToFracital(track: MusicTrack) {
	const artists = splitArtistCredit(track.artist);
	return {
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
