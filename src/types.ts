import type { libcurl } from "libcurl.js";

declare global {
	interface Window {
		Filer: FilerType;
		loadLock: boolean;
	}
}

// For webOS Builds of Fracital
export const ThemePath = "/themes/";
export const StaticThemePath = "/themes/";
export const SettingsPath = "/settings.json";
export const MusicPath = "/music/";
export const GamesPath = "/games/";
export const isWebOS = false;
export const wispURL = typeof window !== "undefined" && window.location && window.location.origin ? `${window.location.origin.replace(/^https?:\/\//, window.location.protocol === "https:" ? "wss://" : "ws://")}/wisp/` : "";
export const saveLogin = async ({ id, display, handle, avatar }: { id: string; display: string; handle: string; avatar: string | any }) => {
	await window.fr.fs.promises.writeFile("/account.json", JSON.stringify({ id, display, handle, avatar }), "utf8");
};
export const getLogin = async (): Promise<{ id: string; display: string; handle: string; avatar: string | any } | null> => {
	if (!(await fileExists("/account.json"))) {
		return null;
	} else {
		return JSON.parse(await window.fr.fs.promises.readFile("/account.json", "utf8"));
	}
};
export const clearLogin = async (): Promise<void> => {
	if (await fileExists("/account.json")) {
		await window.fr.fs.promises.unlink("/account.json");
	}
};

export const getProxy = async (): Promise<"sj" | "uv"> => {
	try {
		if (!window.fr?.fs) return "sj";
		const data = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
		return data.proxy === "uv" ? "uv" : "sj";
	} catch {
		return "sj";
	}
};

export const changeProxy = async (proxy: "sj" | "uv"): Promise<void> => {
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
}
