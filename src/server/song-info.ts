/**
 * Now Playing details: a song's release date (iTunes) and its credits — writers,
 * producers, engineers and musicians (MusicBrainz). Both keyless; cached a day.
 */
import { musicbrainz } from "./artist-extras";

const TTL = 24 * 60 * 60_000;

export interface SongCredit {
	name: string;
	roles: string[];
}

export interface SongCredits {
	sections: { title: string; credits: SongCredit[] }[];
	/** The MusicBrainz recording the credits came from, for "view source". */
	url: string | null;
	/** A lookup failed, so some credits may be missing (don't cache for long). */
	partial?: boolean;
}

const infoCache = new Map<string, { at: number; value: { releaseDate: string | null } }>();
const creditsCache = new Map<string, { at: number; value: SongCredits; ttl?: number }>();

const cached = <T>(map: Map<string, { at: number; value: T; ttl?: number }>, key: string) => {
	const hit = map.get(key);
	return hit && Date.now() - hit.at < (hit.ttl ?? TTL) ? hit.value : undefined;
};

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/\s*[([].*?(feat|ft|with|remaster|version|edit|mix)[^)\]]*[)\]]/gi, "")
		.replace(/[^\p{L}\p{N}]+/gu, "");

async function itunes<T>(path: string): Promise<T | null> {
	try {
		const res = await fetch(`https://itunes.apple.com/${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
		return res.ok ? ((await res.json()) as T) : null;
	} catch {
		return null;
	}
}

type ItunesResult = { wrapperType?: string; trackName?: string; artistName?: string; releaseDate?: string };

/** Release date of the song's album/single (falls back to a search by title + artist). */
export async function songInfo(title: string, artist: string, albumId?: string): Promise<{ releaseDate: string | null }> {
	const key = `${albumId ?? ""}|${norm(artist)}|${norm(title)}`;
	const hit = cached(infoCache, key);
	if (hit) return hit;

	let releaseDate: string | null = null;
	if (albumId && /^\d+$/.test(albumId)) {
		const r = await itunes<{ results?: ItunesResult[] }>(`lookup?id=${albumId}&country=US`);
		releaseDate = r?.results?.find(x => x.releaseDate)?.releaseDate ?? null;
	}
	if (!releaseDate) {
		const r = await itunes<{ results?: ItunesResult[] }>(`search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=song&limit=10&country=US`);
		const songs = r?.results?.filter(x => x.wrapperType === "track") ?? [];
		const match = songs.find(x => norm(x.trackName ?? "") === norm(title) && norm(x.artistName ?? "").includes(norm(artist).slice(0, 12))) ?? songs.find(x => norm(x.trackName ?? "") === norm(title));
		releaseDate = match?.releaseDate ?? null;
	}

	const value = { releaseDate };
	infoCache.set(key, { at: Date.now(), value });
	return value;
}

type MbArtist = { id: string; name: string };
type MbRelation = { type: string; "target-type": string; attributes?: string[]; artist?: MbArtist; work?: { title: string; relations?: MbRelation[] } };
type MbRecording = { id: string; title: string; score?: number; disambiguation?: string; video?: boolean; releases?: unknown[]; "artist-credit"?: { name: string; artist: MbArtist }[]; relations?: MbRelation[] };

const lucene = (s: string) => `"${s.replace(/[\\"]/g, "\\$&")}"`;
const cap = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

/** Which section a relationship goes in, and how its role reads. */
function describe(rel: MbRelation): { section: string; role: string } | null {
	const attrs = rel.attributes ?? [];
	switch (rel.type) {
		case "composer":
			return { section: "Written by", role: "Composer" };
		case "lyricist":
			return { section: "Written by", role: "Lyricist" };
		case "writer":
			return { section: "Written by", role: "Songwriter" };
		case "arranger":
			return { section: "Written by", role: "Arranger" };
		case "producer":
			return { section: "Produced by", role: attrs.includes("executive") ? "Executive Producer" : attrs.includes("co") ? "Co-Producer" : "Producer" };
		case "programming":
			return { section: "Produced by", role: "Programming" };
		case "mix":
			return { section: "Engineering", role: "Mixing Engineer" };
		case "recording":
			return { section: "Engineering", role: "Recording Engineer" };
		case "mastering":
			return { section: "Engineering", role: "Mastering Engineer" };
		case "engineer":
		case "audio":
		case "sound":
			return { section: "Engineering", role: "Engineer" };
		case "vocal":
			return { section: "Performers", role: cap(attrs.find(a => /vocal/.test(a)) ?? (attrs[0] ? `${attrs[0]} vocals` : "Vocals")) };
		case "instrument":
			return { section: "Performers", role: cap(attrs.filter(a => !["additional", "guest", "solo"].includes(a)).join(", ") || "Instruments") };
		case "performer":
			return { section: "Performers", role: "Performer" };
		default:
			return null;
	}
}

