/**
 * "For You" (about:newtab?fyp): what to go back to and what to try, from this browser's or account's listening
 * and playing. Anonymous visitors are known by the player's listener id (localStorage "fracital:listener"), the
 * same one music_play_events uses; a signed-in account also counts its device's anonymous rows. Game plays are
 * recorded here too (POST /api/game-event, the games' counterpart of /api/play-event), which gives games a history
 * per listener and a site-wide "trending".
 */
import type { Hono } from "hono";
import type { Pool } from "pg";
import * as z from "zod";
import type { Env } from "./accounts.ts";
import { artistTopTracks, findDeezerArtist, type RadioTrack, relatedArtists } from "./music-radio";

/** Where the music API lives on every host (the picks' stream URLs point there). */
const MUSIC_API = "/api/music";
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 5000;
const LISTENER = /^[\w-]{8,64}$/;

export async function migrateGameEvents(pool: Pool) {
	await pool.query(`create table if not exists game_play_events (
		id bigserial primary key,
		game_key text not null,
		title text not null,
		listener text not null,
		user_id text,
		at timestamptz not null default now()
	)`);
	await pool.query("create index if not exists game_play_events_game on game_play_events (game_key, at desc)");
	await pool.query("create index if not exists game_play_events_listener on game_play_events (listener, at desc)");
	await pool.query("create index if not exists game_play_events_user on game_play_events (user_id, at desc)");
}

/** The client's feedback key (src/libs/playlists.ts feedbackKey): first artist and title, without brackets or punctuation. */
export function songKey(title: string, artist: string): string {
	const first = artist.split(/,| & | feat\.? | ft\.? | x /i)[0] ?? artist;
	return `${first}|${title}`
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, "")
		.replace(/[^\p{L}\p{N}|]+/gu, "");
}

/** Without the songs the user asked not to be recommended. */
export function dropDisliked<T extends { title: string; artist: string }>(tracks: T[], disliked: Iterable<string>): T[] {
	const keys = new Set(disliked);
	return tracks.filter(t => !keys.has(songKey(t.title, t.artist)));
}

/** One row per song. */
export function dedupeTracks<T extends { title: string; artist: string }>(tracks: T[]): T[] {
	const seen = new Set<string>();
	return tracks.filter(t => {
		const k = `${t.title}|${t.artist}`.toLowerCase();
		return !seen.has(k) && seen.add(k);
	});
}

/** Changes once a day, so a shelf keeps its order through the day. */
export const daySeed = (now = Date.now()) => Math.floor(now / 86_400_000);

