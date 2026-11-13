import { createHash } from "node:crypto";

/*
 * Filter lists for the ad blocker extension. The server fetches them from their publishers and keeps them in memory,
 * so clients get them from us (sealed, like every /api response) instead of each browser fetching them, and so a
 * list being briefly unreachable upstream doesn't break anyone. Only these lists can be asked for: this is not a
 * general-purpose fetcher.
 */

/** Ghostery's mirror of uBlock Origin's lists and resources (the files its adblocker library is built and tested against). */
const UBLOCK = "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin";

/** Each list by id: the file (or files, joined) it's made of. */
export const FILTER_LISTS = {
	easylist: ["https://easylist.to/easylist/easylist.txt"],
	easyprivacy: ["https://easylist.to/easylist/easyprivacy.txt"],
	// uBlock Origin's own filters: fixes for sites EasyList can't handle by blocking, like video ads on YouTube,
	// which need scripts run in the page (its "scriptlets").
	ublock: ["filters.txt", "filters-2020.txt", "filters-2021.txt", "filters-2022.txt", "filters-2023.txt", "filters-2024.txt", "badware.txt", "quick-fixes.txt", "unbreak.txt"].map(file => `${UBLOCK}/${file}`),
	// The scriptlets and stand-in files uBlock's filters refer to (not a filter list: the engine loads it as resources).
	resources: [`${UBLOCK}/resources.json`],
} as const;

export type FilterListId = keyof typeof FILTER_LISTS;

/** How long a fetched list is served before it's fetched again (EasyList itself updates a few times a day). */
const REFRESH_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
/** The lists are a few MB; anything far bigger is not a filter list. */
const MAX_BYTES = 30 * 1024 * 1024;

interface CachedList {
	text: string;
	/** A short hash of the text: clients rebuild their engine only when it changes. */
	version: string;
	fetchedAt: number;
}

const cache = new Map<FilterListId, CachedList>();
const inflight = new Map<FilterListId, Promise<CachedList>>();

export const isFilterListId = (id: string): id is FilterListId => Object.keys(FILTER_LISTS).includes(id);

const fetchFile = async (url: string) => {
	const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "text/plain" } });
	if (!response.ok) throw new Error(`${url}: upstream ${response.status}`);
	return response.text();
};

const fetchList = async (id: FilterListId): Promise<CachedList> => {
	const text = (await Promise.all(FILTER_LISTS[id].map(fetchFile))).join("\n");
	if (text.length > MAX_BYTES || text.length < 100) throw new Error(`${id}: not a filter list`);
	return { text, version: createHash("sha256").update(text).digest("hex").slice(0, 16), fetchedAt: Date.now() };
};

/** A list, fetched when missing or older than a day. If a refresh fails, the copy already held is served. */
export const getFilterList = async (id: FilterListId): Promise<CachedList> => {
	const held = cache.get(id);
	if (held && Date.now() - held.fetchedAt < REFRESH_MS) return held;
	let pending = inflight.get(id);
	if (!pending) {
		pending = fetchList(id)
			.then(fresh => {
				cache.set(id, fresh);
				return fresh;
			})
			.finally(() => inflight.delete(id));
		inflight.set(id, pending);
	}
	try {
		return await pending;
	} catch (error) {
		if (held) return held;
		throw error;
	}
};
