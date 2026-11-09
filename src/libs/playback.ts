import { createId } from "@paralleldrive/cuid2";
import { useMusicStore, usePlaybackStore, useTabsStore } from "../store";

let audioEl: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;

/** Called by QuickPlayer, which owns the one <audio> element and its Web Audio graph. */
export const registerAudio = (audio: HTMLAudioElement | null, context?: AudioContext | null) => {
	audioEl = audio;
	if (context !== undefined) audioCtx = context;
};

export const getAudio = () => audioEl;

/** Something else playing the song for now: a music video with its own audio (Now Playing's Video mode). */
export interface PlaybackOwner {
	play: () => void;
	pause: () => void;
	seek: (time: number) => void;
	time: () => number;
	paused: () => boolean;
}

let owner: PlaybackOwner | null = null;

/** While set, the transport controls drive `next` instead of the <audio> element. */
export const setPlaybackOwner = (next: PlaybackOwner | null) => {
	owner = next;
};

export const play = async () => {
	if (owner) return owner.play();
	if (!audioEl) return;
	if (audioCtx?.state === "suspended") await audioCtx.resume();
	await audioEl.play();
	usePlaybackStore.getState().setIsPlaying(true);
};

export const pause = () => {
	if (owner) return owner.pause();
	audioEl?.pause();
	usePlaybackStore.getState().setIsPlaying(false);
};

export const togglePlay = async () => {
	if (owner) return owner.paused() ? owner.play() : owner.pause();
	if (!audioEl) return;
	if (audioEl.paused) await play();
	else pause();
};

export const seek = (time: number) => {
	if (owner) return owner.seek(Math.max(0, time));
	if (!audioEl) return;
	const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : usePlaybackStore.getState().duration;
	const next = Math.max(0, duration ? Math.min(time, duration) : time);
	audioEl.currentTime = next;
	usePlaybackStore.getState().setCurrentTime(next);
};

/** Restarts the track if it's past the first few seconds, otherwise goes to the previous track. */
export const previous = () => {
	const time = owner ? owner.time() : audioEl?.currentTime;
	if (time === undefined) return;
	if (time > 2.5 || !useMusicStore.getState().playPrev()) seek(0);
};

export const next = () => useMusicStore.getState().playNext();

export const toggleLoop = () => usePlaybackStore.getState().setLoop(prev => !prev);

export const setVolume = (volume: number) => {
	const clamped = Math.max(0, Math.min(1, volume));
	const store = usePlaybackStore.getState();
	store.setVolume(clamped);
	if (clamped > 0 && store.muted) store.setMuted(false);
};

export const toggleMute = () => usePlaybackStore.getState().setMuted(prev => !prev);

export const formatTime = (time: number): string => {
	if (!Number.isFinite(time) || time < 0) return "0:00";
	const hours = Math.floor(time / 3600);
	const minutes = Math.floor((time % 3600) / 60);
	const seconds = Math.floor(time % 60)
		.toString()
		.padStart(2, "0");
	return hours > 0 ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
};

export type PlayerMode = "video" | "cover" | "lyrics" | "queue" | "credits" | "info";

export const PLAYER_PAGE = "player";

/** The player is the "Now Playing" section of about:music (legacy about:player URLs redirect there). */
export const isPlayerUrl = (url: string | undefined) => !!url && /^about:(player(\?|$)|music\?player(&|$))/.test(url);

export const playerUrl = (mode: PlayerMode) => (mode === "cover" ? "about:music?player" : `about:music?player&${mode}`);

export const parsePlayerMode = (query: string | undefined): PlayerMode => (query === "video" || query === "lyrics" || query === "queue" || query === "credits" || query === "info" ? query : "cover");

/** The Now Playing tab is titled after the song. */
export const nowPlayingTitle = () => useMusicStore.getState().currentTrack?.title || "Now Playing";

/** Shows Now Playing in the open Music tab (switching it to `mode`) or opens a new one. */
export const openMusicPlayer = (mode: PlayerMode = "cover") => {
	const { tabs, setCurrentTab, updateTab, newTab } = useTabsStore.getState();
	const url = playerUrl(mode);
	const isMusic = (u: string) => /^about:music(\?|$)/.test(u);
	const existing = tabs.find(tab => tab.current && isMusic(tab.url)) ?? tabs.find(tab => isPlayerUrl(tab.url)) ?? tabs.find(tab => isMusic(tab.url));
	if (existing) {
		updateTab(existing.id, { url, displayUrl: url, title: nowPlayingTitle() });
		setCurrentTab(existing.id);
		return;
	}
	newTab({ id: createId(), title: nowPlayingTitle(), url, displayUrl: url });
};
