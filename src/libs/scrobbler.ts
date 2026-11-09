/**
 * Scrobbles what plays in Fracital to the signed-in user's Last.fm account.
 *
 * Follows Last.fm's rules: "now playing" when a song starts, and a scrobble once a
 * song longer than 30s has actually been listened to for half its length or 4 minutes.
 * Only real listening counts: seeks don't, and listening time can't outrun the clock.
 * Restarting a song after a counted listen (repeat-one, or seeking back to the start) is a new listen.
 *
 * Scrobbles go through a per-account queue in localStorage, so ones made offline, while
 * Last.fm is down, or while Last.fm access needs reconnecting are sent later (Last.fm
 * accepts scrobbles up to 14 days old).
 *
 * Also counts plays (30s of listening) for Fracital's own artist stats, signed in or not.
 */
import { useMusicStore, usePlaybackStore } from "../store";
import type { Track } from "../types";
import { getMe, meFetch, refreshMe } from "./auth";
import { listenerId } from "./artistPanel";

interface PlayState {
	key: string;
	track: Track;
	startedAt: number;
	listened: number;
	lastTime: number;
	/** Wall clock at the last playback tick, to cap listening time. */
	lastTick: number;
	nowPlayingSent: boolean;
	scrobbled: boolean;
	/** Counted toward Fracital's own play stats (artist panel). */
	counted: boolean;
}

interface QueuedScrobble {
	title: string;
	artist: string;
	album?: string;
	duration?: number;
	timestamp: number;
}

const QUEUE_PREFIX = "fr-scrobbles:";
const QUEUE_MAX = 1000;
const BATCH = 50;
/** Last.fm rejects scrobbles older than 14 days; leave a margin. */
const MAX_AGE_S = 13 * 24 * 60 * 60;
const RETRY_MS = 2 * 60_000;

let state: PlayState | null = null;
let started = false;

const primaryArtist = (t: Track) => (Array.isArray(t.artists) ? t.artists[0] : t.artists) || "";

/** The Last.fm-connected account, or null. `needsReconnect` accounts still queue scrobbles. */
async function lastfmAccount() {
	const me = await getMe();
	return me?.lastfm ? { userId: me.user.id, needsReconnect: !!me.lastfm.needsReconnect } : null;
}

function payload(t: Track, duration: number) {
	return { title: t.title, artist: primaryArtist(t), album: t.album || undefined, duration: duration > 0 ? Math.round(duration) : undefined };
}

// --- Queue ---

const queueKey = (userId: string) => QUEUE_PREFIX + userId;

function readQueue(userId: string): QueuedScrobble[] {
	try {
		const list = JSON.parse(localStorage.getItem(queueKey(userId)) || "[]") as QueuedScrobble[];
		const oldest = Date.now() / 1000 - MAX_AGE_S;
		return Array.isArray(list) ? list.filter(s => s && s.title && s.artist && s.timestamp > oldest) : [];
	} catch {
		return [];
	}
}

function writeQueue(userId: string, list: QueuedScrobble[]) {
	try {
		if (list.length) localStorage.setItem(queueKey(userId), JSON.stringify(list.slice(-QUEUE_MAX)));
		else localStorage.removeItem(queueKey(userId));
	} catch {
		// Storage full or blocked: the scrobble is only lost if sending it now fails too.
	}
}

function enqueue(userId: string, s: QueuedScrobble) {
	const list = readQueue(userId);
	// The same song at the same second is the same listen.
	if (list.some(q => q.timestamp === s.timestamp && q.title === s.title && q.artist === s.artist)) return;
	list.push(s);
	writeQueue(userId, list);
}

let flushing = false;
let retryTimer: number | undefined;

