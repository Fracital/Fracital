/**
 * The active tab profile's site rules and focus mode (tabProfiles.ts holds them). A tab that goes to a blocked site,
 * whichever way it got there (the address bar, a link, a page moving itself), is sent to about:blocked instead. Open
 * tabs are checked again when the profile or its rules change.
 */
import { useTabsStore } from "../store";
import { activeProfile, focusActive, type TabProfile, useTabProfiles } from "./tabProfiles";

/** What focus mode blocks: sites made for scrolling, watching and playing. */
export const FOCUS_SITES = [
	"youtube.com",
	"youtu.be",
	"tiktok.com",
	"instagram.com",
	"facebook.com",
	"x.com",
	"twitter.com",
	"threads.net",
	"reddit.com",
	"tumblr.com",
	"pinterest.com",
	"snapchat.com",
	"discord.com",
	"twitch.tv",
	"kick.com",
	"netflix.com",
	"9gag.com",
	"roblox.com",
	"now.gg",
	"poki.com",
	"crazygames.com",
	"coolmathgames.com",
	"krunker.io",
	"krunk.io",
];
/** The app's own pages focus mode blocks (about:<name>). */
export const FOCUS_PAGES = ["games", "chat", "social"];

export type BlockReason = "focus" | "block" | "allow";

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return null;
	}
};

const covers = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/** "https://www.YouTube.com/watch?v=1" → "youtube.com"; null for something that isn't a site. */
export const normalizeSite = (input: string) => {
	const text = input.trim().toLowerCase();
	if (!text) return null;
	const host = hostOf(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`);
	return host && (host.includes(".") || host === "localhost") ? host : null;
};

/** Why `url` is blocked in `profile`, or null when it isn't. */
export const blockReason = (url: string, profile: TabProfile, now = Date.now()): BlockReason | null => {
	if (url.startsWith("about:")) {
		const page = url.slice(6).split("?")[0];
		return focusActive(profile, now) && FOCUS_PAGES.includes(page) ? "focus" : null;
	}
	if (!/^https?:\/\//i.test(url)) return null;
	const host = hostOf(url);
	if (!host) return null;
	if (focusActive(profile, now) && FOCUS_SITES.some(site => covers(host, site))) return "focus";
	const sites = profile.sites ?? [];
	if (profile.siteMode === "block" && sites.some(site => covers(host, site))) return "block";
	if (profile.siteMode === "allow" && !sites.some(site => covers(host, site))) return "allow";
	return null;
};

export const blockedUrl = (url: string, reason: BlockReason) => `about:blocked?reason=${reason}&url=${encodeURIComponent(url)}`;

/** What each tab was last checked at, so only a tab that moved is checked again. */
const checked = new Map<string, string>();

const enforce = (all: boolean) => {
	const profile = activeProfile();
	const { tabs, navigateTab } = useTabsStore.getState();
	for (const tab of tabs) {
		const where = `${tab.url}\n${tab.displayUrl}`;
		if (!all && checked.get(tab.id) === where) continue;
		checked.set(tab.id, where);
		// The page's own address (where a proxied page went by itself) first, then the one asked for.
		for (const url of [tab.displayUrl, tab.url]) {
			const reason = url ? blockReason(url, profile) : null;
			if (!reason) continue;
			// The address bar just says where it is; the page reads why from the URL.
			navigateTab(tab.id, { url: blockedUrl(url, reason), displayUrl: "about:blocked", title: "Blocked", icon: null });
			break;
		}
	}
};

let started = false;

export const startProfileRules = () => {
	if (started) return;
	started = true;
	useTabsStore.subscribe(() => enforce(false));
	useTabProfiles.subscribe((state, prev) => {
		if (state.activeId !== prev.activeId || state.profiles !== prev.profiles) enforce(true);
	});
	enforce(true);
};