// Leave out alternate versions so the studio recording ranks near the top (and the search stays fast).
const SKIP_VERSIONS = ["live", "mix", "remix", "acapella", "instrumental", "edit"].map(w => ` AND NOT comment:${w}`).join("");

const SECTION_ORDER = ["Performed by", "Written by", "Produced by", "Engineering", "Performers"];

/** Song credits from MusicBrainz; empty sections when the song isn't catalogued there. */
export async function songCredits(title: string, artist: string): Promise<SongCredits> {
	const key = `${norm(artist)}|${norm(title)}`;
	const hit = cached(creditsCache, key);
	if (hit) return hit;

	const search = await musicbrainz<{ recordings?: MbRecording[] }>(`recording?query=${encodeURIComponent(`recording:${lucene(title)} AND artist:${lucene(artist)} AND video:false${SKIP_VERSIONS}`)}&limit=8&fmt=json`, 20_000);
	// The studio recording is the one without a "live"/"DJ-mix"/"music video" note, on the most releases.
	const candidates = (search?.recordings ?? [])
		.filter(r => (r.score ?? 0) >= 80 && norm(r.title) === norm(title) && !r.video)
		.sort((a, b) => Number(!!a.disambiguation) - Number(!!b.disambiguation) || (b.releases?.length ?? 0) - (a.releases?.length ?? 0))
		.slice(0, 3);

	// A song is often split across recordings (one per release), each holding part of the credits — merge them.
	const recordings: MbRecording[] = [];
	let failed = !search;
	for (const c of candidates) {
		const full = await musicbrainz<MbRecording>(`recording/${c.id}?inc=artist-credits+artist-rels+work-rels+work-level-rels&fmt=json`, 15_000);
		if (full) recordings.push(full);
		else failed = true;
	}
	const relCount = (r: MbRecording) => (r.relations ?? []).reduce((n, rel) => n + 1 + (rel.work?.relations?.length ?? 0), 0);
	const recording = [...recordings].sort((a, b) => relCount(b) - relCount(a))[0] ?? null;

	const sections = new Map<string, Map<string, SongCredit>>();
	const add = (section: string, name: string, role?: string) => {
		const people = sections.get(section) ?? new Map<string, SongCredit>();
		sections.set(section, people);
		const person = people.get(name) ?? { name, roles: [] };
		people.set(name, person);
		if (role && !person.roles.includes(role)) person.roles.push(role);
	};

	for (const c of recordings[0]?.["artist-credit"] ?? []) add("Performed by", c.name || c.artist.name);
	for (const rec of recordings) {
		const rels = rec.relations ?? [];
		for (const rel of [...rels, ...rels.flatMap(r => r.work?.relations ?? [])]) {
			if (rel["target-type"] !== "artist" || !rel.artist) continue;
			const d = describe(rel);
			if (d) add(d.section, rel.artist.name, d.role);
		}
	}

	const value: SongCredits = {
		sections: SECTION_ORDER.filter(t => sections.has(t)).map(t => ({ title: t, credits: [...sections.get(t)!.values()] })),
		url: recording ? `https://musicbrainz.org/recording/${recording.id}` : null,
		...(failed ? { partial: true } : {}),
	};
	// A lookup that timed out may have left credits out: retry soon instead of keeping it for a day.
	creditsCache.set(key, { at: Date.now(), value, ttl: failed ? 2 * 60_000 : TTL });
	return value;
}
