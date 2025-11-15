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
				window.parent.tb.dialog.Message({
					title,
					message,
					defaultValue,
					onOk: (value: string) => {
						onOk(value);
					},
				});
				return null;
			},
			alert: ({ title, message, onOk }: { title: string; message: string; onOk?: () => void }) => {
				window.parent.tb.dialog.Alert({
					title,
					message,
					onOk: () => {
						if (onOk) onOk();
					},
				});
				return null;
			},
		},
		fs: window.parent.tb.fs,
		buffer: window.parent.tb.buffer,
		sh: window.parent.tb.sh,
	};
};
