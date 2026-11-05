/** Client for Fracital for Artists (artist panel) and the admin dashboard. */
import { meFetch } from "./auth";
import { compressImage, IMAGE_PRESETS } from "./compressImage";
import type { ArtistLinkKind } from "./music-service";

export type PageRole = "owner" | "admin" | "editor";

export interface ArtistFont {
	family: string;
	source: "google" | "upload";
	url?: string;
}

export interface ArtistPick {
	title: string;
	artist: string;
	artwork?: string;
	trackId?: string;
	albumId?: string;
	note?: string;
}

export interface ArtistProfile {
	artistId: string;
	name: string;
	verified: boolean;
	bio: string | null;
	banner: string | null;
	photos: string[];
	logo: string | null;
	font: ArtistFont | null;
	links: { kind: ArtistLinkKind; url: string }[] | null;
	pick: ArtistPick | null;
	announcement: string | null;
	updatedAt?: string;
}

export type ProfileEdit = Partial<Omit<ArtistProfile, "artistId" | "verified" | "updatedAt">>;

export interface Claim {
	id: number;
	artistId: string;
	artistName: string;
	status: "pending" | "approved" | "rejected";
	roleTitle: string;
	adminNote: string | null;
	createdAt: string;
	reviewedAt: string | null;
}

export interface ArtistStats {
	totalPlays: number;
	plays28: number;
	plays7: number;
	listeners28: number;
	listenersTotal: number;
	saves: number;
	topSongs: { title: string; plays: number; listeners: number }[];
	daily: { day: string; plays: number }[];
}

export interface Member {
	userId: string;
	role: PageRole;
	name: string;
	email: string | null;
	image: string | null;
	since: string;
}

const profileCache = new Map<string, Promise<ArtistProfile | null>>();

/** Public: the artist's customizations (null when unclaimed). */
export function getArtistProfile(artistId: string, fresh = false): Promise<ArtistProfile | null> {
	if (fresh) profileCache.delete(artistId);
	let p = profileCache.get(artistId);
	if (!p) {
		p = fetch(`/api/artist-profile/${encodeURIComponent(artistId)}`)
			.then(r => (r.ok ? r.json() : { profile: null }))
			.then(r => (r as { profile: ArtistProfile | null }).profile)
			.catch(() => null);
		profileCache.set(artistId, p);
	}
	return p;
}

export const FONT_STACK = (font: ArtistFont | null | undefined) => (font ? `"${font.family}", system-ui, sans-serif` : undefined);

/** Body text on artist pages (bio, announcement, notes): readable, while the artist's own font is kept for their name. */
export const TEXT_STACK = '"Instrument Sans", system-ui, sans-serif';

let textFontLoaded = false;
export function loadTextFont() {
	if (textFontLoaded) return;
	textFontLoaded = true;
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap";
	document.head.appendChild(link);
}

const loadedFonts = new Set<string>();

