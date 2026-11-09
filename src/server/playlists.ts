/**
 * The signed-in user's playlists and song feedback: likes (the built-in "Liked Songs" playlist)
 * and dislikes (songs radio never plays again). Client side: src/libs/playlists.ts.
 *
 * Songs are stored as the client's track data (the same shape as saved songs), and feedback is
 * keyed by a normalized "artist|title" key the client computes, so the same song from different
 * sources counts once. Everything is deleted with the user.
 */
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { Pool } from "pg";
import * as z from "zod";
import type { Env } from "./accounts";

const MAX_PLAYLISTS = 200;
const MAX_PLAYLIST_TRACKS = 2000;
const MAX_FEEDBACK = 5000;

export async function migratePlaylists(pool: Pool) {
	await pool.query(`create table if not exists fracital_playlists (
		id text primary key,
		user_id text not null references "user"(id) on delete cascade,
		name text not null,
		created_at timestamptz not null default now(),
		updated_at timestamptz not null default now()
	)`);
	await pool.query("create index if not exists fracital_playlists_user on fracital_playlists (user_id)");
	await pool.query(`create table if not exists fracital_playlist_tracks (
		playlist_id text not null references fracital_playlists(id) on delete cascade,
		track_id text not null,
		position double precision not null,
		data jsonb not null,
		added_at timestamptz not null default now(),
		primary key (playlist_id, track_id)
	)`);
	await pool.query(`create table if not exists fracital_track_feedback (
		user_id text not null references "user"(id) on delete cascade,
		song_key text not null,
		score smallint not null,
		data jsonb not null,
		updated_at timestamptz not null default now(),
		primary key (user_id, song_key)
	)`);
}

const trackData = z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(500), artist: z.string().max(500) }).passthrough();
const name = z.string().trim().min(1).max(100);

/** Track JSON within the same size limit as saved songs. */
const sized = (data: unknown) => {
	const json = JSON.stringify(data);
	return json.length <= 8000 ? json : null;
};