/** Sends queued scrobbles in batches; keeps them on temporary failures and retries later. */
export async function flushScrobbles(): Promise<void> {
	if (flushing) return;
	const account = await lastfmAccount();
	if (!account || account.needsReconnect || !navigator.onLine) return;
	flushing = true;
	window.clearTimeout(retryTimer);
	try {
		let list = readQueue(account.userId);
		while (list.length) {
			const batch = list.slice(0, BATCH);
			let res: { ok?: boolean; retry?: boolean; revoked?: boolean };
			try {
				res = await meFetch("/api/me/scrobble", { method: "POST", body: JSON.stringify({ scrobbles: batch }) });
			} catch (err) {
				const data = (err as { data?: { retry?: boolean } }).data;
				const status = (err as { status?: number }).status ?? 0;
				// Network errors and 5xx retry; a definite rejection (bad data, not connected) drops the batch.
				res = { ok: false, retry: data?.retry ?? (status === 0 || status >= 500) };
				if (status === 401 || status === 409) return;
			}
			if (res.revoked) {
				void refreshMe();
				return;
			}
			if (!res.ok && res.retry) {
				retryTimer = window.setTimeout(() => void flushScrobbles(), RETRY_MS);
				return;
			}
			// Sent, or permanently rejected: drop this batch. Re-read in case more were queued meanwhile.
			const sent = new Set(batch.map(s => `${s.timestamp}|${s.artist}|${s.title}`));
			list = readQueue(account.userId).filter(s => !sent.has(`${s.timestamp}|${s.artist}|${s.title}`));
			writeQueue(account.userId, list);
		}
	} finally {
		flushing = false;
	}
}

// --- Listening ---

function beginPlay(track: Track) {
	const playback = usePlaybackStore.getState();
	state = { key: track.id, track, startedAt: Date.now(), listened: 0, lastTime: playback.currentTime, lastTick: Date.now(), nowPlayingSent: false, scrobbled: false, counted: false };
}

async function sendNowPlaying(s: PlayState, duration: number) {
	s.nowPlayingSent = true;
	if (!s.track.title || !primaryArtist(s.track)) return;
	const account = await lastfmAccount();
	if (!account || account.needsReconnect || !navigator.onLine) return;
	const res = await meFetch<{ revoked?: boolean }>("/api/me/nowplaying", { method: "POST", body: JSON.stringify(payload(s.track, duration)) }).catch(() => null);
	if (res?.revoked) void refreshMe();
}

async function scrobble(s: PlayState, duration: number) {
	s.scrobbled = true;
	if (!s.track.title || !primaryArtist(s.track)) return;
	const account = await lastfmAccount();
	if (!account) return;
	enqueue(account.userId, { ...payload(s.track, duration), timestamp: Math.floor(s.startedAt / 1000) });
	void flushScrobbles();
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
		const now = Date.now();
		const wall = (now - s.lastTick) / 1000;
		s.lastTick = now;

		// Back to the start after a counted listen (repeat-one, or seeking back) is a new listen.
		const restarted = currentTime < 3 && s.lastTime - currentTime > 10;
		if (restarted && (s.scrobbled || (duration > 0 && s.lastTime > duration - 5))) {
			beginPlay(s.track);
			return;
		}

		const delta = currentTime - s.lastTime;
		s.lastTime = currentTime;
		// Count only real listening: normal ticks (not seeks), never faster than the clock allows.
		if (isPlaying && delta > 0 && delta < 2.5) s.listened += Math.min(delta, wall * 1.1 + 0.25);

		if (isPlaying && !s.nowPlayingSent && duration > 0) void sendNowPlaying(s, duration);
		if (!s.scrobbled && duration > 30 && s.listened >= Math.min(duration / 2, 240)) void scrobble(s, duration);
		// Fracital play stats: a play counts after 30s of listening (or most of a short song).
		if (!s.counted && s.listened >= Math.min(30, duration * 0.8 || 30)) {
			s.counted = true;
			const artist = primaryArtist(s.track);
			if (artist && s.track.title && !/^unknown/i.test(artist)) {
				void fetch("/api/play-event", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artist, title: s.track.title, listener: listenerId() }) }).catch(() => {});
			}
		}
	});

	// Send anything left from earlier: at start, when back online, and after (re)connecting Last.fm.
	window.addEventListener("online", () => void flushScrobbles());
	window.addEventListener("account-upd", () => void flushScrobbles());
	window.setTimeout(() => void flushScrobbles(), 5000);
}

/** Scrobbles waiting to be sent for the signed-in account. */
export async function pendingScrobbles(): Promise<number> {
	const me = await getMe();
	return me ? readQueue(me.user.id).length : 0;
}
