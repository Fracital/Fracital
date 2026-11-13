/**
 * Comments on songs and albums (shown in the quick player and Now Playing). Anyone can read them; posting, editing,
 * deleting, liking, reporting and following people need an account. Authors edit and delete their own; admins delete
 * any and review reports in about:admin. Lists sort (newest, oldest, top, relevant, friends) and filter (mine, from
 * the artist, with song times, by one person).
 */
import type { Hono, MiddlewareHandler } from "hono";
import type { Pool } from "pg";
import * as z from "zod";
import type { Env } from "./accounts";
import { userMeta } from "./artists";

const COMMENT_MAX = 500;
const PAGE = 30;
/** Per account: at least this long between comments, and at most RATE_PER_MINUTE a minute. */
const RATE_GAP_MS = 5000;
const RATE_PER_MINUTE = 6;

export async function migrateComments(pool: Pool) {
	await pool.query(`create table if not exists fracital_comments (
		id bigserial primary key,
		kind text not null check (kind in ('song', 'album')),
		target text not null,
		user_id text not null references "user"(id) on delete cascade,
		body text not null,
		created_at timestamptz not null default now(),
		edited_at timestamptz
	)`);
	await pool.query("create index if not exists fracital_comments_target on fracital_comments (kind, target, created_at desc)");
	// The song's (or album's) name and artist as written, for listing someone's comments on their profile (the target
	// is only the matching key). Older comments have none: profiles fall back to the key.
	await pool.query("alter table fracital_comments add column if not exists title text, add column if not exists artist text");
	await pool.query("create index if not exists fracital_comments_user on fracital_comments (user_id, created_at desc)");
	await pool.query(`create table if not exists fracital_comment_reports (
		comment_id bigint not null references fracital_comments(id) on delete cascade,
		user_id text not null references "user"(id) on delete cascade,
		reason text,
		created_at timestamptz not null default now(),
		primary key (comment_id, user_id)
	)`);
	await pool.query(`create table if not exists fracital_comment_likes (
		comment_id bigint not null references fracital_comments(id) on delete cascade,
		user_id text not null references "user"(id) on delete cascade,
		created_at timestamptz not null default now(),
		primary key (comment_id, user_id)
	)`);
	// People following people (a "Friends" sort puts comments from the people you follow first).
	await pool.query(`create table if not exists fracital_user_follows (
		follower_id text not null references "user"(id) on delete cascade,
		followee_id text not null references "user"(id) on delete cascade,
		created_at timestamptz not null default now(),
		primary key (follower_id, followee_id),
		check (follower_id <> followee_id)
	)`);
}

/**
 * What a comment is on: a song (title by its main artist) or an album (name by its main artist), normalized the way
 * the app keys liked songs (lowercase, no bracketed extras or punctuation), so "Song (Remastered)" shares comments.
 */
/** The main artist of a credit ("A, B", "A & B", "A feat. B", "A x B" → "A"). */
export const firstArtist = (artist: string) => (artist.split(/,| & | feat\.? | ft\.? | x /i)[0] ?? artist).trim();

export const targetKey = (name: string, artist: string) => {
	const first = firstArtist(artist);
	return `${first}|${name}`
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, "")
		.replace(/[^\p{L}\p{N}|]+/gu, "");
};

const targetQuery = z.object({
	kind: z.enum(["song", "album"]),
	name: z.string().trim().min(1).max(300),
	artist: z.string().trim().min(1).max(300),
});

const commentBody = z.string().trim().min(1).max(COMMENT_MAX);

export type CommentRow = { id: string; body: string; created_at: Date; edited_at: Date | null; user_id: string; name: string; image: string | null; username: string | null; likes?: string; liked?: boolean; by_artist?: boolean; followed?: boolean };

/** A name normalized like targetKey's artist part, in SQL (to match verified artist pages to comment targets). */
export const sqlNormalize = (expr: string) => `regexp_replace(regexp_replace(lower(${expr}), '\\(.*?\\)|\\[.*?\\]', '', 'g'), '[^[:alnum:]]', '', 'g')`;

