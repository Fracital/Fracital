/**
 * Keeps each browser's local Fracital data (settings.json, built-in themes, quick links, bundled games)
 * up to date with the deployed app, so new defaults and fixes reach existing users without them
 * resetting or re-downloading anything. Runs on every boot from init().
 *
 * - New settings: add the key and its default to DEFAULT_SETTINGS. Existing values are never overwritten.
 * - Built-in themes: edit the CSS in public/themes, then bump that theme's `version` in BUILTIN_THEMES.
 *   A theme that's missing, or older than its entry here, is (re)installed.
 * - Anything else (renaming a setting, changing user data): append a step to MIGRATIONS. Each id runs once
 *   per browser, in order; never reorder or reuse ids. Steps should be idempotent.
 */
import { dirExists, fileExists, SettingsPath, StaticThemePath, ThemePath } from "../types";

const STATE_PATH = "/.updater.json";

export const DEFAULT_QUICK_LINKS = [
	{ title: "Github", icon: "https://github.githubassets.com/favicons/favicon.svg", color: "#fff", href: "https://github.com/Fracital/Fracital" },
	{ title: "YouTube", icon: "/youtube.svg", color: "#ff4242", href: "https://www.youtube.com" },
	{ title: "Google", icon: "/google.svg", color: "#ffffff", href: "https://google.com" },
	{ title: "Krunker", icon: "/krunker.png", color: "#ffd95c", href: "https://krunk.io" },
	{ title: "Estro AI Chat", icon: "/estro.svg", color: "#9a5ae7", href: "https://estro.help/" },
	{ title: "Fracital Music", icon: "/fm.svg", color: "#e25bec", href: "about:music" },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
	theme: "default",
	proxy: "sj",
	quicklinks: JSON.stringify(DEFAULT_QUICK_LINKS),
	"floating-tabs": false,
	"disable-visualizers": false,
	"tracks-visualizer": true,
	"big-player-visualizer": true,
	"big-player-default": true,
	// Off: stomp is not offered in the engine selector until the user opts in.
	"experimental-proxies": false,
};

interface ThemeMeta {
	name: string;
	description: string;
	author: string;
	version: string;
	license: string;
	color: string;
	brightness: "dark" | "light";
}

const APACHE = "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)";
const BUILTIN_THEMES: { dir: string; css: string; meta: ThemeMeta }[] = [
	{ dir: "default", css: "default.css", meta: { name: "Default", description: "The default theme for Fracital.", author: "SNOOT", version: "1.0.0", license: APACHE, color: "#fb74fe", brightness: "dark" } },
	{ dir: "light", css: "light.css", meta: { name: "Light", description: "The default light theme for Fracital.", author: "SNOOT", version: "1.0.0", license: APACHE, color: "#e4b174", brightness: "light" } },
	{ dir: "amber", css: "amber.css", meta: { name: "Amber", description: "A amber theme for Fracital.", author: "SNOOT", version: "1.0.0", license: APACHE, color: "#e4b174", brightness: "dark" } },
	{ dir: "greyscale", css: "greyscale.css", meta: { name: "Greyscale", description: "A greyscale theme for Fracital.", author: "SNOOT", version: "1.0.0", license: APACHE, color: "#e4b174", brightness: "dark" } },
];

interface UpdaterState {
	applied: string[];
	/** Signature of the bundled game files last copied into the virtual drive. */
	games?: string;
}

type QuickLink = { title?: string; icon?: string; color?: string; href?: string };

const readQuickLinks = (): QuickLink[] | null => {
	try {
		const saved = JSON.parse(localStorage.getItem("quicklinks") || "null");
		return Array.isArray(saved) ? saved : null;
	} catch {
		return null;
	}
};
const writeQuickLinks = (links: QuickLink[]) => localStorage.setItem("quicklinks", JSON.stringify(links));

/** Adds default links the user doesn't have yet (by href). Links they delete later stay deleted. */
const addDefaultLinks = (titles: string[]) => {
	const saved = readQuickLinks();
	if (!saved) return;
	const added = DEFAULT_QUICK_LINKS.filter(l => titles.includes(l.title) && !saved.some(s => s.href === l.href));
	if (added.length) writeQuickLinks([...saved, ...added]);
};

