/**
 * The For You page's data (about:newtab?fyp): what this browser knows (history, games played, the player) joined
 * with the server's picks for the listener or account (/api/for-you, src/server/for-you.ts). The server part is
 * kept in sessionStorage for ten minutes; the local part is cheap and recomputed on every load.
 */
import { useMusicStore, useTabsStore } from "../store";
import type { Track } from "../types";
import { cryptoFetch } from "./api-crypto-fetch";
import { listenerId } from "./artistPanel";
import { useBrowsingHistory } from "./browsingHistory";
import { useGameHistory } from "./gameHistory";
import { ensureInstalledGames, type InstalledGame, readFavorites, useInstalledGames } from "./installedGames";
import { getCharts, type MusicTrack } from "./music-service";
import { canonicalUrl, type FrecentSite, frecentSites } from "./omni/rank";
import { readLinks } from "./quickLinks";

const CACHE_KEY = "fracital:for-you";
const CACHE_MS = 10 * 60_000;

export interface ForYouServer {
	signedIn: boolean;
	music: {
		jumpBackIn: { title: string; artist: string; plays: number; last: string }[];
		topArtists: { name: string; plays: number; picture: string }[];
		artists: { name: string; picture: string; because: string }[];
		picks: MusicTrack[];
		coldStart: boolean;
	};
	games: {
		recent: { key: string; title: string; plays: number; last: string }[];
		trending: { key: string; title: string; players: number }[];
	};
}

export type JumpItem = { kind: "site"; url: string; title: string; icon?: string } | { kind: "game"; game: InstalledGame } | { kind: "song"; track: Track };

export interface ForYouData {
	jumpBackIn: JumpItem[];
	games: {
		recent: InstalledGame[];
		favorites: InstalledGame[];
		/** Played across the site this week; `installed` when this browser has it. */
		trending: { key: string; title: string; players: number; installed?: InstalledGame }[];
	};
	music: ForYouServer["music"];
	sites: FrecentSite[];
}

const EMPTY_SERVER: ForYouServer = { signedIn: false, music: { jumpBackIn: [], topArtists: [], artists: [], picks: [], coldStart: true }, games: { recent: [], trending: [] } };

const readCache = (): ForYouServer | null => {
	try {
		const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null") as { at: number; data: ForYouServer } | null;
		return saved && Date.now() - saved.at < CACHE_MS ? saved.data : null;
	} catch {
		return null;
	}
};

const writeCache = (data: ForYouServer) => {
	try {
		sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
	} catch {}
};

/** Forgets the server's picks (after sign-in or sign-out). */
export const resetForYou = () => {
	try {
		sessionStorage.removeItem(CACHE_KEY);
	} catch {}
};

async function fetchServer(): Promise<ForYouServer> {
	const cached = readCache();
	if (cached) return cached;
	const res = await cryptoFetch(`/api/for-you?listener=${encodeURIComponent(listenerId())}`);
	if (!res.ok) return EMPTY_SERVER;
	const data = (await res.json()) as ForYouServer;
	// Nothing known yet: the charts stand in for picks.
	if (data.music.coldStart && !data.music.picks.length)
		data.music.picks = await getCharts(12)
			.then(r => r.tracks)
			.catch(() => []);
	writeCache(data);
	return data;
}

/** Waits for the installed games' first read, so the page can match plays to them. */
const installedGames = () =>
	new Promise<InstalledGame[]>(resolve => {
		ensureInstalledGames();
		const { ready, games } = useInstalledGames.getState();
		if (ready) return resolve(games);
		const stop = useInstalledGames.subscribe(s => {
			if (s.ready) {
				stop();
				resolve(s.games);
			}
		});
	});

export async function loadForYou(): Promise<ForYouData> {
	const [server, installed] = await Promise.all([fetchServer().catch(() => EMPTY_SERVER), installedGames()]);
	const byId = new Map(installed.map(g => [g.id, g]));
	const byKey = new Map(installed.map(g => [g.folderName.toLowerCase(), g]));

	const open = new Set(useTabsStore.getState().tabs.map(t => canonicalUrl(t.url)));
	const sites = frecentSites(useBrowsingHistory.getState().visits).filter(s => !open.has(s.canonical));
	const recentSites = [...sites].sort((a, b) => b.lastAt - a.lastAt);
	const recentGames = useGameHistory
		.getState()
		.plays.map(p => byId.get(p.id))
		.filter((g): g is InstalledGame => !!g);
	const { currentTrack, playedHistory } = useMusicStore.getState();
	const lastSong = currentTrack ?? playedHistory[playedHistory.length - 1];

	const jumpBackIn: JumpItem[] = [...recentSites.slice(0, 2).map(s => ({ kind: "site", url: s.url, title: s.title, icon: s.icon }) as JumpItem), ...recentGames.slice(0, 2).map(g => ({ kind: "game", game: g }) as JumpItem), ...(lastSong ? [{ kind: "song", track: lastSong } as JumpItem] : [])].slice(0, 6);

	const favorites = readFavorites()
		.map(name => byKey.get(name.toLowerCase()))
		.filter((g): g is InstalledGame => !!g && !recentGames.includes(g));
	// Quick links the user pinned count as sites, after the ones history ranks.
	const known = new Set(sites.map(s => s.canonical));
	const pinned: FrecentSite[] = readLinks()
		.filter(l => /^https?:\/\//i.test(l.href) && !known.has(canonicalUrl(l.href)) && !open.has(canonicalUrl(l.href)))
		.map(l => ({ url: l.href, canonical: canonicalUrl(l.href), title: l.title, frecency: 0, lastAt: 0, visits: 0 }));

	return {
		jumpBackIn,
		games: {
			recent: recentGames.slice(0, 12),
			favorites: favorites.slice(0, 12),
			trending: server.games.trending.map(t => ({ ...t, installed: byKey.get(t.key) })),
		},
		music: server.music,
		sites: [...sites.slice(0, 8), ...pinned].slice(0, 12),
	};
}
