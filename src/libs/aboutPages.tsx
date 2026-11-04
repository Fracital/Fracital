import { type ReactNode } from "react";
import { createId } from "@paralleldrive/cuid2";
import { useTabsStore } from "../store";
import { Cog6ToothIcon, MusicalNoteIcon, FolderIcon, UserCircleIcon, PlayIcon, PlayCircleIcon, GlobeAltIcon, DocumentIcon, SignalIcon, CheckBadgeIcon, ShieldCheckIcon } from "@heroicons/react/24/solid";

import Home from "../views/Home";
import Settings from "../views/Settings";
import { MusicLibrary } from "../views/Music/MusicLibrary";
import { MusicPlayer } from "../views/Music/MusicPlayer";
import Files from "../views/Files/Files";
import { Account } from "../views/Account";
import { ArtistPanel } from "../views/ArtistPanel";
import { AdminDashboard } from "../views/AdminDashboard";
import Games from "../views/Games";
import { TextEditor } from "../views/TextEditor";
import { DigitalLibrary } from "../views/DigitalLibrary";

export interface AboutPage {
	name: string;
	component: React.ComponentType<any>;
	icon?: ReactNode;
	title?: string;
	/** Tab title for a given query, when it depends on the section shown. */
	titleFor?: (query: string | undefined) => string;
	queryFields?: string[];
	hasQuery?: boolean;
}

/**
 * Central registry for all about: pages.
 *
 * To add a new page:
 * 1. Import your component at the top of this file
 * 2. Add an entry to this object with your page name as the key
 * 3. That's it! The page will automatically be rendered when navigating to about:yourpage
 *
 * Example:
 * ```ts
 * import MyNewPage from "../views/MyNewPage";
 *
 * mypage: {
 *   name: "mypage",
 *   component: MyNewPage,
 *   icon: <SomeIcon className="size-5" />,
 *   title: "My Page Title",
 *   hasQuery: true  // if your page uses URL query params
 * }
 * ```
 */
export const aboutPages: Record<string, AboutPage> = {
	newtab: {
		name: "newtab",
		component: Home,
		icon: <GlobeAltIcon className="size-5" />,
		title: "New Tab",
	},
	settings: {
		name: "settings",
		component: Settings,
		icon: <Cog6ToothIcon className="size-5" />,
		title: "Settings",
	},
	music: {
		name: "music",
		component: MusicLibrary,
		icon: <MusicalNoteIcon className="size-5" />,
		title: "Music",
		// The Digital Library is the default section (about:music, about:music?digilib&…).
		titleFor: query => (/^(library|upload)(&|$)/.test(query ?? "") ? "Music" : "Digital Library"),
		hasQuery: true,
	},
	player: {
		name: "player",
		component: MusicPlayer,
		icon: <PlayCircleIcon className="size-5" />,
		title: "Music Player",
		hasQuery: true,
	},
	files: {
		name: "files",
		component: Files,
		icon: <FolderIcon className="size-5" />,
		title: "Files",
		hasQuery: true,
	},
	games: {
		name: "games",
		component: Games,
		icon: <PlayIcon className="size-5" />,
		title: "Games",
		hasQuery: true,
	},
	account: {
		name: "account",
		component: Account,
		icon: <UserCircleIcon className="size-5" />,
		title: "Fracital Account",
		hasQuery: true,
	},
	text: {
		name: "text",
		component: TextEditor,
		icon: <DocumentIcon className="size-5" />,
		title: "Text Editor",
		queryFields: ["path"],
		hasQuery: true,
	},
	artists: {
		name: "artists",
		component: ArtistPanel,
		icon: <CheckBadgeIcon className="size-5" />,
		title: "Fracital for Artists",
		hasQuery: true,
	},
	admin: {
		name: "admin",
		component: AdminDashboard,
		icon: <ShieldCheckIcon className="size-5" />,
		title: "Admin Dashboard",
		hasQuery: true,
	},
	// Legacy: about:library URLs are rewritten to about:music?digilib (see aboutAlias.ts).
	library: {
		name: "library",
		component: DigitalLibrary,
		icon: <SignalIcon className="size-5" />,
		title: "Digital Library",
		hasQuery: true,
	},
};

/** Focuses the existing Music tab on its Digital Library section (navigating it to `query`) or opens a new one. */
export const openLibraryPage = (query: string, title?: string) => {
	const { tabs, setCurrentTab, newTab } = useTabsStore.getState();
	const full = query ? `digilib&${query}` : "digilib";
	const existing = tabs.find(t => t.current && getPageFromUrl(t.url) === "music") ?? tabs.find(t => getPageFromUrl(t.url) === "music");
	if (existing) {
		setCurrentTab(existing.id);
		updatePageTab(existing.id, "music", { query: full, title: title || "Digital Library" });
		return;
	}
	const url = `about:music?${full}`;
	newTab({ id: createId(), title: title || "Digital Library", icon: aboutPages.music.icon, url, displayUrl: url });
};

export const getPageFromUrl = (url: string): string | null => {
	if (!url.includes("about:")) return null;
	return url.replace("about:", "").split("?")[0];
};

export const getQueryFromUrl = (url: string): string | undefined => {
	if (!url.includes("?")) return undefined;
	return url.split("?")[1];
};

/**
 * Updates a tab's title and URL based on the current page state.
 * This should be called by pages when their content changes (e.g., selecting a specific item).
 *
 * @param tabId - The ID of the tab to update
 * @param pageName - The name of the about page (e.g., "games", "music")
 * @param options - Optional parameters for custom title/URL
 */
export const updatePageTab = (
	tabId: string,
	pageName: string,
	options?: {
		title?: string;
		query?: string;
	},
) => {
	const pageConfig = aboutPages[pageName];
	if (!pageConfig) return;

	const baseUrl = `about:${pageName}`;
	const url = options?.query ? `${baseUrl}?${options.query}` : baseUrl;
	const title = options?.title || pageConfig.title || pageName;

	// Dispatch navigation event
	const event = new CustomEvent("navigate", {
		detail: {
			url,
			title,
			icon: pageConfig.icon,
			displayUrl: url,
			id: tabId,
		},
	});
	window.dispatchEvent(event);
};
