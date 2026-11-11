import { useSettingsStore } from "../store";

/** Where the address bar sends a search (Settings → Network). DuckDuckGo is the default. */
export const SEARCH_ENGINE_SETTING = "search-engine";

export const SEARCH_ENGINES = [
	{ id: "duckduckgo", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
	{ id: "google", name: "Google", url: "https://www.google.com/search?q=" },
	{ id: "bing", name: "Bing", url: "https://www.bing.com/search?q=" },
	{ id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=" },
	{ id: "startpage", name: "Startpage", url: "https://www.startpage.com/do/search?q=" },
] as const;

export const currentSearchEngine = (settings: Record<string, unknown>) => SEARCH_ENGINES.find(engine => engine.id === settings[SEARCH_ENGINE_SETTING]) ?? SEARCH_ENGINES[0];

export const searchUrl = (query: string) => currentSearchEngine(useSettingsStore.getState().settings).url + encodeURIComponent(query);

/** Typed text that reads as a search rather than a web address. */
export const isSearchQuery = (q: string) => {
	if (q.includes(" ")) return true;
	if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(q)) return false;
	if (q.startsWith("www.") || q.includes(".") || q.includes(":")) return false;
	return true;
};

/** Typed text as a URL to open: a web address as given (https:// added when missing), else a search. */
export const urlFromInput = (q: string) => {
	if (isSearchQuery(q)) return searchUrl(q);
	if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(q) || q.includes("about:")) return q;
	return `https://${q}`;
};
