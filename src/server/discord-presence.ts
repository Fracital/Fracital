/**
 * Discord Rich Presence ("Listening to <song>") set from the server, for users who opt in.
 *
 * A web page can't reach the Discord client, so this uses Discord's headless sessions
 * (POST /users/@me/headless-sessions with an OAuth token that has `activities.write`).
 * That endpoint is only described by community docs, and Discord's own docs list the scope
 * as unavailable to most apps, so the whole feature is off unless DISCORD_PRESENCE=1, and
 * the scope is only ever asked for by the separate "show on Discord" connect step (never by
 * Discord sign-in), so a rejected scope can't break signing in.
 *
 * A headless session lasts 20 minutes; the client re-sends while a song plays.
 */
import type { Pool } from "pg";

const API = "https://discord.com/api/v10";
export const PRESENCE_SCOPE = "activities.write";

export const discordPresenceEnabled = () => process.env.DISCORD_PRESENCE?.trim() === "1" && !!process.env.DISCORD_CLIENT_ID?.trim() && !!process.env.DISCORD_CLIENT_SECRET?.trim();

/** Whether a stored better-auth scope list (comma- or space-separated) includes the presence scope. */
export const hasPresenceScope = (scope: string | null | undefined) => !!scope && scope.split(/[\s,]+/).includes(PRESENCE_SCOPE);

/**
 * Only third-party artwork CDNs: Discord's media proxy embeds the image URL in the activity
 * friends receive, so an artwork URL on one of our own hosts would show them that host.
 */
const ARTWORK_HOSTS = ["dzcdn.net", "mzstatic.com", "ytimg.com", "ggpht.com", "googleusercontent.com", "scdn.co", "fastly.net", "coverartarchive.org", "archive.org", "sndcdn.com"];
function artworkUrl(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		const host = url.hostname.toLowerCase();
		return url.protocol === "https:" && raw.length <= 300 && ARTWORK_HOSTS.some(h => host === h || host.endsWith(`.${h}`)) ? url.href : undefined;
	} catch {
		return undefined;
	}
}

export async function migratePresence(pool: Pool) {
	await pool.query(`create table if not exists fracital_discord_presence (
		user_id text primary key references "user"(id) on delete cascade,
		enabled boolean not null default true,
		session_token text not null default '',
		error text not null default '',
		error_at timestamptz,
		updated_at timestamptz not null default now()
	)`);
	// "On Discord" (discord-bot.ts) on the account page; users can turn it off.
	await pool.query("alter table fracital_discord_presence add column if not exists show_activity boolean not null default true");
}

export interface PresenceRow {
	enabled: boolean;
	/** Show what the user is doing on Discord on their account page. */
	show_activity: boolean;
	session_token: string;
	error: string;
	error_at: Date | null;
}

export async function readPresence(pool: Pool, userId: string): Promise<PresenceRow> {
	const { rows } = await pool.query<PresenceRow>("select enabled, show_activity, session_token, error, error_at from fracital_discord_presence where user_id = $1", [userId]);
	return rows[0] ?? { enabled: true, show_activity: true, session_token: "", error: "", error_at: null };
}

export async function writePresence(pool: Pool, userId: string, patch: Partial<Omit<PresenceRow, "error_at">>) {
	const row = { ...(await readPresence(pool, userId)), ...patch };
	await pool.query(
		`insert into fracital_discord_presence (user_id, enabled, show_activity, session_token, error, error_at, updated_at) values ($1, $2, $3, $4, $5, $6, now())
		 on conflict (user_id) do update set enabled = excluded.enabled, show_activity = excluded.show_activity, session_token = excluded.session_token, error = excluded.error, error_at = excluded.error_at, updated_at = now()`,
		[userId, row.enabled, row.show_activity, row.session_token, row.error, patch.error === undefined ? row.error_at : patch.error ? new Date() : null],
	);
}

export interface NowPlaying {
	title: string;
	artist: string;
	album?: string;
	artwork?: string;
	/** Seconds. */
	duration?: number;
	/** Seconds into the song right now. */
	position?: number;
}

class DiscordError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function discord<T>(path: string, accessToken: string, body: unknown): Promise<T | null> {
	const res = await fetch(`${API}${path}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "User-Agent": "Fracital/2.0" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(8000),
	});
	if (res.status === 204) return null;
	const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok) throw new DiscordError(res.status, data?.message || `Discord ${res.status}`);
	return data;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function activity(song: NowPlaying) {
	const now = Date.now();
	const start = now - Math.max(0, song.position ?? 0) * 1000;
	const large = artworkUrl(song.artwork);
	return {
		type: 2, // Listening
		name: "Fracital",
		application_id: process.env.DISCORD_CLIENT_ID!.trim(),
		platform: "desktop",
		status_display_type: 2, // "Listening to <details>" in the member list
		details: clip(song.title, 128),
		state: clip(song.artist, 128),
		timestamps: song.duration ? { start, end: start + song.duration * 1000 } : { start },
		...(large ? { assets: { large_image: large, ...(song.album ? { large_text: clip(song.album, 128) } : {}) } } : {}),
	};
}

export type PresenceResult = { ok: true; token: string } | { ok: false; error: string; temporary: boolean };

/** Errors Discord gives when the scope or the endpoint isn't open to this app. */
const refusal = (status: number) => status === 401 || status === 403;

/** Shows `song` (or clears the status with null), updating the session `token` when there is one. */
export async function sendPresence(accessToken: string, token: string, song: NowPlaying | null): Promise<PresenceResult> {
	try {
		if (!song) {
			if (token) await discord("/users/@me/headless-sessions/delete", accessToken, { token }).catch(err => (err instanceof DiscordError && err.status === 404 ? null : Promise.reject(err)));
			return { ok: true, token: "" };
		}
		const body = { activities: [activity(song)] };
		let res = await discord<{ token?: string }>("/users/@me/headless-sessions", accessToken, token ? { ...body, token } : body).catch(async err => {
			// The session expired (20 minutes) or was cleared elsewhere: start a new one.
			if (token && err instanceof DiscordError && (err.status === 400 || err.status === 404)) return discord<{ token?: string }>("/users/@me/headless-sessions", accessToken, body);
			throw err;
		});
		res ??= {};
		return { ok: true, token: res.token || token };
	} catch (err) {
		const status = err instanceof DiscordError ? err.status : 0;
		if (refusal(status)) return { ok: false, error: "Discord didn't allow setting your status. Reconnect Discord; if this keeps happening, Discord hasn't opened status access to this app.", temporary: false };
		return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach Discord", temporary: status === 0 || status === 429 || status >= 500 };
	}
}
