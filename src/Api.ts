import { useSettingsStore } from "./store";
import { ThemePath, type COM } from "./types";

declare const fr: COM;
declare global {
	interface Window {
		fr: COM;
	}
}

export const Api = async () => {
	const settings = useSettingsStore(state => state.settings);
	const getSettings = useSettingsStore(state => state.getSettings);
	const setSettings = useSettingsStore(state => state.setSettings);

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
			}
		},
		fs: Filer.fs,
		buffer: Filer.Buffer,
		sh: new Filer.fs.Shell(),
	};
};
