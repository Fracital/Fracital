/**
 * The blog (/blog, /blog/<slug>, and /api/blog for about:blog): dev logs and Terms / Privacy Policy update posts.
 * Posts come from two places: Markdown files in content/blog (shipped with the code, read once at startup) and rows
 * an admin writes in the dashboard (published without a deploy; a row with a file's slug replaces that file).
 * Public pages are server-rendered in the legal pages' shell, never on a decoy host (see backend.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { Marked } from "marked";
import type { Pool } from "pg";
import * as z from "zod";
import type { Env } from "./accounts.ts";
import { escapeHtml, legalShell } from "./legal.ts";

export const POST_KINDS = ["devlog", "terms", "privacy"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const KIND_LABELS: Record<PostKind, string> = { devlog: "Dev log", terms: "Terms update", privacy: "Privacy update" };

export interface BlogPost {
	slug: string;
	title: string;
	/** ISO; a file's date comes from its name, a row's from when it was published (or last saved, for a draft). */
	date: string;
	kind: PostKind;
	summary: string;
	bodyMd: string;
	html: string;
	source: "file" | "db";
	published: boolean;
}

const CONTENT_DIR = fileURLToPath(new URL("../../content/blog", import.meta.url));
const SLUG = /^[a-z0-9-]{1,80}$/;

// Raw HTML in a post is shown as text, and a link may only go to a web page, an email address or an anchor, so a post
// can never carry a script, whoever wrote it.
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;
const marked = new Marked({ gfm: true });
marked.use({
	renderer: {
		html: ({ text }) => escapeHtml(text),
		link({ href, title, tokens }) {
			const text = this.parser.parseInline(tokens);
			return SAFE_HREF.test(href) ? `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${text}</a>` : text;
		},
	},
});
export const renderMarkdown = (md: string) => marked.parse(md, { async: false }) as string;

/** `key: value` lines between `---` fences at the top of a file. */
const parseFrontMatter = (raw: string) => {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!m) return { meta: {} as Record<string, string>, body: raw };
	const meta: Record<string, string> = {};
	for (const line of m[1].split(/\r?\n/)) {
		const i = line.indexOf(":");
		if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	return { meta, body: m[2] };
};

const asKind = (k: string | undefined): PostKind => (POST_KINDS.includes(k as PostKind) ? (k as PostKind) : "devlog");

let fileCache: BlogPost[] | null = null;

