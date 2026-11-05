/**
 * Fracital for Artists + admin dashboard.
 *
 * - Artists claim their Digital Library page; admins review claims by hand.
 * - Verified pages get a badge, and their team can customize the page (bio, banner,
 *   photos, logo, custom font, official links, Artist Pick, announcement), see stats,
 *   and invite team members by link.
 * - Admins approve/reject claims, revoke pages, edit any page, manage users (admin
 *   role, bans) and see overview stats.
 *
 * Admins: users with role 'admin' in fracital_user_meta, or whose email is listed in
 * ADMIN_EMAILS (comma-separated) — the bootstrap for the first admin.
 */
import { randomBytes } from "node:crypto";
import type { Hono, MiddlewareHandler } from "hono";
import type { Pool } from "pg";
import * as z from "zod";
import type { Env } from "./accounts";

// ============================================================
// Schema
// ============================================================

export async function migrateArtistTables(pool: Pool) {
	await pool.query(`
		create table if not exists fracital_user_meta (
			user_id text primary key references "user"(id) on delete cascade,
			role text not null default 'user',
			banned_at timestamptz,
			ban_reason text
		);
		create table if not exists artist_profiles (
			artist_id text primary key,
			name text not null,
			verified boolean not null default false,
			verified_at timestamptz,
			bio text,
			banner text,
			photos jsonb not null default '[]',
			logo text,
			font jsonb,
			links jsonb,
			pick jsonb,
			announcement text,
			updated_at timestamptz not null default now(),
			updated_by text
		);
		create table if not exists artist_claims (
			id serial primary key,
			artist_id text not null,
			artist_name text not null,
			user_id text not null references "user"(id) on delete cascade,
			status text not null default 'pending',
			role_title text not null,
			contact_email text not null,
			proof_links jsonb not null default '[]',
			message text not null default '',
			admin_note text,
			reviewed_by text,
			reviewed_at timestamptz,
			created_at timestamptz not null default now()
		);
		create index if not exists artist_claims_status on artist_claims (status, created_at desc);
		create table if not exists artist_members (
			artist_id text not null,
			user_id text not null references "user"(id) on delete cascade,
			role text not null default 'editor',
			invited_by text,
			created_at timestamptz not null default now(),
			primary key (artist_id, user_id)
		);
		create table if not exists artist_invites (
			code text primary key,
			artist_id text not null,
			role text not null default 'editor',
			created_by text not null,
			created_at timestamptz not null default now(),
			expires_at timestamptz not null,
			used_by text,
			used_at timestamptz
		);
		create table if not exists artist_media (
			id text primary key,
			artist_id text not null,
			mime text not null,
			bytes bytea not null,
			size integer not null,
			created_by text not null,
			created_at timestamptz not null default now()
		);
		create table if not exists music_play_events (
			id bigserial primary key,
			artist_key text not null,
			artist text not null,
			title text not null,
			listener text not null,
			user_id text,
			at timestamptz not null default now()
		);
		create index if not exists music_play_events_artist on music_play_events (artist_key, at desc);
		create index if not exists music_play_events_listener on music_play_events (listener, at desc);
		alter table fracital_user_meta add column if not exists username text;
		alter table fracital_user_meta add column if not exists premium boolean not null default false;
		create unique index if not exists fracital_user_meta_username on fracital_user_meta (lower(username));
	`);
}

// ============================================================
// Helpers
// ============================================================

/** Comparable artist identity: "Tyler, The Creator" → "tylerthecreator". */
export const artistKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const adminEmails = () =>
	(process.env.ADMIN_EMAILS || "")
		.split(",")
		.map(s => s.trim().toLowerCase())
		.filter(Boolean);

export async function userMeta(pool: Pool, user: { id: string; email: string }) {
	const { rows } = await pool.query<{ role: string; banned_at: Date | null; ban_reason: string | null; username: string | null; premium: boolean }>("select role, banned_at, ban_reason, username, premium from fracital_user_meta where user_id = $1", [user.id]);
	const meta = rows[0];
	return {
		isAdmin: meta?.role === "admin" || adminEmails().includes(user.email.toLowerCase()),
		banned: !!meta?.banned_at,
		banReason: meta?.ban_reason ?? null,
		username: meta?.username ?? null,
		premium: !!meta?.premium,
	};
}

export async function isBanned(pool: Pool, userId: string) {
	const { rows } = await pool.query("select 1 from fracital_user_meta where user_id = $1 and banned_at is not null", [userId]);
	return rows.length > 0;
}

