/**
 * Shows what plays in Fracital as the user's Discord status ("Listening to <song>"), for
 * accounts that turned it on (about:account; the server side is discord-presence.ts).
 *
 * Sends the song when it changes, starts, pauses (clears the status) or is seeked, and
 * re-sends while it plays because Discord drops the status after 20 minutes without one.
 */
import { useMusicStore, usePlaybackStore } from "../store";
import type { Track } from "../types";
import { getMe, meFetch, refreshMe } from "./auth";

const HEARTBEAT_MS = 8 * 60_000;
/** A song change or pause settles for this long before it's sent, so skipping through a queue sends once. */
const SETTLE_MS = 1500;

interface Sent {
	key: string;
	playing: boolean;
	/** Where the song would be now, from the last send (seconds); a seek moves it off. */
	startedAt: number;
}

let started = false;
let last: Sent | null = null;
let timer: number | undefined;

const artistsOf = (t: Track) => (Array.isArray(t.artists) ? t.artists.join(", ") : t.artists) || "";

async function active(): Promise<boolean> {
	const p = (await getMe())?.discordPresence;
	return !!p?.connected && p.enabled;
}

async function send(): Promise<void> {
	const track = useMusicStore.getState().currentTrack;
	const { isPlaying, currentTime, duration } = usePlaybackStore.getState();
	const playing = !!track && isPlaying && !!track.title && !!artistsOf(track);
	if (!(await active())) {
		last = null;
		return;
	}
	if (!playing && !last?.playing) return;
	last = { key: track?.id ?? "", playing, startedAt: Date.now() / 1000 - currentTime };
	const song = playing
		? {
				title: track!.title,
				artist: artistsOf(track!),
				album: track!.album || undefined,
				artwork: /^https:\/\//.test(track!.cover) ? track!.cover : undefined,
				duration: duration > 0 ? Math.round(duration) : undefined,
				position: Math.max(0, Math.round(currentTime)),
			}
		: null;
	const res = await meFetch<{ ok?: boolean; error?: string; connected?: boolean }>("/api/me/presence", { method: "POST", body: JSON.stringify({ song }), keepalive: !song }).catch(() => null);
	// A refusal or a lost connection shows on the account page.
	if (res && !res.ok && (res.error || res.connected === false)) void refreshMe();
}

const schedule = () => {
	window.clearTimeout(timer);
	timer = window.setTimeout(() => void send(), SETTLE_MS);
};

export function startDiscordPresence() {
	if (started) return;
	started = true;

	useMusicStore.subscribe((music, prev) => {
		if (music.currentTrack?.id !== prev.currentTrack?.id) schedule();
	});
	usePlaybackStore.subscribe((playback, prev) => {
		if (playback.isPlaying !== prev.isPlaying) return schedule();
		// A seek: the song is somewhere other than where the status says.
		// Re-anchored now, so the ticks until it's sent don't keep pushing the send back.
		if (last?.playing && Math.abs(Date.now() / 1000 - playback.currentTime - last.startedAt) > 5) {
			last.startedAt = Date.now() / 1000 - playback.currentTime;
			schedule();
		}
	});

	window.setInterval(() => {
		if (last?.playing) void send();
	}, HEARTBEAT_MS);

	// Turning it on or off, or signing out, takes effect right away.
	window.addEventListener("account-upd", () => {
		void active().then(on => {
			if (on && usePlaybackStore.getState().isPlaying) schedule();
		});
	});
	// Closing the app clears the status instead of leaving it for 20 minutes.
	window.addEventListener("pagehide", () => {
		if (!last?.playing) return;
		last = null;
		void meFetch("/api/me/presence", { method: "POST", body: JSON.stringify({ song: null }), keepalive: true }).catch(() => null);
	});
}