/**
 * A comment with its author and counts. $1 is the viewer's id (or null): whether they liked it and follow its author.
 * by_artist: the author is a member of the verified artist page named like the artist the comment is on.
 */
export const COMMENT_SELECT = `select c.id, c.body, c.created_at, c.edited_at, c.user_id, u.name, u.image, um.username,
		(select count(*) from fracital_comment_likes l where l.comment_id = c.id) likes,
		exists (select 1 from fracital_comment_likes l where l.comment_id = c.id and l.user_id = $1) liked,
		exists (select 1 from fracital_user_follows f where f.follower_id = $1 and f.followee_id = c.user_id) followed,
		exists (select 1 from artist_members m join artist_profiles p on p.artist_id = m.artist_id
			where m.user_id = c.user_id and p.verified and ${sqlNormalize("p.name")} = split_part(c.target, '|', 1)) by_artist
	from fracital_comments c join "user" u on u.id = c.user_id left join fracital_user_meta um on um.user_id = c.user_id`;

export const commentJson = (r: CommentRow, viewer: { id: string | null; isAdmin: boolean }) => ({
	id: Number(r.id),
	body: r.body,
	at: r.created_at.toISOString(),
	editedAt: r.edited_at?.toISOString() ?? null,
	user: { id: r.user_id, name: r.name, image: r.image, username: r.username },
	mine: viewer.id === r.user_id,
	canDelete: viewer.id === r.user_id || viewer.isAdmin,
	likes: Number(r.likes ?? 0),
	liked: !!r.liked,
	byArtist: !!r.by_artist,
	followed: !!r.followed,
});

/** The list's order: sorts are allowlisted (never SQL from the request). */
const SORTS = {
	newest: "id desc",
	oldest: "id asc",
	top: "likes desc, id desc",
	// The artist's comments, then well-liked recent ones: likes over age (a gentler "hot" score), newest breaking ties.
	relevant: "by_artist desc, (likes::float + 1) / power(extract(epoch from now() - created_at) / 3600 + 2, 1.2) desc, id desc",
	// The people you follow first, then everyone newest first.
	friends: "followed desc, id desc",
} as const;

/** A song time in a comment ("1:23", "12:05"), like the ones the player makes tappable. */
const HAS_TIME = "'(^|[^0-9])[0-9]{1,2}:[0-5][0-9]([^0-9]|$)'";