/** The posts in content/blog, newest first. Cached after the first read; `fresh` re-reads (the dev server). */
export function loadFilePosts(fresh = false): BlogPost[] {
	if (fileCache && !fresh) return fileCache;
	const posts: BlogPost[] = [];
	if (existsSync(CONTENT_DIR)) {
		for (const name of readdirSync(CONTENT_DIR)) {
			const m = /^(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.md$/.exec(name);
			if (!m) continue;
			const { meta, body } = parseFrontMatter(readFileSync(join(CONTENT_DIR, name), "utf8"));
			posts.push({ slug: m[2], title: meta.title || m[2], date: new Date(`${m[1]}T12:00:00Z`).toISOString(), kind: asKind(meta.kind), summary: meta.summary || "", bodyMd: body, html: renderMarkdown(body), source: "file", published: true });
		}
	}
	posts.sort((a, b) => b.date.localeCompare(a.date));
	fileCache = posts;
	return posts;
}

export async function migrateBlog(pool: Pool) {
	await pool.query(`create table if not exists fracital_blog_posts (
		slug text primary key,
		title text not null,
		kind text not null,
		summary text not null default '',
		body_md text not null,
		published_at timestamptz,
		created_by text,
		created_at timestamptz not null default now(),
		updated_at timestamptz not null default now()
	)`);
}

type Row = { slug: string; title: string; kind: string; summary: string; body_md: string; published_at: Date | null; updated_at: Date };
const fromRow = (r: Row): BlogPost => ({ slug: r.slug, title: r.title, date: (r.published_at ?? r.updated_at).toISOString(), kind: asKind(r.kind), summary: r.summary, bodyMd: r.body_md, html: renderMarkdown(r.body_md), source: "db", published: !!r.published_at });

/** Every post, newest first: the files plus the rows (a row replaces a file with the same slug). Drafts only on request. */
export async function listPosts(pool: Pool | null, opts: { drafts?: boolean; fresh?: boolean } = {}): Promise<BlogPost[]> {
	const bySlug = new Map(loadFilePosts(opts.fresh).map(p => [p.slug, p]));
	if (pool) {
		const { rows } = await pool.query<Row>(`select slug, title, kind, summary, body_md, published_at, updated_at from fracital_blog_posts${opts.drafts ? "" : " where published_at is not null"}`);
		for (const r of rows) bySlug.set(r.slug, fromRow(r));
	}
	return [...bySlug.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export const getPost = async (pool: Pool | null, slug: string, opts: { fresh?: boolean; drafts?: boolean } = {}) => (SLUG.test(slug) ? ((await listPosts(pool, opts)).find(p => p.slug === slug) ?? null) : null);

// --- Public pages ---

const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const badge = (kind: PostKind) => `<span class="badge ${kind}">${KIND_LABELS[kind]}</span>`;

export const renderBlogIndex = (posts: BlogPost[]) =>
	legalShell({
		title: "Blog",
		description: "Fracital's dev log, and what changed in the Terms of Service and Privacy Policy.",
		heading: "Blog",
		meta: "Dev logs, and what changed in the Terms and the Privacy Policy.",
		body: posts.length ? posts.map(p => `<article class="post"><h2><a href="/blog/${p.slug}">${escapeHtml(p.title)}</a></h2><p class="meta">${badge(p.kind)} ${dateText(p.date)}</p>${p.summary ? `<p>${escapeHtml(p.summary)}</p>` : ""}</article>`).join("") : "<p>Nothing here yet.</p>",
	});

export const renderBlogPostPage = (post: BlogPost) =>
	legalShell({
		title: post.title,
		description: post.summary || post.title,
		heading: post.title,
		meta: `${badge(post.kind)} ${dateText(post.date)}`,
		body: `${post.html}<p class="back"><a href="/blog">← All posts</a></p>`,
	});

export const renderBlogNotFound = () => legalShell({ title: "Not found", description: "No such post.", heading: "No such post", meta: "", body: `<p>There's nothing at that address. <a href="/blog">All posts</a>.</p>` });

// --- JSON for the app, and the admin editor ---

type Deps = { init: () => Promise<{ pool: Pool } | null> };

const postJson = ({ bodyMd, html, ...p }: BlogPost, withBody: "html" | "md" | "none") => ({ ...p, ...(withBody === "html" ? { html } : withBody === "md" ? { bodyMd } : {}) });

const postInput = z.object({
	title: z.string().trim().min(1).max(200),
	kind: z.enum(POST_KINDS),
	summary: z.string().trim().max(500),
	bodyMd: z.string().max(100_000),
	published: z.boolean(),
});

export function registerBlogRoutes(app: Hono<Env>, deps: Deps) {
	// Public: the list (no bodies) and one post, for about:blog and the home page's policy notice.
	app.get("/api/blog", async c => {
		const pool = (await deps.init())?.pool ?? null;
		const kinds = (c.req.query("kind") || "").split(",").filter((k): k is PostKind => POST_KINDS.includes(k as PostKind));
		const limit = Number.parseInt(c.req.query("limit") || "", 10);
		let posts = await listPosts(pool);
		if (kinds.length) posts = posts.filter(p => kinds.includes(p.kind));
		if (limit > 0) posts = posts.slice(0, limit);
		return c.json({ posts: posts.map(p => postJson(p, "none")) });
	});
	app.get("/api/blog/:slug", async c => {
		const post = await getPost((await deps.init())?.pool ?? null, c.req.param("slug"));
		return post ? c.json({ post: postJson(post, "html") }) : c.json({ error: "No such post" }, 404);
	});

	// Admin (the /api/admin/* guard is installed with the artist routes): everything, drafts and files included.
	app.get("/api/admin/blog", async c => c.json({ posts: (await listPosts(c.get("pool"), { drafts: true })).map(p => postJson(p, "md")) }));
	app.put("/api/admin/blog/:slug", async c => {
		const slug = c.req.param("slug");
		if (!SLUG.test(slug)) return c.json({ error: "Slugs are lowercase letters, digits and dashes" }, 400);
		const body = postInput.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const { title, kind, summary, bodyMd, published } = body.data;
		const pool = c.get("pool");
		await pool.query(
			`insert into fracital_blog_posts (slug, title, kind, summary, body_md, published_at, created_by) values ($1, $2, $3, $4, $5, case when $6 then now() end, $7)
			 on conflict (slug) do update set title = $2, kind = $3, summary = $4, body_md = $5, updated_at = now(),
			 published_at = case when $6 then coalesce(fracital_blog_posts.published_at, now()) end`,
			[slug, title, kind, summary, bodyMd, published, c.get("user").id],
		);
		const post = await getPost(pool, slug, { drafts: true });
		return c.json({ post: post ? postJson(post, "md") : null });
	});
	app.delete("/api/admin/blog/:slug", async c => {
		const { rowCount } = await c.get("pool").query("delete from fracital_blog_posts where slug = $1", [c.req.param("slug")]);
		return rowCount ? c.json({ ok: true }) : c.json({ error: "No such post" }, 404);
	});
}
