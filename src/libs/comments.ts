import { meFetch } from "./auth";

/** What a comment is on: a song (its title) or an album (its name), by the main artist. */
export interface CommentTarget {
	kind: "song" | "album";
	name: string;
	artist: string;
}

export interface MusicComment {
	id: number;
	body: string;
	at: string;
	editedAt: string | null;
	user: { id: string; name: string; image: string | null; username: string | null };
	/** The viewer wrote it (so they can edit it). */
	mine: boolean;
	/** The viewer can delete it (theirs, or they're an admin). */
	canDelete: boolean;
	likes: number;
	/** The viewer liked it. */
	liked: boolean;
	/** Written by a member of the song's (or album's) verified artist page. */
	byArtist: boolean;
	/** The viewer follows its author. */
	followed: boolean;
}

export type CommentSort = "newest" | "oldest" | "top" | "relevant" | "friends";
export type CommentFilter = "mine" | "artist" | "timestamps";

/** How to list comments: the order, an optional filter, and optionally only one person's. */
export interface CommentListOptions {
	sort: CommentSort;
	filter?: CommentFilter;
	/** A user id: only their comments. */
	by?: string;
}

export interface CommentPage {
	comments: MusicComment[];
	more: boolean;
	total: number;
	viewer: { signedIn: boolean; isAdmin: boolean };
}

export interface ReportedComment extends MusicComment {
	kind: "song" | "album";
	target: string;
	reports: number;
	reasons: string[];
	lastReport: string;
}

const query = (target: CommentTarget, options: CommentListOptions, offset: number) =>
	new URLSearchParams({ kind: target.kind, name: target.name, artist: target.artist, sort: options.sort, ...(options.filter ? { filter: options.filter } : {}), ...(options.by ? { by: options.by } : {}), ...(offset ? { offset: String(offset) } : {}) });

/** Song and album comments: anyone reads them; posting, editing, deleting and reporting need an account. */
export const comments = {
	list: (target: CommentTarget, options: CommentListOptions, offset = 0) => meFetch<CommentPage>(`/api/comments?${query(target, options, offset)}`),
	like: (id: number, liked: boolean) => meFetch<{ ok: true }>(`/api/me/comments/${id}/like`, { method: liked ? "POST" : "DELETE" }),
	follow: (userId: string, following: boolean) => meFetch<{ ok: true }>(`/api/me/follows/${encodeURIComponent(userId)}`, { method: following ? "POST" : "DELETE" }),
	post: (target: CommentTarget, body: string) => meFetch<{ comment: MusicComment }>("/api/me/comments", { method: "POST", body: JSON.stringify({ ...target, body }) }),
	edit: (id: number, body: string) => meFetch<{ comment: MusicComment }>(`/api/me/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
	remove: (id: number) => meFetch<{ ok: true }>(`/api/me/comments/${id}`, { method: "DELETE" }),
	report: (id: number, reason?: string) => meFetch<{ ok: true; reported: boolean }>(`/api/me/comments/${id}/report`, { method: "POST", body: JSON.stringify({ reason }) }),
	/** Admins: reported comments, most reported first. */
	reports: () => meFetch<{ reports: ReportedComment[] }>("/api/admin/comment-reports"),
	dismiss: (id: number) => meFetch<{ ok: true }>(`/api/admin/comment-reports/${id}`, { method: "DELETE" }),
};

/** "just now", "5m", "3h", "2d", then the date. */
export const commentAge = (iso: string) => {
	const s = (Date.now() - new Date(iso).getTime()) / 1000;
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
	return new Date(iso).toLocaleDateString();
};
