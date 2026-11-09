/**
 * The signed-in user's playlists, liked songs and disliked songs (server: src/server/playlists.ts).
 *
 * Liking a song adds it to "Liked Songs" and also loves it on Last.fm / ListenBrainz when one is
 * connected. Disliking one skips it if it's playing, drops it from the queue, and keeps radio
 * from playing it again. Shared so a heart toggled anywhere updates everywhere.
 */
import { createId } from "@paralleldrive/cuid2";
import { create } from "zustand";
import { getMe } from "./auth";
import { songKey, useLastfmStore } from "./lastfmState";
import { library, type MusicTrack, type PlaylistSummary } from "./music-service";
import { libraryTrackFromPlayer } from "./savedLibrary";
import { useMusicStore, useTabsStore } from "../store";
import type { Track } from "../types";

/** Feedback key: the song's first artist and title, without "(feat. …)", "[Remastered]" or punctuation. */
export function feedbackKey(title: string, artist: string): string {
	const first = artist.split(/,| & | feat\.? | ft\.? | x /i)[0] ?? artist;
	return `${first}|${title}`
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, "")
		.replace(/[^\p{L}\p{N}|]+/gu, "");
}

const hex16 = (s: string) => {
	// FNV-1a twice for 16 hex chars: only an id for the stream endpoint, not security.
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < s.length; i++) {
		a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0;
		b = Math.imul(b ^ s.charCodeAt(i), 2166136261) >>> 0;
	}
	return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
};

/**
 * A player track as a storable song. Songs without a lasting stream (local files) get the
 * stream endpoint's title/artist lookup instead, so they still play from a playlist later.
 */
export function trackFromPlayer(track: Track): MusicTrack {
	const fromLibrary = libraryTrackFromPlayer(track);
	if (fromLibrary) return fromLibrary;
	const artist = Array.isArray(track.artists) ? track.artists.join(", ") : track.artists;
	const lasting = /^(https?:)?\/\//.test(track.src || "") || (track.src || "").startsWith("/api/");
	const id = `lfm-${hex16(`${artist}|${track.title}`.toLowerCase())}`;
	return {
		id,
		title: track.title,
		artist,
		album: track.album || undefined,
		duration: 0,
		artwork: /^https?:\/\//.test(track.cover) ? track.cover : "",
		streamUrl: lasting ? track.src! : `/api/music/playback/${id}?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(artist)}`,
		explicit: track.explicit,
	};
}

/** Only what's needed to play and show a song again (the same fields saved songs keep). */
const slim = ({ id, title, artist, artistId, album, albumId, duration, artwork, streamUrl, explicit }: MusicTrack): MusicTrack => ({ id, title, artist, artistId, album, albumId, duration, artwork, streamUrl, explicit });

interface PlaylistState {
	/** undefined until checked, false when signed out. */
	signedIn: boolean | undefined;
	playlists: PlaylistSummary[];
	/** Liked songs, newest first. */
	liked: MusicTrack[];
	/** Disliked songs by feedback key. */
	disliked: Record<string, true>;
	refresh: () => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState>(() => ({
	signedIn: undefined,
	playlists: [],
	liked: [],
	disliked: {},
	refresh: async () => {
		const me = await getMe().catch(() => null);
		if (!me) return void usePlaylistStore.setState({ signedIn: false, playlists: [], liked: [], disliked: {} });
		const [lists, feedback] = await Promise.all([library.playlists().catch(() => ({ playlists: [] })), library.feedback().catch(() => ({ liked: [], disliked: [] }))]);
		usePlaylistStore.setState({ signedIn: true, playlists: lists.playlists, liked: feedback.liked, disliked: Object.fromEntries(feedback.disliked.map(k => [k, true as const])) });
	},
}));

let started = false;
/** Loads playlists and feedback once (and again on sign in/out). Safe to call from many components. */
export function ensurePlaylistsLoaded() {
	if (started) return;
	started = true;
	void usePlaylistStore.getState().refresh();
	window.addEventListener("account-upd", () => void usePlaylistStore.getState().refresh());
}

const openSignIn = () => useTabsStore.getState().newTab({ id: createId(), url: "about:account", displayUrl: "about:account", title: "Fracital Account", icon: null, current: true });

/** Signed in, or opens the sign-in page and returns false. */
export function requireSignIn(): boolean {
	ensurePlaylistsLoaded();
	if (usePlaylistStore.getState().signedIn) return true;
	openSignIn();
	return false;
}

/** `record` without `key`. */
const without = (record: Record<string, true>, key: string) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key)) as Record<string, true>;

