declare global {
	interface Window {
		Filer: FilerType;
	}
}

// For webOS Builds of Fracital
export const ThemePath = "/themes/";
export const StaticThemePath = "/themes/";
export const SettingsPath = "/settings.json";
export const MusicPath = "/music/";
export const isWebOS = false;

export const getProxy = async (): Promise<"sj" | "uv"> => {
	const data = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
	return data.proxy;
};

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
