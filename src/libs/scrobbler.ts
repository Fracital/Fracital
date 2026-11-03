/**
 * Scrobbles what plays in Fracital to the signed-in user's Last.fm account.
 *
 * Follows Last.fm's rules: "now playing" when a song starts, and a scrobble once a
 * song longer than 30s has actually been listened to for half its length or 4 minutes.
 */
import { useMusicStore, usePlaybackStore } from "../store";
import type { Track } from "../types";
import { getMe, meFetch } from "./auth";

interface PlayState {
	key: string;
	track: Track;
	startedAt: number;
	listened: number;
	lastTime: number;
	nowPlayingSent: boolean;
	scrobbled: boolean;
}

let state: PlayState | null = null;
let started = false;

const primaryArtist = (t: Track) => (Array.isArray(t.artists) ? t.artists[0] : t.artists) || "";

async function connected(): Promise<boolean> {
	return !!(await getMe())?.lastfm;
}

function payload(t: Track, duration: number) {
	return { title: t.title, artist: primaryArtist(t), album: t.album || undefined, duration: duration > 0 ? Math.round(duration) : undefined };
}

function beginPlay(track: Track) {
	state = { key: track.id, track, startedAt: Date.now(), listened: 0, lastTime: usePlaybackStore.getState().currentTime, nowPlayingSent: false, scrobbled: false };
}

async function sendNowPlaying(s: PlayState, duration: number) {
	s.nowPlayingSent = true;
	if (!s.track.title || !primaryArtist(s.track) || !(await connected())) return;
	await meFetch("/api/me/nowplaying", { method: "POST", body: JSON.stringify(payload(s.track, duration)) }).catch(() => {});
}

async function scrobble(s: PlayState, duration: number) {
	s.scrobbled = true;
	if (!s.track.title || !primaryArtist(s.track) || !(await connected())) return;
	await meFetch("/api/me/scrobble", { method: "POST", body: JSON.stringify({ ...payload(s.track, duration), timestamp: Math.floor(s.startedAt / 1000) }) }).catch(() => {});
}

export function startScrobbler() {
	if (started) return;
	started = true;

	useMusicStore.subscribe(music => {
		const track = music.currentTrack;
		if (!track) state = null;
		else if (track.id !== state?.key) beginPlay(track);
	});

	usePlaybackStore.subscribe(playback => {
		const s = state;
		if (!s) return;
		const { isPlaying, currentTime, duration } = playback;

		// Looping the same song: jumping back to the start after a near-complete play is a new listen.
		if (s.scrobbled && currentTime < 2 && s.lastTime > duration - 5 && duration > 0) {
			beginPlay(s.track);
			return;
		}

		const delta = currentTime - s.lastTime;
		s.lastTime = currentTime;
		// Count only real listening time (normal ticks), not seeks.
		if (isPlaying && delta > 0 && delta < 2.5) s.listened += delta;

		if (isPlaying && !s.nowPlayingSent && duration > 0) void sendNowPlaying(s, duration);
		if (!s.scrobbled && duration > 30 && s.listened >= Math.min(duration / 2, 240)) void scrobble(s, duration);
	});
}