type Role = "owner" | "admin" | "editor";
const ROLE_RANK: Record<Role, number> = { editor: 1, admin: 2, owner: 3 };

const LINK_KINDS = ["instagram", "spotify", "youtube", "tidal", "apple", "soundcloud", "x", "tiktok", "facebook", "bandcamp", "deezer", "website"] as const;

const mediaUrl = z
	.string()
	.max(2000)
	.refine(v => v === "" || v.startsWith("/api/artist-media/") || /^https:\/\//.test(v), "Must be an uploaded file or an https:// URL");

const profileInput = z.object({
	bio: z.string().max(4000).nullable().optional(),
	banner: mediaUrl.nullable().optional(),
	photos: z.array(mediaUrl).max(6).optional(),
	logo: mediaUrl.nullable().optional(),
	font: z
		.object({
			family: z
				.string()
				.min(1)
				.max(80)
				.regex(/^[\p{L}\p{N} '-]+$/u, "Invalid font name"),
			source: z.enum(["google", "upload"]),
			url: mediaUrl.optional(),
		})
		.nullable()
		.optional(),
	links: z
		.array(
			z.object({
				kind: z.enum(LINK_KINDS),
				url: z
					.string()
					.url()
					.max(500)
					.refine(u => /^https:\/\//.test(u), "Links must use https"),
			}),
		)
		.max(12)
		.nullable()
		.optional(),
	pick: z
		.object({
			title: z.string().min(1).max(300),
			artist: z.string().min(1).max(300),
			artwork: z.string().max(2000).optional(),
			trackId: z.string().max(100).optional(),
			albumId: z.string().max(100).optional(),
			note: z.string().max(280).optional(),
		})
		.nullable()
		.optional(),
	announcement: z.string().max(500).nullable().optional(),
});

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const FONT_TYPES = new Set(["font/woff2", "font/woff", "font/ttf", "font/otf", "application/font-woff", "application/x-font-ttf", "application/x-font-opentype"]);

/** Sniffs the real file type from magic bytes (the client-sent type isn't trusted). */
function sniff(bytes: Buffer): string | null {
	const hex = bytes.subarray(0, 12).toString("hex");
	if (hex.startsWith("89504e47")) return "image/png";
	if (hex.startsWith("ffd8ff")) return "image/jpeg";
	if (hex.startsWith("47494638")) return "image/gif";
	if (hex.startsWith("52494646") && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
	const tag = bytes.subarray(0, 4).toString("ascii");
	if (tag === "wOF2") return "font/woff2";
	if (tag === "wOFF") return "font/woff";
	if (tag === "OTTO") return "font/otf";
	if (hex.startsWith("00010000") || tag === "true") return "font/ttf";
	return null;
}

const profileRow = (r: Record<string, unknown> | undefined) =>
	r
		? {
				artistId: r.artist_id,
				name: r.name,
				verified: r.verified,
				bio: r.bio ?? null,
				banner: r.banner ?? null,
				photos: r.photos ?? [],
				logo: r.logo ?? null,
				font: r.font ?? null,
				links: r.links ?? null,
				pick: r.pick ?? null,
				announcement: r.announcement ?? null,
				updatedAt: r.updated_at,
			}
		: null;

// ============================================================
// Routes
// ============================================================

type Deps = { init: () => Promise<{ pool: Pool; auth: { api: { getSession: (o: { headers: Headers }) => Promise<{ user: Env["Variables"]["user"] } | null> } } } | null>; requireUser: MiddlewareHandler<Env> };

export function registerArtistRoutes(app: Hono<Env>, { init, requireUser }: Deps) {
	// --- Public ---

	app.get("/api/artist-profile/:artistId", async c => {
		const ctx = await init();
		if (!ctx) return c.json({ profile: null });
		const { rows } = await ctx.pool.query("select * from artist_profiles where artist_id = $1", [c.req.param("artistId")]);
		c.header("Cache-Control", "no-cache");
		return c.json({ profile: profileRow(rows[0]) });
	});

	app.get("/api/artist-media/:id", async c => {
		const ctx = await init();
		if (!ctx) return c.notFound();
		const { rows } = await ctx.pool.query<{ mime: string; bytes: Buffer }>("select mime, bytes from artist_media where id = $1", [c.req.param("id")]);
		if (!rows[0]) return c.notFound();
		return new Response(new Uint8Array(rows[0].bytes), {
			headers: {
				"Content-Type": rows[0].mime,
				"Cache-Control": "public, max-age=31536000, immutable",
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "default-src 'none'; sandbox",
				"Access-Control-Allow-Origin": "*",
			},
		});
	});

	// A play counted by the player after ~30s of listening (signed in or anonymous).
	app.post("/api/play-event", async c => {
		const ctx = await init();
		if (!ctx) return c.json({ ok: false });
		const body = z.object({ artist: z.string().min(1).max(300), title: z.string().min(1).max(300), listener: z.string().min(8).max(64) }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
		const { artist, title, listener } = body.data;
		const key = artistKey(artist);
		if (!key) return c.json({ ok: false });
		// One play per listener per song per 10 minutes.
		const dup = await ctx.pool.query("select 1 from music_play_events where listener = $1 and artist_key = $2 and lower(title) = lower($3) and at > now() - interval '10 minutes' limit 1", [listener, key, title]);
		if (!dup.rows.length) {
			await ctx.pool.query("insert into music_play_events (artist_key, artist, title, listener, user_id) values ($1, $2, $3, $4, $5)", [key, artist, title, listener, session?.user.id ?? null]);
		}
		return c.json({ ok: true });
	});

	// --- Signed-in helpers ---

	const meta = (c: { get: <K extends keyof Env["Variables"]>(k: K) => Env["Variables"][K] }) => userMeta(c.get("pool"), c.get("user"));

	/** The user's role on a page; admins act as 'admin' on every page. */
	async function pageRole(c: Parameters<typeof meta>[0], artistId: string): Promise<Role | null> {
		const { rows } = await c.get("pool").query<{ role: Role }>("select role from artist_members where artist_id = $1 and user_id = $2", [artistId, c.get("user").id]);
		if (rows[0]) return rows[0].role;
		return (await meta(c)).isAdmin ? "admin" : null;
	}

	const needPage =
		(min: Role): MiddlewareHandler<Env> =>
		async (c, next) => {
			const role = await pageRole(c, c.req.param("artistId") ?? "");
			if (!role || ROLE_RANK[role] < ROLE_RANK[min]) return c.json({ error: "You don't manage this page" }, 403);
			await next();
		};

	async function saveProfile(pool: Pool, artistId: string, name: string | undefined, input: z.infer<typeof profileInput>, userId: string) {
		const existing = await pool.query("select name from artist_profiles where artist_id = $1", [artistId]);
		if (!existing.rows.length) await pool.query("insert into artist_profiles (artist_id, name) values ($1, $2)", [artistId, name || "Unknown Artist"]);
		const fields: [string, unknown][] = [];
		const json = (v: unknown) => (v === undefined ? undefined : v === null ? null : JSON.stringify(v));
		if (input.bio !== undefined) fields.push(["bio", input.bio || null]);
		if (input.banner !== undefined) fields.push(["banner", input.banner || null]);
		if (input.photos !== undefined) fields.push(["photos", JSON.stringify(input.photos.filter(Boolean))]);
		if (input.logo !== undefined) fields.push(["logo", input.logo || null]);
		if (input.font !== undefined) fields.push(["font", json(input.font)]);
		if (input.links !== undefined) fields.push(["links", json(input.links)]);
		if (input.pick !== undefined) fields.push(["pick", json(input.pick)]);
		if (input.announcement !== undefined) fields.push(["announcement", input.announcement || null]);
		if (!fields.length) return;
		const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(", ");
		await pool.query(`update artist_profiles set ${sets}, updated_at = now(), updated_by = $${fields.length + 2} where artist_id = $1`, [artistId, ...fields.map(([, v]) => v), userId]);
	}

	async function pageStats(pool: Pool, artistId: string) {
		const { rows: prof } = await pool.query<{ name: string }>("select name from artist_profiles where artist_id = $1", [artistId]);
		const key = artistKey(prof[0]?.name ?? "");
		const [totals, top, daily, saves] = await Promise.all([
			pool.query<{ total: string; plays28: string; plays7: string; listeners28: string; listeners_total: string }>(
				`select count(*) total,
					count(*) filter (where at > now() - interval '28 days') plays28,
					count(*) filter (where at > now() - interval '7 days') plays7,
					count(distinct listener) filter (where at > now() - interval '28 days') listeners28,
					count(distinct listener) listeners_total
				from music_play_events where artist_key = $1`,
				[key],
			),
			pool.query<{ title: string; plays: string; listeners: string }>("select min(title) title, count(*) plays, count(distinct listener) listeners from music_play_events where artist_key = $1 and at > now() - interval '28 days' group by lower(title) order by count(*) desc limit 10", [key]),
			pool.query<{ day: string; plays: string }>("select to_char(d, 'YYYY-MM-DD') as day, coalesce(count(e.id), 0) plays from generate_series(current_date - 27, current_date, interval '1 day') d left join music_play_events e on e.artist_key = $1 and e.at::date = d::date group by d order by d", [key]),
			pool.query<{ n: string }>("select count(*) n from fracital_saved_artists where artist_id = $1", [artistId]),
		]);
		const t = totals.rows[0];
		return {
			totalPlays: Number(t?.total ?? 0),
			plays28: Number(t?.plays28 ?? 0),
			plays7: Number(t?.plays7 ?? 0),
			listeners28: Number(t?.listeners28 ?? 0),
			listenersTotal: Number(t?.listeners_total ?? 0),
			saves: Number(saves.rows[0]?.n ?? 0),
			topSongs: top.rows.map(r => ({ title: r.title, plays: Number(r.plays), listeners: Number(r.listeners) })),
			daily: daily.rows.map(r => ({ day: r.day, plays: Number(r.plays) })),
		};
	}

	// --- Your profile: display name, username, profile picture ---

	const RESERVED = new Set(["admin", "admins", "fracital", "support", "help", "staff", "mod", "moderator", "official", "system", "root", "api", "artists", "artist", "null", "undefined", "me"]);

	app.put("/api/me/profile", async c => {
		const body = z
			.object({
				name: z.string().trim().min(1, "Display name can't be empty").max(50, "Display name is too long").optional(),
				username: z
					.string()
					.trim()
					.toLowerCase()
					.regex(/^[a-z0-9_.]{3,30}$/, "Usernames are 3–30 characters: letters, numbers, _ and .")
					.nullable()
					.optional(),
				image: z
					.string()
					.max(2000)
					.refine(v => v === "" || v.startsWith("/api/artist-media/") || /^https:\/\//.test(v), "Invalid image")
					.nullable()
					.optional(),
			})
			.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, 400);
		const pool = c.get("pool");
		const userId = c.get("user").id;
		const { name, username, image } = body.data;
		if (username !== undefined && username !== null) {
			if (RESERVED.has(username)) return c.json({ error: "That username is reserved" }, 409);
			const taken = await pool.query("select 1 from fracital_user_meta where lower(username) = $1 and user_id <> $2", [username, userId]);
			if (taken.rows.length) return c.json({ error: "That username is taken" }, 409);
		}
		if (username !== undefined) {
			await pool.query("insert into fracital_user_meta (user_id, username) values ($1, $2) on conflict (user_id) do update set username = excluded.username", [userId, username]);
		}
		if (name !== undefined) await pool.query('update "user" set name = $2, "updatedAt" = now() where id = $1', [userId, name]);
		if (image !== undefined) await pool.query('update "user" set image = $2, "updatedAt" = now() where id = $1', [userId, image || null]);
		return c.json({ ok: true });
	});

	// Upload a profile picture (raw body). Stored like artist media, under the user's id.
	app.post("/api/me/avatar", async c => {
		const bytes = Buffer.from(await c.req.arrayBuffer());
		if (!bytes.length) return c.json({ error: "Empty file" }, 400);
		if (bytes.length > 3 * 1024 * 1024) return c.json({ error: "Image too large (max 3MB)" }, 413);
		const mime = sniff(bytes);
		if (!mime || !IMAGE_TYPES.has(mime)) return c.json({ error: "Upload a PNG, JPEG, WebP or GIF image" }, 415);
		const pool = c.get("pool");
		const userId = c.get("user").id;
		const owner = `user:${userId}`;
		// Keep only the latest avatar.
		await pool.query("delete from artist_media where artist_id = $1", [owner]);
		const id = randomBytes(12).toString("hex");
		await pool.query("insert into artist_media (id, artist_id, mime, bytes, size, created_by) values ($1, $2, $3, $4, $5, $6)", [id, owner, mime, bytes, bytes.length, userId]);
		const url = `/api/artist-media/${id}`;
		await pool.query('update "user" set image = $2, "updatedAt" = now() where id = $1', [userId, url]);
		return c.json({ url });
	});

	// --- Artist panel (members) ---

	app.get("/api/me/artist-panel", async c => {
		const pool = c.get("pool");
		const userId = c.get("user").id;
		const [pages, claims] = await Promise.all([
			pool.query("select m.artist_id, m.role, p.name, p.verified, p.logo, p.banner, p.photos from artist_members m left join artist_profiles p on p.artist_id = m.artist_id where m.user_id = $1 order by p.name", [userId]),
			pool.query("select id, artist_id, artist_name, status, role_title, admin_note, created_at, reviewed_at from artist_claims where user_id = $1 order by created_at desc limit 50", [userId]),
		]);
		return c.json({
			isAdmin: (await meta(c)).isAdmin,
			pages: pages.rows.map(r => ({ artistId: r.artist_id, role: r.role, name: r.name, verified: r.verified, image: r.logo || r.photos?.[0] || r.banner || null })),
			claims: claims.rows.map(r => ({ id: r.id, artistId: r.artist_id, artistName: r.artist_name, status: r.status, roleTitle: r.role_title, adminNote: r.admin_note, createdAt: r.created_at, reviewedAt: r.reviewed_at })),
		});
	});

	app.post("/api/me/claims", async c => {
		const body = z
			.object({
				artistId: z.string().min(1).max(100),
				artistName: z.string().min(1).max(300),
				roleTitle: z.enum(["Artist", "Manager", "Label", "Team member"]),
				contactEmail: z.string().email().max(300),
				proofLinks: z.array(z.string().url().max(500)).min(1, "Add at least one official link").max(8),
				message: z.string().max(2000).default(""),
			})
			.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, 400);
		const pool = c.get("pool");
		const userId = c.get("user").id;
		const d = body.data;
		const member = await pool.query("select 1 from artist_members where artist_id = $1 and user_id = $2", [d.artistId, userId]);
		if (member.rows.length) return c.json({ error: "You already manage this page" }, 409);
		const pending = await pool.query("select 1 from artist_claims where artist_id = $1 and user_id = $2 and status = 'pending'", [d.artistId, userId]);
		if (pending.rows.length) return c.json({ error: "You already have a pending claim for this artist" }, 409);
		const recent = await pool.query("select count(*)::int n from artist_claims where user_id = $1 and created_at > now() - interval '1 day'", [userId]);
		if ((recent.rows[0]?.n ?? 0) >= 5) return c.json({ error: "Too many claims today — try again tomorrow" }, 429);
		const { rows } = await pool.query("insert into artist_claims (artist_id, artist_name, user_id, role_title, contact_email, proof_links, message) values ($1, $2, $3, $4, $5, $6, $7) returning id", [d.artistId, d.artistName, userId, d.roleTitle, d.contactEmail, JSON.stringify(d.proofLinks), d.message]);
		return c.json({ ok: true, id: rows[0].id });
	});

	app.delete("/api/me/claims/:id", async c => {
		await c.get("pool").query("delete from artist_claims where id = $1 and user_id = $2 and status = 'pending'", [Number(c.req.param("id")) || 0, c.get("user").id]);
		return c.json({ ok: true });
	});

	app.get("/api/me/artist-panel/:artistId", needPage("editor"), async c => {
		const pool = c.get("pool");
		const artistId = c.req.param("artistId");
		const [profile, members, invites] = await Promise.all([
			pool.query("select * from artist_profiles where artist_id = $1", [artistId]),
			pool.query('select m.user_id, m.role, m.created_at, u.name, u.email, u.image from artist_members m join "user" u on u.id = m.user_id where m.artist_id = $1 order by m.created_at', [artistId]),
			pool.query("select code, role, created_at, expires_at from artist_invites where artist_id = $1 and used_by is null and expires_at > now() order by created_at desc", [artistId]),
		]);
		return c.json({
			role: await pageRole(c, artistId),
			profile: profileRow(profile.rows[0]),
			members: members.rows.map(r => ({ userId: r.user_id, role: r.role, name: r.name, email: String(r.email).endsWith("@lastfm.invalid") ? null : r.email, image: r.image, since: r.created_at })),
			invites: invites.rows.map(r => ({ code: r.code, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at })),
		});
	});

	app.put("/api/me/artist-panel/:artistId/profile", needPage("editor"), async c => {
		const body = profileInput.extend({ name: z.string().max(300).optional() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, 400);
		await saveProfile(c.get("pool"), c.req.param("artistId"), body.data.name, body.data, c.get("user").id);
		const { rows } = await c.get("pool").query("select * from artist_profiles where artist_id = $1", [c.req.param("artistId")]);
		return c.json({ profile: profileRow(rows[0]) });
	});

	// Upload an image or font (raw body). Returns its URL.
	app.post("/api/me/artist-panel/:artistId/media", needPage("editor"), async c => {
		const kind = c.req.query("kind") === "font" ? "font" : "image";
		const bytes = Buffer.from(await c.req.arrayBuffer());
		const max = kind === "font" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
		if (!bytes.length) return c.json({ error: "Empty file" }, 400);
		if (bytes.length > max) return c.json({ error: `File too large (max ${max / 1024 / 1024}MB)` }, 413);
		const mime = sniff(bytes);
		if (!mime || (kind === "image" ? !IMAGE_TYPES.has(mime) : !FONT_TYPES.has(mime))) {
			return c.json({ error: kind === "font" ? "Upload a .woff2, .woff, .ttf or .otf font" : "Upload a PNG, JPEG, WebP or GIF image" }, 415);
		}
		const pool = c.get("pool");
		const used = await pool.query<{ total: string }>("select coalesce(sum(size), 0) total from artist_media where artist_id = $1", [c.req.param("artistId")]);
		if (Number(used.rows[0]?.total ?? 0) + bytes.length > 60 * 1024 * 1024) return c.json({ error: "This page's upload storage is full (60MB)" }, 413);
		const id = randomBytes(12).toString("hex");
		await pool.query("insert into artist_media (id, artist_id, mime, bytes, size, created_by) values ($1, $2, $3, $4, $5, $6)", [id, c.req.param("artistId"), mime, bytes, bytes.length, c.get("user").id]);
		return c.json({ url: `/api/artist-media/${id}`, mime });
	});

	app.get("/api/me/artist-panel/:artistId/stats", needPage("editor"), async c => c.json(await pageStats(c.get("pool"), c.req.param("artistId"))));

	app.post("/api/me/artist-panel/:artistId/invites", needPage("admin"), async c => {
		const body = z.object({ role: z.enum(["admin", "editor"]) }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid role" }, 400);
		const code = randomBytes(9).toString("base64url");
		await c.get("pool").query("insert into artist_invites (code, artist_id, role, created_by, expires_at) values ($1, $2, $3, $4, now() + interval '7 days')", [code, c.req.param("artistId"), body.data.role, c.get("user").id]);
		return c.json({ code });
	});

	app.delete("/api/me/artist-panel/:artistId/invites/:code", needPage("admin"), async c => {
		await c.get("pool").query("delete from artist_invites where code = $1 and artist_id = $2", [c.req.param("code"), c.req.param("artistId")]);
		return c.json({ ok: true });
	});

	app.delete("/api/me/artist-panel/:artistId/members/:userId", needPage("editor"), async c => {
		const pool = c.get("pool");
		const artistId = c.req.param("artistId");
		const target = c.req.param("userId");
		const me = c.get("user").id;
		const myRole = await pageRole(c, artistId);
		const { rows } = await pool.query<{ role: Role }>("select role from artist_members where artist_id = $1 and user_id = $2", [artistId, target]);
		if (!rows[0]) return c.json({ ok: true });
		// Anyone can leave; removing others needs a higher role. The owner can't be removed here.
		if (target !== me && (!myRole || ROLE_RANK[myRole] <= ROLE_RANK[rows[0].role])) return c.json({ error: "You can't remove this member" }, 403);
		if (rows[0].role === "owner") return c.json({ error: "The owner can't be removed — an admin can revoke the page" }, 400);
		await pool.query("delete from artist_members where artist_id = $1 and user_id = $2", [artistId, target]);
		return c.json({ ok: true });
	});

	app.get("/api/me/artist-invites/:code", async c => {
		const { rows } = await c.get("pool").query("select i.artist_id, i.role, p.name from artist_invites i left join artist_profiles p on p.artist_id = i.artist_id where i.code = $1 and i.used_by is null and i.expires_at > now()", [c.req.param("code")]);
		if (!rows[0]) return c.json({ error: "This invite is invalid or expired" }, 404);
		return c.json({ artistId: rows[0].artist_id, artistName: rows[0].name, role: rows[0].role });
	});

	app.post("/api/me/artist-invites/:code/accept", async c => {
		const pool = c.get("pool");
		const userId = c.get("user").id;
		const { rows } = await pool.query("update artist_invites set used_by = $2, used_at = now() where code = $1 and used_by is null and expires_at > now() returning artist_id, role, created_by", [c.req.param("code"), userId]);
		if (!rows[0]) return c.json({ error: "This invite is invalid or expired" }, 404);
		await pool.query("insert into artist_members (artist_id, user_id, role, invited_by) values ($1, $2, $3, $4) on conflict (artist_id, user_id) do nothing", [rows[0].artist_id, userId, rows[0].role, rows[0].created_by]);
		return c.json({ ok: true, artistId: rows[0].artist_id });
	});

	// --- Admin ---

	const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
		if (!(await meta(c)).isAdmin) return c.json({ error: "Admins only" }, 403);
		await next();
	};
	app.use("/api/admin/*", requireUser, requireAdmin);

	app.get("/api/admin/overview", async c => {
		const pool = c.get("pool");
		const { rows } = await pool.query(`select
			(select count(*) from "user")::int users,
			(select count(*) from "user" where "createdAt" > now() - interval '7 days')::int new_users7,
			(select count(*) from artist_claims where status = 'pending')::int pending_claims,
			(select count(*) from artist_profiles where verified)::int verified_artists,
			(select count(*) from music_play_events where at > now() - interval '1 day')::int plays1,
			(select count(*) from music_play_events where at > now() - interval '7 days')::int plays7,
			(select count(*) from music_play_events where at > now() - interval '28 days')::int plays28,
			(select count(distinct listener) from music_play_events where at > now() - interval '7 days')::int listeners7,
			(select count(*) from fracital_user_meta where banned_at is not null)::int banned`);
		const top = await pool.query("select min(artist) artist, count(*)::int plays from music_play_events where at > now() - interval '7 days' group by artist_key order by plays desc limit 10");
		const daily = await pool.query("select to_char(d, 'YYYY-MM-DD') as day, coalesce(count(e.id), 0)::int plays from generate_series(current_date - 27, current_date, interval '1 day') d left join music_play_events e on e.at::date = d::date group by d order by d");
		return c.json({ ...rows[0], topArtists: top.rows, daily: daily.rows });
	});

	app.get("/api/admin/claims", async c => {
		const status = ["pending", "approved", "rejected"].includes(c.req.query("status") || "") ? c.req.query("status") : "pending";
		const { rows } = await c.get("pool").query(
			`select c.*, u.name user_name, u.email user_email, u.image user_image, u."createdAt" user_created,
				(select count(*) from artist_members m where m.artist_id = c.artist_id)::int existing_members
			from artist_claims c join "user" u on u.id = c.user_id where c.status = $1 order by c.created_at ${status === "pending" ? "asc" : "desc"} limit 200`,
			[status],
		);
		return c.json({
			claims: rows.map(r => ({
				id: r.id,
				artistId: r.artist_id,
				artistName: r.artist_name,
				status: r.status,
				roleTitle: r.role_title,
				contactEmail: r.contact_email,
				proofLinks: r.proof_links,
				message: r.message,
				adminNote: r.admin_note,
				createdAt: r.created_at,
				reviewedAt: r.reviewed_at,
				existingMembers: r.existing_members,
				user: { id: r.user_id, name: r.user_name, email: String(r.user_email).endsWith("@lastfm.invalid") ? `Last.fm: ${String(r.user_email).replace("@lastfm.invalid", "")}` : r.user_email, image: r.user_image, createdAt: r.user_created },
			})),
		});
	});

	app.post("/api/admin/claims/:id", async c => {
		const body = z.object({ action: z.enum(["approve", "reject"]), note: z.string().max(1000).optional() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const pool = c.get("pool");
		const adminId = c.get("user").id;
		const { rows } = await pool.query("update artist_claims set status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = now() where id = $1 and status = 'pending' returning artist_id, artist_name, user_id", [
			Number(c.req.param("id")) || 0,
			body.data.action === "approve" ? "approved" : "rejected",
			body.data.note || null,
			adminId,
		]);
		const claim = rows[0];
		if (!claim) return c.json({ error: "Claim not found or already reviewed" }, 404);
		if (body.data.action === "approve") {
			await pool.query("insert into artist_profiles (artist_id, name, verified, verified_at) values ($1, $2, true, now()) on conflict (artist_id) do update set verified = true, verified_at = coalesce(artist_profiles.verified_at, now())", [claim.artist_id, claim.artist_name]);
			// The first approved claimant owns the page; later ones join as admins.
			const owner = await pool.query("select 1 from artist_members where artist_id = $1 and role = 'owner'", [claim.artist_id]);
			await pool.query("insert into artist_members (artist_id, user_id, role, invited_by) values ($1, $2, $3, $4) on conflict (artist_id, user_id) do update set role = excluded.role", [claim.artist_id, claim.user_id, owner.rows.length ? "admin" : "owner", adminId]);
		}
		return c.json({ ok: true });
	});

	app.get("/api/admin/artists", async c => {
		const { rows } = await c.get("pool").query(
			`select p.artist_id, p.name, p.verified, p.verified_at, p.updated_at, p.logo, p.photos,
				coalesce(json_agg(json_build_object('userId', u.id, 'name', u.name, 'role', m.role)) filter (where u.id is not null), '[]') members
			from artist_profiles p left join artist_members m on m.artist_id = p.artist_id left join "user" u on u.id = m.user_id
			group by p.artist_id order by p.verified desc, p.name limit 500`,
		);
		return c.json({ artists: rows.map(r => ({ artistId: r.artist_id, name: r.name, verified: r.verified, verifiedAt: r.verified_at, updatedAt: r.updated_at, image: r.logo || r.photos?.[0] || null, members: r.members })) });
	});

	app.post("/api/admin/artists/:artistId/revoke", async c => {
		const pool = c.get("pool");
		const artistId = c.req.param("artistId");
		await pool.query("update artist_profiles set verified = false, verified_at = null where artist_id = $1", [artistId]);
		await pool.query("delete from artist_members where artist_id = $1", [artistId]);
		await pool.query("delete from artist_invites where artist_id = $1", [artistId]);
		return c.json({ ok: true });
	});

	app.post("/api/admin/artists/:artistId/verify", async c => {
		const body = z.object({ name: z.string().min(1).max(300) }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		await c.get("pool").query("insert into artist_profiles (artist_id, name, verified, verified_at) values ($1, $2, true, now()) on conflict (artist_id) do update set verified = true, verified_at = now()", [c.req.param("artistId"), body.data.name]);
		return c.json({ ok: true });
	});

	app.delete("/api/admin/artists/:artistId/members/:userId", async c => {
		await c.get("pool").query("delete from artist_members where artist_id = $1 and user_id = $2", [c.req.param("artistId"), c.req.param("userId")]);
		return c.json({ ok: true });
	});

	app.get("/api/admin/users", async c => {
		const q = (c.req.query("q") || "").trim();
		const { rows } = await c.get("pool").query(
			`select u.id, u.name, u.email, u.image, u."createdAt" created_at, m.role, m.banned_at, m.ban_reason, m.username, coalesce(m.premium, false) premium,
				(select count(*) from artist_members am where am.user_id = u.id)::int pages,
				(select count(*) from artist_claims ac where ac.user_id = u.id)::int claims,
				(select max(s."updatedAt") from session s where s."userId" = u.id) last_seen
			from "user" u left join fracital_user_meta m on m.user_id = u.id
			where $1 = '' or u.name ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%' or m.username ilike '%' || $1 || '%'
			order by u."createdAt" desc limit 200`,
			[q],
		);
		const admins = adminEmails();
		return c.json({
			users: rows.map(r => ({
				id: r.id,
				name: r.name,
				email: String(r.email).endsWith("@lastfm.invalid") ? `Last.fm: ${String(r.email).replace("@lastfm.invalid", "")}` : r.email,
				image: r.image,
				createdAt: r.created_at,
				lastSeen: r.last_seen,
				role: r.role === "admin" || admins.includes(String(r.email).toLowerCase()) ? "admin" : "user",
				adminByEnv: admins.includes(String(r.email).toLowerCase()),
				banned: !!r.banned_at,
				banReason: r.ban_reason,
				username: r.username,
				premium: r.premium,
				pages: r.pages,
				claims: r.claims,
			})),
		});
	});

	app.post("/api/admin/users/:id", async c => {
		const body = z.object({ role: z.enum(["admin", "user"]).optional(), banned: z.boolean().optional(), reason: z.string().max(500).optional(), premium: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const pool = c.get("pool");
		const target = c.req.param("id");
		if (target === c.get("user").id && (body.data.banned || body.data.role === "user")) return c.json({ error: "You can't ban or demote yourself" }, 400);
		await pool.query("insert into fracital_user_meta (user_id) values ($1) on conflict do nothing", [target]);
		if (body.data.role) await pool.query("update fracital_user_meta set role = $2 where user_id = $1", [target, body.data.role]);
		if (body.data.premium !== undefined) await pool.query("update fracital_user_meta set premium = $2 where user_id = $1", [target, body.data.premium]);
		if (body.data.banned !== undefined) {
			await pool.query("update fracital_user_meta set banned_at = $2, ban_reason = $3 where user_id = $1", [target, body.data.banned ? new Date() : null, body.data.banned ? body.data.reason || null : null]);
			// Sign a banned user out everywhere.
			if (body.data.banned) await pool.query('delete from session where "userId" = $1', [target]);
		}
		return c.json({ ok: true });
	});
}
