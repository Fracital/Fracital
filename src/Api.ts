import { meFetch, refreshMe } from "./libs/auth";
import { applySettingsDefaults } from "./libs/updater";
import { startScrobbler } from "./libs/scrobbler";
import { startDiscordPresence } from "./libs/discordPresence";
import { initRadio } from "./libs/radio";
import { useSettingsStore } from "./store";
import { getLogin, SettingsPath, ThemePath, wispURL, type COM } from "./types";
import { libcurl } from "libcurl.js";

declare const fr: COM;
declare const __BUILD_STAMP__: string;
declare global {
	interface Window {
		fr: COM;
	}
}

/** filer.min.js loads async (index.html) so it doesn't hold up the app's first paint; it's needed from here on. */
const filerReady = () =>
	typeof Filer !== "undefined"
		? Promise.resolve()
		: new Promise<void>((resolve, reject) => {
				const script = document.querySelector<HTMLScriptElement>('script[src$="/filer.min.js"]');
				if (!script) return reject(new Error("Filer script is missing"));
				script.addEventListener("load", () => resolve(), { once: true });
				script.addEventListener("error", () => reject(new Error("Filer failed to load")), { once: true });
			});

export const Api = async () => {
	await filerReady();
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
					// Settings saved by an older version lack newer keys; add their defaults.
					await applySettingsDefaults();
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
		// The name carries the build's stamp, like every vendored file the build rewrites (vite.config.ts buildStamp).
		void libcurl.load_wasm(`/vendor/net.${__BUILD_STAMP__}.wasm`).catch(error => console.error("Failed to load libcurl WASM:", error));

		startScrobbler();
		startDiscordPresence();
		initRadio();
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
