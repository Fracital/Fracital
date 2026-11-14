/**
 * What the first paint needs before Filer (IndexedDB, async) has been read: the theme, the tab layout settings and
 * who's signed in. Copied to localStorage whenever the real ones change, so the loading skeleton and the app's first
 * render show the user's own theme, layout and account instead of the defaults. Kept dependency-free: the skeleton
 * and main.tsx import it.
 */

export interface BootLayout {
	/** Big Screen tabs (the tab view). */
	tabView: boolean;
	/** The compact icon rail. */
	compact: boolean;
	tabsLeft: boolean;
}

export interface BootAccount {
	id: string;
	display: string;
	handle: string;
	avatar: string | null;
}

export interface BootTheme {
	name: string;
	brightness: string;
	css: string;
}

const THEME_KEY = "fracital:boot-theme";
const LAYOUT_KEY = "fracital:boot-layout";
/** A bigger theme isn't copied; it shows once Filer is read. */
const THEME_CSS_MAX = 256 * 1024;
/** The theme's <style>: put in by applyBootTheme, then reused (and replaced) by theme.ts. */
export const BOOT_THEME_ID = "theme-style";
const ACCOUNT_KEY = "fracital:boot-account";
/** A bigger avatar (a data URL) isn't copied; the top bar shows it once Filer is read. */
const AVATAR_MAX = 64 * 1024;

const read = <T>(key: string): T | null => {
	try {
		return JSON.parse(localStorage.getItem(key) || "null");
	} catch {
		return null;
	}
};

const write = (key: string, value: unknown) => {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Private mode or full: the first paint just shows the defaults.
	}
};

export const readBootLayout = (): BootLayout | null => {
	if (typeof window === "undefined") return null;
	const saved = read<BootLayout>(LAYOUT_KEY);
	return saved && typeof saved.tabView === "boolean" ? saved : null;
};

/** From settings.json's keys. */
export const writeBootLayout = (settings: Record<string, unknown>) => {
	const next: BootLayout = { tabView: settings["tab-view"] === true, compact: settings["compact-tabs"] === true, tabsLeft: settings["tabs-position"] === "left" };
	const saved = readBootLayout();
	if (!saved || saved.tabView !== next.tabView || saved.compact !== next.compact || saved.tabsLeft !== next.tabsLeft) write(LAYOUT_KEY, next);
};

/** The settings.json keys the copy stands in for. */
export const bootLayoutSettings = (layout: BootLayout) => ({ "tab-view": layout.tabView, "compact-tabs": layout.compact, "tabs-position": layout.tabsLeft ? "left" : "right" });

export const readBootAccount = (): BootAccount | null => {
	if (typeof window === "undefined") return null;
	const saved = read<BootAccount>(ACCOUNT_KEY);
	return saved && typeof saved.id === "string" && typeof saved.display === "string" ? saved : null;
};

export const writeBootAccount = (account: { id: string; display: string; handle: string; avatar?: unknown } | null) =>
	write(ACCOUNT_KEY, account && { id: account.id, display: account.display, handle: account.handle, avatar: typeof account.avatar === "string" && account.avatar.length <= AVATAR_MAX ? account.avatar : null });

export const readBootTheme = (): BootTheme | null => {
	if (typeof window === "undefined") return null;
	const saved = read<BootTheme>(THEME_KEY);
	return saved && typeof saved.css === "string" && typeof saved.name === "string" ? saved : null;
};

export const writeBootTheme = (theme: BootTheme) => {
	const saved = readBootTheme();
	if (saved && saved.name === theme.name && saved.brightness === theme.brightness && saved.css === theme.css) return;
	write(THEME_KEY, theme.css.length <= THEME_CSS_MAX ? theme : null);
};

/** Puts last time's theme in before anything renders (into the cloak's shadow root when there is one, as theme.ts does). */
export const applyBootTheme = (shadow: ShadowRoot | null) => {
	const theme = readBootTheme();
	if (!theme || (shadow ?? document).getElementById(BOOT_THEME_ID)) return;
	const style = document.createElement("style");
	style.id = BOOT_THEME_ID;
	style.textContent = shadow ? theme.css.replace(/:root\b/g, ":host") : theme.css;
	(shadow ?? document.head).appendChild(style);
};

/** The settings.json keys the copies stand in for, until it's read. */
export const bootSettings = () => {
	const layout = readBootLayout();
	const theme = readBootTheme();
	return { ...(layout ? bootLayoutSettings(layout) : {}), ...(theme ? { theme: theme.name, brightness: theme.brightness } : {}) };
};
