import { writeBootAccount } from "./libs/bootCache";
import type { libcurl } from "libcurl.js";

declare global {
	interface Window {
		Filer: FilerType;
		loadLock: boolean;
		/** Server-injected client config (see src/server/relay-gate.ts). */
		__FRX_CFG__?: { relay?: string; talk?: string };
	}
}

// For webOS Builds of Fracital
export const ThemePath = "/themes/";
export const StaticThemePath = "/themes";
export const SettingsPath = "/settings.json";
export const MusicPath = "/music/";
export const GamesPath = "/games/";
export const isWebOS = false;
// Relay path comes from the server-injected config (gated, neutral name);
// the legacy literal is only a fallback for local dev without a gate key.
const relayPath = typeof window !== "undefined" ? window.__FRX_CFG__?.relay || "/wisp/" : "/wisp/";
export const wispURL = typeof window !== "undefined" && window.location && window.location.origin ? `${window.location.origin.replace(/^https?:\/\//, window.location.protocol === "https:" ? "wss://" : "ws://")}${relayPath}` : "";
// The signed-in account lives in /account.json; bootCache keeps a synchronous copy for the first paint.
export const saveLogin = async ({ id, display, handle, avatar }: { id: string; display: string; handle: string; avatar: string | any }) => {
	await window.fr.fs.promises.writeFile("/account.json", JSON.stringify({ id, display, handle, avatar }), "utf8");
	writeBootAccount({ id, display, handle, avatar });
};
export const getLogin = async (): Promise<{ id: string; display: string; handle: string; avatar: string | any } | null> => {
	const login = (await fileExists("/account.json")) ? JSON.parse(await window.fr.fs.promises.readFile("/account.json", "utf8")) : null;
	writeBootAccount(login);
	return login;
};
export const clearLogin = async (): Promise<void> => {
	writeBootAccount(null);
	if (await fileExists("/account.json")) {
		await window.fr.fs.promises.unlink("/account.json");
	}
};

/** The proxy engines a tab can run on: Scramjet (default), UV, and stomp ("st", behind the experimental proxies setting). */
export type ProxyEngine = "sj" | "uv" | "st";
export const PROXY_ENGINES: readonly ProxyEngine[] = ["sj", "uv", "st"];
export const EXPERIMENTAL_PROXIES_SETTING = "experimental-proxies";
/** Renders the tabs in the tab view instead of the side panel. */
export const TAB_VIEW_SETTING = "tab-view";
/** Closing a group also closes its tabs. Off (the default), they stay open, out of any group. */
export const CLOSE_GROUP_TABS_SETTING = "close-group-tabs";
/** Groups show first and tabs in no group after them, instead of mixed in the order the user put them. */
export const GROUPS_ON_TOP_SETTING = "groups-on-top";
export const isProxyEngine = (value: unknown): value is ProxyEngine => typeof value === "string" && (PROXY_ENGINES as readonly string[]).includes(value);

export const getProxy = async (): Promise<ProxyEngine> => {
	try {
		if (!window.fr?.fs) return "sj";
		const data = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
		return isProxyEngine(data.proxy) ? data.proxy : "sj";
	} catch {
		return "sj";
	}
};

export const changeProxy = async (proxy: ProxyEngine): Promise<void> => {
	try {
		if (!window.fr?.fs) return;
		const data = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
		data.proxy = proxy;
		await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify(data, null, 2), "utf8");
	} catch (error) {
		console.error("Failed to save proxy selection:", error);
	}
};

export const dirExists = async (path: string): Promise<boolean> => {
	return new Promise(resolve => {
		if (typeof window.fr === "undefined" || typeof window.fr.fs === "undefined") return resolve(false);
		window.fr.fs.stat(path, (err: any, stats: any) => {
			if (err) {
				if (err.code === "ENOENT") {
					resolve(false);
				} else {
					console.error(err);
					resolve(false);
				}
			} else {
				const exists = stats.type === "DIRECTORY";
				resolve(exists);
			}
		});
	});
};

export const fileExists = async (path: string): Promise<boolean> => {
	return new Promise(resolve => {
		if (typeof window.fr === "undefined" || typeof window.fr.fs === "undefined") return resolve(false);
		window.fr.fs.stat(path, (err: any, stats: any) => {
			if (err) {
				if (err.code === "ENOENT") {
					resolve(false);
				} else {
					console.error(err);
					resolve(false);
				}
			} else {
				const exists = stats.type === "FILE";
				resolve(exists);
			}
		});
	});
};

export interface COM {
	theme: {
		getTheme: () => any;
		setTheme: (name: string) => Promise<boolean>;
	};
	dialog: {
		prompt: (options: { title: string; message: string; defaultValue?: string; onOk: (value: string) => void }) => void;
		alert: (options: { title: string; message: string; onOk?: () => void }) => void;
	};
	fs: FilerFS;
	buffer: any;
	sh: any;
	net: typeof libcurl;
	sync: {
		get: () => Promise<any>;
		set: () => Promise<void>;
		syncing: boolean;
	};
}

export interface SongProps {
	title: string;
	artist: string;
	album: string;
	genre: string;
	year: string;
	cover: string | any;
	src: string;
}

export interface Track {
	id: string;
	folderName?: string;
	title: string;
	artists: string | string[];
	album: string;
	genre: string;
	year: string | Date;
	cover: string;
	explicit: boolean;
	src?: string;
	/** Set for tracks streamed from the Digital Library, which can link back to their artist/album pages. */
	source?: "digital-library";
	artistId?: string;
	albumId?: string;
	/** The Digital Library track id (stable; `id` is re-generated per queue entry). */
	libraryId?: string;
	/** Queued by radio (replaced when the station re-tunes); unset for songs the user queued. */
	radio?: boolean;
}
