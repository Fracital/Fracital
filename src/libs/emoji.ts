/** One emoji: the character, its group (emojibase's), its name, its :shortcodes: and the words that find it. */
export interface Emoji {
	emoji: string;
	group: number;
	name: string;
	codes: string[];
	tags: string[];
}

/** The emoji keyboard's sections, in emojibase's group numbers (2, skin tones on their own, isn't one). */
export const EMOJI_GROUPS: { group: number; label: string; icon: string }[] = [
	{ group: 0, label: "Smileys & emotion", icon: "😀" },
	{ group: 1, label: "People & body", icon: "👋" },
	{ group: 3, label: "Animals & nature", icon: "🐻" },
	{ group: 4, label: "Food & drink", icon: "🍔" },
	{ group: 5, label: "Travel & places", icon: "✈️" },
	{ group: 6, label: "Activities", icon: "⚽" },
	{ group: 7, label: "Objects", icon: "💡" },
	{ group: 8, label: "Symbols", icon: "💟" },
	{ group: 9, label: "Flags", icon: "🏳️" },
];

let loading: Promise<Emoji[]> | null = null;
let loaded: Emoji[] | null = null;
const byCode = new Map<string, string>();

/** The emoji data loads (a separate chunk) the first time the comment box is used. */
export const loadEmoji = () =>
	(loading ??= import("virtual:emoji-data").then(({ default: data }) => {
		loaded = data.split("\n").map(line => {
			const [emoji, group, name, codes, tags] = line.split("\t");
			return { emoji, group: Number(group), name, codes: codes ? codes.split(" ") : [], tags: tags ? tags.split(" ") : [] };
		});
		for (const e of loaded) for (const code of e.codes) if (!byCode.has(code)) byCode.set(code, e.emoji);
		return loaded;
	}));

/** The emoji for a shortcode ("sob" → 😭), once the data has loaded. */
export const emojiForCode = (code: string) => byCode.get(code.toLowerCase());

/** Turns every known :shortcode: in the text into its emoji; unknown ones stay as typed. */
export const replaceShortcodes = (text: string) => text.replace(/:([a-z0-9_+-]+):/gi, (match, code: string) => emojiForCode(code) ?? match);

/** Emoji for a search: an exact shortcode first, then shortcodes that start with it, then names and words that contain it. */
export const searchEmoji = (query: string, limit = Number.POSITIVE_INFINITY) => {
	const q = query.trim().toLowerCase().replace(/^:|:$/g, "");
	if (!loaded || !q) return [];
	const exact: Emoji[] = [];
	const starts: Emoji[] = [];
	const then: Emoji[] = [];
	for (const e of loaded) {
		if (e.codes.includes(q)) exact.push(e);
		else if (e.codes.some(code => code.startsWith(q))) starts.push(e);
		else if (e.name.includes(q) || e.codes.some(code => code.includes(q)) || e.tags.some(tag => tag.startsWith(q))) then.push(e);
	}
	return [...exact, ...starts, ...then].slice(0, limit);
};

/** The shortcode to show for an emoji in a search: the one the search matched, else its first. */
export const shownCode = (e: Emoji, query = "") => {
	const q = query.toLowerCase().replace(/^:|:$/g, "");
	return (q && (e.codes.find(code => code === q) ?? e.codes.find(code => code.startsWith(q)) ?? e.codes.find(code => code.includes(q)))) || e.codes[0];
};

const RECENT_KEY = "emoji-recent";
const RECENT_MAX = 24;

/** The emoji picked most recently, newest first (kept in this browser only). */
export const recentEmoji = (): string[] => {
	try {
		const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
		return Array.isArray(list) ? list.filter(e => typeof e === "string").slice(0, RECENT_MAX) : [];
	} catch {
		return [];
	}
};

export const rememberEmoji = (emoji: string) => {
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recentEmoji().filter(e => e !== emoji)].slice(0, RECENT_MAX)));
	} catch {
		// Without storage there's just no recent row.
	}
};
