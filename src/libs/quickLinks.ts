/**
 * The new tab page's quick links, kept in localStorage ("quicklinks") like before. Every change goes through
 * here and fires "links-upd", which the new tab page, Settings and the address bar's star listen for.
 */
import { DEFAULT_QUICK_LINKS } from "./updater";

export interface QuickLink {
	title: string;
	/** An image URL (or site path / data URI), one of GLYPH_ICONS' names, or "default" (a globe). */
	icon: string;
	color: string;
	href: string;
}

/** Built-in icons a link can use instead of an image, by the name stored in `icon`. */
export const GLYPH_NAMES = ["default", "gifticon", "musicalicon", "puzzleicon", "shoppingicon", "brieficon", "newspapericon"] as const;

export const LINK_COLORS = ["#ffffff", "#ff4242", "#ff8a3d", "#ffd95c", "#3ddc84", "#0079d3", "#9a5ae7", "#e25bec", "#2b2b2b"];

export const readLinks = (): QuickLink[] => {
	try {
		const saved = JSON.parse(localStorage.getItem("quicklinks") || "null");
		return Array.isArray(saved) ? saved : DEFAULT_QUICK_LINKS;
	} catch {
		return DEFAULT_QUICK_LINKS;
	}
};

const writeLinks = (links: QuickLink[]) => {
	localStorage.setItem("quicklinks", JSON.stringify(links));
	window.dispatchEvent(new Event("links-upd"));
};

export const addLink = (link: QuickLink) => writeLinks([...readLinks(), link]);
export const updateLink = (index: number, link: QuickLink) => writeLinks(readLinks().map((l, i) => (i === index ? link : l)));
export const removeLink = (index: number) => writeLinks(readLinks().filter((_, i) => i !== index));
export const moveLink = (index: number, by: -1 | 1) => {
	const links = readLinks();
	const to = index + by;
	if (to < 0 || to >= links.length) return;
	[links[index], links[to]] = [links[to], links[index]];
	writeLinks(links);
};

/** "youtube.com" → "https://youtube.com"; about: pages and full URLs stay as typed. */
export const normalizeHref = (input: string) => {
	const text = input.trim();
	if (!text || /^(about:|[a-z][a-z0-9+.-]*:\/\/)/i.test(text)) return text;
	return `https://${text}`;
};

/** The address without its scheme or "www.", for showing under a link's name. */
export const shortHref = (href: string) => {
	try {
		const url = new URL(href);
		if (url.protocol === "about:") return href;
		return url.hostname.replace(/^www\./, "");
	} catch {
		return href;
	}
};

/** The site's own icon, for a link to it. */
export const siteIcon = (href: string) => {
	try {
		const url = new URL(normalizeHref(href));
		return /^https?:$/.test(url.protocol) ? `${url.origin}/favicon.ico` : null;
	} catch {
		return null;
	}
};

/** A valid 3- or 6-digit hex color, or white. */
export const safeColor = (color: string | undefined) => (color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : "#ffffff");
