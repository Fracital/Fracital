import { createId } from "@paralleldrive/cuid2";
import { useMusicStore, usePlaybackStore, useTabsStore } from "../store";

let audioEl: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;

/** Called by QuickPlayer, which owns the one <audio> element and its Web Audio graph. */
export const registerAudio = (audio: HTMLAudioElement | null, context?: AudioContext | null) => {
	audioEl = audio;
	if (context !== undefined) audioCtx = context;
};

export const play = async () => {
	if (!audioEl) return;
	if (audioCtx?.state === "suspended") await audioCtx.resume();
	await audioEl.play();
	usePlaybackStore.getState().setIsPlaying(true);
};

export const pause = () => {
	audioEl?.pause();
	usePlaybackStore.getState().setIsPlaying(false);
};

export const togglePlay = async () => {
	if (!audioEl) return;
	if (audioEl.paused) await play();
	else pause();
};

export const seek = (time: number) => {
	if (!audioEl) return;
	const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : usePlaybackStore.getState().duration;
	const next = Math.max(0, duration ? Math.min(time, duration) : time);
	audioEl.currentTime = next;
	usePlaybackStore.getState().setCurrentTime(next);
};

/** Restarts the track if it's past the first few seconds, otherwise goes to the previous track. */
export const previous = () => {
	if (!audioEl) return;
	if (audioEl.currentTime > 2.5 || !useMusicStore.getState().playPrev()) seek(0);
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

export type PlayerMode = "cover" | "lyrics" | "queue";

export const PLAYER_PAGE = "player";

export const isPlayerUrl = (url: string | undefined) => !!url && /^about:player(\?|$)/.test(url);

export const playerUrl = (mode: PlayerMode) => (mode === "cover" ? `about:${PLAYER_PAGE}` : `about:${PLAYER_PAGE}?${mode}`);

export const parsePlayerMode = (query: string | undefined): PlayerMode => (query === "lyrics" || query === "queue" ? query : "cover");

/** Focuses the existing music player tab (switching it to `mode`) or opens a new one. */
export const openMusicPlayer = (mode: PlayerMode = "cover") => {
	const { tabs, setCurrentTab, updateTab, newTab } = useTabsStore.getState();
	const url = playerUrl(mode);
	const existing = tabs.find(tab => isPlayerUrl(tab.url));
	if (existing) {
		updateTab(existing.id, { url, displayUrl: url });
		setCurrentTab(existing.id);
		return;
	}
	newTab({ id: createId(), title: "Music Player", url, displayUrl: url });
};
