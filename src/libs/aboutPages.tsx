import { type ReactNode } from "react";
import { Cog6ToothIcon, MusicalNoteIcon, FolderIcon, UserCircleIcon, PlayIcon, GlobeAltIcon } from "@heroicons/react/24/solid";

import Home from "../views/Home";
import Settings from "../views/Settings";
import { MusicLibrary } from "../views/Music/MusicLibrary";
import Files from "../views/Files/Files";
import { Login } from "../views/Login";
import Games from "../views/Games";

export interface AboutPage {
	name: string;
	component: React.ComponentType<any>;
	icon?: ReactNode;
	title?: string;
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
		icon: <FolderIcon className="size-5" />,
		title: "Music Library",
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
		component: Login,
		icon: <UserCircleIcon className="size-5" />,
		title: "Account Management",
		hasQuery: true,
	},
};

export const getPageFromUrl = (url: string): string | null => {
	if (!url.includes("about:")) return null;
	return url.replace("about:", "").split("?")[0];
};

export const getQueryFromUrl = (url: string): string | undefined => {
	if (!url.includes("?")) return undefined;
	const queryString = url.split("?")[1];
	if (!queryString.includes("=")) {
		return queryString;
	}
	return queryString;
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
	}
) => {
	const pageConfig = aboutPages[pageName];
	if (!pageConfig) return;

	const baseUrl = `about:${pageName}`;
	const url = options?.query ? `${baseUrl}?${options.query}` : baseUrl;
	const title = options?.title || pageConfig.title || pageName;

	// Dispatch navigation event
	const event = new CustomEvent("proxy-navigate", {
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
