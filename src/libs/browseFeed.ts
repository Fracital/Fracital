/**
 * The Browse home's personal feed: new releases, picks and similar artists built from the artists a
 * user follows, listens to (Last.fm) and has saved music by. Results are cached for the session so
 * switching tabs doesn't refetch every artist.
 */
import { cleanAlbumTitle, getArtist, searchTracks, type MusicAlbum, type MusicTrack } from "./music-service";

export interface FeedSeed {
	name: string;
	id?: string;
}

export interface BrowseFeed {
	/** Recent albums/singles from seed artists, newest first. */
	newReleases: MusicAlbum[];
	/** A rotating mix of the seed artists' top songs. */
	picks: MusicTrack[];
	/** Artists similar to the seeds that the user doesn't already have. */
	similar: { name: string; picture: string; because: string }[];
}

const MAX_SEEDS = 8;
const CACHE_MS = 30 * 60_000;
const DAY = 86_400_000;

const idCache = new Map<string, Promise<string | null>>();
/** An artist's catalog id from their name (cached; null when search finds nobody). */
function resolveArtistId(name: string): Promise<string | null> {
	const key = name.toLowerCase();
	let pending = idCache.get(key);
	if (!pending) {
		pending = searchTracks(name, 5)
			.then(r => {
				const artists = r.artists ?? [];
				return (artists.find(a => a.name.toLowerCase() === key) ?? artists[0])?.id ?? null;
			})
			.catch(() => {
				idCache.delete(key);
				return null;
			});
		idCache.set(key, pending);
	}
	return pending;
}

const cacheKey = (seeds: FeedSeed[]) => `fracital:browse-feed:${seeds.map(s => s.name.toLowerCase()).join("|")}`;

function readCache(seeds: FeedSeed[]): BrowseFeed | null {
	try {
		const hit = JSON.parse(sessionStorage.getItem(cacheKey(seeds)) || "null") as { at: number; feed: BrowseFeed } | null;
		return hit && Date.now() - hit.at < CACHE_MS ? hit.feed : null;
	} catch {
		return null;
	}
}

/** Dedupes seeds by name, keeping the first (highest-priority) one. */
export function pickSeeds(groups: FeedSeed[][]): FeedSeed[] {
	const seen = new Set<string>();
	const out: FeedSeed[] = [];
	for (const seed of groups.flat()) {
		const key = seed.name.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(seed);
		if (out.length === MAX_SEEDS) break;
	}
	return out;
}

export async function loadBrowseFeed(seeds: FeedSeed[]): Promise<BrowseFeed> {
	const empty: BrowseFeed = { newReleases: [], picks: [], similar: [] };
	if (!seeds.length) return empty;
	const cached = readCache(seeds);
	if (cached) return cached;

	const details = (
		await Promise.allSettled(
			seeds.map(async seed => {
				const id = seed.id ?? (await resolveArtistId(seed.name));
				return id ? { seed, detail: await getArtist(id) } : null;
			}),
		)
	).flatMap(r => (r.status === "fulfilled" && r.value ? [r.value] : []));

	// New releases: the last four months, widened to a year when that's thin.
	const now = Date.now();
	// One per release: iTunes lists clean and explicit editions separately; keep the explicit one.
	const releases = new Map<string, MusicAlbum>();
	for (const { detail } of details)
		for (const a of detail.albums) {
			if (!a.releaseDate) continue;
			const key = `${cleanAlbumTitle(a.title).toLowerCase()}|${a.artist.toLowerCase()}`;
			const seen = releases.get(key);
			if (!seen || (a.explicit && !seen.explicit)) releases.set(key, a);
		}
	const byDate = [...releases.values()].sort((a, b) => Date.parse(b.releaseDate ?? "") - Date.parse(a.releaseDate ?? ""));
	const within = (days: number) => byDate.filter(a => now - Date.parse(a.releaseDate ?? "") < days * DAY);
	const recent = within(120);
	const newReleases = (recent.length >= 6 ? recent : within(365)).slice(0, 18);

	// Picks: a couple of top songs per artist, rotated daily so the shelf changes.
	const day = Math.floor(now / DAY);
	const perArtist = details.map(({ detail }) => {
		const top = detail.tracks.slice(0, 6);
		return top.length ? [top[day % top.length], top[(day + 3) % top.length]].filter((t, i, all) => all.indexOf(t) === i) : [];
	});
	const picks: MusicTrack[] = [];
	for (let round = 0; round < 2; round++) for (const list of perArtist) if (list[round]) picks.push(list[round]);

	// Similar artists the user doesn't already have.
	const known = new Set(seeds.map(s => s.name.toLowerCase()));
	const similar: BrowseFeed["similar"] = [];
	for (const { seed, detail } of details) {
		for (const s of (detail.similar ?? []).slice(0, 4)) {
			const key = s.name.toLowerCase();
			if (known.has(key)) continue;
			known.add(key);
			similar.push({ name: s.name, picture: s.picture, because: seed.name });
		}
	}

	const feed: BrowseFeed = { newReleases, picks: picks.slice(0, 24), similar: similar.slice(0, 18) };
	if (details.length) {
		try {
			sessionStorage.setItem(cacheKey(seeds), JSON.stringify({ at: now, feed }));
		} catch {
			// Storage full: the feed just loads again next time.
		}
	}
	return feed;
}
