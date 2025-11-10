import { useSettingsStore } from "../store";
import { SettingsPath, ThemePath } from "../types";

let styleElement: HTMLStyleElement | null = null;

export const initTheme = async () => {
	const { getSettings, setSettings } = useSettingsStore.getState();
	const currentTheme = await getSettings("theme");
	if (currentTheme === null) return;
	const configBuffer = JSON.parse(await window.fr.fs.promises.readFile(`${ThemePath}/${currentTheme}/index.json`, "utf8"));
	setSettings("brightness", configBuffer["brightness"]);
	await loadTheme(currentTheme);
};

export const loadTheme = async (name: string) => {
	const { setSettings } = useSettingsStore.getState();
	try {
		const themeBuffer = await window.fr.fs.promises.readFile(`${ThemePath}/${name}/index.css`, "utf8");
		const configBuffer = await window.fr.fs.promises.readFile(`${ThemePath}/${name}/index.json`, "utf8");

		if (!styleElement) {
			styleElement = document.createElement("style");
			styleElement.id = "theme-style";
			document.head.appendChild(styleElement);
		}
		styleElement.textContent = themeBuffer;
		setSettings("theme", name);
		setSettings("brightness", JSON.parse(configBuffer).brightness);
		const settings = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf-8"));
		settings.theme = name;
		await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify(settings, null, 4));
		console.log(`Theme ${name} loaded successfully.`);
	} catch (error) {
		console.error(`Failed to load theme ${name}:`, error);
		return;
	}
};