/** Mounts the routes on the accounts app, under /api/me (which requires a signed-in user). */
export function registerPlaylistRoutes(app: Hono<Env>) {
	type Ctx = { get: <K extends keyof Env["Variables"]>(k: K) => Env["Variables"][K] };
	/** The playlist when it belongs to the signed-in user. */
	const owned = async (c: Ctx, id: string) => {
		const { rows } = await c.get("pool").query<{ id: string; name: string }>("select id, name from fracital_playlists where id = $1 and user_id = $2", [id, c.get("user").id]);
		return rows[0] ?? null;
	};

	app.get("/api/me/playlists", async c => {
		const { rows } = await c.get("pool").query<{ id: string; name: string; count: string; artwork: string[] | null }>(
			`select p.id, p.name, count(t.track_id) as count,
				(array_agg(t.data->>'artwork' order by t.position) filter (where coalesce(t.data->>'artwork', '') <> ''))[1:4] as artwork
			 from fracital_playlists p left join fracital_playlist_tracks t on t.playlist_id = p.id
			 where p.user_id = $1 group by p.id order by p.updated_at desc`,
			[c.get("user").id],
		);
		return c.json({ playlists: rows.map(r => ({ id: r.id, name: r.name, count: Number(r.count), artwork: r.artwork ?? [] })) });
	});

	app.post("/api/me/playlists", async c => {
		const body = z.object({ name }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Give the playlist a name" }, 400);
		const pool = c.get("pool");
		const { rows } = await pool.query<{ n: string }>("select count(*) as n from fracital_playlists where user_id = $1", [c.get("user").id]);
		if (Number(rows[0]?.n) >= MAX_PLAYLISTS) return c.json({ error: "You've reached the playlist limit" }, 409);
		const id = randomUUID();
		await pool.query("insert into fracital_playlists (id, user_id, name) values ($1, $2, $3)", [id, c.get("user").id, body.data.name]);
		return c.json({ playlist: { id, name: body.data.name, count: 0, artwork: [] } });
	});

	app.get("/api/me/playlists/:id", async c => {
		const playlist = await owned(c, c.req.param("id"));
		if (!playlist) return c.json({ error: "Playlist not found" }, 404);
		const { rows } = await c.get("pool").query<{ data: unknown }>("select data from fracital_playlist_tracks where playlist_id = $1 order by position", [playlist.id]);
		return c.json({ id: playlist.id, name: playlist.name, tracks: rows.map(r => r.data) });
	});

	app.patch("/api/me/playlists/:id", async c => {
		const body = z.object({ name }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Give the playlist a name" }, 400);
		const res = await c.get("pool").query("update fracital_playlists set name = $3, updated_at = now() where id = $1 and user_id = $2", [c.req.param("id"), c.get("user").id, body.data.name]);
		return res.rowCount ? c.json({ ok: true }) : c.json({ error: "Playlist not found" }, 404);
	});

	app.delete("/api/me/playlists/:id", async c => {
		await c.get("pool").query("delete from fracital_playlists where id = $1 and user_id = $2", [c.req.param("id"), c.get("user").id]);
		return c.json({ ok: true });
	});

	// Adds a song at the end (a song already in the playlist stays where it is).
	app.put("/api/me/playlists/:id/tracks", async c => {
		const body = z.object({ data: trackData }).safeParse(await c.req.json().catch(() => null));
		const json = body.success ? sized(body.data.data) : null;
		if (!body.success || !json) return c.json({ error: "Invalid request" }, 400);
		const playlist = await owned(c, c.req.param("id"));
		if (!playlist) return c.json({ error: "Playlist not found" }, 404);
		const pool = c.get("pool");
		const { rows } = await pool.query<{ n: string; last: number | null }>("select count(*) as n, max(position) as last from fracital_playlist_tracks where playlist_id = $1", [playlist.id]);
		if (Number(rows[0]?.n) >= MAX_PLAYLIST_TRACKS) return c.json({ error: "This playlist is full" }, 409);
		const res = await pool.query("insert into fracital_playlist_tracks (playlist_id, track_id, position, data) values ($1, $2, $3, $4) on conflict do nothing", [playlist.id, body.data.data.id, (rows[0]?.last ?? 0) + 1, json]);
		await pool.query("update fracital_playlists set updated_at = now() where id = $1", [playlist.id]);
		return c.json({ ok: true, added: !!res.rowCount });
	});

	app.delete("/api/me/playlists/:id/tracks/:trackId", async c => {
		const playlist = await owned(c, c.req.param("id"));
		if (!playlist) return c.json({ error: "Playlist not found" }, 404);
		await c.get("pool").query("delete from fracital_playlist_tracks where playlist_id = $1 and track_id = $2", [playlist.id, c.req.param("trackId")]);
		await c.get("pool").query("update fracital_playlists set updated_at = now() where id = $1", [playlist.id]);
		return c.json({ ok: true });
	});

	app.get("/api/me/feedback", async c => {
		const { rows } = await c.get("pool").query<{ song_key: string; score: number; data: unknown }>("select song_key, score, data from fracital_track_feedback where user_id = $1 order by updated_at desc", [c.get("user").id]);
		return c.json({
			liked: rows.filter(r => r.score > 0).map(r => r.data),
			disliked: rows.filter(r => r.score < 0).map(r => r.song_key),
		});
	});

	// score 1 likes, -1 dislikes, 0 clears.
	app.put("/api/me/feedback", async c => {
		const body = z.object({ key: z.string().min(1).max(400), score: z.union([z.literal(1), z.literal(-1), z.literal(0)]), data: trackData }).safeParse(await c.req.json().catch(() => null));
		const json = body.success ? sized(body.data.data) : null;
		if (!body.success || !json) return c.json({ error: "Invalid request" }, 400);
		const pool = c.get("pool");
		const userId = c.get("user").id;
		if (body.data.score === 0) {
			await pool.query("delete from fracital_track_feedback where user_id = $1 and song_key = $2", [userId, body.data.key]);
			return c.json({ ok: true });
		}
		const { rows } = await pool.query<{ n: string }>("select count(*) as n from fracital_track_feedback where user_id = $1", [userId]);
		if (Number(rows[0]?.n) >= MAX_FEEDBACK) return c.json({ error: "You've reached the limit for liked and disliked songs" }, 409);
		await pool.query("insert into fracital_track_feedback (user_id, song_key, score, data, updated_at) values ($1, $2, $3, $4, now()) on conflict (user_id, song_key) do update set score = excluded.score, data = excluded.data, updated_at = now()", [userId, body.data.key, body.data.score, json]);
		return c.json({ ok: true });
	});
}
