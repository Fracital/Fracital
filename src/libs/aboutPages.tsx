import { type ReactNode } from "react";
import { Cog6ToothIcon, HomeIcon, MusicalNoteIcon, FolderIcon, UserCircleIcon, RectangleGroupIcon, PuzzlePieceIcon } from "@heroicons/react/24/solid";

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
		icon: <HomeIcon className="size-5" />,
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
		icon: <PuzzlePieceIcon className="size-5" />,
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
	return url.includes("?") ? url.split("?")[1] : undefined;
};
