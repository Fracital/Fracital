/**
 * User profiles (src/server/profiles.ts): about:user?<username> and the card a name or avatar opens. Anyone can look;
 * owners pick what shows in their account settings.
 */
import { create } from "zustand";
import type { DiscordActivity } from "./auth";
import { meFetch } from "./auth";
import type { MusicComment } from "./comments";
import { compressImage, IMAGE_PRESETS } from "./compressImage";
import type { MusicTrack } from "./music-service";

export const PROFILE_SECTIONS = ["comments", "artists", "stats", "playlists", "listening", "discord"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** Enough to show someone before their profile loads (a comment's or message's author). */
export interface ProfileUser {
	id: string;
	name: string;
	image: string | null;
	username: string | null;
}

export interface Profile {
	user: ProfileUser & { joinedAt: string };
	/** It's the viewer's own (they see every section, hidden ones too). */
	own: boolean;
	private: boolean;
	/** The owner's hidden sections (only sent to the owner). */
	hidden?: ProfileSection[];
	followers: number;
	following: number;
	followed: boolean;
	// The rest is missing on a private profile (unless it's the viewer's own).
	bio?: string;
	banner?: string | null;
	bannerColor?: string | null;
	interests?: ProfileInterest[];
	/** Their accounts elsewhere (https URLs). */
	links?: string[];
	/** Verified artist pages they're a member of. */
	artistPages?: { artistId: string; name: string }[];
	/** Their comments are shown (loaded separately, a page at a time). */
	comments?: boolean;
	stats?: { streak: number; best: number; comments: number; likesReceived: number; plays: number };
	artists?: { saved: { id: string; name: string; picture: string | null }[]; top: { name: string; plays: number }[] };
	playlists?: { id: string; name: string; count: number; artwork: string[] }[];
	/** null: not listening right now (or not sharing it). */
	listening?: { song: { title: string; artist: string; album?: string; artwork?: string }; at: string } | null;
	/** null: nothing to show from Discord right now. */
	discord?: { status: "online" | "idle" | "dnd" | "offline"; activities: DiscordActivity[] } | null;
}

/** A chip under their name: a game they play or an artist they like (their own words). */
export interface ProfileInterest {
	kind: "game" | "music";
	name: string;
}

export type ProfileComment = MusicComment & { on: { kind: "song" | "album"; name: string; artist: string } };

export interface ProfileSettings {
	bio: string;
	banner: string | null;
	bannerColor: string | null;
	private: boolean;
	hidden: ProfileSection[];
	interests: ProfileInterest[];
	links: string[];
}

const handle = (h: string) => encodeURIComponent(h);

export const profiles = {
	get: (h: string) => meFetch<Profile>(`/api/profiles/${handle(h)}`),
	comments: (h: string, offset = 0) => meFetch<{ comments: ProfileComment[]; more: boolean }>(`/api/profiles/${handle(h)}/comments${offset ? `?offset=${offset}` : ""}`),
	playlist: (h: string, id: string) => meFetch<{ name: string; tracks: MusicTrack[] }>(`/api/profiles/${handle(h)}/playlists/${encodeURIComponent(id)}`),
	settings: () => meFetch<ProfileSettings>("/api/me/public-profile"),
	save: (changes: Partial<Omit<ProfileSettings, "banner">>) => meFetch<ProfileSettings>("/api/me/public-profile", { method: "PUT", body: JSON.stringify(changes) }),
	/** Compressed in the browser first (Compressor.js), so any size of image works. */
	uploadBanner: async (input: File) => {
		const file = await compressImage(input, IMAGE_PRESETS.profileBanner);
		return meFetch<ProfileSettings>("/api/me/public-profile/banner", { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
	},
	removeBanner: () => meFetch<ProfileSettings>("/api/me/public-profile/banner", { method: "DELETE" }),
};

/** The URL of someone's profile page: by username when they have one (shareable), else by account id. */
export const profileUrl = (user: Pick<ProfileUser, "id" | "username">) => `about:user?${encodeURIComponent(user.username ?? user.id)}`;

/** The profile card that's open, and where (the name or avatar it opened from). One at a time, app-wide. */
interface ProfileCardState {
	open: { user: ProfileUser; anchor: { top: number; bottom: number; left: number; right: number } } | null;
	/** Extra actions the place it opened from offers (e.g. "show only their comments" in a comment list). */
	actions: { label: string; onClick: () => void }[];
}

export const useProfileCard = create<ProfileCardState>(() => ({ open: null, actions: [] }));

/** Opens someone's profile card next to the element that was clicked. */
export const openProfileCard = (user: ProfileUser, from: Element, actions: ProfileCardState["actions"] = []) => {
	const r = from.getBoundingClientRect();
	useProfileCard.setState({ open: { user, anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }, actions });
};

export const closeProfileCard = () => useProfileCard.setState({ open: null, actions: [] });
