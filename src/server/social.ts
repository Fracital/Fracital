/**
 * The Social page (about:social): one chat room for signed-in accounts, and what members who chose to
 * share it are listening to. Routes live under /api/me/social, behind the signed-in check.
 */
import type { Hono } from "hono";
import type { Pool } from "pg";
import * as z from "zod";
import type { Env } from "./accounts";
import { userMeta } from "./artists";
import { liveStreakSql } from "./streaks";

const MESSAGE_MAX = 500;
const PAGE = 50;
/** A shared status this old (no heartbeat since) counts as stopped. */
const STATUS_FRESH_MINUTES = 3;
/** Per account: at least this long between messages, and at most RATE_PER_MINUTE a minute. */
const RATE_GAP_MS = 1500;
const RATE_PER_MINUTE = 15;

export async function migrateSocial(pool: Pool) {
	await pool.query(`create table if not exists fracital_social_messages (
		id bigserial primary key,
		user_id text not null references "user"(id) on delete cascade,
		body text not null,
		created_at timestamptz not null default now()
	)`);
	await pool.query("create index if not exists fracital_social_messages_created on fracital_social_messages (created_at desc)");
	await pool.query(`create table if not exists fracital_social_status (
		user_id text primary key references "user"(id) on delete cascade,
		share boolean not null default false,
		song jsonb,
		updated_at timestamptz not null default now()
	)`);
}

const song = z.object({
	title: z.string().min(1).max(200),
	artist: z.string().min(1).max(200),
	album: z.string().max(200).optional(),
	artwork: z
		.string()
		.max(400)
		.regex(/^https:\/\//)
		.optional(),
});

type MessageRow = { id: string; body: string; created_at: Date; user_id: string; name: string; image: string | null; username: string | null; streak: number };

const messageJson = (r: MessageRow) => ({ id: Number(r.id), body: r.body, at: r.created_at.toISOString(), user: { id: r.user_id, name: r.name, image: r.image, username: r.username, streak: r.streak } });

const MESSAGE_SELECT = `select m.id, m.body, m.created_at, m.user_id, u.name, u.image, um.username, ${liveStreakSql("st")} streak
	from fracital_social_messages m join "user" u on u.id = m.user_id left join fracital_user_meta um on um.user_id = m.user_id left join fracital_streaks st on st.user_id = m.user_id`;

export function registerSocialRoutes(app: Hono<Env>) {
	const sent = new Map<string, number[]>();

	// The newest page, or (with ?after=) what came after the last message the page has.
	app.get("/api/me/social/messages", async c => {
		const pool = c.get("pool");
		const after = Number(c.req.query("after"));
		const { rows } = Number.isSafeInteger(after) && after > 0 ? await pool.query<MessageRow>(`${MESSAGE_SELECT} where m.id > $1 order by m.id asc limit ${PAGE}`, [after]) : await pool.query<MessageRow>(`${MESSAGE_SELECT} order by m.id desc limit ${PAGE}`).then(r => ({ rows: r.rows.reverse() }));
		return c.json({ messages: rows.map(messageJson) });
	});

	app.post("/api/me/social/messages", async c => {
		const body = z.object({ body: z.string() }).safeParse(await c.req.json().catch(() => null));
		const text = body.success ? body.data.body.trim() : "";
		if (!text || text.length > MESSAGE_MAX) return c.json({ error: `Messages are 1 to ${MESSAGE_MAX} characters` }, 400);
		const user = c.get("user");
		const now = Date.now();
		const recent = (sent.get(user.id) ?? []).filter(t => now - t < 60_000);
		if (recent.length >= RATE_PER_MINUTE || (recent.length && now - recent[recent.length - 1] < RATE_GAP_MS)) return c.json({ error: "You're sending messages too fast" }, 429);
		sent.set(user.id, [...recent, now]);
		const pool = c.get("pool");
		const { rows } = await pool.query<{ id: string }>("insert into fracital_social_messages (user_id, body) values ($1, $2) returning id", [user.id, text]);
		const { rows: full } = await pool.query<MessageRow>(`${MESSAGE_SELECT} where m.id = $1`, [rows[0].id]);
		return c.json({ message: messageJson(full[0]) });
	});

	// Your own message, or any message for an admin.
	app.delete("/api/me/social/messages/:id", async c => {
		const id = Number(c.req.param("id"));
		if (!Number.isSafeInteger(id)) return c.json({ error: "Invalid request" }, 400);
		const user = c.get("user");
		const pool = c.get("pool");
		const { isAdmin } = await userMeta(pool, user);
		const { rowCount } = isAdmin ? await pool.query("delete from fracital_social_messages where id = $1", [id]) : await pool.query("delete from fracital_social_messages where id = $1 and user_id = $2", [id, user.id]);
		return rowCount ? c.json({ ok: true }) : c.json({ error: "Message not found" }, 404);
	});

	app.get("/api/me/social/listening", async c => {
		const { rows } = await c.get("pool").query<{ user_id: string; name: string; image: string | null; username: string | null; streak: number; song: z.infer<typeof song>; updated_at: Date }>(
			`select s.user_id, u.name, u.image, um.username, ${liveStreakSql("st")} streak, s.song, s.updated_at
			 from fracital_social_status s join "user" u on u.id = s.user_id left join fracital_user_meta um on um.user_id = s.user_id left join fracital_streaks st on st.user_id = s.user_id
			 where s.share and s.song is not null and s.updated_at > now() - interval '${STATUS_FRESH_MINUTES} minutes'
			 order by s.updated_at desc limit 50`,
		);
		return c.json({ listening: rows.map(r => ({ user: { id: r.user_id, name: r.name, image: r.image, username: r.username, streak: r.streak }, song: r.song, at: r.updated_at.toISOString() })) });
	});

	app.get("/api/me/social/share", async c => {
		const { rows } = await c.get("pool").query<{ share: boolean }>("select share from fracital_social_status where user_id = $1", [c.get("user").id]);
		return c.json({ share: !!rows[0]?.share });
	});

	app.put("/api/me/social/share", async c => {
		const body = z.object({ share: z.boolean() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		await c.get("pool").query("insert into fracital_social_status (user_id, share, song, updated_at) values ($1, $2, null, now()) on conflict (user_id) do update set share = $2, song = case when $2 then fracital_social_status.song else null end, updated_at = now()", [c.get("user").id, body.data.share]);
		return c.json({ share: body.data.share });
	});

	// What's playing now (null when it stopped); kept only for accounts that share it.
	app.post("/api/me/social/status", async c => {
		const body = z.object({ song: song.nullable() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		await c.get("pool").query("update fracital_social_status set song = $2, updated_at = now() where user_id = $1 and share", [c.get("user").id, body.data.song ? JSON.stringify(body.data.song) : null]);
		return c.json({ ok: true });
	});
}
