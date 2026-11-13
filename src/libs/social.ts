/**
 * The Social page's API (src/server/social.ts), and the listening status it shows: what plays here is
 * sent while the account chose to share it (off until it does), and cleared when it stops.
 */
import { useMusicStore, usePlaybackStore } from "../store";
import type { Track } from "../types";
import { meFetch } from "./auth";

export interface SocialUser {
	id: string;
	name: string;
	image: string | null;
	username: string | null;
	/** Their active streak in days; 0 when they have none. */
	streak?: number;
}

export interface SocialMessage {
	id: number;
	body: string;
	at: string;
	user: SocialUser;
}

export interface SocialSong {
	title: string;
	artist: string;
	album?: string;
	artwork?: string;
}

export interface Listening {
	user: SocialUser;
	song: SocialSong;
	at: string;
}

/** null until asked: whether this account shares what it plays. */
let sharing: boolean | null = null;

export const social = {
	messages: (after?: number) => meFetch<{ messages: SocialMessage[] }>(`/api/me/social/messages${after ? `?after=${after}` : ""}`).then(r => r.messages),
	send: (body: string) => meFetch<{ message: SocialMessage }>("/api/me/social/messages", { method: "POST", body: JSON.stringify({ body }) }).then(r => r.message),
	remove: (id: number) => meFetch(`/api/me/social/messages/${id}`, { method: "DELETE" }),
	listening: () => meFetch<{ listening: Listening[] }>("/api/me/social/listening").then(r => r.listening),
	share: async () => (sharing = await meFetch<{ share: boolean }>("/api/me/social/share").then(r => r.share)),
	setShare: async (share: boolean) => {
		await meFetch("/api/me/social/share", { method: "PUT", body: JSON.stringify({ share }) });
		sharing = share;
		lastKey = "";
		if (share) void sendStatus();
	},
};

const HEARTBEAT_MS = 60_000;
const SETTLE_MS = 1500;
let started = false;
/** The track last sent as playing; empty when the status is clear. */
let lastKey = "";
let timer: number | undefined;

const artistsOf = (t: Track) => (Array.isArray(t.artists) ? t.artists.join(", ") : t.artists) || "";

async function sendStatus() {
	if (sharing === null) await social.share().catch(() => (sharing = false));
	if (!sharing) return;
	const track = useMusicStore.getState().currentTrack;
	const playing = !!track && usePlaybackStore.getState().isPlaying && !!track.title && !!artistsOf(track);
	if (!playing && !lastKey) return;
	lastKey = playing ? track!.id : "";
	const song = playing ? { title: track!.title, artist: artistsOf(track!), album: track!.album || undefined, artwork: /^https:\/\//.test(track!.cover) ? track!.cover : undefined } : null;
	await meFetch("/api/me/social/status", { method: "POST", body: JSON.stringify({ song }), keepalive: !song }).catch(() => null);
}

const schedule = () => {
	window.clearTimeout(timer);
	timer = window.setTimeout(() => void sendStatus(), SETTLE_MS);
};

export function startSocialStatus() {
	if (started) return;
	started = true;
	useMusicStore.subscribe((music, prev) => {
		if (music.currentTrack?.id !== prev.currentTrack?.id) schedule();
	});
	usePlaybackStore.subscribe((playback, prev) => {
		if (playback.isPlaying !== prev.isPlaying) schedule();
	});
	window.setInterval(() => {
		if (lastKey) void sendStatus();
	}, HEARTBEAT_MS);
	// Signing in or out: ask again.
	window.addEventListener("account-upd", () => {
		sharing = null;
		lastKey = "";
	});
	window.addEventListener("pagehide", () => {
		if (!lastKey || !sharing) return;
		lastKey = "";
		void meFetch("/api/me/social/status", { method: "POST", body: JSON.stringify({ song: null }), keepalive: true }).catch(() => null);
	});
}
