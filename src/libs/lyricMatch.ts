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

/** True when two track titles refer to the same song, ignoring case, accents, punctuation and version tags. */
export const titlesMatch = (a: string, b: string) => {
	const x = normalizeTitle(a);
	const y = normalizeTitle(b);
	if (!x || !y) return false;
	return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
};

export const splitArtists = (value: string) => value.split(ARTIST_SEPARATORS).map(normalizeName).filter(Boolean);

/** True when at least one artist is shared, or when we don't know the track's artist. */
export const artistsMatch = (wanted: string, candidates: string[]) => {
	const want = splitArtists(wanted);
	if (want.length === 0) return true;
	const have = candidates.flatMap(splitArtists);
	return want.some(a => have.some(b => a === b || a.includes(b) || b.includes(a)));
};

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