const listQuery = z.object({
	sort: z.enum(["newest", "oldest", "top", "relevant", "friends"]).default("newest"),
	filter: z.enum(["mine", "artist", "timestamps"]).optional(),
	by: z.string().max(100).optional(),
	offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** Just what reading needs from the accounts setup: the database, and who's signed in. */
type SessionAuth = { api: { getSession: (o: { headers: Headers }) => Promise<{ user: Env["Variables"]["user"] } | null> } };
type Deps = { init: () => Promise<{ pool: Pool; auth: SessionAuth } | null> };

export function registerCommentRoutes(app: Hono<Env>, { init }: Deps) {
	const posted = new Map<string, number[]>();

	/** Who's reading, when signed in; reading needs no account. */
	const viewerOf = async (c: Parameters<MiddlewareHandler<Env>>[0], pool: Pool, auth: SessionAuth) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
		if (!session) return { id: null, isAdmin: false };
		return { id: session.user.id, isAdmin: (await userMeta(pool, session.user)).isAdmin };
	};

	// A song's or album's comments, sorted and filtered (?sort, ?filter, ?by=<userId>), a page at a time (?offset).
	app.get("/api/comments", async c => {
		const ctx = await init();
		if (!ctx) return c.json({ error: "Fracital Accounts aren't configured on this server" }, 503);
		const target = targetQuery.safeParse({ kind: c.req.query("kind"), name: c.req.query("name"), artist: c.req.query("artist") });
		const options = listQuery.safeParse({ sort: c.req.query("sort") || undefined, filter: c.req.query("filter") || undefined, by: c.req.query("by") || undefined, offset: c.req.query("offset") || undefined });
		if (!target.success || !options.success) return c.json({ error: "Bad request" }, 400);
		const viewer = await viewerOf(c, ctx.pool, ctx.auth);
		const { sort, filter, by, offset } = options.data;
		// Comments from before names were kept get this song's (or album's) name as written, for profiles to show.
		void ctx.pool.query("update fracital_comments set title = $3, artist = $4 where kind = $1 and target = $2 and title is null", [target.data.kind, targetKey(target.data.name, target.data.artist), target.data.name, firstArtist(target.data.artist)]).catch(() => undefined);
		const params: unknown[] = [viewer.id, target.data.kind, targetKey(target.data.name, target.data.artist)];
		/** Adds a value to the query's parameters; returns its placeholder ("$4"). */
		const param = (value: unknown) => `$${params.push(value)}`;
		const where = ["c.kind = $2", "c.target = $3"];
		if (filter === "mine") where.push(viewer.id ? "c.user_id = $1" : "false");
		if (filter === "timestamps") where.push(`c.body ~ ${HAS_TIME}`);
		if (by) where.push(`c.user_id = ${param(by)}`);
		const base = `${COMMENT_SELECT} where ${where.join(" and ")}`;
		const matching = filter === "artist" ? `select * from (${base}) x where by_artist` : `select * from (${base}) x`;
		const { rows } = await ctx.pool.query<CommentRow>(`${matching} order by ${SORTS[sort]} limit ${param(PAGE + 1)} offset ${param(offset)}`, params);
		const { rows: count } = await ctx.pool.query<{ n: string }>("select count(*) n from fracital_comments where kind = $1 and target = $2", params.slice(1, 3));
		return c.json({ comments: rows.slice(0, PAGE).map(r => commentJson(r, viewer)), more: rows.length > PAGE, total: Number(count[0].n), viewer: { signedIn: !!viewer.id, isAdmin: viewer.isAdmin } });
	});

	// Likes: one per account per comment.
	app.post("/api/me/comments/:id/like", async c => {
		await c.get("pool").query("insert into fracital_comment_likes (comment_id, user_id) select id, $2 from fracital_comments where id = $1 on conflict do nothing", [c.req.param("id"), c.get("user").id]);
		return c.json({ ok: true });
	});
	app.delete("/api/me/comments/:id/like", async c => {
		await c.get("pool").query("delete from fracital_comment_likes where comment_id = $1 and user_id = $2", [c.req.param("id"), c.get("user").id]);
		return c.json({ ok: true });
	});

	// Following people (whose comments the "Friends" sort puts first).
	app.post("/api/me/follows/:userId", async c => {
		const me = c.get("user").id;
		const them = c.req.param("userId");
		if (them === me) return c.json({ error: "You can't follow yourself" }, 400);
		await c.get("pool").query('insert into fracital_user_follows (follower_id, followee_id) select $1, id from "user" where id = $2 on conflict do nothing', [me, them]);
		return c.json({ ok: true });
	});
	app.delete("/api/me/follows/:userId", async c => {
		await c.get("pool").query("delete from fracital_user_follows where follower_id = $1 and followee_id = $2", [c.get("user").id, c.req.param("userId")]);
		return c.json({ ok: true });
	});

	app.post("/api/me/comments", async c => {
		const body = targetQuery.extend({ body: commentBody }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: `Comments are 1–${COMMENT_MAX} characters` }, 400);
		const user = c.get("user");
		const now = Date.now();
		const recent = (posted.get(user.id) ?? []).filter(t => now - t < 60_000);
		if (recent.length >= RATE_PER_MINUTE || (recent.length && now - recent[recent.length - 1] < RATE_GAP_MS)) return c.json({ error: "You're commenting too fast. Try again in a moment." }, 429);
		posted.set(user.id, [...recent, now]);
		const pool = c.get("pool");
		const { rows } = await pool.query<{ id: string }>("insert into fracital_comments (kind, target, user_id, body, title, artist) values ($1, $2, $3, $4, $5, $6) returning id", [body.data.kind, targetKey(body.data.name, body.data.artist), user.id, body.data.body, body.data.name, body.data.artist]);
		const { rows: made } = await pool.query<CommentRow>(`${COMMENT_SELECT} where c.id = $2`, [user.id, rows[0].id]);
		return c.json({ comment: commentJson(made[0], { id: user.id, isAdmin: false }) });
	});

	// Authors edit their own comments (marked edited).
	app.patch("/api/me/comments/:id", async c => {
		const body = z.object({ body: commentBody }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: `Comments are 1–${COMMENT_MAX} characters` }, 400);
		const pool = c.get("pool");
		const user = c.get("user");
		const { rows } = await pool.query<{ id: string }>("update fracital_comments set body = $3, edited_at = now() where id = $1 and user_id = $2 returning id", [c.req.param("id"), user.id, body.data.body]);
		if (!rows.length) return c.json({ error: "You can only edit your own comments" }, 403);
		const { rows: edited } = await pool.query<CommentRow>(`${COMMENT_SELECT} where c.id = $2`, [user.id, rows[0].id]);
		return c.json({ comment: commentJson(edited[0], { id: user.id, isAdmin: false }) });
	});

	// Authors delete their own; admins delete any.
	app.delete("/api/me/comments/:id", async c => {
		const pool = c.get("pool");
		const user = c.get("user");
		const { isAdmin } = await userMeta(pool, user);
		const { rowCount } = await pool.query(isAdmin ? "delete from fracital_comments where id = $1" : "delete from fracital_comments where id = $1 and user_id = $2", isAdmin ? [c.req.param("id")] : [c.req.param("id"), user.id]);
		if (!rowCount) return c.json({ error: "You can only delete your own comments" }, 403);
		return c.json({ ok: true });
	});

	app.post("/api/me/comments/:id/report", async c => {
		const body = z.object({ reason: z.string().trim().max(200).optional() }).safeParse(await c.req.json().catch(() => ({})));
		const pool = c.get("pool");
		const { rowCount } = await pool.query("insert into fracital_comment_reports (comment_id, user_id, reason) select id, $2, $3 from fracital_comments where id = $1 on conflict do nothing", [c.req.param("id"), c.get("user").id, body.success ? (body.data.reason ?? null) : null]);
		return c.json({ ok: true, reported: !!rowCount });
	});

	// Admins (the /api/admin/* guard): reported comments, most reported first; dismissing clears a comment's reports.
	app.get("/api/admin/comment-reports", async c => {
		const { rows } = await c.get("pool").query<CommentRow & { kind: string; target: string; reports: string; reasons: (string | null)[]; last_report: Date }>(
			`select c.id, c.body, c.created_at, c.edited_at, c.user_id, u.name, u.image, um.username, c.kind, c.target, count(r.*) reports, array_agg(r.reason) reasons, max(r.created_at) last_report
			 from fracital_comment_reports r join fracital_comments c on c.id = r.comment_id join "user" u on u.id = c.user_id left join fracital_user_meta um on um.user_id = c.user_id
			 group by c.id, u.name, u.image, um.username order by count(r.*) desc, max(r.created_at) desc limit 100`,
		);
		return c.json({
			reports: rows.map(r => ({ ...commentJson(r, { id: null, isAdmin: true }), kind: r.kind, target: r.target, reports: Number(r.reports), reasons: r.reasons.filter((reason): reason is string => !!reason), lastReport: r.last_report.toISOString() })),
		});
	});
	app.delete("/api/admin/comment-reports/:id", async c => {
		await c.get("pool").query("delete from fracital_comment_reports where comment_id = $1", [c.req.param("id")]);
		return c.json({ ok: true });
	});
}
