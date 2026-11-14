import { useSettingsStore } from "../store";
import { SettingsPath, StaticThemePath, ThemePath } from "../types";
import { BOOT_THEME_ID, writeBootTheme } from "./bootCache";
import { getCloakShadowRoot } from "./cloak";

let styleElement: HTMLStyleElement | null = null;

const BUNDLED_THEMES = ["default", "light", "amber", "greyscale"];

// Older builds fetched /themes//<name>.css and saved the 404 body into Filer as the theme.
const isBrokenTheme = (css: string) => !css.includes("{");

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
			if (isBrokenTheme(themeBuffer)) {
				if (!BUNDLED_THEMES.includes(name)) throw new Error(`Theme ${name} is not valid CSS`);
				const response = await fetch(`${StaticThemePath}/${name}.css`);
				if (!response.ok) throw new Error(`Theme repair returned HTTP ${response.status}`);
				themeBuffer = await response.text();
				await window.fr.fs.promises.writeFile(`${ThemePath}/${name}/index.css`, themeBuffer);
			}
		} catch {
			const fallbackName = name === "light" ? "light" : "default";
			const response = await fetch(`${StaticThemePath}/${fallbackName}.css`);
			if (!response.ok) throw new Error(`Theme fallback returned HTTP ${response.status}`);
			themeBuffer = await response.text();
			brightness = fallbackName === "light" ? "light" : "dark";
		}

		// On decoy hosts the theme goes straight into the shadow root, where :root never matches
		// and a <head> copy would also restyle the decoy page. main.tsx may have put last time's there already.
		const shadow = getCloakShadowRoot();
		styleElement ??= (shadow ?? document).getElementById(BOOT_THEME_ID) as HTMLStyleElement | null;
		if (!styleElement) {
			styleElement = document.createElement("style");
			styleElement.id = BOOT_THEME_ID;
			(shadow ?? document.head).appendChild(styleElement);
		}
		styleElement.textContent = shadow ? themeBuffer.replace(/:root\b/g, ":host") : themeBuffer;
		setSettings("theme", name);
		setSettings("brightness", brightness);
		writeBootTheme({ name, brightness, css: themeBuffer });

		try {
			// Only a change is written: at startup the theme comes from settings.json, which the updater may be writing.
			const settings = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
			if (settings.theme !== name) {
				settings.theme = name;
				await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify(settings, null, 4));
			}
		} catch (error) {
			console.warn("Failed to persist selected theme:", error);
		}

		console.log(`Theme ${name} loaded successfully.`);
	} catch (error) {
		console.error(`Failed to load theme ${name}:`, error);
	}
};
