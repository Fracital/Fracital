/**
 * Extra artist-page data: official social/streaming links (MusicBrainz URL relations)
 * and gallery photos (TheAudioDB + Wikidata/Wikimedia Commons). All keyless; cached a day.
 */

export type LinkKind = "instagram" | "spotify" | "youtube" | "tidal" | "apple" | "soundcloud" | "x" | "tiktok" | "facebook" | "bandcamp" | "deezer" | "website";

export interface ArtistLink {
	kind: LinkKind;
	url: string;
}

export interface ArtistExtras {
	links: ArtistLink[];
	images: string[];
}

const UA = "Fracital/2.0 (https://github.com/NovaAppsInc/Fracital)";
const TTL = 24 * 60 * 60_000;
const cache = new Map<string, { at: number; value: ArtistExtras }>();

// MusicBrainz allows ~1 request/second per client.
let mbChain: Promise<unknown> = Promise.resolve();
function musicbrainz<T>(path: string): Promise<T | null> {
	const run = mbChain.then(async () => {
		try {
			const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
			return res.ok ? ((await res.json()) as T) : null;
		} catch {
			return null;
		} finally {
			await new Promise(r => setTimeout(r, 1100));
		}
	});
	mbChain = run.catch(() => {});
	return run;
}

async function getJson<T>(url: string): Promise<T | null> {
	try {
		const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
		return res.ok ? ((await res.json()) as T) : null;
	} catch {
		return null;
	}
}

/** Display order: the first four are shown as icons, the rest live behind "+". */
const ORDER: LinkKind[] = ["instagram", "spotify", "youtube", "tidal", "apple", "soundcloud", "x", "tiktok", "facebook", "bandcamp", "deezer", "website"];

function classify(url: string, type: string): LinkKind | null {
	let host = "";
	try {
		host = new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
	if (host.endsWith("instagram.com")) return "instagram";
	if (host === "open.spotify.com") return "spotify";
	if (host === "youtube.com" || host === "m.youtube.com") return "youtube";
	if (host.endsWith("tidal.com")) return "tidal";
	if (host === "music.apple.com") return "apple";
	if (host === "soundcloud.com") return "soundcloud";
	if (host === "twitter.com" || host === "x.com") return "x";
	if (host === "tiktok.com") return "tiktok";
	if (host === "facebook.com") return "facebook";
	if (host.endsWith("bandcamp.com")) return "bandcamp";
	if (host === "deezer.com") return "deezer";
	if (type === "official homepage") return "website";
	return null;
}

interface MbArtist {
	id: string;
	name: string;
	score?: number;
	relations?: { type: string; url?: { resource: string } }[];
}

export async function artistExtras(name: string): Promise<ArtistExtras> {
	const key = name.toLowerCase().trim();
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL) return hit.value;

	const [audiodb, search] = await Promise.all([
		getJson<{ artists?: Record<string, string | null>[] | null }>(`https://www.theaudiodb.com/api/v1/json/${process.env.THEAUDIODB_API_KEY || "123"}/search.php?s=${encodeURIComponent(name)}`),
		musicbrainz<{ artists?: MbArtist[] }>(`artist/?query=${encodeURIComponent(`artist:"${name}"`)}&limit=3&fmt=json`),
	]);
	const adb = audiodb?.artists?.find(a => (a.strArtist || "").toLowerCase() === key) ?? null;

	// Prefer TheAudioDB's MBID (already disambiguated), else an exact-name MusicBrainz hit.
	const mbid = adb?.strMusicBrainzID || search?.artists?.find(a => a.name.toLowerCase() === key && (a.score ?? 0) >= 90)?.id;
	const mb = mbid ? await musicbrainz<MbArtist>(`artist/${mbid}?inc=url-rels&fmt=json`) : null;

	const byKind = new Map<LinkKind, string>();
	let wikidata = "";
	for (const rel of mb?.relations ?? []) {
		const url = rel.url?.resource;
		if (!url) continue;
		if (rel.type === "wikidata") wikidata = url.split("/").pop() || "";
		const kind = classify(url, rel.type);
		if (kind && !byKind.has(kind)) byKind.set(kind, url);
	}
	const links = ORDER.filter(k => byKind.has(k)).map(kind => ({ kind, url: byKind.get(kind)! }));

	const images: string[] = [];
	const push = (url: string | null | undefined) => {
		if (url && /^https:\/\//.test(url) && !images.includes(url)) images.push(url);
	};
	for (const field of ["strArtistThumb", "strArtistFanart", "strArtistFanart2", "strArtistFanart3", "strArtistFanart4", "strArtistWideThumb"]) push(adb?.[field]);
	if (wikidata) {
		const entity = await getJson<{ entities?: Record<string, { claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] } }> }>(`https://www.wikidata.org/wiki/Special:EntityData/${wikidata}.json`);
		const file = entity?.entities?.[wikidata]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
		if (file) push(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=800`);
	}

	const value = { links, images };
	cache.set(key, { at: Date.now(), value });
	return value;
}
