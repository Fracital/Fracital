/**
 * Public user profiles (about:user?<username>, and the card a name or avatar opens): who someone is, their bio and
 * banner, and what they do here: comments, favorite artists, stats and streak, playlists, what they're listening to
 * and their Discord activity. Anyone can look; each section can be hidden by its owner, or the whole profile made
 * private (then only the name and picture show). Listening and Discord also need the owner's existing opt-ins (the
 * Social page's "share what I'm listening to", and "show my Discord activity").
 */
import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import type { Pool } from "pg";
import * as z from "zod";
import type { Env } from "./accounts";
import { artistKey, IMAGE_TYPES, sniff, userMeta } from "./artists";
import { COMMENT_SELECT, type CommentRow, commentJson, firstArtist, targetKey } from "./comments";
import { discordBotStatus, discordBotToken, discordPresenceFor } from "./discord-bot";
import { readPresence } from "./discord-presence";
import { liveStreakSql } from "./streaks";

export const PROFILE_SECTIONS = ["comments", "artists", "stats", "playlists", "listening", "discord"] as const;
type Section = (typeof PROFILE_SECTIONS)[number];

const BIO_MAX = 300;
/** The chips under their name: games they play and artists they like, in their own words. */
const INTERESTS_MAX = 8;
const INTEREST_NAME_MAX = 40;
/** The icons in the banner's corner: their accounts elsewhere (Instagram, Spotify, ...). */
const LINKS_MAX = 6;
const LINK_MAX = 200;
const BANNER_MAX_BYTES = 4 * 1024 * 1024;
const COMMENTS_PAGE = 20;
/** The Social page's freshness for "listening now" (its status is re-sent while a song plays). */
const LISTENING_FRESH_MINUTES = 3;

export async function migrateProfiles(pool: Pool) {
	await pool.query(`create table if not exists fracital_profiles (
		user_id text primary key references "user"(id) on delete cascade,
		bio text not null default '',
		banner text not null default '',
		banner_color text not null default '',
		private boolean not null default false,
		hidden text[] not null default '{}',
		updated_at timestamptz not null default now()
	)`);
	await pool.query(`alter table fracital_profiles add column if not exists interests jsonb not null default '[]', add column if not exists links text[] not null default '{}'`);
	await pool.query(`create table if not exists fracital_profile_media (
		id text primary key,
		user_id text not null references "user"(id) on delete cascade,
		mime text not null,
		bytes bytea not null,
		size integer not null,
		created_at timestamptz not null default now()
	)`);
}

type Interest = { kind: "game" | "music"; name: string };
type ProfileRow = { bio: string; banner: string; banner_color: string; private: boolean; hidden: string[]; interests: Interest[]; links: string[] };
const EMPTY: ProfileRow = { bio: "", banner: "", banner_color: "", private: false, hidden: [], interests: [], links: [] };

const readProfile = async (pool: Pool, userId: string): Promise<ProfileRow> => {
	const { rows } = await pool.query<ProfileRow>("select bio, banner, banner_color, private, hidden, interests, links from fracital_profiles where user_id = $1", [userId]);
	return rows[0] ?? EMPTY;
};

const settingsJson = (p: ProfileRow) => ({
	bio: p.bio,
	banner: p.banner || null,
	bannerColor: p.banner_color || null,
	private: p.private,
	hidden: p.hidden.filter((s): s is Section => (PROFILE_SECTIONS as readonly string[]).includes(s)),
	interests: p.interests,
	links: p.links,
});

