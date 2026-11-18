/**
 * The blog (src/server/blog.ts) as the app sees it: the public list and posts for about:blog and the home page's
 * policy notice, and Markdown rendering for the admin editor's preview. Post HTML is sanitized before it's shown.
 */
import DOMPurify from "dompurify";
import { marked } from "marked";
import { meFetch } from "./auth";

export const POST_KINDS = ["devlog", "terms", "privacy"] as const;
export type PostKind = (typeof POST_KINDS)[number];
/** Badge text by kind; the admin editor's kind picker shows these too. */
export const KIND_LABELS: Record<PostKind, string> = { devlog: "Dev log", terms: "Terms update", privacy: "Privacy update" };

export interface BlogPostMeta {
	slug: string;
	title: string;
	/** ISO. */
	date: string;
	kind: PostKind;
	summary: string;
	source: "file" | "db";
	published: boolean;
}
export interface BlogPost extends BlogPostMeta {
	html: string;
}

export const blog = {
	list: (opts: { kind?: PostKind[]; limit?: number } = {}) => {
		const q = new URLSearchParams();
		if (opts.kind?.length) q.set("kind", opts.kind.join(","));
		if (opts.limit) q.set("limit", String(opts.limit));
		const query = q.toString();
		return meFetch<{ posts: BlogPostMeta[] }>(`/api/blog${query ? `?${query}` : ""}`).then(r => r.posts);
	},
	get: (slug: string) => meFetch<{ post: BlogPost }>(`/api/blog/${encodeURIComponent(slug)}`).then(r => r.post),
};

/** Post HTML from the server, made safe to put in the page. */
export const sanitizeHtml = (html: string) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

/** Markdown typed in the admin editor, rendered the way the server will (raw HTML is dropped here, escaped there). */
export const renderMarkdownSafe = (md: string) => sanitizeHtml(marked.parse(md, { async: false }) as string);

/** The public address of a post, for sharing (absolute: a decoy host doesn't serve the blog). */
export const postUrl = (slug: string) => `https://fracit.al/blog/${encodeURIComponent(slug)}`;

export const postDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
