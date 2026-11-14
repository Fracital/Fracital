/**
 * Browsing history (about:history): the sites tabs visited, newest first. Kept in this browser only, in
 * localStorage under "fracital:" (so game-save sync skips it); it never goes to the account.
 *
 * The tabs store records a visit whenever a tab reports where it is (pushHistory / replaceHistory). A page's
 * title and icon usually arrive just after its URL, so a report for the URL a tab is already on updates that
 * visit instead of adding one; so does a reload soon after.
 */
import { createId } from "@paralleldrive/cuid2";
import { create } from "zustand";

export interface HistoryVisit {
	id: string;
	url: string;
	title: string;
	/** The page's icon URL, when it has one. */
	icon?: string;
	/** When it was visited (ms since epoch). */
	at: number;
}

const STORAGE_KEY = "fracital:history";
const MAX_VISITS = 5000;
/** The same page again in the same tab within this long is the same visit (a reload, its title arriving). */
const SAME_VISIT_MS = 30 * 60_000;
/** What a proxied tab shows before the page has a title. */
const PLACEHOLDER_TITLE = "New Tab";

const isVisit = (v: unknown): v is HistoryVisit => !!v && typeof (v as HistoryVisit).id === "string" && typeof (v as HistoryVisit).url === "string" && typeof (v as HistoryVisit).at === "number";

const load = (): HistoryVisit[] => {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
		return Array.isArray(saved) ? saved.filter(isVisit) : [];
	} catch {
		return [];
	}
};

export const useBrowsingHistory = create<{ visits: HistoryVisit[] }>(() => ({ visits: typeof window === "undefined" ? [] : load() }));

if (typeof window !== "undefined") {
	// Written a moment after the last change: a page load reports its URL, title and icon one after another.
	let saveTimer: number | undefined;
	useBrowsingHistory.subscribe(({ visits }) => {
		window.clearTimeout(saveTimer);
		saveTimer = window.setTimeout(() => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(visits));
			} catch {
				// Storage full or unavailable: history just isn't kept this time.
			}
		}, 500);
	});
	// Another window of the app changed it.
	window.addEventListener("storage", e => {
		if (e.key === STORAGE_KEY) useBrowsingHistory.setState({ visits: load() });
	});
}

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
};

/** Each tab's latest visit, so the title and icon that follow its URL land on it. */
const lastByTab = new Map<string, string>();

/** Records where a tab is. Only web pages count (not the app's own about: pages). */
export const recordVisit = (tabId: string, entry: { url: string; title?: string; icon?: unknown }) => {
	if (!/^https?:\/\//i.test(entry.url)) return;
	const title = entry.title?.trim() && entry.title !== PLACEHOLDER_TITLE ? entry.title.trim() : "";
	const icon = typeof entry.icon === "string" && entry.icon ? entry.icon : undefined;
	const now = Date.now();
	useBrowsingHistory.setState(({ visits }) => {
		const lastId = lastByTab.get(tabId);
		const last = lastId ? visits.find(v => v.id === lastId) : undefined;
		if (last && last.url === entry.url && now - last.at < SAME_VISIT_MS) {
			if ((!title || title === last.title) && (!icon || icon === last.icon)) return { visits };
			return { visits: visits.map(v => (v.id === last.id ? { ...v, title: title || v.title, icon: icon ?? v.icon } : v)) };
		}
		const visit: HistoryVisit = { id: createId(), url: entry.url, title: title || hostOf(entry.url), icon, at: now };
		lastByTab.set(tabId, visit.id);
		return { visits: [visit, ...visits].slice(0, MAX_VISITS) };
	});
};

export const removeVisit = (id: string) => useBrowsingHistory.setState(({ visits }) => ({ visits: visits.filter(v => v.id !== id) }));

/** Clears visits from `since` (ms since epoch) on; with no `since`, all of them. */
export const clearHistory = (since?: number) => useBrowsingHistory.setState(({ visits }) => ({ visits: since === undefined ? [] : visits.filter(v => v.at < since) }));
