import { parseBlob } from "music-metadata";
import { MusicPath, type Track } from "../types";
import { fetchJson } from "./imgHandler";
import { LYRIC_FORMATS, lyricFormatOf, parseLrc, parseLyrics, toLrc, type LyricFormat, type ParsedLyrics } from "./lrc";
import { artistsMatch, stripCredits, titlesMatch } from "./lyricMatch";

export type LyricsSource = "file" | "embedded" | "lrclib" | "netease";

export interface Lyrics extends ParsedLyrics {
	source: LyricsSource;
}

export const LYRICS_PROVIDER_NAMES: Partial<Record<LyricsSource, string>> = {
	lrclib: "LRCLIB",
	netease: "NetEase Cloud Music",
};

export const LYRICS_SOURCE_LABELS: Record<LyricsSource, string> = {
	file: "Lyrics from music folder",
	embedded: "Lyrics from file tags",
	lrclib: "Lyrics from LRCLIB",
	netease: "Lyrics from NetEase Cloud Music",
};

interface LrclibResult {
	trackName?: string;
	artistName?: string;
	duration?: number;
	instrumental?: boolean;
	plainLyrics?: string | null;
	syncedLyrics?: string | null;
}

interface NeteaseSong {
	id: number;
	name: string;
	artists?: { name: string }[];
	/** Milliseconds. */
	duration?: number;
}

interface NeteaseLyricResponse {
	nolyric?: boolean;
	uncollected?: boolean;
	lrc?: { lyric?: string };
}

// Synced formats are checked before plain text.
const LYRIC_FILES = LYRIC_FORMATS.map(format => ({ name: `lyrics.${format}`, format }));
export const LYRICS_ACCEPT = LYRIC_FORMATS.map(format => `.${format}`).join(",");
export const LYRICS_CHANGED_EVENT = "fracital:lyrics-changed";
const UNKNOWN_ARTIST = /^unknown( artist)?$/i;
// ID3 SYLT timestamps in milliseconds.
const TIMESTAMP_MS = 2;

const cache = new Map<string, Promise<Lyrics | null>>();

const artistOf = (track: Track) => {
	const artists = Array.isArray(track.artists) ? track.artists.join(", ") : track.artists;
	return artists && !UNKNOWN_ARTIST.test(artists.trim()) ? artists.trim() : "";
};

const hasLines = (lyrics: ParsedLyrics | null): lyrics is ParsedLyrics => !!lyrics && lyrics.lines.some(line => line.text);

const fromFolder = async (track: Track): Promise<Lyrics | null> => {
	if (!track.folderName) return null;
	for (const { name, format } of LYRIC_FILES) {
		try {
			const raw = await window.fr.fs.promises.readFile(`${MusicPath}/${track.folderName}/${name}`, "utf8");
			const parsed = parseLyrics(String(raw), format);
			if (hasLines(parsed)) return { ...parsed, source: "file" };
		} catch {
			// File doesn't exist; try the next source.
		}
	}
	return null;
};

/** Reads lyrics embedded in the audio file's tags, plus the file's duration for matching online results. */
const fromEmbeddedTags = async (track: Track): Promise<{ lyrics: Lyrics | null; duration?: number }> => {
	if (!track.src) return { lyrics: null };
	try {
		const blob = await (await fetch(track.src)).blob();
		const { common, format } = await parseBlob(blob, { skipCovers: true });
		const duration = format.duration;
		for (const tag of common.lyrics ?? []) {
			const timed = tag.syncText?.filter(line => typeof line.timestamp === "number");
			if (timed?.length && tag.timeStampFormat === TIMESTAMP_MS) {
				return {
					duration,
					lyrics: {
						synced: true,
						source: "embedded",
						lines: timed.map(line => ({ time: (line.timestamp as number) / 1000, text: line.text.trim() })).sort((a, b) => a.time - b.time),
					},
				};
			}
			const text = tag.text ?? tag.syncText?.map(line => line.text).join("\n");
			const parsed = text ? parseLrc(text) : null;
			if (hasLines(parsed)) return { duration, lyrics: { ...parsed, source: "embedded" } };
		}
		return { lyrics: null, duration };
	} catch (error) {
		console.warn("Failed to read embedded lyrics:", error);
		return { lyrics: null };
	}
};

// Providers sometimes return a different cut of the song; skip matches whose length is off by more than this.
const MAX_DURATION_DIFF = 15;

const durationOff = (duration: number | undefined, candidate: number | undefined) => (duration && candidate ? Math.abs(candidate - duration) : 0);

export interface SongQuery {
	title: string;
	/** Comma-separated artists, or empty when unknown. */
	artist: string;
	/** Seconds, used to pick the right version of a song. */
	duration?: number;
}

const fromLrclib = async ({ title, artist, duration }: SongQuery): Promise<Lyrics | null> => {
	const params = new URLSearchParams({ track_name: title });
	if (artist) params.set("artist_name", artist);

	try {
		const results = await fetchJson<LrclibResult[]>(`https://lrclib.net/api/search?${params}`);
		if (!Array.isArray(results) || results.length === 0) return null;

		// Synced lyrics from a different-length cut would drift, so only use them when the length matches; plain lyrics are fine either way.
		const syncedFits = (r: LrclibResult) => !!r.syncedLyrics && durationOff(duration, r.duration) <= MAX_DURATION_DIFF;
		const score = (r: LrclibResult) => (syncedFits(r) ? 0 : 1000) + durationOff(duration, r.duration);
		const best = results.filter(r => syncedFits(r) || r.plainLyrics).sort((a, b) => score(a) - score(b))[0];
		if (!best) return null;

		const parsed = parseLrc((syncedFits(best) ? best.syncedLyrics : best.plainLyrics) || "");
		return hasLines(parsed) ? { ...parsed, source: "lrclib" } : null;
	} catch (error) {
		console.warn("Failed to fetch lyrics from LRCLIB:", error);
		return null;
	}
};

