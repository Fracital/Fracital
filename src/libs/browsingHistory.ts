/**
 * Browsing history (about:history): the sites tabs visited, newest first. Kept in this browser, in localStorage
 * under "fracital:" (so game-save sync skips it). It goes to the account only when the account has turned on
 * history backup (historyBackup.ts), which merges every device's copy; deletions are remembered as tombstones so a
 * merge never brings them back.
 *
 * The tabs store records a visit whenever a tab reports where it is (pushHistory / replaceHistory). A page's
 * title and icon usually arrive just after its URL, so a report for the URL a tab is already on updates that
 * visit instead of adding one; so does a reload soon after.
 */
import { createId } from "@paralleldrive/cuid2";
import { create } from "zustand";
import { emptyTombstones, HISTORY_CAP, type HistoryTombstones, type HistoryVisit, TOMBSTONE_LIMITS } from "./history-limits";

export type { HistoryVisit } from "./history-limits";

const STORAGE_KEY = "fracital:history";
const TOMBSTONES_KEY = "fracital:history-tombstones";
/** Visits kept: the free cap, raised by historyBackup.ts for a Premium account with backup on. */
let maxVisits: number = HISTORY_CAP.free;
export const setHistoryCap = (n: number) => {
	maxVisits = n;
};
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

const loadTombstones = (): HistoryTombstones => {
	try {
		const saved = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || "null");
		return saved && Array.isArray(saved.ids) && Array.isArray(saved.ranges) && typeof saved.clearedBefore === "number" ? saved : emptyTombstones();
	} catch {
		return emptyTombstones();
	}
};

let tombstones: HistoryTombstones = typeof window === "undefined" ? emptyTombstones() : loadTombstones();
export const getTombstones = () => tombstones;
const setTombstones = (next: HistoryTombstones) => {
	tombstones = { ids: next.ids.slice(-TOMBSTONE_LIMITS.ids), ranges: next.ranges.slice(-TOMBSTONE_LIMITS.ranges), clearedBefore: next.clearedBefore };
	try {
		localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones));
	} catch {}
};

export const useBrowsingHistory = create<{ visits: HistoryVisit[] }>(() => ({ visits: typeof window === "undefined" ? [] : load() }));

// A change made by the backup (adopting the account's copy) must not be sent back as a new change.
let applying = false;
/** Replaces the history with the merged copy from the account, deletions included. */
export const applyRemote = (visits: HistoryVisit[], remoteTombstones: HistoryTombstones) => {
	setTombstones(remoteTombstones);
	applying = true;
	try {
		useBrowsingHistory.setState({ visits: visits.slice(0, maxVisits) });
	} finally {
		applying = false;
	}
};
/** Runs after each change the user made here (a visit, a deletion, a clear); not after applyRemote. */
export const onHistoryChange = (cb: () => void) =>
	useBrowsingHistory.subscribe(() => {
		if (!applying) cb();
	});

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
		return { visits: [visit, ...visits].slice(0, maxVisits) };
	});
};

export const removeVisit = (id: string) => {
	setTombstones({ ...tombstones, ids: [...tombstones.ids, id] });
	useBrowsingHistory.setState(({ visits }) => ({ visits: visits.filter(v => v.id !== id) }));
};

/** Clears visits from `since` (ms since epoch) on; with no `since`, all of them. */
export const clearHistory = (since?: number) => {
	const now = Date.now();
	setTombstones(since === undefined ? { ...tombstones, clearedBefore: now } : { ...tombstones, ranges: [...tombstones.ranges, { from: since, to: now }] });
	useBrowsingHistory.setState(({ visits }) => ({ visits: since === undefined ? [] : visits.filter(v => v.at < since) }));
};
