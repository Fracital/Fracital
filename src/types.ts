declare global {
	interface Window {
		Filer: FilerType;
	}
}

if (typeof sessionStorage === 'undefined') {
	(globalThis as any).sessionStorage = {
		length: 0,
		clear: () => {},
		getItem: (_key: string) => null,
		key: (_index: number) => null,
		removeItem: (_key: string) => {},
		setItem: (_key: string, _value: string) => {},
	};
}
if (typeof location === 'undefined') {
	(globalThis as any).location = {
		pathname: "/",
	};
}

// For webOS Builds of Fracital
export const ThemePath = `/apps/user/${sessionStorage.getItem("currAcc")}/Fracital/themes/`;
export const StaticThemePath = `${location.pathname.replace("index.html", "")}/themes/`;
export const SettingsPath = `/apps/user/${sessionStorage.getItem("currAcc")}/Fracital/settings.json`;
export const MusicPath = `/home/${sessionStorage.getItem("currAcc")}/music/`;
export const isWebOS = true;

export const getProxy = async (): Promise<"sj" | "uv"> => {
	const data = JSON.parse(await window.fr.fs.promises.readFile(`/home/${sessionStorage.getItem("currAcc")}/settings.json`, "utf8"));
	const actualproxy = data.proxy === "Scramjet" ? "sj" : data.proxy === "Ultraviolet" ? "uv" : "sj";
	return actualproxy;
};

export const changeProxy = async (proxy: "sj" | "uv"): Promise<void> => {
	const data = JSON.parse(await window.fr.fs.promises.readFile(`/home/${sessionStorage.getItem("currAcc")}/settings.json`, "utf8"));
	data.proxy = proxy === "sj" ? "Scramjet" : proxy === "uv" ? "Ultraviolet" : "Scramjet";
	await window.fr.fs.promises.writeFile(`/home/${sessionStorage.getItem("currAcc")}/settings.json`, JSON.stringify(data, null, 4), "utf8");
}

export const dirExists = async (path: string): Promise<boolean> => {
	return new Promise(resolve => {
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
