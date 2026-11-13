import { ShieldCheckIcon } from "@heroicons/react/24/solid";
import type { Extension, ExtensionSettings } from "../types";
import { currentEngine, loadEngine, unloadEngine } from "./engine";

export interface AdblockSettings extends ExtensionSettings {
	/** Which filter lists to use (ids the server offers). */
	lists: string[];
}

/** The filter lists it can use, by the id the server knows them by. */
export const ADBLOCK_LISTS = [
	{ id: "easylist", name: "EasyList", about: "Ads." },
	{ id: "easyprivacy", name: "EasyPrivacy", about: "Trackers and analytics." },
	{ id: "ublock", name: "uBlock filters", about: "uBlock Origin's own fixes, including video ads on sites like YouTube." },
] as const;

/** A request's fetch destination, as the filter rules name request types (uBlock/AdBlock Plus `$script`, `$image`…). */
const ruleType = (destination: string | undefined) => {
	switch (destination) {
		case "script":
		case "worker":
		case "sharedworker":
		case "serviceworker":
		case "audioworklet":
		case "paintworklet":
			return "script";
		case "style":
			return "stylesheet";
		case "image":
			return "image";
		case "font":
			return "font";
		case "audio":
		case "video":
		case "track":
			return "media";
		case "iframe":
		case "frame":
			return "sub_frame";
		case "document":
			return "main_frame";
		case "object":
		case "embed":
			return "object";
		case "":
			return "xmlhttprequest";
		default:
			return "other";
	}
};

export const adblock: Extension<AdblockSettings> = {
	id: "adblock",
	name: "Ad Blocker",
	description: "Blocks ads and trackers on the sites you visit, and hides the empty spaces they leave behind.",
	icon: ShieldCheckIcon,
	defaults: { enabled: false, allow: [], lists: ADBLOCK_LISTS.map(list => list.id) },
	start: (settings, report) => loadEngine(settings.lists, report),
	stop: unloadEngine,
	filterRequest: ({ url, pageUrl, destination }) => {
		const loaded = currentEngine();
		if (!loaded) return null;
		const type = ruleType(destination);
		// Never the page itself: blocking it would only leave an empty tab.
		if (type === "main_frame") return null;
		const result = loaded.engine.match(loaded.lib.Request.fromRawDetails({ url, sourceUrl: pageUrl, type }));
		if (!result.match) return null;
		// Where the filter names a stand-in (uBlock's `redirect=`), the page gets that instead of a failure.
		return result.redirect ? { action: "redirect", body: result.redirect.body, contentType: result.redirect.contentType } : { action: "block" };
	},
	domStyles: (pageUrl, { classes, ids, hrefs }) => {
		const loaded = currentEngine();
		if (!loaded) return "";
		const page = loaded.lib.Request.fromRawDetails({ url: pageUrl });
		const { styles } = loaded.engine.getCosmeticsFilters({ url: pageUrl, hostname: page.hostname, domain: page.domain, classes, ids, hrefs, getBaseRules: false, getInjectionRules: false, getExtendedRules: false, getRulesFromDOM: true, getRulesFromHostname: false });
		return styles;
	},
	pageScripts: pageUrl => {
		const loaded = currentEngine();
		if (!loaded) return [];
		const page = loaded.lib.Request.fromRawDetails({ url: pageUrl });
		return loaded.engine.getCosmeticsFilters({ url: pageUrl, hostname: page.hostname, domain: page.domain, getBaseRules: false, getInjectionRules: true, getExtendedRules: false, getRulesFromDOM: false, getRulesFromHostname: true }).scripts;
	},
	pageStyles: pageUrl => {
		const loaded = currentEngine();
		if (!loaded) return "";
		const page = loaded.lib.Request.fromRawDetails({ url: pageUrl });
		const { styles } = loaded.engine.getCosmeticsFilters({ url: pageUrl, hostname: page.hostname, domain: page.domain, getBaseRules: true, getInjectionRules: false, getExtendedRules: false, getRulesFromDOM: false, getRulesFromHostname: true });
		return styles;
	},
};