export const isLiked = (s: PlaylistState, title: string, artist: string) => {
	const key = feedbackKey(title, artist);
	return s.liked.some(t => feedbackKey(t.title, t.artist) === key);
};
export const isDisliked = (s: PlaylistState, title: string, artist: string) => !!s.disliked[feedbackKey(title, artist)];

/** Loves or unloves on Last.fm / ListenBrainz too, when one is connected (best effort). */
function mirrorLove(track: MusicTrack, loved: boolean) {
	const { username, loved: lovedMap } = useLastfmStore.getState();
	if (!username) return;
	const key = songKey(track.title, track.artist);
	if (!!lovedMap[key] === loved) return;
	useLastfmStore.setState(s => ({ loved: { ...s.loved, [key]: loved } }));
	library.love(track.title, track.artist, loved).catch(() => useLastfmStore.setState(s => ({ loved: { ...s.loved, [key]: !loved } })));
}

export function toggleLike(input: MusicTrack): void {
	if (!requireSignIn()) return;
	const track = slim(input);
	const key = feedbackKey(track.title, track.artist);
	const before = usePlaylistStore.getState();
	const liked = !isLiked(before, track.title, track.artist);
	const disliked = without(before.disliked, key);
	usePlaylistStore.setState(s => ({ liked: liked ? [track, ...s.liked.filter(t => feedbackKey(t.title, t.artist) !== key)] : s.liked.filter(t => feedbackKey(t.title, t.artist) !== key), disliked }));
	library.setFeedback(key, liked ? 1 : 0, track).catch(() => usePlaylistStore.setState({ liked: before.liked, disliked: before.disliked }));
	mirrorLove(track, liked);
}

/**
 * Dislikes a song, or takes the dislike back. Disliking skips it if it's playing and removes it
 * from the queue; radio leaves it out from then on.
 */
export function toggleDislike(input: MusicTrack): void {
	if (!requireSignIn()) return;
	const track = slim(input);
	const key = feedbackKey(track.title, track.artist);
	const before = usePlaylistStore.getState();
	const disliked = !before.disliked[key];
	usePlaylistStore.setState(s => ({ disliked: disliked ? { ...s.disliked, [key]: true } : without(s.disliked, key), liked: disliked ? s.liked.filter(t => feedbackKey(t.title, t.artist) !== key) : s.liked }));
	library.setFeedback(key, disliked ? -1 : 0, track).catch(() => usePlaylistStore.setState({ liked: before.liked, disliked: before.disliked }));
	if (!disliked) return;
	mirrorLove(track, false);
	const music = useMusicStore.getState();
	const sameSong = (t: Track) => feedbackKey(t.title, Array.isArray(t.artists) ? t.artists.join(", ") : t.artists) === key;
	useMusicStore.setState({ queue: music.queue.filter(t => !sameSong(t)) });
	if (music.currentTrack && sameSong(music.currentTrack)) {
		if (useMusicStore.getState().queue.length) useMusicStore.getState().playNext();
		else useMusicStore.getState().setCurrentTrack(null);
	}
}

export async function createPlaylist(name: string, first?: MusicTrack): Promise<PlaylistSummary | null> {
	if (!requireSignIn()) return null;
	const { playlist } = await library.createPlaylist(name);
	usePlaylistStore.setState(s => ({ playlists: [playlist, ...s.playlists] }));
	if (first) await addToPlaylist(playlist.id, first);
	return playlist;
}

export async function addToPlaylist(id: string, input: MusicTrack): Promise<boolean> {
	if (!requireSignIn()) return false;
	const track = slim(input);
	const { added } = await library.addToPlaylist(id, track);
	if (added)
		usePlaylistStore.setState(s => ({
			// Most recently changed first, like the server orders them.
			playlists: s.playlists.map(p => (p.id === id ? { ...p, count: p.count + 1, artwork: p.artwork.length < 4 && track.artwork ? [...p.artwork, track.artwork] : p.artwork } : p)).sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0)),
		}));
	return added;
}

export async function removeFromPlaylist(id: string, trackId: string): Promise<void> {
	await library.removeFromPlaylist(id, trackId);
	usePlaylistStore.setState(s => ({ playlists: s.playlists.map(p => (p.id === id ? { ...p, count: Math.max(0, p.count - 1) } : p)) }));
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
	await library.renamePlaylist(id, name);
	usePlaylistStore.setState(s => ({ playlists: s.playlists.map(p => (p.id === id ? { ...p, name } : p)) }));
}

export async function deletePlaylist(id: string): Promise<void> {
	await library.deletePlaylist(id);
	usePlaylistStore.setState(s => ({ playlists: s.playlists.filter(p => p.id !== id) }));
}
