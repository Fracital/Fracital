/**
 * The signed-in user's saved songs, albums and followed artists (Fracital account, no
 * Last.fm needed). Shared so an "add to library" toggled anywhere updates everywhere.
 */
import { createId } from "@paralleldrive/cuid2";
import { create } from "zustand";
import { getMe } from "./auth";
import { library, type MusicAlbum, type MusicTrack } from "./music-service";
import { useTabsStore } from "../store";
import type { Track } from "../types";

export interface SavedArtist {
	id: string;
	name: string;
	picture: string;
}

interface SavedState {
	/** null = signed out, undefined = not loaded yet. */
	signedIn: boolean | undefined;
	tracks: MusicTrack[];
	albums: MusicAlbum[];
	artists: SavedArtist[];
	refresh: () => Promise<void>;
	toggleTrack: (track: MusicTrack) => void;
	toggleAlbum: (album: MusicAlbum) => void;
	toggleArtist: (artist: SavedArtist) => void;
}

const openSignIn = () => useTabsStore.getState().newTab({ id: createId(), url: "about:account", displayUrl: "about:account", title: "Fracital Account", icon: null, current: true });

/** Optimistically flips an item in/out of a list, reverting if the request fails. */
function toggle<T extends { id: string }>(key: "tracks" | "albums" | "artists", item: T, save: (saved: boolean) => Promise<unknown>) {
	const state = useSavedStore.getState();
	if (!state.signedIn) return openSignIn();
	const list = state[key] as unknown as T[];
	const next = !list.some(x => x.id === item.id);
	const apply = (saved: boolean) =>
		useSavedStore.setState(s => {
			const cur = (s[key] as unknown as T[]).filter(x => x.id !== item.id);
			return { [key]: saved ? [item, ...cur] : cur } as Partial<SavedState>;
		});
	apply(next);
	save(next).catch(() => apply(!next));
}

export const useSavedStore = create<SavedState>(() => ({
	signedIn: undefined,
	tracks: [],
	albums: [],
	artists: [],
	refresh: async () => {
		const me = await getMe().catch(() => null);
		if (!me) return void useSavedStore.setState({ signedIn: false, tracks: [], albums: [], artists: [] });
		const [saved, artists] = await Promise.all([library.saved().catch(() => ({ tracks: [], albums: [] })), library.savedArtists().catch(() => ({ artists: [] }))]);
		useSavedStore.setState({ signedIn: true, tracks: saved.tracks, albums: saved.albums, artists: artists.artists });
	},
	toggleTrack: track => {
		const { id, title, artist, artistId, album, albumId, duration, artwork, streamUrl, explicit } = track;
		const slim: MusicTrack = { id, title, artist, artistId, album, albumId, duration, artwork, streamUrl, explicit };
		toggle("tracks", slim, saved => library.saveItem("track", slim, saved));
	},
	toggleAlbum: album => {
		const { id, title, artist, artistId, artwork, releaseDate, trackCount, type, explicit } = album;
		const slim: MusicAlbum = { id, title, artist, artistId, artwork, releaseDate, trackCount, type, explicit };
		toggle("albums", slim, saved => library.saveItem("album", slim, saved));
	},
	toggleArtist: artist => toggle("artists", artist, saved => library.saveArtist(artist.id, artist.name, artist.picture, saved)),
}));

let started = false;
/** Loads saved items once (and again on sign in/out). Safe to call from many components. */
export function ensureSavedLoaded() {
	if (started) return;
	started = true;
	void useSavedStore.getState().refresh();
	window.addEventListener("account-upd", () => void useSavedStore.getState().refresh());
}

export const useIsTrackSaved = (id?: string) => useSavedStore(s => !!id && s.tracks.some(t => t.id === id));
export const useIsAlbumSaved = (id?: string) => useSavedStore(s => !!id && s.albums.some(a => a.id === id));
export const useIsArtistSaved = (id?: string) => useSavedStore(s => !!id && s.artists.some(a => a.id === id));

/** Back from the player's Track shape to a library track (Digital Library tracks only). */
export function libraryTrackFromPlayer(track: Track): MusicTrack | null {
	const id = track.libraryId ?? (track.id.startsWith("ms-") ? track.id.slice(3) : null);
	if (track.source !== "digital-library" || !id) return null;
	return {
		id,
		title: track.title,
		artist: Array.isArray(track.artists) ? track.artists.join(", ") : track.artists,
		artistId: track.artistId,
		album: track.album || undefined,
		albumId: track.albumId,
		duration: 0,
		artwork: track.cover,
		streamUrl: track.src || "",
		explicit: track.explicit,
	};
}
