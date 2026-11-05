/**
 * Picks the YouTube upload to stream for a catalog song. The first search hit is often
 * the wrong version — a clean/radio edit of an explicit song, a censored lyric video, a
 * live take or a sped-up edit — so candidates are scored instead: the requested version
 * (explicit vs clean), the artist's own or auto-generated "Topic" upload, and a matching
 * length win.
 */
import ytSearch from "yt-search";

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export interface MatchHints {
	title: string;
	artist: string;
	/** The catalog marks the song explicit: avoid clean/censored versions. */
	explicit?: boolean;
	/** Song length in seconds, when known. */
	duration?: number;
}

/**
 * iTunes marks clean edits of explicit songs "cleaned", and search often returns that edition
 * first (the explicit one may not be listed at all). Streams come from YouTube either way, so
 * treat both as the explicit song: play the original and show it as explicit.
 */
export const isExplicitEdition = (explicitness: string | undefined) => explicitness === "explicit" || explicitness === "cleaned";

/** Query-string hints added to a song's playback URL so the resolver knows which version to find. */
export function playbackHints(t: { preview?: string; title: string; artist: string; explicit?: boolean; duration?: number }): string {
	const params = new URLSearchParams({ fallback: t.preview || "", title: t.title, artist: t.artist });
	if (t.explicit) params.set("explicit", "1");
	if (t.duration && t.duration > 0) params.set("dur", String(Math.round(t.duration)));
	return params.toString();
}

type Video = { videoId?: string; title?: string; seconds?: number; views?: number; author?: { name?: string } };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const CLEAN = /\b(clean|radio edit|radio version|censored|edited|kidz bop|family friendly|no swearing)\b/;
const OFF_VERSION = /\b(live|remix|sped up|slowed|reverb|nightcore|8d|instrumental|acapella|a cappella|karaoke|cover|reaction|loop|1 hour|extended|mashup|bass boosted|chopped|screwed|snippet|teaser|fan made)\b/;

function score(v: Video, hints: MatchHints): number {
	const title = norm(v.title ?? "");
	const author = norm(v.author?.name ?? "");
	const compact = (x: string) => x.replace(/ /g, "");
	const song = norm(hints.title);
	// Every credited artist ("¥$, Kanye West & Ty Dolla $ign"); names that are all symbols normalize to "" and are skipped.
	const artists = hints.artist
		.split(/,|&| feat\.? | ft\.? | x | and /i)
		.map(norm)
		.filter(a => a.length > 1);
	let s = 0;

	// It has to be this song (featured-artist words aside: uploads write "ft." / "feat." / "with" differently).
	const songWords = song.split(" ").filter(w => w.length > 1 && !["feat", "ft", "with", "featuring"].includes(w));
	const hit = songWords.filter(w => title.includes(w)).length / Math.max(1, songWords.length);
	s += hit * 40;
	if (hit < 0.5) s -= 60;

	// Uploaded by the artist (or YouTube's auto-generated "Artist - Topic" album upload). Reuploads rank below.
	// The artist's own channel is named exactly for them ("Kendrick Lamar", "KendrickLamarVEVO", "Kendrick Lamar - Topic");
	// fan channels merely contain the name ("Kendrick Lamar Spotlight").
	const official = artists.some(a => [a, `${a} topic`, `${compact(a)}vevo`].includes(author) || compact(author) === `${compact(a)}vevo`);
	const mentions = artists.some(a => compact(author).includes(compact(a)));
	if (official) s += 40;
	else if (mentions) s += 12;
	else if (author.includes("vevo")) s += 20;
	if (artists.some(a => title.includes(a))) s += 5;

	// Same version as the catalog song. Words already in the song's own title are fine ("Live Forever").
	const wanted = (re: RegExp) => re.test(song);
	if (CLEAN.test(title) && !wanted(CLEAN)) s -= hints.explicit ? 80 : 5;
	if (hints.explicit && /\b(explicit|dirty|uncensored)\b/.test(title)) s += 8;
	if (hints.explicit && /\blyrics?\b/.test(title)) s -= 10; // lyric videos are often censored
	if (OFF_VERSION.test(title) && !wanted(OFF_VERSION)) s -= 40;
	if (/\b(official audio|audio)\b/.test(title)) s += 6;
	if (/\bofficial (music )?video\b/.test(title)) s -= 4; // videos often carry intros/skits

	// Length: clean edits are close, but live/extended takes and wrong songs are not.
	if (hints.duration && v.seconds) {
		const off = Math.abs(v.seconds - hints.duration);
		s += off <= 3 ? 12 : off <= 10 ? 6 : off <= 30 ? 0 : -25;
	}
	return s;
}

async function search(query: string): Promise<Video[]> {
	try {
		const r = (await ytSearch(query)) as { videos?: Video[] };
		return (r.videos ?? []).slice(0, 15);
	} catch {
		return [];
	}
}

/** The best-matching YouTube video id for a song, or null when nothing plausible turns up. */
export async function findYoutubeMatch(hints: MatchHints): Promise<string | null> {
	const base = `${hints.artist} ${hints.title}`;
	// Explicit songs also search for the explicit version directly; the album upload usually wins either way.
	const lists = await Promise.all([search(`${base} official audio`), ...(hints.explicit ? [search(`${base} explicit`)] : [])]);
	const seen = new Set<string>();
	const candidates = lists.flat().filter(v => v.videoId && videoIdPattern.test(v.videoId) && !seen.has(v.videoId) && seen.add(v.videoId));
	if (!candidates.length) return null;
	const ranked = candidates.map(v => ({ v, s: score(v, hints) })).sort((a, b) => b.s - a.s);
	return ranked[0].s > -20 ? ranked[0].v.videoId! : (candidates[0].videoId ?? null);
}
