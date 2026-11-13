/// <reference types="vite/client" />
/// <reference types="@mercuryworkshop/scramjet" />
/// <reference types="@mercuryworkshop/scramjet-controller" />

declare module "virtual:emoji-data" {
	/** A line per emoji: emoji, group, name, shortcodes, search words (tab-separated; the lists space-separated). */
	const data: string;
	export default data;
}