/** Loads an artist's font (Google Fonts or an uploaded file) so it can be used by family name. */
export function loadArtistFont(font: ArtistFont | null | undefined) {
	if (!font || loadedFonts.has(font.family)) return;
	loadedFonts.add(font.family);
	if (font.source === "google") {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, "+")}:wght@400;700;900&display=swap`;
		document.head.appendChild(link);
	} else if (font.url) {
		// Add before loading so document.fonts tracks it (fires "loadingdone" for anything sized to it).
		const face = new FontFace(font.family, `url(${font.url})`);
		document.fonts.add(face);
		face.load().catch(() => {
			document.fonts.delete(face);
			loadedFonts.delete(font.family);
		});
	}
}

/** Popular Google Fonts offered in the picker (any Google Font name also works). */
export const GOOGLE_FONTS = [
	"Inter",
	"Bebas Neue",
	"Anton",
	"Oswald",
	"Montserrat",
	"Poppins",
	"Archivo Black",
	"Space Grotesk",
	"Syne",
	"Unbounded",
	"Righteous",
	"Bungee",
	"Monoton",
	"Rubik Mono One",
	"Press Start 2P",
	"Permanent Marker",
	"Rock Salt",
	"Pacifico",
	"Lobster",
	"Playfair Display",
	"Cinzel",
	"UnifrakturMaguntia",
	"Metal Mania",
	"Creepster",
	"Space Mono",
];

// --- Signed-in artist panel ---

export const panel = {
	overview: () => meFetch<{ isAdmin: boolean; pages: { artistId: string; role: PageRole; name: string; verified: boolean; image: string | null }[]; claims: Claim[] }>("/api/me/artist-panel"),
	claim: (body: { artistId: string; artistName: string; roleTitle: string; contactEmail: string; proofLinks: string[]; message: string }) => meFetch<{ ok: boolean }>("/api/me/claims", { method: "POST", body: JSON.stringify(body) }),
	cancelClaim: (id: number) => meFetch(`/api/me/claims/${id}`, { method: "DELETE" }),
	page: (artistId: string) => meFetch<{ role: PageRole; profile: ArtistProfile | null; members: Member[]; invites: { code: string; role: PageRole; createdAt: string; expiresAt: string }[] }>(`/api/me/artist-panel/${encodeURIComponent(artistId)}`),
	save: (artistId: string, edit: ProfileEdit) =>
		meFetch<{ profile: ArtistProfile }>(`/api/me/artist-panel/${encodeURIComponent(artistId)}/profile`, { method: "PUT", body: JSON.stringify(edit) }).then(r => {
			profileCache.delete(artistId);
			return r;
		}),
	/** Images are compressed in the browser first (any size works); fonts upload as-is. */
	upload: async (artistId: string, input: File, kind: "image" | "font", preset: keyof typeof IMAGE_PRESETS = "photo") => {
		const file = kind === "image" ? await compressImage(input, IMAGE_PRESETS[preset]) : input;
		const res = await fetch(`/api/me/artist-panel/${encodeURIComponent(artistId)}/media?kind=${kind}`, { method: "POST", credentials: "include", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
		const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
		if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
		return data.url;
	},
	stats: (artistId: string) => meFetch<ArtistStats>(`/api/me/artist-panel/${encodeURIComponent(artistId)}/stats`),
	invite: (artistId: string, role: "admin" | "editor") => meFetch<{ code: string }>(`/api/me/artist-panel/${encodeURIComponent(artistId)}/invites`, { method: "POST", body: JSON.stringify({ role }) }),
	revokeInvite: (artistId: string, code: string) => meFetch(`/api/me/artist-panel/${encodeURIComponent(artistId)}/invites/${code}`, { method: "DELETE" }),
	removeMember: (artistId: string, userId: string) => meFetch(`/api/me/artist-panel/${encodeURIComponent(artistId)}/members/${userId}`, { method: "DELETE" }),
	inviteInfo: (code: string) => meFetch<{ artistId: string; artistName: string | null; role: PageRole }>(`/api/me/artist-invites/${code}`),
	acceptInvite: (code: string) => meFetch<{ artistId: string }>(`/api/me/artist-invites/${code}/accept`, { method: "POST" }),
};

// --- Admin ---

export interface AdminClaim extends Claim {
	contactEmail: string;
	proofLinks: string[];
	message: string;
	existingMembers: number;
	user: { id: string; name: string; email: string; image: string | null; createdAt: string };
}

export interface AdminUser {
	id: string;
	name: string;
	email: string;
	image: string | null;
	createdAt: string;
	lastSeen: string | null;
	role: "admin" | "user";
	adminByEnv: boolean;
	banned: boolean;
	banReason: string | null;
	username: string | null;
	premium: boolean;
	pages: number;
	claims: number;
}

export const admin = {
	overview: () =>
		meFetch<{
			users: number;
			new_users7: number;
			pending_claims: number;
			verified_artists: number;
			plays1: number;
			plays7: number;
			plays28: number;
			listeners7: number;
			banned: number;
			topArtists: { artist: string; plays: number }[];
			daily: { day: string; plays: number }[];
		}>("/api/admin/overview"),
	claims: (status: "pending" | "approved" | "rejected") => meFetch<{ claims: AdminClaim[] }>(`/api/admin/claims?status=${status}`),
	review: (id: number, action: "approve" | "reject", note: string) => meFetch(`/api/admin/claims/${id}`, { method: "POST", body: JSON.stringify({ action, note }) }),
	artists: () => meFetch<{ artists: { artistId: string; name: string; verified: boolean; verifiedAt: string | null; updatedAt: string; image: string | null; members: { userId: string; name: string; role: PageRole }[] }[] }>("/api/admin/artists"),
	revoke: (artistId: string) => meFetch(`/api/admin/artists/${encodeURIComponent(artistId)}/revoke`, { method: "POST" }),
	verify: (artistId: string, name: string) => meFetch(`/api/admin/artists/${encodeURIComponent(artistId)}/verify`, { method: "POST", body: JSON.stringify({ name }) }),
	removeMember: (artistId: string, userId: string) => meFetch(`/api/admin/artists/${encodeURIComponent(artistId)}/members/${userId}`, { method: "DELETE" }),
	users: (q: string) => meFetch<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
	updateUser: (id: string, change: { role?: "admin" | "user"; banned?: boolean; reason?: string; premium?: boolean }) => meFetch(`/api/admin/users/${id}`, { method: "POST", body: JSON.stringify(change) }),
};

/** A per-browser anonymous id, so Fracital play stats can count unique listeners. */
export function listenerId(): string {
	let id = localStorage.getItem("fracital:listener");
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem("fracital:listener", id);
	}
	return id;
}
