import { meFetch, refreshMe } from "./libs/auth";
import { startScrobbler } from "./libs/scrobbler";
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
	const { getSettings, setSettings } = useSettingsStore.getState();
	if (!window.loadLock) window.loadLock = false;
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
			// Settings sync with the signed-in Fracital Account (stores the raw settings.json text).
			get: async () => {
				window.fr.sync.syncing = true;
				try {
					const settings = await meFetch<{ value: string | null }>("/api/me/settings");
					if (!settings.value) return false;
					await window.fr.fs.promises.writeFile(SettingsPath, settings.value);
					return true;
				} catch {
					return false;
				} finally {
					window.fr.sync.syncing = false;
				}
			},
			set: async () => {
				window.fr.sync.syncing = true;
				try {
					const value = await window.fr.fs.promises.readFile(SettingsPath, "utf8");
					await meFetch("/api/me/settings", { method: "PUT", body: JSON.stringify({ value }) });
				} catch (err) {
					console.error("Settings sync failed:", err);
				} finally {
					window.fr.sync.syncing = false;
				}
			},
			syncing: false,
		},
	};

	if (!window.loadLock) {
		window.loadLock = true;
		void libcurl
			.load_wasm("https://cdn.jsdelivr.net/npm/libcurl.js@latest/libcurl.wasm")
			.then(() => libcurl.set_websocket(wispURL as `ws://${string}` | `wss://${string}`))
			.catch(error => console.error("Failed to load libcurl WASM:", error));

		startScrobbler();
		void (async () => {
			// Confirm the saved login still has a live session (clears it if it expired).
			if ((await getLogin()) !== null) await refreshMe();
			if ((await getLogin()) !== null) {
				await window.fr.sync.get();
				window.fr.fs.watch(SettingsPath, async (e: string, _f: string) => {
					if (e === "change" && window.fr.sync.syncing === false) void window.fr.sync.set();
				});
			}
		})();
	}
};
