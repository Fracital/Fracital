import type { LyricLine } from "./lrc";

// Tags like "(Remastered 2011)", "[Live]" or " - Radio Edit" that providers often add or drop.
const TITLE_EXTRAS = /\s*[([][^)\]]*[)\]]|\s+-\s+.*$/g;
const FEATURING = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;
const ARTIST_SEPARATORS = /\s*(?:,|&|\/|;|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i;

export const normalizeName = (value: string) =>
	value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const normalizeTitle = (value: string) => normalizeName(value.replace(FEATURING, "").replace(TITLE_EXTRAS, "")) || normalizeName(value);

/** Damerau-style edit distance (insert/delete/substitute), capped work for short names. */
const editDistance = (a: string, b: string): number => {
	if (a === b) return 0;
	if (!a.length || !b.length) return Math.max(a.length, b.length);
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = row;
	}
	return prev[b.length];
};

/** 0..1 character-level similarity (1 = identical). */
const charSimilarity = (a: string, b: string): number => {
	const longer = Math.max(a.length, b.length);
	return longer === 0 ? 1 : 1 - editDistance(a, b) / longer;
};

// Tokens this close count as the same word (handles typos and plural "s").
const tokensEqual = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 1);

/**
 * 0..1 similarity between two normalized names, combining character-level edit
 * distance with token overlap. Token overlap is weighted by token length so
 * "North Star" scores low against "Your Eyes Are My North Star" (2 of 6 words)
 * instead of passing a substring test.
 */
const nameSimilarity = (a: string, b: string): number => {
	if (!a || !b) return 0;
	if (a === b) return 1;
	const ta = a.split(" ");
	const tb = b.split(" ");
	const matchedChars = ta.reduce((sum, token) => sum + (tb.some(other => tokensEqual(token, other)) ? token.length : 0), 0);
	const totalChars = Math.max(ta.join("").length, tb.join("").length);
	const tokenScore = totalChars === 0 ? 0 : matchedChars / totalChars;
	return Math.max(charSimilarity(a, b), tokenScore);
};

/** 0..1 score for how likely two track titles refer to the same song. */
export const titleSimilarity = (a: string, b: string): number => {
	const x = normalizeTitle(a);
	const y = normalizeTitle(b);
	if (!x || !y) return 0;
	return nameSimilarity(x, y);
};

const TITLE_THRESHOLD = 0.82;
const ARTIST_THRESHOLD = 0.8;

/** True when two track titles refer to the same song, ignoring case, accents, punctuation and version tags. */
export const titlesMatch = (a: string, b: string) => titleSimilarity(a, b) >= TITLE_THRESHOLD;

export const splitArtists = (value: string) => value.split(ARTIST_SEPARATORS).map(normalizeName).filter(Boolean);

/** 0..1 score for the best shared artist between a credit string and candidate names. */
export const artistSimilarity = (wanted: string, candidates: string[]): number => {
	const want = splitArtists(wanted);
	if (want.length === 0) return 1;
	const have = candidates.flatMap(splitArtists);
	if (have.length === 0) return 0;
	let best = 0;
	for (const a of want) for (const b of have) best = Math.max(best, nameSimilarity(a, b));
	return best;
};

/** True when at least one artist is shared, or when we don't know the track's artist. */
export const artistsMatch = (wanted: string, candidates: string[]) => artistSimilarity(wanted, candidates) >= ARTIST_THRESHOLD;

// NetEase prefixes lyrics with credit lines such as "作词 : Name" or "Producer: Name".
const CREDIT_LINE = /^\s*(?:[^\s:：]*[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af][^:：]{0,12}|(?:lyrics?|lyricist|written by|writers?|composers?|composed by|producers?|produced by|arrange(?:r|d by)|mix(?:ing|ed by)?|master(?:ing|ed by)?|vocals?|recording|engineer)(?:\s+[a-z]+)?\s*)[:：]\s*\S/i;
const PLACEHOLDER = /^(?:纯音乐[，,]?\s*请欣赏|此歌曲为没有填词的纯音乐[，,]?\s*请您欣赏|暂无歌词)$/;

const isFiller = (line: LyricLine) => !line.text || CREDIT_LINE.test(line.text) || PLACEHOLDER.test(line.text.trim());

/**
 * Removes the credit and "instrumental" placeholder lines that some providers put before or after the lyrics.
 * Only the leading and trailing runs are removed so real lyrics containing a colon are kept.
 */
export const stripCredits = (lines: LyricLine[]): LyricLine[] => {
	let start = 0;
	let end = lines.length;
	while (start < end && isFiller(lines[start])) start++;
	while (end > start && isFiller(lines[end - 1])) end--;
	const cleaned = lines.slice(start, end);
	if (cleaned[0]?.breakBefore) cleaned[0] = { time: cleaned[0].time, text: cleaned[0].text };
	return cleaned;
};
