export interface LyricLine {
	/** Start time in seconds, or null for unsynced lyrics. */
	time: number | null;
	text: string;
	/** Set when blank lines in the source separate this line from the previous one (a verse/section break). */
	breakBefore?: boolean;
}

export interface ParsedLyrics {
	synced: boolean;
	lines: LyricLine[];
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[([a-zA-Z#]+):(.*)\]$/;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

const toSeconds = (min: string, sec: string, frac?: string) => {
	const fraction = frac ? Number(frac) / 10 ** frac.length : 0;
	return Number(min) * 60 + Number(sec) + fraction;
};

/** Parses LRC (including multi-timestamp and enhanced word tags) or falls back to plain-text lyrics. */
export const parseLrc = (raw: string): ParsedLyrics => {
	const synced: LyricLine[] = [];
	const plain: LyricLine[] = [];
	let offset = 0;
	let syncedBreak = false;
	let plainBreak = false;

	for (const rawLine of raw.replace(/\r\n?/g, "\n").split("\n")) {
		const line = rawLine.trim();
		if (!line) {
			syncedBreak = plainBreak = true;
			continue;
		}

		const meta = line.match(META_TAG);
		if (meta && !/^\d/.test(meta[1])) {
			// Positive offset means lyrics should appear earlier.
			if (meta[1].toLowerCase() === "offset") offset = Number(meta[2]) / 1000 || 0;
			continue;
		}

		const times: number[] = [];
		let lastIndex = 0;
		TIME_TAG.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = TIME_TAG.exec(line)) && match.index === lastIndex) {
			times.push(toSeconds(match[1], match[2], match[3]));
			lastIndex = TIME_TAG.lastIndex;
		}

		const text = line.slice(lastIndex).replace(WORD_TAG, "").replace(/\s+/g, " ").trim();
		if (times.length > 0) {
			for (const time of times) synced.push(syncedBreak ? { time, text, breakBefore: true } : { time, text });
			syncedBreak = false;
		} else {
			plain.push(plainBreak ? { time: null, text, breakBefore: true } : { time: null, text });
			plainBreak = false;
		}
	}

	const lines = synced.length > 0 ? synced.map(l => ({ ...l, time: Math.max(0, (l.time as number) - offset) })).sort((a, b) => (a.time as number) - (b.time as number)) : plain;
	// Blank lines before the first lyric aren't a break between sections.
	if (lines[0]?.breakBefore) delete lines[0].breakBefore;
	return { synced: synced.length > 0, lines };
};

const SRT_TIMING = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/;
const SUBTITLE_MARKUP = /<[^>]*>|\{\\[^}]*\}/g;
// Silences at least this long (seconds) between cues get an empty "♪" line.
const MIN_SRT_GAP = 3;

const hmsToSeconds = (hours: string | undefined, min: string, sec: string, frac?: string) => Number(hours ?? 0) * 3600 + toSeconds(min, sec, frac);

/** Parses SRT subtitles into synced lyrics, falling back to plain text when no cues are found. */
export const parseSrt = (raw: string): ParsedLyrics => {
	const cues: { start: number; end: number; text: string[] }[] = [];
	const rows = raw
		.replace(/^\uFEFF/, "")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map(row => row.trim());

	// Walk line by line rather than by blank-line blocks so files without blank lines between cues still parse.
	rows.forEach((row, i) => {
		const m = row.match(SRT_TIMING);
		if (m) {
			cues.push({ start: hmsToSeconds(m[1], m[2], m[3], m[4]), end: hmsToSeconds(m[5], m[6], m[7], m[8]), text: [] });
			return;
		}
		const isCueNumber = /^\d+$/.test(row) && SRT_TIMING.test(rows[i + 1] ?? "");
		if (row && !isCueNumber && cues.length) cues[cues.length - 1].text.push(row);
	});

	if (cues.length === 0) return parseLrc(raw);

	const sorted = cues.map(cue => ({ ...cue, text: cue.text.join(" ").replace(SUBTITLE_MARKUP, "").replace(/\s+/g, " ").trim() })).sort((a, b) => a.start - b.start);
	const lines: LyricLine[] = [];
	sorted.forEach((cue, i) => {
		lines.push({ time: cue.start, text: cue.text });
		const next = sorted[i + 1];
		if (next && cue.text && cue.end > cue.start && next.start - cue.end >= MIN_SRT_GAP) lines.push({ time: cue.end, text: "" });
	});
	return { synced: true, lines };
};

export type LyricFormat = "lrc" | "srt" | "txt";

export const LYRIC_FORMATS: readonly LyricFormat[] = ["lrc", "srt", "txt"];

export const lyricFormatOf = (fileName: string): LyricFormat | null => {
	const ext = fileName.split(".").pop()?.toLowerCase();
	return LYRIC_FORMATS.find(format => format === ext) ?? null;
};

/** Parses lyrics according to their file format. TXT files may still contain LRC timestamps. */
export const parseLyrics = (raw: string, format: LyricFormat): ParsedLyrics => (format === "srt" ? parseSrt(raw) : parseLrc(raw));

const pad = (n: number) => String(n).padStart(2, "0");

const lrcStamp = (seconds: number) => {
	const centis = Math.round(seconds * 100);
	return `[${pad(Math.floor(centis / 6000))}:${pad(Math.floor((centis % 6000) / 100))}.${pad(centis % 100)}]`;
};

/** Serializes lyrics back to LRC (or plain text when unsynced), keeping section breaks as blank lines. */
export const toLrc = ({ synced, lines }: ParsedLyrics): string => `${lines.map((line, i) => `${line.breakBefore && i > 0 ? "\n" : ""}${synced && line.time !== null ? lrcStamp(line.time) : ""}${line.text}`).join("\n")}\n`;

/** Index of the line that should be highlighted at `time`, or -1 before the first line. */
export const activeLineIndex = (lines: LyricLine[], time: number): number => {
	let lo = 0;
	let hi = lines.length - 1;
	let result = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const lineTime = lines[mid].time;
		if (lineTime !== null && lineTime <= time) {
			result = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return result;
};
