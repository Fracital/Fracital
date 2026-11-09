/**
 * Deleted accounts' data, downloadable by the owner for 30 days. Stored gzipped under the hash
 * of a random link token; the link is the only key, since the account no longer exists.
 */
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Hono } from "hono";
import type { Pool } from "pg";

export const EXPORT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPORT_PATH = "/api/export";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function migrateExports(pool: Pool) {
	await pool.query(`create table if not exists fracital_deleted_exports (
		id text primary key,
		name text not null,
		data bytea not null,
		created_at timestamptz not null default now(),
		expires_at timestamptz not null
	)`);
	await purgeExpiredExports(pool);
}

export async function purgeExpiredExports(pool: Pool) {
	await pool.query("delete from fracital_deleted_exports where expires_at < now()").catch(err => console.error("Purging expired data exports failed:", err instanceof Error ? err.message : err));
}

/** Rows of a table for the user as JSON, without `drop` columns (secrets, the user id); [] when the table doesn't exist. */
async function rows(pool: Pool, sql: string, userId: string): Promise<unknown[]> {
	try {
		const { rows } = await pool.query<{ data: unknown[] | null }>(sql, [userId]);
		return rows[0]?.data ?? [];
	} catch {
		return [];
	}
}
const table = (name: string, drop: string[] = [], order = "") => `select coalesce(jsonb_agg((to_jsonb(t) - 'user_id'${drop.map(c => ` - '${c}'`).join("")})${order ? ` order by ${order}` : ""}), '[]'::jsonb) as data from ${name} t where t.user_id = $1`;

/** Everything stored about a user, as one document (no tokens, password hashes or keys). */
export async function buildExport(pool: Pool, userId: string): Promise<Record<string, unknown>> {
	const one = async (sql: string) => (await rows(pool, `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as data from (${sql}) t`, userId))[0] ?? null;
	const many = (sql: string) => rows(pool, `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as data from (${sql}) t`, userId);
	const [account, meta, signIn, passkeys, sessions] = await Promise.all([
		one(`select id, name, email, image, "emailVerified" as email_verified, "createdAt" as created_at from "user" where id = $1`),
		one("select role, username, premium, banned_at, ban_reason from fracital_user_meta where user_id = $1"),
		many(`select "providerId" as provider, "accountId" as account, scope, "createdAt" as connected_at from account where "userId" = $1`),
		many(`select name, "deviceType" as device_type, "createdAt" as created_at from passkey where "userId" = $1`),
		many(`select "createdAt" as signed_in_at, "expiresAt" as expires_at, "ipAddress" as ip_address, "userAgent" as user_agent from session where "userId" = $1`),
	]);
	const [settings, savedItems, savedArtists, gameSaves, playlists, feedback, listenbrainz, discord, plays, artistPages, artistClaims] = await Promise.all([
		rows(pool, table("fracital_settings"), userId),
		rows(pool, table("fracital_saved_items", [], "t.created_at"), userId),
		rows(pool, table("fracital_saved_artists", [], "t.created_at"), userId),
		rows(pool, table("fracital_game_saves"), userId),
		many(`select p.name, p.created_at, coalesce((select jsonb_agg(pt.data order by pt.position) from fracital_playlist_tracks pt where pt.playlist_id = p.id), '[]'::jsonb) as songs from fracital_playlists p where p.user_id = $1 order by p.created_at`),
		rows(pool, table("fracital_track_feedback", [], "t.updated_at"), userId),
		rows(pool, table("fracital_listenbrainz", ["token"]), userId),
		rows(pool, table("fracital_discord_presence", ["session_token"]), userId),
		many("select artist, title, at from music_play_events where user_id = $1 order by at"),
		rows(pool, table("artist_members"), userId),
		rows(pool, table("artist_claims"), userId),
	]);
	return {
		about: `Everything Fracital stored about your account, as of its deletion. Kept for ${EXPORT_DAYS} days after deletion, then erased.`,
		exported_at: new Date().toISOString(),
		account,
		profile: meta,
		sign_in_methods: signIn,
		passkeys,
		sessions,
		settings,
		saved: savedItems,
		followed_artists: savedArtists,
		game_saves: gameSaves,
		playlists,
		likes_and_dislikes: feedback,
		listenbrainz,
		discord: discord,
		plays,
		artist_pages: artistPages,
		artist_claims: artistClaims,
	};
}

/** Stores a deleted account's export for 30 days; returns the download path (with its secret token). */
export async function saveExport(pool: Pool, name: string, data: Record<string, unknown>): Promise<{ path: string; expires: Date }> {
	const token = randomBytes(32).toString("base64url");
	const expires = new Date(Date.now() + EXPORT_DAYS * DAY_MS);
	await pool.query("insert into fracital_deleted_exports (id, name, data, expires_at) values ($1, $2, $3, $4)", [sha256(token), name, gzipSync(JSON.stringify(data, null, 2)), expires]);
	return { path: `${EXPORT_PATH}/${token}`, expires };
}

const page = (title: string, text: string) =>
	`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${title}</title><body style="background:#1a1a1d;color:#eee;font:16px/1.6 system-ui;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box"><div style="max-width:440px"><h1 style="font-size:22px">${title}</h1><p>${text}</p></div></body>`;

/** The download route. `pool` resolves the database (null when accounts are off). */
export function registerExportRoutes<E extends object>(app: Hono<{ Variables: E }>, pool: () => Promise<Pool | null>) {
	app.get(`${EXPORT_PATH}/:token`, async c => {
		c.header("Cache-Control", "no-store");
		c.header("Referrer-Policy", "no-referrer");
		c.header("X-Robots-Tag", "noindex");
		const db = await pool();
		if (!db) return c.html(page("Not available", "Downloads aren't available right now. Try again later."), 503);
		const { rows } = await db.query<{ data: Buffer; expires_at: Date }>("select data, expires_at from fracital_deleted_exports where id = $1", [sha256(c.req.param("token"))]);
		const row = rows[0];
		if (!row || row.expires_at.getTime() < Date.now()) return c.html(page("This link has expired", `Data from deleted accounts is kept for ${EXPORT_DAYS} days, then erased for good. If you think this is a mistake, email contact@fracit.al.`), 404);
		c.header("Content-Type", "application/octet-stream");
		c.header("Content-Disposition", `attachment; filename="fracital-account-data-${new Date().toISOString().slice(0, 10)}.json"`);
		return c.body(new Uint8Array(gunzipSync(row.data)));
	});
}