/** The same order for the same seed (mulberry32). */
export function shuffleSeeded<T>(list: T[], seed: number): T[] {
	let a = seed >>> 0;
	const rnd = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export interface ForYouResponse {
	signedIn: boolean;
	music: {
		jumpBackIn: { title: string; artist: string; plays: number; last: string }[];
		topArtists: { name: string; plays: number; picture: string }[];
		artists: { name: string; picture: string; because: string }[];
		picks: RadioTrack[];
		/** Nothing is known about this listener yet: the client shows the charts instead. */
		coldStart: boolean;
	};
	games: {
		recent: { key: string; title: string; plays: number; last: string }[];
		trending: { key: string; title: string; players: number }[];
	};
}

const empty = (signedIn: boolean): ForYouResponse => ({ signedIn, music: { jumpBackIn: [], topArtists: [], artists: [], picks: [], coldStart: true }, games: { recent: [], trending: [] } });

type SessionAuth = { api: { getSession: (o: { headers: Headers }) => Promise<{ user: { id: string } } | null> } };
type Deps = { init: () => Promise<{ pool: Pool; auth: SessionAuth } | null> };

const cache = new Map<string, { at: number; data: ForYouResponse }>();

async function build(pool: Pool, userId: string | null, listener: string | null): Promise<ForYouResponse> {
	// Whose history: the account's rows plus this device's anonymous ones, or just the device's.
	const who = userId ? { sql: "(user_id = $1 or listener = $2)", params: [userId, listener ?? ""] } : { sql: "listener = $1", params: [listener] };
	const q = <T extends Record<string, unknown>>(sql: string, params: unknown[] = who.params) => pool.query<T>(sql, params).then(r => r.rows);
	const [jump, top, recentRows, trending, disliked, saved] = await Promise.all([
		q<{ title: string; artist: string; plays: number; last: Date }>(`select min(title) title, min(artist) artist, count(*)::int plays, max(at) last from music_play_events where ${who.sql} and at > now() - interval '7 days' group by artist_key, lower(title) order by last desc limit 8`),
		q<{ name: string; plays: number }>(`select min(artist) name, count(*)::int plays from music_play_events where ${who.sql} and at > now() - interval '30 days' group by artist_key order by plays desc limit 6`),
		q<{ key: string; title: string; plays: number; last: Date }>(`select game_key key, min(title) title, count(*)::int plays, max(at) last from game_play_events where ${who.sql} and at > now() - interval '30 days' group by game_key order by last desc limit 8`),
		q<{ key: string; title: string; players: number }>("select game_key key, min(title) title, count(distinct listener)::int players from game_play_events where at > now() - interval '7 days' group by game_key order by players desc limit 12", []),
		userId ? q<{ song_key: string }>("select song_key from fracital_track_feedback where user_id = $1 and score < 0", [userId]) : Promise.resolve([]),
		userId ? q<{ name: string }>("select name from fracital_saved_artists where user_id = $1 order by created_at desc limit 2", [userId]) : Promise.resolve([]),
	]);
	// No game events yet for the account: its cloud saves say what it played.
	const recent = recentRows.length || !userId ? recentRows : await q<{ key: string; title: string; plays: number; last: Date }>("select game_key key, title, 1 plays, updated_at last from fracital_game_saves where user_id = $1 order by updated_at desc limit 8", [userId]);

	const pictures = await Promise.all(top.map(a => findDeezerArtist(a.name).catch(() => null)));
	const topArtists = top.map((a, i) => ({ name: a.name, plays: a.plays, picture: pictures[i]?.picture_medium || pictures[i]?.picture_big || "" }));

	const seeds = [...top.slice(0, 4).map(a => a.name), ...saved.map(a => a.name).filter(n => !top.some(a => a.name.toLowerCase() === n.toLowerCase()))].slice(0, 6);
	const music: ForYouResponse["music"] = { jumpBackIn: jump.map(r => ({ title: r.title, artist: r.artist, plays: r.plays, last: r.last.toISOString() })), topArtists, artists: [], picks: [], coldStart: seeds.length === 0 };
	if (seeds.length) {
		const related = await Promise.all(seeds.map(s => relatedArtists(s, 6).catch(() => [])));
		const known = new Set(seeds.map(s => s.toLowerCase()));
		for (const [i, list] of related.entries()) {
			for (const a of list) {
				const key = a.name.toLowerCase();
				if (known.has(key)) continue;
				known.add(key);
				music.artists.push({ name: a.name, picture: a.picture, because: seeds[i] });
			}
		}
		music.artists = music.artists.slice(0, 6);
		const tops = await Promise.all(music.artists.slice(0, 4).map(a => artistTopTracks(a.name, MUSIC_API, 5).catch(() => [])));
		music.picks = shuffleSeeded(
			dropDisliked(
				dedupeTracks(tops.flat()),
				disliked.map(d => d.song_key),
			),
			daySeed(),
		).slice(0, 20);
	}
	return {
		signedIn: !!userId,
		music,
		games: { recent: recent.map(r => ({ key: r.key, title: r.title, plays: r.plays, last: r.last.toISOString() })), trending },
	};
}

export function registerForYouRoutes(app: Hono<Env>, { init }: Deps) {
	// A game opened for a while (signed in or anonymous), like /api/play-event for songs.
	app.post("/api/game-event", async c => {
		const ctx = await init();
		if (!ctx) return c.json({ ok: false });
		const body = z.object({ game: z.string().trim().min(1).max(120), title: z.string().trim().min(1).max(300), listener: z.string().regex(LISTENER) }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
		const { game, title, listener } = body.data;
		const key = game.toLowerCase();
		// One play per listener per game per 10 minutes.
		const dup = await ctx.pool.query("select 1 from game_play_events where listener = $1 and game_key = $2 and at > now() - interval '10 minutes' limit 1", [listener, key]);
		if (!dup.rows.length) await ctx.pool.query("insert into game_play_events (game_key, title, listener, user_id) values ($1, $2, $3, $4)", [key, title, listener, session?.user.id ?? null]);
		return c.json({ ok: true });
	});

	// GET /api/for-you?listener=<id>: the listener's (and, signed in, the account's) picks. Cached 10 minutes.
	app.get("/api/for-you", async c => {
		const ctx = await init();
		if (!ctx) return c.json(empty(false));
		const raw = c.req.query("listener") ?? "";
		const listener = LISTENER.test(raw) ? raw : null;
		const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
		const userId = session?.user.id ?? null;
		if (!userId && !listener) return c.json(empty(false));
		const key = userId ? `u:${userId}|${listener ?? ""}` : `a:${listener}`;
		const hit = cache.get(key);
		if (hit && Date.now() - hit.at < CACHE_TTL_MS) return c.json(hit.data);
		const data = await build(ctx.pool, userId, listener).catch(err => {
			console.error("for-you failed:", err);
			return empty(!!userId);
		});
		if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
		cache.set(key, { at: Date.now(), data });
		return c.json(data);
	});
}
