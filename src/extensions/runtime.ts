import { create } from "zustand";
import { useSettingsStore } from "../store";
import { EXTENSIONS } from "./registry";
import { EXTENSIONS_SETTING, extensionSettings } from "./state";
import type { ExtensionRequest, ExtensionSettings, ExtensionStatus, PageFeatures, RequestVerdict } from "./types";

/*
 * The one place the engines ask about extensions. It runs the extensions that are switched on, with their current
 * settings, and does nothing at all while none are (the default).
 */

/** Each extension's status and how many requests it blocked since the app opened, for about:extensions. */
export const useExtensionsStore = create<{ status: Record<string, ExtensionStatus>; blocked: Record<string, number> }>(() => ({ status: {}, blocked: {} }));

/** The extensions that are on, with the settings they run with. */
const running = new Map<string, ExtensionSettings>();
/** Each page's CSS, until an extension starts, stops or reports (its rules may have changed). */
const stylesCache = new Map<string, string>();

const report = (id: string) => (status: ExtensionStatus) => {
	stylesCache.clear();
	useExtensionsStore.setState(state => ({ status: { ...state.status, [id]: status } }));
};

// Blocked counts are added up and shown a few times a second, not on every request.
const pendingBlocked: Record<string, number> = {};
let flushTimer = 0;
const countBlocked = (id: string) => {
	pendingBlocked[id] = (pendingBlocked[id] ?? 0) + 1;
	if (flushTimer) return;
	flushTimer = window.setTimeout(() => {
		flushTimer = 0;
		useExtensionsStore.setState(state => {
			const blocked = { ...state.blocked };
			for (const key of Object.keys(pendingBlocked)) {
				blocked[key] = (blocked[key] ?? 0) + pendingBlocked[key];
				delete pendingBlocked[key];
			}
			return { blocked };
		});
	}, 300);
};

/** Whether an extension is paused on the page's site (or a parent domain of it). */
const paused = (settings: ExtensionSettings, pageUrl: string | undefined) => {
	if (!pageUrl || !settings.allow.length) return false;
	let host: string;
	try {
		host = new URL(pageUrl).hostname;
	} catch {
		return false;
	}
	return settings.allow.some(site => host === site || host.endsWith(`.${site}`));
};

/** Starts, restarts or stops each extension as its settings change. Called once when the app starts. */
export const startExtensions = () => {
	let applied = "";
	const sync = () => {
		const saved = useSettingsStore.getState().settings[EXTENSIONS_SETTING];
		const key = JSON.stringify(saved ?? null);
		if (key === applied) return;
		applied = key;
		stylesCache.clear();
		for (const extension of EXTENSIONS) {
			const settings = extensionSettings(extension);
			const before = running.get(extension.id);
			if (!settings.enabled) {
				if (!before) continue;
				running.delete(extension.id);
				extension.stop?.();
				report(extension.id)({ state: "off" });
				continue;
			}
			if (before && JSON.stringify(before) === JSON.stringify(settings)) continue;
			running.set(extension.id, settings);
			void Promise.resolve(extension.start?.(settings, report(extension.id))).catch(error => report(extension.id)({ state: "error", detail: String((error as Error)?.message ?? error) }));
		}
	};
	sync();
	return useSettingsStore.subscribe(sync);
};

/** What to do with a request a proxied page makes: null lets it through. */
export const requestVerdict = (request: ExtensionRequest): RequestVerdict | null => {
	if (!running.size) return null;
	for (const extension of EXTENSIONS) {
		const settings = running.get(extension.id);
		if (!settings || !extension.filterRequest || paused(settings, request.pageUrl)) continue;
		const verdict = extension.filterRequest(request, settings);
		if (verdict) {
			countBlocked(extension.id);
			return verdict;
		}
	}
	return null;
};

/**
 * The response the engines give for a verdict. A block fails the way a blocked request does in a browser with an ad
 * blocker (an error status, so scripts fire `error` and fetches see a failure) instead of an empty success, which
 * pages like YouTube's player read as broken data. A stand-in is served with its own type.
 */
export const verdictResponse = (verdict: RequestVerdict): { status: number; statusText: string; headers: [string, string][]; body: string | ArrayBuffer } => {
	if (verdict.action === "block") return { status: 403, statusText: "Forbidden", headers: [], body: "" };
	const base64 = verdict.contentType.endsWith(";base64");
	const contentType = base64 ? verdict.contentType.slice(0, -";base64".length) : verdict.contentType;
	const body = base64 ? Uint8Array.from(atob(verdict.body), c => c.charCodeAt(0)).buffer : verdict.body;
	return { status: 200, statusText: "OK", headers: [["content-type", contentType]], body };
};

/** The CSS the running extensions add to a proxied page. */
export const stylesFor = (pageUrl: string) => {
	if (!running.size) return "";
	const cached = stylesCache.get(pageUrl);
	if (cached !== undefined) return cached;
	let css = "";
	for (const extension of EXTENSIONS) {
		const settings = running.get(extension.id);
		if (settings && extension.pageStyles && !paused(settings, pageUrl)) css += extension.pageStyles(pageUrl, settings);
	}
	if (stylesCache.size > 100) stylesCache.clear();
	stylesCache.set(pageUrl, css);
	return css;
};

