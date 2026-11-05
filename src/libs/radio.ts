/**
 * Autoplay radio (on by default). Every track change — skip, back, picking a song
 * anywhere, or the next track starting — refreshes what's coming up from the new
 * song and its artist: the upcoming radio songs are replaced with a fresh mix seeded
 * by it. Songs the user queued themselves stay first, recently played songs aren't
 * repeated, and the station keeps going when the queue runs out. Turning it off
 * (the "Off" button) stops re-tuning until it's turned back on or radio is started.
 */
import { createId } from "@paralleldrive/cuid2";
import { create } from "zustand";
import { useMusicStore } from "../store";
import type { Track } from "../types";
import { getRadio, trackToFracital } from "./music-service";

const PREFS_KEY = "fracital:radio";

interface RadioPrefs {
	/** Autoplay radio on/off (persisted, defaults to on). */
	active: boolean;
	/** What the station is currently built around. */
	seed: { artist: string; title?: string } | null;
	variety: number;
	length: number;
}

interface RadioState extends RadioPrefs {
	loading: boolean;
	error: string | null;
	setVariety: (v: number) => void;
	setLength: (n: number) => void;
}

const loadPrefs = (): RadioPrefs => {
	try {
		const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<RadioPrefs>;
		return {
			active: (saved as { autoplay?: boolean }).autoplay ?? true,
			seed: null,
			// Older builds stored these separately.
			variety: saved.variety ?? (Number(localStorage.getItem("fracital:radio-variety")) || 40),
			length: saved.length ?? (Number(localStorage.getItem("fracital:radio-length")) || 25),
		};
	} catch {
		return { active: true, seed: null, variety: 40, length: 25 };
	}
};

export const useRadioStore = create<RadioState>(set => ({
	...loadPrefs(),
	loading: false,
	error: null,
	setVariety: variety => set({ variety }),
	setLength: length => set({ length }),
}));

useRadioStore.subscribe(s => {
	const { active, variety, length } = s;
	localStorage.setItem(PREFS_KEY, JSON.stringify({ autoplay: active, variety, length }));
});

const primaryArtist = (t: Track) => (Array.isArray(t.artists) ? t.artists[0] : t.artists) || "";
const songKey = (title: string, artist: string) => `${artist}|${title}`.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^\p{L}\p{N}|]+/gu, "");

/** Increments on every request so a slow, stale response never overwrites a newer one. */
let generation = 0;
/** The track id radio itself just started, so its own change doesn't trigger a re-tune. */
let selfStartedId: string | null = null;

async function fetchStation(artist: string, title: string | undefined, exclude: Set<string>) {
	const { variety, length } = useRadioStore.getState();
	// Ask for a few extra to make up for songs filtered out as recently played.
	const mix = await getRadio({ artist, title, variety, limit: length + 8 });
	return (mix.tracks || []).filter(t => (t.streamUrl || t.previewUrl) && !exclude.has(songKey(t.title, t.artist)));
}

/** Songs to avoid repeating: what's playing plus the last 40 played. */
function recentKeys(): Set<string> {
	const { currentTrack, playedHistory } = useMusicStore.getState();
	return new Set([currentTrack, ...playedHistory.slice(-40)].filter((t): t is Track => !!t).map(t => songKey(t.title, primaryArtist(t))));
}

/** Starts radio from an artist (and optional song) and plays it immediately. */
export async function startRadio(artist: string, title?: string): Promise<void> {
	const gen = ++generation;
	useRadioStore.setState({ loading: true, error: null });
	try {
		const recent = recentKeys();
		const [opener, ...others] = await fetchStation(artist, title, new Set());
		if (gen !== generation) return;
		if (!opener) throw new Error("Couldn't build a station for that");
		const { length } = useRadioStore.getState();
		// The opener (your chosen song) always plays; the rest skips anything played recently.
		const tracks = [opener, ...others.filter(t => !recent.has(songKey(t.title, t.artist)))];
		const [first, ...rest] = tracks.slice(0, length).map(t => ({ ...trackToFracital(t), id: createId(), radio: true }));
		selfStartedId = first.id;
		// Starting a station is a fresh start: it replaces whatever was queued.
		useMusicStore.getState().playTrack(first);
		useMusicStore.setState({ queue: rest });
		useRadioStore.setState({ active: true, seed: { artist, title } });
	} catch (err) {
		if (gen === generation) useRadioStore.setState({ error: err instanceof Error ? err.message : "Radio failed" });
	} finally {
		if (gen === generation) useRadioStore.setState({ loading: false });
	}
}

/** Re-tunes around what's playing now, keeping it playing and replacing only radio-queued songs. */
async function retune(track: Track): Promise<void> {
	const artist = primaryArtist(track);
	// Untagged local files have nothing to build a station from.
	if (!artist || !track.title || /^unknown/i.test(artist)) return;
	const gen = ++generation;
	useRadioStore.setState({ loading: true, error: null, seed: { artist, title: track.title } });
	try {
		const tracks = await fetchStation(artist, track.title, recentKeys());
		// The song changed again while this was loading; the newer request wins.
		if (gen !== generation || useMusicStore.getState().currentTrack?.id !== track.id) return;
		const { length } = useRadioStore.getState();
		const upcoming = tracks.slice(0, length - 1).map(t => ({ ...trackToFracital(t), id: createId(), radio: true }));
		const userQueued = useMusicStore.getState().queue.filter(t => !t.radio && t.id !== track.id);
		useMusicStore.setState({ queue: [...userQueued, ...upcoming] });
	} catch (err) {
		if (gen === generation) useRadioStore.setState({ error: err instanceof Error ? err.message : "Radio failed" });
	} finally {
		if (gen === generation) useRadioStore.setState({ loading: false });
	}
}

/** Turns autoplay radio back on and re-tunes around what's playing right now. */
export function enableRadio(): void {
	useRadioStore.setState({ active: true, error: null });
	const now = useMusicStore.getState().currentTrack;
	if (now) void retune(now);
}

/** Turns autoplay radio off: its queued songs are removed; the current song and user-queued songs stay. */
export function stopRadio(): void {
	generation++;
	window.clearTimeout(retuneTimer);
	useRadioStore.setState({ active: false, seed: null, loading: false, error: null });
	useMusicStore.setState(s => ({ queue: s.queue.filter(t => !t.radio) }));
}

let retuneTimer = 0;
let started = false;

/** Wires radio to the player. Called once at startup. */
export function initRadio(): void {
	if (started) return;
	started = true;
	useMusicStore.subscribe((music, prev) => {
		if (!useRadioStore.getState().active) return;
		const now = music.currentTrack;
		if (now?.id === prev.currentTrack?.id) return;
		if (now && now.id === selfStartedId) {
			selfStartedId = null;
			return;
		}
		window.clearTimeout(retuneTimer);
		if (now) {
			// Short debounce so mashing "next" only re-tunes once, on the song you land on.
			retuneTimer = window.setTimeout(() => void retune(now), 350);
		} else {
			// The queue ran out: keep the station going from where it was.
			const seed = useRadioStore.getState().seed ?? (prev.currentTrack ? { artist: primaryArtist(prev.currentTrack), title: prev.currentTrack.title } : null);
			if (seed) retuneTimer = window.setTimeout(() => void startRadio(seed.artist, seed.title), 350);
		}
	});
}