const fromNetease = async ({ title, artist, duration }: SongQuery): Promise<Lyrics | null> => {
	const params = new URLSearchParams({ s: artist ? `${title} ${artist}` : title, type: "1", limit: "10" });

	try {
		const search = await fetchJson<{ result?: { songs?: NeteaseSong[] } }>(`https://music.163.com/api/search/get?${params}`);
		const candidates = (search.result?.songs ?? [])
			.filter(song => titlesMatch(title, song.name) && artistsMatch(artist, song.artists?.map(a => a.name) ?? []))
			.map(song => ({ song, off: durationOff(duration, song.duration ? song.duration / 1000 : undefined) }))
			.filter(({ off }) => off <= MAX_DURATION_DIFF)
			.sort((a, b) => a.off - b.off)
			.slice(0, 3);

		for (const { song } of candidates) {
			const data = await fetchJson<NeteaseLyricResponse>(`https://music.163.com/api/song/lyric?id=${song.id}&lv=1&tv=-1`);
			if (data.nolyric || data.uncollected || !data.lrc?.lyric) continue;
			const parsed = parseLrc(data.lrc.lyric);
			const lyrics = { ...parsed, lines: stripCredits(parsed.lines) };
			if (hasLines(lyrics)) return { ...lyrics, source: "netease" };
		}
	} catch (error) {
		console.warn("Failed to fetch lyrics from NetEase:", error);
	}
	return null;
};

/** Queries every online provider at once, preferring synced lyrics, then provider order. */
export const findOnlineLyrics = async (query: SongQuery): Promise<Lyrics | null> => {
	const title = query.title.trim();
	if (!title) return null;
	const trimmed = { ...query, title, artist: UNKNOWN_ARTIST.test(query.artist.trim()) ? "" : query.artist.trim() };
	const results = await Promise.all([fromLrclib(trimmed), fromNetease(trimmed)]);
	return results.find(lyrics => lyrics?.synced) ?? results.find(Boolean) ?? null;
};

/**
 * Looks for lyrics in order: `lyrics.lrc`/`lyrics.srt`/`lyrics.txt` in the song's music folder,
 * lyrics embedded in the audio file's tags, then online (LRCLIB and NetEase Cloud Music).
 */
export const loadLyrics = (track: Track, duration?: number): Promise<Lyrics | null> => {
	const key = track.folderName || track.src || `${track.title}|${artistOf(track)}`;
	const cached = cache.get(key);
	if (cached) return cached;

	const pending = (async () => {
		const file = await fromFolder(track);
		if (file) return file;
		const embedded = await fromEmbeddedTags(track);
		// The file's own duration is more reliable than the player's, which may still belong to the previous track.
		return embedded.lyrics ?? (await findOnlineLyrics({ title: track.title ?? "", artist: artistOf(track), duration: embedded.duration ?? duration }));
	})();
	cache.set(key, pending);
	// Don't cache misses forever so newly added lyric files get picked up.
	pending.then(result => {
		if (!result) cache.delete(key);
	});
	return pending;
};

/**
 * Saves an LRC, SRT or TXT file as the lyrics for a song folder, replacing any existing lyric file.
 * Throws if the file type is unsupported or it contains no lyrics.
 */
export const saveLyrics = async (folderName: string, file: File): Promise<void> => {
	const format = lyricFormatOf(file.name);
	if (!format) throw new Error("Unsupported lyrics file. Please choose an LRC, SRT or TXT file.");

	const raw = await file.text();
	if (!hasLines(parseLyrics(raw, format))) throw new Error("That file doesn't contain any lyrics.");
	await writeLyrics(folderName, raw, format);
};

/** Saves already-parsed lyrics (e.g. found online) as `lyrics.lrc` when synced, otherwise `lyrics.txt`. */
export const saveParsedLyrics = (folderName: string, lyrics: ParsedLyrics): Promise<void> => writeLyrics(folderName, toLrc(lyrics), lyrics.synced ? "lrc" : "txt");

/** Lyrics stored with the song (lyrics file or file tags), plus the audio's duration when it was read. */
export const readLocalLyrics = async (track: Track): Promise<{ lyrics: Lyrics | null; duration?: number }> => {
	const file = await fromFolder(track);
	const embedded = await fromEmbeddedTags(track);
	return { lyrics: file ?? embedded.lyrics, duration: embedded.duration };
};

const writeLyrics = async (folderName: string, raw: string, format: LyricFormat): Promise<void> => {
	const folderPath = `${MusicPath}/${folderName}`;
	for (const { name } of LYRIC_FILES) {
		try {
			await window.fr.fs.promises.unlink(`${folderPath}/${name}`);
		} catch {
			// Nothing to remove.
		}
	}
	await window.fr.fs.promises.writeFile(`${folderPath}/lyrics.${format}`, raw);

	cache.delete(folderName);
	window.dispatchEvent(new CustomEvent(LYRICS_CHANGED_EVENT, { detail: { folderName } }));
};