/** A link to their account somewhere else: https only, so a profile can't carry a javascript: or data: URL. */
const linkInput = z
	.string()
	.trim()
	.max(LINK_MAX)
	.transform(v => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`))
	.refine(v => {
		try {
			const url = new URL(v);
			return url.protocol === "https:" && url.hostname.includes(".");
		} catch {
			return false;
		}
	});

const profileInput = z.object({
	bio: z.string().trim().max(BIO_MAX).optional(),
	bannerColor: z
		.string()
		.regex(/^(#[0-9a-f]{6})?$/i)
		.optional(),
	private: z.boolean().optional(),
	hidden: z.array(z.enum(PROFILE_SECTIONS)).max(PROFILE_SECTIONS.length).optional(),
	interests: z
		.array(z.object({ kind: z.enum(["game", "music"]), name: z.string().trim().min(1).max(INTEREST_NAME_MAX) }))
		.max(INTERESTS_MAX)
		.optional(),
	links: z.array(linkInput).max(LINKS_MAX).optional(),
});

/** Just what reading needs from the accounts setup: the database, and who's signed in. */
type SessionAuth = { api: { getSession: (o: { headers: Headers }) => Promise<{ user: Env["Variables"]["user"] } | null> } };
type Deps = { init: () => Promise<{ pool: Pool; auth: SessionAuth } | null> };

type UserRow = { id: string; name: string; image: string | null; created_at: Date; username: string | null; banned: boolean };

/** A profile's owner by username (any case) or account id; banned accounts have none. */
const findUser = async (pool: Pool, handle: string) => {
	const { rows } = await pool.query<UserRow>(
		`select u.id, u.name, u.image, u."createdAt" created_at, um.username, um.banned_at is not null banned
		 from "user" u left join fracital_user_meta um on um.user_id = u.id
		 where u.id = $1 or lower(um.username) = lower($1) limit 1`,
		[handle.replace(/^@/, "")],
	);
	return rows[0] && !rows[0].banned ? rows[0] : null;
};

export function registerProfileRoutes(app: Hono<Env>, { init }: Deps) {
	const viewerOf = async (headers: Headers, auth: SessionAuth) => (await auth.api.getSession({ headers }).catch(() => null))?.user ?? null;

	/** The profile and the sections its owner shows (all of them to the owner, who's told which are hidden). */
	const visible = async (pool: Pool, owner: string, viewer: string | null) => {
		const profile = await readProfile(pool, owner);
		const own = viewer === owner;
		const shows = (section: Section) => own || (!profile.private && !profile.hidden.includes(section));
		return { profile, own, shows, closed: profile.private && !own };
	};

	app.get("/api/profiles/:handle", async c => {
		const ctx = await init();
		if (!ctx) return c.json({ error: "Fracital Accounts aren't configured on this server" }, 503);
		const { pool } = ctx;
		const user = await findUser(pool, c.req.param("handle"));
		if (!user) return c.json({ error: "No one has that username" }, 404);
		const viewer = await viewerOf(c.req.raw.headers, ctx.auth);
		const { profile, own, shows, closed } = await visible(pool, user.id, viewer?.id ?? null);

		const base = {
			user: { id: user.id, name: user.name, image: user.image, username: user.username, joinedAt: user.created_at.toISOString() },
			own,
			private: profile.private,
			...(own ? { hidden: settingsJson(profile).hidden } : {}),
		};
		const follows = await pool.query<{ followers: string; following: string; followed: boolean }>(
			`select (select count(*) from fracital_user_follows where followee_id = $1) followers,
				(select count(*) from fracital_user_follows where follower_id = $1) following,
				exists (select 1 from fracital_user_follows where follower_id = $2 and followee_id = $1) followed`,
			[user.id, viewer?.id ?? null],
		);
		const social = { followers: Number(follows.rows[0].followers), following: Number(follows.rows[0].following), followed: follows.rows[0].followed };
		if (closed) return c.json({ ...base, ...social });

		const artistPages = await pool.query<{ artist_id: string; name: string }>("select p.artist_id, p.name from artist_members m join artist_profiles p on p.artist_id = m.artist_id where m.user_id = $1 and p.verified order by p.name", [user.id]);
		const [stats, artists, playlists, listening, discord] = await Promise.all([
			shows("stats") ? statsOf(pool, user.id) : undefined,
			shows("artists") ? artistsOf(pool, user.id) : undefined,
			shows("playlists") ? playlistsOf(pool, user.id) : undefined,
			shows("listening") ? listeningOf(pool, user.id) : undefined,
			shows("discord") ? discordOf(pool, user.id) : undefined,
		]);
		return c.json({
			...base,
			...social,
			bio: profile.bio,
			banner: profile.banner || null,
			bannerColor: profile.banner_color || null,
			interests: profile.interests,
			links: profile.links,
			artistPages: artistPages.rows.map(r => ({ artistId: r.artist_id, name: r.name })),
			comments: shows("comments"),
			...(stats ? { stats } : {}),
			...(artists ? { artists } : {}),
			...(playlists ? { playlists } : {}),
			...(listening !== undefined ? { listening } : {}),
			...(discord !== undefined ? { discord } : {}),
		});
	});

	// Someone's comments, newest first, a page at a time (?offset), each with the song or album it's on.
	app.get("/api/profiles/:handle/comments", async c => {
		const ctx = await init();
		if (!ctx) return c.json({ error: "Fracital Accounts aren't configured on this server" }, 503);
		const user = await findUser(ctx.pool, c.req.param("handle"));
		if (!user) return c.json({ error: "No one has that username" }, 404);
		const viewer = await viewerOf(c.req.raw.headers, ctx.auth);
		const { shows } = await visible(ctx.pool, user.id, viewer?.id ?? null);
		if (!shows("comments")) return c.json({ error: "Their comments are hidden" }, 403);
		const offset = Math.min(10_000, Math.max(0, Number(c.req.query("offset")) || 0));
		const { rows } = await ctx.pool.query<CommentRow & { kind: "song" | "album"; target: string; title: string | null; artist: string | null }>(
			`select x.*, t.kind, t.target, t.title, t.artist from (${COMMENT_SELECT} where c.user_id = $2) x join fracital_comments t on t.id = x.id
			 order by x.id desc limit $3 offset $4`,
			[viewer?.id ?? null, user.id, COMMENTS_PAGE + 1, offset],
		);
		await nameOldComments(ctx.pool, rows);
		const isAdmin = viewer ? (await userMeta(ctx.pool, viewer)).isAdmin : false;
		return c.json({
			comments: rows.slice(0, COMMENTS_PAGE).map(r => {
				// Older comments only have the matching key ("artist|name", lowercased).
				const [keyArtist, keyName] = r.target.split("|");
				return { ...commentJson(r, { id: viewer?.id ?? null, isAdmin }), on: { kind: r.kind, name: r.title ?? keyName, artist: r.artist ?? keyArtist } };
			}),
			more: rows.length > COMMENTS_PAGE,
		});
	});

	// One of their playlists' songs (to play from their profile).
	app.get("/api/profiles/:handle/playlists/:id", async c => {
		const ctx = await init();
		if (!ctx) return c.json({ error: "Fracital Accounts aren't configured on this server" }, 503);
		const user = await findUser(ctx.pool, c.req.param("handle"));
		if (!user) return c.json({ error: "No one has that username" }, 404);
		const viewer = await viewerOf(c.req.raw.headers, ctx.auth);
		if (!(await visible(ctx.pool, user.id, viewer?.id ?? null)).shows("playlists")) return c.json({ error: "Their playlists are hidden" }, 403);
		const { rows: found } = await ctx.pool.query<{ name: string }>("select name from fracital_playlists where id = $1 and user_id = $2", [c.req.param("id"), user.id]);
		if (!found[0]) return c.json({ error: "Playlist not found" }, 404);
		const { rows } = await ctx.pool.query<{ data: unknown }>("select data from fracital_playlist_tracks where playlist_id = $1 order by position limit 500", [c.req.param("id")]);
		return c.json({ name: found[0].name, tracks: rows.map(r => r.data) });
	});

	app.get("/api/profile-media/:id", async c => {
		const ctx = await init();
		if (!ctx) return c.notFound();
		const { rows } = await ctx.pool.query<{ mime: string; bytes: Buffer }>("select mime, bytes from fracital_profile_media where id = $1", [c.req.param("id")]);
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

	// --- Your own profile's settings ---

	app.get("/api/me/public-profile", async c => c.json(settingsJson(await readProfile(c.get("pool"), c.get("user").id))));

	app.put("/api/me/public-profile", async c => {
		const body = profileInput.safeParse(await c.req.json().catch(() => null));
		if (!body.success) {
			const field = body.error.issues[0]?.path[0];
			const error = field === "bio" ? `Bios are up to ${BIO_MAX} characters` : field === "links" ? `Add up to ${LINKS_MAX} https links` : field === "interests" ? `Add up to ${INTERESTS_MAX} interests, ${INTEREST_NAME_MAX} characters each` : "Invalid request";
			return c.json({ error }, 400);
		}
		const pool = c.get("pool");
		const next = { ...(await readProfile(pool, c.get("user").id)) };
		if (body.data.bio !== undefined) next.bio = body.data.bio;
		if (body.data.bannerColor !== undefined) next.banner_color = body.data.bannerColor;
		if (body.data.private !== undefined) next.private = body.data.private;
		if (body.data.hidden !== undefined) next.hidden = [...new Set(body.data.hidden)];
		// The same thing twice (any case) is kept once.
		if (body.data.interests !== undefined) next.interests = body.data.interests.filter((x, i, all) => all.findIndex(y => y.kind === x.kind && y.name.toLowerCase() === x.name.toLowerCase()) === i);
		if (body.data.links !== undefined) next.links = [...new Set(body.data.links)];
		await saveProfile(pool, c.get("user").id, next);
		return c.json(settingsJson(next));
	});

	// A new banner image (the raw file as the body), replacing the old one.
	app.post("/api/me/public-profile/banner", async c => {
		const bytes = Buffer.from(await c.req.arrayBuffer());
		if (!bytes.length) return c.json({ error: "Empty file" }, 400);
		if (bytes.length > BANNER_MAX_BYTES) return c.json({ error: `Banners are up to ${BANNER_MAX_BYTES / 1024 / 1024}MB` }, 413);
		const mime = sniff(bytes);
		if (!mime || !IMAGE_TYPES.has(mime)) return c.json({ error: "Upload a PNG, JPEG, WebP or GIF image" }, 415);
		const pool = c.get("pool");
		const userId = c.get("user").id;
		const id = randomBytes(12).toString("hex");
		await pool.query("delete from fracital_profile_media where user_id = $1", [userId]);
		await pool.query("insert into fracital_profile_media (id, user_id, mime, bytes, size) values ($1, $2, $3, $4, $5)", [id, userId, mime, bytes, bytes.length]);
		const next = { ...(await readProfile(pool, userId)), banner: `/api/profile-media/${id}` };
		await saveProfile(pool, userId, next);
		return c.json(settingsJson(next));
	});

	app.delete("/api/me/public-profile/banner", async c => {
		const pool = c.get("pool");
		const userId = c.get("user").id;
		await pool.query("delete from fracital_profile_media where user_id = $1", [userId]);
		const next = { ...(await readProfile(pool, userId)), banner: "" };
		await saveProfile(pool, userId, next);
		return c.json(settingsJson(next));
	});
}

/**
 * Song comments from before their song's name was kept only have the matching key ("ellalangley|choosintexas"). The
 * song's real name and artist are usually in the play counts (which keep both as played): match them by the same key,
 * then keep them on the comment so this happens once. (Opening the song's comments fills them in too, albums included.)
 */
const nameOldComments = async (pool: Pool, rows: { id: string; kind: string; target: string; title: string | null; artist: string | null }[]) => {
	const missing = rows.filter(r => r.kind === "song" && !r.title);
	const keys = [...new Set(missing.map(r => r.target))];
	await Promise.all(
		keys.map(async key => {
			const [keyArtist] = key.split("|");
			if (!keyArtist) return;
			// Plays are keyed by their whole credit ("karolgjudeline"), which starts with the main artist's key (letters and
			// digits only, so nothing in it needs escaping for LIKE).
			const { rows: plays } = await pool.query<{ artist: string; title: string }>("select distinct artist, title from music_play_events where artist_key like $1 limit 2000", [`${artistKey(keyArtist)}%`]);
			const play = plays.find(p => targetKey(p.title, p.artist) === key);
			if (!play) return;
			const artist = firstArtist(play.artist);
			await pool.query("update fracital_comments set title = $2, artist = $3 where kind = 'song' and target = $1 and title is null", [key, play.title, artist]);
			for (const r of missing) if (r.target === key) Object.assign(r, { title: play.title, artist });
		}),
	).catch(() => undefined);
};

const saveProfile = (pool: Pool, userId: string, p: ProfileRow) =>
	pool.query(
		`insert into fracital_profiles (user_id, bio, banner, banner_color, private, hidden, interests, links, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, now())
		 on conflict (user_id) do update set bio = excluded.bio, banner = excluded.banner, banner_color = excluded.banner_color, private = excluded.private, hidden = excluded.hidden,
			interests = excluded.interests, links = excluded.links, updated_at = now()`,
		[userId, p.bio, p.banner, p.banner_color, p.private, p.hidden, JSON.stringify(p.interests), p.links],
	);

const statsOf = async (pool: Pool, userId: string) => {
	const { rows } = await pool.query<{ streak: number; best: number; comments: string; likes: string; plays: string }>(
		`select ${liveStreakSql("st")} streak, coalesce(st.best, 0) best,
			(select count(*) from fracital_comments where user_id = $1) comments,
			(select count(*) from fracital_comment_likes l join fracital_comments c on c.id = l.comment_id where c.user_id = $1) likes,
			(select count(*) from music_play_events where user_id = $1) plays
		 from (select 1) one left join fracital_streaks st on st.user_id = $1`,
		[userId],
	);
	const r = rows[0];
	return { streak: Number(r.streak), best: Number(r.best), comments: Number(r.comments), likesReceived: Number(r.likes), plays: Number(r.plays) };
};

const artistsOf = async (pool: Pool, userId: string) => {
	const [saved, top] = await Promise.all([
		pool.query<{ artist_id: string; name: string; picture: string }>("select artist_id, name, picture from fracital_saved_artists where user_id = $1 order by created_at desc limit 24", [userId]),
		// Their most played in the last 30 days, under the name the player first counted.
		pool.query<{ name: string; plays: string }>(
			`select min(artist) name, count(*) plays from music_play_events where user_id = $1 and at > now() - interval '30 days'
			 group by artist_key order by plays desc limit 10`,
			[userId],
		),
	]);
	return { saved: saved.rows.map(r => ({ id: r.artist_id, name: r.name, picture: r.picture || null })), top: top.rows.map(r => ({ name: r.name, plays: Number(r.plays) })) };
};

const playlistsOf = async (pool: Pool, userId: string) => {
	const { rows } = await pool.query<{ id: string; name: string; count: string; artwork: string[] | null }>(
		`select p.id, p.name, count(t.track_id) as count,
			(array_agg(t.data->>'artwork' order by t.position) filter (where coalesce(t.data->>'artwork', '') <> ''))[1:4] as artwork
		 from fracital_playlists p left join fracital_playlist_tracks t on t.playlist_id = p.id
		 where p.user_id = $1 group by p.id order by p.updated_at desc limit 50`,
		[userId],
	);
	return rows.map(r => ({ id: r.id, name: r.name, count: Number(r.count), artwork: r.artwork ?? [] }));
};

/** What they're playing now, when they share it (the Social page's switch); null when nothing is. */
const listeningOf = async (pool: Pool, userId: string) => {
	const { rows } = await pool.query<{ song: unknown; updated_at: Date }>(`select song, updated_at from fracital_social_status where user_id = $1 and share and song is not null and updated_at > now() - interval '${LISTENING_FRESH_MINUTES} minutes'`, [userId]);
	return rows[0] ? { song: rows[0].song, at: rows[0].updated_at.toISOString() } : null;
};

/**
 * Their Discord status and activities, as the bot sees them (no voice channel: that's only on their own account page),
 * when Discord is linked and they show their activity. null when there's nothing to show.
 */
const discordOf = async (pool: Pool, userId: string) => {
	if (!discordBotToken() || discordBotStatus().state !== "ready") return null;
	if (!(await readPresence(pool, userId)).show_activity) return null;
	const { rows } = await pool.query<{ account_id: string }>(`select "accountId" account_id from account where "userId" = $1 and "providerId" = 'discord' limit 1`, [userId]);
	if (!rows[0]) return null;
	const presence = discordPresenceFor(rows[0].account_id);
	return presence ? { status: presence.status, activities: presence.activities } : null;
};
