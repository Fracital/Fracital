import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/*
 * `virtual:emoji-data`: the emoji for the comment box's emoji keyboard and :shortcodes:, built from emojibase-data
 * at build time into one string (a line per emoji: emoji, group, name, shortcodes, search words, tab-separated).
 * One string instead of the package's JSON keeps the chunk small and quick to compile, and lets the words that are
 * on the build's canary list (a search tag spells one of the engine names) be left out before they ship.
 */

const ID = "virtual:emoji-data";
const RESOLVED = `\0${ID}`;

const require = createRequire(import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(require.resolve(`emojibase-data/en/${path}`), "utf8"));

interface CompactEmoji {
	hexcode: string;
	unicode: string;
	label: string;
	group?: number;
	order?: number;
	tags?: string[];
}

/** emojibase's "components" group: skin tones and hair styles on their own, not emoji to send. */
const COMPONENTS = 2;
/** The newest Emoji version current iOS, Android and Windows 11 fonts all draw; newer ones would show as boxes. */
const MAX_VERSION = 15.1;

const build = () => {
	const canaries = (JSON.parse(readFileSync(new URL("../../scripts/canary-list.json", import.meta.url), "utf8")) as { canaries: { value: string }[] }).canaries.map(c => c.value.toLowerCase());
	const clean = (word: string) => !canaries.some(canary => word.toLowerCase().includes(canary));
	const emoji = read<CompactEmoji[]>("compact.json");
	const versions = new Map(read<{ hexcode: string; version: number }[]>("data.json").map(e => [e.hexcode, e.version]));
	// GitHub's shortcodes first (Discord's are mostly the same), then Slack's for the ones they add.
	const github = read<Record<string, string | string[]>>("shortcodes/github.json");
	const slack = read<Record<string, string | string[]>>("shortcodes/iamcal.json");
	const list = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
	return emoji
		.filter(e => e.group !== undefined && e.group !== COMPONENTS && (versions.get(e.hexcode) ?? 0) <= MAX_VERSION && clean(e.label))
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
		.map(e => {
			const codes = [...new Set([...list(github[e.hexcode]), ...list(slack[e.hexcode])])].filter(clean);
			const tags = (e.tags ?? []).filter(tag => clean(tag) && !codes.includes(tag));
			return [e.unicode, e.group, e.label, codes.join(" "), tags.join(" ")].join("\t");
		})
		.join("\n");
};

export const emojiData = (): Plugin => {
	let source: string | null = null;
	return {
		name: "emoji-data",
		resolveId: id => (id === ID ? RESOLVED : null),
		load(id) {
			if (id !== RESOLVED) return null;
			source ??= `export default ${JSON.stringify(build())};`;
			return source;
		},
	};
};