/** The pages extensions' scripts already ran in. */
const scripted = new WeakSet<Document>();

/**
 * Runs the extensions' scripts in a proxied page, once, as a script element of the page itself (so the engine treats
 * it like the page's own). Best before the page's own scripts: Scramjet calls this as the page starts.
 */
export const runPageScripts = (doc: Document, pageUrl: string) => {
	if (!running.size || scripted.has(doc)) return;
	const parent = doc.head ?? doc.documentElement;
	if (!parent) return;
	scripted.add(doc);
	let code = "";
	for (const extension of EXTENSIONS) {
		const settings = running.get(extension.id);
		if (!settings || !extension.pageScripts || paused(settings, pageUrl)) continue;
		for (const script of extension.pageScripts(pageUrl, settings)) code += `try{${script}\n}catch(e){}\n`;
	}
	if (!code) return;
	const script = doc.createElement("script");
	script.textContent = code;
	parent.appendChild(script);
	script.remove();
};

/** The marker on the style element extensions add to a page. */
const STYLE_ATTR = "data-fx";
/** The marker on the style element with CSS for what's on the page (class names, ids, links). */
const DOM_STYLE_ATTR = "data-fx-dom";

/** The CSS the running extensions add for class names, ids and links newly seen on a page. */
const domStylesFor = (pageUrl: string, found: PageFeatures) => {
	let css = "";
	for (const extension of EXTENSIONS) {
		const settings = running.get(extension.id);
		if (settings && extension.domStyles && !paused(settings, pageUrl)) css += extension.domStyles(pageUrl, found, settings);
	}
	return css;
};

/** The documents being watched, and what's been seen in each. */
const watched = new WeakMap<Document, { classes: Set<string>; ids: Set<string>; hrefs: Set<string> }>();

/**
 * Watches a proxied document as it builds: each class name, id and link that appears is passed (once, in batches) to
 * the extensions, and the CSS they return is added to the page. Starts once per document.
 */
const watchPage = (doc: Document, pageUrl: string) => {
	if (watched.has(doc)) return;
	const seen = { classes: new Set<string>(), ids: new Set<string>(), hrefs: new Set<string>() };
	watched.set(doc, seen);
	let fresh: PageFeatures = { classes: [], ids: [], hrefs: [] };
	let timer = 0;
	/** Adds a value to what's been seen, and to this batch if it's new. */
	const add = (set: Set<string>, batch: string[], value: string) => {
		if (set.has(value)) return;
		set.add(value);
		batch.push(value);
	};
	const note = (el: Element) => {
		for (const name of el.classList) add(seen.classes, fresh.classes, name);
		if (el.id) add(seen.ids, fresh.ids, el.id);
		const href = el.tagName === "A" ? el.getAttribute("href") : null;
		if (href) add(seen.hrefs, fresh.hrefs, href);
	};
	const scan = (root: Element) => {
		note(root);
		for (const el of root.querySelectorAll("[class],[id],a[href]")) note(el);
	};
	const flush = () => {
		timer = 0;
		const found = fresh;
		fresh = { classes: [], ids: [], hrefs: [] };
		if (!running.size || (!found.classes.length && !found.ids.length && !found.hrefs.length)) return;
		const css = domStylesFor(pageUrl, found);
		if (!css) return;
		let style = doc.querySelector<HTMLStyleElement>(`style[${DOM_STYLE_ATTR}]`);
		if (!style) {
			const parent = doc.head ?? doc.documentElement;
			if (!parent) return;
			style = doc.createElement("style");
			style.setAttribute(DOM_STYLE_ATTR, "");
			parent.appendChild(style);
		}
		style.textContent += css;
	};
	const later = () => {
		if (!timer) timer = window.setTimeout(flush, 120);
	};
	if (doc.documentElement) scan(doc.documentElement);
	later();
	new MutationObserver(records => {
		if (!running.size) return;
		for (const record of records) {
			if (record.type === "attributes") note(record.target as Element);
			else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node as Element);
		}
		later();
	}).observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id", "href"] });
};

/**
 * Puts the extensions' CSS in a proxied document (or takes it out when there's none now), once. Safe to call again:
 * it only writes when the CSS changed. Returns false when the document isn't far enough along to hold it yet.
 */
export const applyPageStyles = (doc: Document, pageUrl: string) => {
	if (running.size) watchPage(doc, pageUrl);
	const css = stylesFor(pageUrl);
	const existing = doc.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
	if (!css) {
		existing?.remove();
		return true;
	}
	if (existing) {
		if (existing.textContent !== css) existing.textContent = css;
		return true;
	}
	const parent = doc.head ?? doc.documentElement;
	if (!parent) return false;
	const style = doc.createElement("style");
	style.setAttribute(STYLE_ATTR, "");
	style.textContent = css;
	parent.appendChild(style);
	return true;
};
