import { useSettingsStore } from "../store";
import { SettingsPath, StaticThemePath, ThemePath } from "../types";

let styleElement: HTMLStyleElement | null = null;

export const initTheme = async (nameOverride?: string) => {
	if (!window.fr?.fs) return;

	let name = nameOverride;
	if (!name) {
		try {
			const settings = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
			name = typeof settings.theme === "string" ? settings.theme : "default";
		} catch {
			name = "default";
		}
	}

	name ??= "default";
	await loadTheme(name);
};

export const loadTheme = async (name: string) => {
	const { setSettings } = useSettingsStore.getState();
	try {
		let themeBuffer: string;
		let brightness = "dark";

		try {
			themeBuffer = await window.fr.fs.promises.readFile(`${ThemePath}/${name}/index.css`, "utf8");
			const configBuffer = await window.fr.fs.promises.readFile(`${ThemePath}/${name}/index.json`, "utf8");
			brightness = JSON.parse(configBuffer).brightness ?? "dark";
		} catch {
			const fallbackName = name === "light" ? "light" : "default";
			const response = await fetch(`${StaticThemePath}/${fallbackName}.css`);
			if (!response.ok) throw new Error(`Theme fallback returned HTTP ${response.status}`);
			themeBuffer = await response.text();
			brightness = fallbackName === "light" ? "light" : "dark";
		}

		if (!styleElement) {
			styleElement = document.createElement("style");
			styleElement.id = "theme-style";
			document.head.appendChild(styleElement);
		}
		styleElement.textContent = themeBuffer;
		setSettings("theme", name);
		setSettings("brightness", brightness);

		try {
			const settings = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
			settings.theme = name;
			await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify(settings, null, 4));
		} catch (error) {
			console.warn("Failed to persist selected theme:", error);
		}

		console.log(`Theme ${name} loaded successfully.`);
	} catch (error) {
		console.error(`Failed to load theme ${name}:`, error);
	}
};