const MIGRATIONS: { id: string; run: () => void | Promise<void> }[] = [
	{
		// Older defaults linked the Fracital site itself; swap it for YouTube.
		id: "quicklinks-replace-fractial",
		run: () => {
			const saved = readQuickLinks();
			const youtube = DEFAULT_QUICK_LINKS.find(l => l.title === "YouTube");
			if (!saved || !youtube) return;
			const migrated = saved.map(l => (l.title === "Fracital" && /fractial\.dev/.test(l.href ?? "") ? youtube : l));
			if (migrated.some((l, i) => l !== saved[i])) writeQuickLinks(migrated);
		},
	},
	{
		id: "quicklinks-v2",
		// Browsers that already ran this before the updater existed have the old flag.
		run: () => {
			if (!localStorage.getItem("quicklinks-v2")) addDefaultLinks(["Krunker", "Estro AI Chat"]);
		},
	},
	{ id: "quicklinks-fracital-music", run: () => addDefaultLinks(["Fracital Music"]) },
	{
		// Default links used to be all white; give the untouched ones their brand colors.
		id: "quicklinks-default-colors",
		run: () => {
			const saved = readQuickLinks();
			if (!saved) return;
			let changed = false;
			const next = saved.map(l => {
				const def = DEFAULT_QUICK_LINKS.find(d => d.href === l.href);
				if (!def || !/^#fff(fff)?$/i.test(l.color ?? "") || def.color === l.color) return l;
				changed = true;
				return { ...l, color: def.color };
			});
			if (changed) writeQuickLinks(next);
		},
	},
];

const log = (msg: string) => console.log(`%cupdater%c ${msg}`, "color: #c7a1f2", "color: inherit");

async function readState(): Promise<UpdaterState> {
	try {
		const state = JSON.parse(await window.fr.fs.promises.readFile(STATE_PATH, "utf8")) as UpdaterState;
		return { applied: Array.isArray(state.applied) ? state.applied : [], games: state.games };
	} catch {
		return { applied: [] };
	}
}

const writeState = (state: UpdaterState) => window.fr.fs.promises.writeFile(STATE_PATH, JSON.stringify(state, null, 2));

/** Creates settings.json, or adds any settings it's missing. Returns true if it wrote the file. */
export async function applySettingsDefaults(): Promise<boolean> {
	let current: Record<string, unknown> | null = null;
	if (await fileExists(SettingsPath)) {
		try {
			const parsed = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
		} catch {
			// Unreadable settings are replaced by the defaults below.
		}
	}
	const missing = Object.keys(DEFAULT_SETTINGS).filter(k => !current || !(k in current));
	if (!missing.length) return false;
	await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, ...current }, null, 4));
	log(current ? `settings: added ${missing.join(", ")}` : "settings: created settings.json");
	return true;
}

/** FNV-1a; only used to notice that the bundled file list changed. */
const shortHash = (text: string) => {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return `${(h >>> 0).toString(16)}:${text.length}`;
};

const newer = (a: string, b: string) => {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] || 0) - (pb[i] || 0);
		if (d) return d > 0;
	}
	return false;
};

async function syncThemes() {
	if (!(await dirExists(ThemePath))) await window.fr.fs.promises.mkdir(ThemePath);
	for (const theme of BUILTIN_THEMES) {
		const dir = `${ThemePath}${theme.dir}`;
		let installed: string | null = null;
		try {
			installed = (JSON.parse(await window.fr.fs.promises.readFile(`${dir}/index.json`, "utf8")) as ThemeMeta).version ?? "0";
		} catch {
			// Missing or broken: install it.
		}
		if (installed && (await fileExists(`${dir}/index.css`)) && !newer(theme.meta.version, installed)) continue;
		try {
			const res = await fetch(`${StaticThemePath}/${theme.css}`, { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const css = await res.text();
			if (!(await dirExists(dir))) await window.fr.fs.promises.mkdir(dir);
			await window.fr.fs.promises.writeFile(`${dir}/index.css`, css);
			await window.fr.fs.promises.writeFile(`${dir}/index.json`, JSON.stringify(theme.meta));
			log(`theme ${theme.dir}: ${installed ? `${installed} -> ` : "installed "}${theme.meta.version}`);
		} catch (err) {
			// Try again next boot; the rest of the update still runs.
			console.warn(`updater: couldn't update theme ${theme.dir}`, err);
		}
	}
}

/**
 * Brings this browser's data up to date. `gamesList` identifies the bundled game files; the
 * returned `refreshGames` is true when they changed since the last copy (so init re-copies them all).
 */
export async function runUpdater(gamesList: string): Promise<{ refreshGames: boolean; commitGames: () => Promise<void> }> {
	const gamesSignature = shortHash(gamesList);
	const state = await readState();
	await applySettingsDefaults();
	await syncThemes();

	if (!readQuickLinks()) writeQuickLinks(DEFAULT_QUICK_LINKS);
	for (const step of MIGRATIONS) {
		if (state.applied.includes(step.id)) continue;
		try {
			await step.run();
			state.applied.push(step.id);
			log(`migration ${step.id}`);
		} catch (err) {
			// Not recorded, so it retries next boot.
			console.warn(`updater: migration ${step.id} failed`, err);
		}
	}
	await writeState(state);

	return {
		refreshGames: state.games !== gamesSignature,
		commitGames: async () => {
			state.games = gamesSignature;
			await writeState(state);
		},
	};
}
