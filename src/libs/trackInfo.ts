import { parseBlob } from "music-metadata";
import { fetchJson, fetchRemote } from "./imgHandler";
import { artistsMatch, titlesMatch } from "./lyricMatch";
import type { SongQuery } from "./lyrics";

export type TrackInfoSource = "itunes" | "deezer";

export interface TrackInfo {
	title: string;
	artist: string;
	album?: string;
	genre?: string;
	year?: string;
	coverUrl?: string;
	source: TrackInfoSource;
}

export const TRACK_INFO_SOURCE_LABELS: Record<TrackInfoSource, string> = {
	itunes: "Apple Music",
	deezer: "Deezer",
};

interface ItunesSong {
	trackName?: string;
	artistName?: string;
	collectionName?: string;
	primaryGenreName?: string;
	releaseDate?: string;
	trackTimeMillis?: number;
	artworkUrl100?: string;
}

interface DeezerSong {
	title: string;
	duration?: number;
	artist?: { name: string };
	album?: { id: number; title?: string; cover_xl?: string; cover_big?: string };
}

interface DeezerAlbum {
	release_date?: string;
	genres?: { data?: { name: string }[] };
}

// Different cuts (radio edit, extended mix) usually differ by more than this many seconds.
const MAX_DURATION_DIFF = 15;
// "01 Title", "3. Title" or "7 - Title", but not titles that start with a number like "7 Rings".
const LEADING_TRACK_NUMBER = /^\s*(?:\d{1,3}\s*[-._)]\s*|0\d\s+)/;
const FILENAME_SEPARATOR = /\s+[-–—]\s+/;

const durationFits = (duration: number | undefined, candidate: number | undefined) => !duration || !candidate || Math.abs(candidate - duration) <= MAX_DURATION_DIFF;

const matches = (query: SongQuery, title: string | undefined, artist: string | undefined, seconds: number | undefined) => !!title && titlesMatch(query.title, title) && artistsMatch(query.artist, artist ? [artist] : []) && durationFits(query.duration, seconds);

const fromItunes = async (query: SongQuery): Promise<TrackInfo | null> => {
	const params = new URLSearchParams({ term: [query.title, query.artist].filter(Boolean).join(" "), entity: "song", limit: "15" });
	const { results } = await fetchJson<{ results?: ItunesSong[] }>(`https://itunes.apple.com/search?${params}`);
	const song = results?.find(r => matches(query, r.trackName, r.artistName, r.trackTimeMillis ? r.trackTimeMillis / 1000 : undefined));
	if (!song?.trackName) return null;
	return {
		title: song.trackName,
		artist: song.artistName ?? "",
		album: song.collectionName,
		genre: song.primaryGenreName,
		year: song.releaseDate?.slice(0, 4),
		// iTunes serves any size by changing the dimensions in the artwork URL.
		coverUrl: song.artworkUrl100?.replace(/\/\d+x\d+bb\./, "/600x600bb."),
		source: "itunes",
	};
};

const fromDeezer = async (query: SongQuery): Promise<TrackInfo | null> => {
	const q = [query.title, query.artist.split(",")[0].trim()].filter(Boolean).join(" ");
	const { data } = await fetchJson<{ data?: DeezerSong[] }>(`https://api.deezer.com/search?${new URLSearchParams({ q, limit: "15" })}`);
	const song = data?.find(r => matches(query, r.title, r.artist?.name, r.duration));
	if (!song) return null;

	let album: DeezerAlbum = {};
	if (song.album?.id) {
		try {
			album = await fetchJson<DeezerAlbum>(`https://api.deezer.com/album/${song.album.id}`);
		} catch {
			// Year and genre are optional.
		}
	}
	return {
		title: song.title,
		artist: song.artist?.name ?? "",
		album: song.album?.title,
		genre: album.genres?.data?.map(g => g.name).join(", ") || undefined,
		year: album.release_date?.slice(0, 4),
		coverUrl: song.album?.cover_xl || song.album?.cover_big,
		source: "deezer",
	};
};

/** Looks up a song's album, genre, year and cover art on Apple Music, falling back to Deezer. */
export const findTrackInfo = async (query: SongQuery): Promise<TrackInfo | null> => {
	if (!query.title.trim()) return null;
	for (const provider of [fromItunes, fromDeezer]) {
		try {
			const info = await provider(query);
			if (info) return info;
		} catch (error) {
			console.warn(`Track info lookup failed (${provider.name}):`, error);
		}
	}
	return null;
};

/** Downloads an image and returns it as a data URL, the format covers are stored in within tags.json. */
export const fetchCoverDataUrl = async (url: string): Promise<string> => {
	const blob = await fetchRemote(url);
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
};

/** Duration of an audio file or blob in seconds, if it can be read. */
export const audioDuration = async (blob: Blob): Promise<number | undefined> => {
	try {
		return (await parseBlob(blob, { skipCovers: true, duration: true })).format.duration;
	} catch {
		return undefined;
	}
};

/** Guesses title and artist from file names like "01 - Artist - Title.mp3" or "Title.mp3". */
export const guessFromFileName = (fileName: string): { title: string; artist: string } => {
	const base = fileName
		.replace(/\.[^/.]+$/, "")
		.replace(/_/g, " ")
		.replace(LEADING_TRACK_NUMBER, "")
		.trim();
	const parts = base.split(FILENAME_SEPARATOR).filter(Boolean);
	if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
	return { title: base, artist: "" };
};
