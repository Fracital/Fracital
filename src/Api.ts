import { fetcher } from "./libs/auth";
import { useSettingsStore } from "./store";
import { getLogin, SettingsPath, ThemePath, wispURL, type COM } from "./types";
import { libcurl } from "libcurl.js";

declare const fr: COM;
declare global {
	interface Window {
		fr: COM;
	}
}

export const Api = async () => {
	const getSettings = useSettingsStore(state => state.getSettings);
	const setSettings = useSettingsStore(state => state.setSettings);
	if (!window.loadLock) {
		window.loadLock = true;
		await libcurl.load_wasm("https://cdn.jsdelivr.net/npm/libcurl.js@latest/libcurl.wasm");
		libcurl.set_websocket(wispURL as `ws://${string}` | `wss://${string}`);
		if ((await getLogin()) !== null) {
			await window.fr.sync.get();
			window.fr.fs.watch(SettingsPath, async (e: string, _f: string) => {
				if (e === "change" && window.fr.sync.syncing === false) {
					window.fr.sync.set();
				}
			});
		}
	}
	window.fr = {
		theme: {
			getTheme: () => {
				const theme = getSettings("theme");
				return theme;
			},
			setTheme: async (name: string) => {
				if (getSettings("theme") === name) return false;
				const themes = await window.fr.fs.promises.readdir(ThemePath, "utf8");
				if (themes.find(theme => theme === name)) {
					setSettings("theme", name);
					return true;
				} else return false;
			},
		},
		dialog: {
			prompt: ({ title, message, defaultValue, onOk }: { title: string; message: string; defaultValue?: string; onOk: (value: string) => void }) => {
				console.log(title, message);
				const value = window.prompt(message, defaultValue || "");
				if (value !== null) {
					onOk(value);
				}
				return null;
			},
			alert: ({ title, message, onOk }: { title: string; message: string; onOk?: () => void }) => {
				console.log(title, message);
				window.alert(message);
				onOk?.();
			},
		},
		fs: Filer.fs,
		buffer: Filer.Buffer,
		sh: new Filer.fs.Shell(),
		net: libcurl,
		sync: {
			get: async () => {
				window.fr.sync.syncing = true;
				const rp = await fetcher("https://auth.terbiumon.top/kv/retrieve/frac_settings", {
					credentials: "include",
				});
				if (!rp.ok) return false;
				const settings = await rp.json();
				if (!settings.value) {
					window.fr.sync.syncing = false;
					return false;
				}
				await window.fr.fs.promises.writeFile(SettingsPath, settings.value);
				window.fr.sync.syncing = false;
				return true;
			},
			set: async () => {
				window.fr.sync.syncing = true;
				const rp = await fetcher("https://auth.terbiumon.top/kv/set/frac_settings", {
					credentials: "include",
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						value: JSON.stringify(await window.fr.fs.promises.readFile(SettingsPath, "utf8")),
					}),
				});
				window.fr.sync.syncing = false;
				return rp.json();
			},
			syncing: false,
		},
	};
};
