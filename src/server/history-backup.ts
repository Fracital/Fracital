/**
 * Browsing-history backup (opt-in): an account's copy of the history its devices keep (src/libs/browsingHistory.ts),
 * merged with whatever each signed-in device sends so they all converge (src/libs/history-limits.ts). Off by default;
 * turning it off deletes the copy. Only the owner's own routes under /api/me read it: the Privacy Policy promises it
 * is never sold, read, or used for anything but showing them their own history, so keep it out of every other query.
 */
import type { Hono } from "hono";
import type { Pool } from "pg";
import * as z from "zod";
import { emptyTombstones, HISTORY_CAP, type HistoryTombstones, type HistoryVisit, historyCap, mergeHistory, TOMBSTONE_LIMITS } from "../libs/history-limits.ts";
import type { Env } from "./accounts.ts";
import { userMeta } from "./artists.ts";

/** A full backup from a device, as JSON. 20,000 visits run to a few MB. */
const MAX_BODY_BYTES = 8_000_000;

export async function migrateHistoryBackup(pool: Pool) {
	await pool.query(`create table if not exists fracital_history_backup (
		user_id text primary key references "user"(id) on delete cascade,
		enabled boolean not null default false,
		visits jsonb not null default '[]',
		tombstones jsonb not null default '{"ids":[],"ranges":[],"clearedBefore":0}',
		updated_at timestamptz not null default now()
	)`);
}

const visitInput = z.object({
	id: z.string().min(1).max(40),
	url: z
		.string()
		.max(2048)
		.regex(/^https?:\/\//i),
	title: z.string().max(300),
	icon: z.string().max(1024).optional(),
	at: z.number().finite(),
});
const tombstonesInput = z.object({
	ids: z.array(z.string().max(40)).max(TOMBSTONE_LIMITS.ids),
	ranges: z.array(z.object({ from: z.number().finite(), to: z.number().finite() })).max(TOMBSTONE_LIMITS.ranges),
	clearedBefore: z.number().finite(),
});
const backupInput = z.object({ visits: z.array(visitInput).max(HISTORY_CAP.premium * 2), tombstones: tombstonesInput });

type Row = { enabled: boolean; visits: HistoryVisit[]; tombstones: HistoryTombstones; updated_at: Date | null };
const EMPTY: Row = { enabled: false, visits: [], tombstones: emptyTombstones(), updated_at: null };

const read = async (pool: Pool, userId: string): Promise<Row> => {
	const { rows } = await pool.query<Row>("select enabled, visits, tombstones, updated_at from fracital_history_backup where user_id = $1", [userId]);
	return rows[0] ?? EMPTY;
};

const metaJson = (row: Row, cap: number) => ({ enabled: row.enabled, cap, premiumCap: HISTORY_CAP.premium, count: row.visits.length, updatedAt: row.updated_at ? row.updated_at.toISOString() : null });

export function registerHistoryBackupRoutes(app: Hono<Env>) {
	const capFor = async (pool: Pool, user: { id: string; email: string }) => historyCap((await userMeta(pool, user)).premium);

	// The backup's state, and (unless ?meta=1) the backup itself.
	app.get("/api/me/history-backup", async c => {
		const pool = c.get("pool");
		const user = c.get("user");
		const [row, cap] = await Promise.all([read(pool, user.id), capFor(pool, user)]);
		return c.json(c.req.query("meta") ? metaJson(row, cap) : { ...metaJson(row, cap), visits: row.visits, tombstones: row.tombstones });
	});

	// The switch. Off deletes the copy; the device keeps its own history.
	app.put("/api/me/history-backup/enabled", async c => {
		const body = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const pool = c.get("pool");
		const user = c.get("user");
		const { enabled } = body.data;
		await pool.query(
			`insert into fracital_history_backup (user_id, enabled, visits, tombstones, updated_at) values ($1, $2, '[]', $3, now())
			 on conflict (user_id) do update set enabled = $2, updated_at = now(),
			 visits = case when $2 then fracital_history_backup.visits else '[]'::jsonb end,
			 tombstones = case when $2 then fracital_history_backup.tombstones else $3::jsonb end`,
			[user.id, enabled, JSON.stringify(emptyTombstones())],
		);
		const [row, cap] = await Promise.all([read(pool, user.id), capFor(pool, user)]);
		return c.json(metaJson(row, cap));
	});

	// A device's history, merged into the account's copy; the merged result goes back so the device adopts it.
	app.put("/api/me/history-backup", async c => {
		const text = await c.req.text();
		if (text.length > MAX_BODY_BYTES) return c.json({ error: "That history is too large to back up" }, 413);
		let json: unknown = null;
		try {
			json = JSON.parse(text);
		} catch {}
		const body = backupInput.safeParse(json);
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const pool = c.get("pool");
		const user = c.get("user");
		const [row, cap] = await Promise.all([read(pool, user.id), capFor(pool, user)]);
		if (!row.enabled) return c.json({ error: "History backup is off" }, 403);
		const merged = mergeHistory(row.visits, body.data.visits, row.tombstones, body.data.tombstones, cap);
		const { rows } = await pool.query<{ updated_at: Date }>("update fracital_history_backup set visits = $2, tombstones = $3, updated_at = now() where user_id = $1 returning updated_at", [user.id, JSON.stringify(merged.visits), JSON.stringify(merged.tombstones)]);
		return c.json({ ...metaJson({ ...row, visits: merged.visits, updated_at: rows[0]?.updated_at ?? null }, cap), visits: merged.visits, tombstones: merged.tombstones });
	});
}
