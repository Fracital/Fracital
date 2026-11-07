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

export type Video = { videoId?: string; title?: string; seconds?: number; views?: number; author?: { name?: string } };

const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const CLEAN = /\b(clean|radio edit|radio version|censored|edited|kidz bop|family friendly|no swearing)\b/;
const OFF_VERSION = /\b(live|remix|sped up|slowed|reverb|nightcore|8d|instrumental|acapella|a cappella|karaoke|cover|reaction|loop|1 hour|extended|mashup|bass boosted|chopped|screwed|snippet|teaser|fan made)\b/;

/** Words of a title, for whole-word comparison ("parabol" must not match "parabola"). */
const words = (s: string) => new Set(norm(s).split(" ").filter(Boolean));

/** What's left of a video title once the artist names and upload labels are removed: ideally just the song. */
function bareTitle(title: string, artists: string[]): string {
	let t = norm(title.replace(/[([][^)\]]*[)\]]/g, " ")); // "(Official Audio)", "[Lyrics]", "(feat. X)"
	for (const a of artists) t = ` ${t} `.replace(` ${a} `, " ").trim();
	return t
		.replace(/\b(official|audio|video|music|lyrics?|lyric video|visuali[sz]er|hd|hq|4k|explicit|topic)\b/g, " ")
		.replace(/\b(feat|ft|featuring|with)\b.*$/, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Higher is a better match. Exported for tests. */
export function scoreVideo(v: Video, hints: MatchHints): number {
	return score(v, hints);
}

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

	// It has to be this song, matched by whole words (featured-artist words aside: uploads write "ft." / "feat." differently).
	const titleWords = words(v.title ?? "");
	const songWords = song.split(" ").filter(w => w.length > 0 && !["feat", "ft", "with", "featuring"].includes(w));
	const hit = songWords.filter(w => titleWords.has(w)).length / Math.max(1, songWords.length);
	s += hit * 40;
	if (hit < 0.5) s -= 60;
	// The upload is titled exactly this song (beats "Parabola" when looking for "Parabol", or "Intro" vs "Intro (Reprise)").
	const bare = bareTitle(v.title ?? "", artists);
	const bareSong = bareTitle(hints.title, []);
	if (bare === bareSong) s += 25;
	else if (bare && bareSong && bare.replace(/ /g, "") !== bareSong.replace(/ /g, "")) {
		// Extra words that aren't in the song's title usually mean a different song or version.
		const extra = [...words(bare)].filter(w => !words(hints.title).has(w) && !artists.some(a => a.split(" ").includes(w)));
		s -= Math.min(30, extra.length * 10);
	}

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
		s += off <= 3 ? 15 : off <= 10 ? 8 : off <= 30 ? 0 : off <= 90 ? -25 : -45;
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

// --- Music videos (Now Playing's Video mode) ---

const VIDEO_LABEL = /\b(official (music )?video|music video|official mv)\b/;
// Uploads that are the song over still art, not a music video.
const NOT_A_VIDEO = /\b(official audio|audio|lyrics?|lyric video|visuali[sz]er|full album|static)\b/;
const FAN_MADE = /\b(un ?official|fan ?made|ai)\b/;
const EXTRAS = /\b(behind the scenes|bts|making of|interview|trailer|dance practice|choreography|vertical)\b/;

/** Higher is a better music-video match; below 70 isn't this song's video. Exported for tests. */
export function scoreMusicVideo(v: Video, hints: MatchHints): number {
	const title = norm(v.title ?? "");
	const author = norm(v.author?.name ?? "");
	const compact = (x: string) => x.replace(/ /g, "");
	const song = norm(hints.title);
	const wanted = (re: RegExp) => re.test(song);
	const artists = hints.artist
		.split(/,|&| feat\.? | ft\.? | x | and /i)
		.map(norm)
		.filter(a => a.length > 1);

	const titleWords = words(v.title ?? "");
	const songWords = song.split(" ").filter(w => w.length > 0 && !["feat", "ft", "with", "featuring"].includes(w));
	const hit = songWords.filter(w => titleWords.has(w)).length / Math.max(1, songWords.length);
	if (hit < 0.75) return -100;

	const labeled = VIDEO_LABEL.test(title);
	// "Artist - Topic" uploads are album art; unlabeled audio/lyric uploads aren't videos either.
	if (author.endsWith(" topic") || (NOT_A_VIDEO.test(title) && !labeled && !wanted(NOT_A_VIDEO))) return -100;
	if (FAN_MADE.test(title) && !wanted(FAN_MADE)) return -100;
	const official = artists.some(a => [a, `${a} official`, `${compact(a)}vevo`].includes(author) || compact(author) === `${compact(a)}vevo`);
	const vevo = author.includes("vevo");
	const bare = bareTitle(v.title ?? "", artists);
	const bareSong = bareTitle(hints.title, []);
	// It has to say it's the video, or be on VEVO, or be the artist's upload titled exactly "Artist - Song".
	// Their other unlabeled uploads are art tracks (titled just "Song"), sessions or tape versions.
	const exact = artists.some(a => title.includes(a)) && artists.reduce((t, a) => ` ${t} `.replace(` ${a} `, " ").trim(), title) === song;
	if (!labeled && !vevo && !(official && exact)) return -100;

	let s = hit * 40;
	if (bare === bareSong) s += 20;
	else if (bare && bareSong && compact(bare) !== compact(bareSong)) {
		const extra = [...words(bare)].filter(w => !words(hints.title).has(w) && !artists.some(a => a.split(" ").includes(w)));
		s -= Math.min(30, extra.length * 10);
	}
	if (official) s += 40;
	else if (vevo) s += 25;
	else if (artists.some(a => compact(author).includes(compact(a)))) s += 10;
	if (labeled) s += 30;
	if (OFF_VERSION.test(title) && !wanted(OFF_VERSION)) s -= 50;
	if (EXTRAS.test(title) && !wanted(EXTRAS)) s -= 60;
	if (CLEAN.test(title) && !wanted(CLEAN)) s -= 10;
	// Music videos run long with intros and outros, but not twice the song.
	if (hints.duration && v.seconds && (v.seconds < hints.duration * 0.7 || v.seconds > hints.duration * 2 + 60)) s -= 40;
	return s;
}

export interface MusicVideo {
	videoId: string;
	seconds: number | null;
}

const musicVideoCache = new Map<string, Promise<MusicVideo | null>>();

/** The song's official music video on YouTube, or null when it doesn't seem to have one. Cached per song. */
export function findMusicVideo(hints: Pick<MatchHints, "title" | "artist">): Promise<MusicVideo | null> {
	const key = `${hints.artist}|${hints.title}`.toLowerCase();
	let found = musicVideoCache.get(key);
	if (!found) {
		found = search(`${hints.artist} ${hints.title} official music video`).then(videos => {
			// No results usually means the search failed: don't remember it, so the next request retries.
			if (!videos.length) musicVideoCache.delete(key);
			const ranked = videos
				.filter(v => v.videoId && videoIdPattern.test(v.videoId))
				.map(v => ({ v, s: scoreMusicVideo(v, hints) }))
				.sort((a, b) => b.s - a.s);
			const top = ranked[0];
			return top && top.s >= 70 ? { videoId: top.v.videoId!, seconds: top.v.seconds ?? null } : null;
		});
		if (musicVideoCache.size >= 2000) musicVideoCache.delete(musicVideoCache.keys().next().value!);
		musicVideoCache.set(key, found);
	}
	return found;
}
