/**
 * What the omnibox can suggest, as scored rows for rank.ts: sites from history and quick links, open tabs, the
 * app's own pages, installed games, music the user knows, and (after a pause) the music catalog and the search
 * engine's completions. Local sources read the stores' current state; the hook re-runs them when a store changes.
 */
import { createId } from "@paralleldrive/cuid2";
import type { ReactNode } from "react";
import { useMusicStore, useSettingsStore, useTabsStore } from "../../store";
import type { Track } from "../../types";
import { aboutPages } from "../aboutPages";
import { cryptoFetch } from "../api-crypto-fetch";
import { useBrowsingHistory } from "../browsingHistory";
import { useGameHistory } from "../gameHistory";
import { type InstalledGame, useFavoriteGames, useInstalledGames } from "../installedGames";
import { type MusicArtist, type MusicTrack, searchTracksBrief, trackToFracital } from "../music-service";
import { usePlaylistStore } from "../playlists";
import { readLinks } from "../quickLinks";
import { useSavedStore } from "../savedLibrary";
import { currentSearchEngine, isSearchQuery, searchUrl, urlFromInput } from "../searchEngines";
import { canonicalUrl, frecentSites, hostOf, matchScore, type PickParts, type RankOptions, recencyWeight, type Suggestion, scoreUrl, urlMatch } from "./rank";

/** Pages the box doesn't offer: aliases, legacy names, and ones that aren't for everyone. */
const HIDDEN_PAGES = new Set(["library", "player", "blocked", "admin", "newtab"]);

export const rankOptions = (query: string): RankOptions => ({ urlLike: !isSearchQuery(query), defaultUrl: urlFromInput(query) });
export const engineName = () => currentSearchEngine(useSettingsStore.getState().settings).name;

// --- Sites ---

/** History grouped by page; rebuilt only when the history changes. */
let frecentFor: { visits: unknown; sites: ReturnType<typeof frecentSites> } | null = null;
const sites = () => {
	const { visits } = useBrowsingHistory.getState();
	if (!frecentFor || frecentFor.visits !== visits) frecentFor = { visits, sites: frecentSites(visits) };
	return frecentFor.sites;
};

const siteRow = (url: string, title: string, icon: string | undefined, score: number): Suggestion => ({ kind: "url", id: `url:${canonicalUrl(url)}`, title: title || hostOf(url), subtitle: hostOf(url), icon, url, displayUrl: url, score, fill: url });

export const historySource = (q: string): Suggestion[] => sites().map(s => siteRow(s.url, s.title, s.icon, scoreUrl(urlMatch(q, s.url, s.title), s.frecency)));

export const quickLinksSource = (q: string): Suggestion[] =>
	readLinks()
		.filter(l => /^https?:\/\//i.test(l.href))
		// A link the user pinned counts as a site they use, whatever history says.
		.map(l => siteRow(l.href, l.title, undefined, scoreUrl(urlMatch(q, l.href, l.title), 4.5)));

// --- Tabs ---

const tabRow = (tab: { id: string; url: string; title: string; icon?: string | ReactNode | null }, score: number): Suggestion => ({
	kind: "tab",
	id: `tab:${tab.id}`,
	title: tab.title || hostOf(tab.url),
	subtitle: tab.url.startsWith("about:") ? tab.url : hostOf(tab.url),
	icon: tab.icon ?? undefined,
	url: tab.url,
	score,
	fill: tab.url.startsWith("about:") ? tab.url : tab.url,
	run: () => useTabsStore.getState().setCurrentTab(tab.id),
});

const otherTabs = () => useTabsStore.getState().tabs.filter(t => !t.current && t.url && !t.url.startsWith("about:newtab"));

export const tabsSource = (q: string): Suggestion[] => otherTabs().map(t => tabRow(t, urlMatch(q, t.url, t.title) * 1.05));

// --- The app's pages ---

export const pagesSource = (q: string): Suggestion[] =>
	Object.values(aboutPages)
		.filter(p => !HIDDEN_PAGES.has(p.name) && p.title)
		.map(p => {
			const url = `about:${p.name}`;
			const score = Math.max(matchScore(q, p.title as string), matchScore(q, url), matchScore(q.replace(/^about:/, ""), p.name)) * 0.9;
			return { kind: "page", id: `page:${p.name}`, title: p.title as string, subtitle: url, icon: p.icon, url, displayUrl: url, score, fill: url } satisfies Suggestion;
		});

// --- Games ---

const gameRow = (g: InstalledGame, score: number): Suggestion => {
	const url = `about:games?g=${encodeURIComponent(g.id)}`;
	return { kind: "game", id: `game:${g.id}`, title: g.title, subtitle: g.author, icon: g.thumbnail, url, displayUrl: url, score, fill: g.title };
};

export const gamesSource = (q: string): Suggestion[] => {
	const { games } = useInstalledGames.getState();
	const { favorites } = useFavoriteGames.getState();
	const lastPlayed = new Map(useGameHistory.getState().plays.map(p => [p.id, p.lastAt]));
	const now = Date.now();
	return games.map(g => {
		const match = Math.max(matchScore(q, g.title), ...(g.tags ?? []).map(t => matchScore(q, t) * 0.8));
		const last = lastPlayed.get(g.id);
		const recency = last ? recencyWeight(now - last) : 0;
		return gameRow(g, match ? match * (0.8 + 0.2 * recency) + (favorites.includes(g.folderName) ? 0.05 : 0) : 0);
	});
};

// --- Music ---

const songKey = (title: string, artist: string) => `${artist}|${title}`.toLowerCase();
const artistName = (t: Track) => (Array.isArray(t.artists) ? t.artists.join(", ") : t.artists);

const playerSongRow = (t: Track, score: number): Suggestion => ({
	kind: "song",
	id: `song:${songKey(t.title, artistName(t))}`,
	title: t.title,
	subtitle: artistName(t),
	icon: t.cover,
	score,
	fill: `${artistName(t)} ${t.title}`,
	run: () => useMusicStore.getState().playTrack({ ...t, id: createId() }),
});

const catalogSongRow = (t: MusicTrack, score: number): Suggestion => ({
	kind: "song",
	id: `song:${songKey(t.title, t.artist)}`,
	title: t.title,
	subtitle: t.artist,
	icon: t.artwork,
	score,
	fill: `${t.artist} ${t.title}`,
	run: () => useMusicStore.getState().playTrack(trackToFracital(t)),
});

const artistRow = (name: string, id: string | undefined, picture: string | undefined, score: number): Suggestion => {
	const url = id ? `about:music?digilib&artist=${encodeURIComponent(id)}` : `about:music?digilib&artistName=${encodeURIComponent(name)}`;
	return { kind: "artist", id: `artist:${name.toLowerCase()}`, title: name, icon: picture, url, displayUrl: url, score, fill: name };
};

const songMatch = (q: string, title: string, artist: string) => Math.max(matchScore(q, title), matchScore(q, `${artist} ${title}`), matchScore(q, `${title} ${artist}`));

/** Songs and artists the user already knows: playing now, played, saved, liked. */
export const localMusicSource = (q: string): Suggestion[] => {
	const { currentTrack, playedHistory } = useMusicStore.getState();
	const saved = useSavedStore.getState();
	const { liked } = usePlaylistStore.getState();
	const rows: Suggestion[] = [];
	for (const t of [currentTrack, ...[...playedHistory].reverse()].filter((t): t is Track => !!t)) rows.push(playerSongRow(t, songMatch(q, t.title, artistName(t)) * 0.85));
	for (const t of [...saved.tracks, ...liked]) rows.push(catalogSongRow(t, songMatch(q, t.title, t.artist) * 0.85));
	for (const a of saved.artists) rows.push(artistRow(a.name, a.id, a.picture, matchScore(q, a.name) * 0.8));
	return rows;
};

/** The catalog, a few songs and their artists; local rows for the same songs win. */
export const remoteMusicSource = async (q: string, signal: AbortSignal): Promise<Suggestion[]> => {
	const res = await searchTracksBrief(q, 6, signal);
	const rows: Suggestion[] = res.tracks.map((t, i) => catalogSongRow(t, 0.7 - i * 0.04));
	(res.artists ?? []).forEach((a: MusicArtist, i) => {
		rows.push(artistRow(a.name, a.id, a.picture || undefined, 0.65 - i * 0.04));
	});
	return rows;
};

// --- The search engine's completions ---

export const completionsSource = async (q: string, signal: AbortSignal): Promise<Suggestion[]> => {
	const engine = currentSearchEngine(useSettingsStore.getState().settings);
	const res = await cryptoFetch(`/api/complete?q=${encodeURIComponent(q)}&e=${engine.id}`, { signal });
	if (!res.ok) return [];
	const { s } = (await res.json()) as { s?: string[] };
	return (s ?? []).map((text, i) => ({ kind: "completion", id: `completion:${text.toLowerCase()}`, title: text, url: searchUrl(text), displayUrl: text, score: 0.55 - i * 0.02, fill: text }) satisfies Suggestion);
};

// --- Everything together ---

export const localSuggestions = (q: string): Suggestion[] => [...tabsSource(q), ...historySource(q), ...quickLinksSource(q), ...pagesSource(q), ...gamesSource(q), ...localMusicSource(q)];

export const remoteSuggestions = async (q: string, signal: AbortSignal): Promise<Suggestion[]> => {
	const [music, completions] = await Promise.all([remoteMusicSource(q, signal).catch(() => []), completionsSource(q, signal).catch(() => [])]);
	return [...music, ...completions];
};

/** What the empty box offers. */
export const pickParts = (): PickParts => {
	const games = new Map(useInstalledGames.getState().games.map(g => [g.id, g]));
	const recentGames = useGameHistory
		.getState()
		.plays.map(p => games.get(p.id))
		.filter((g): g is InstalledGame => !!g)
		.map(g => gameRow(g, 1));
	const { currentTrack, playedHistory } = useMusicStore.getState();
	const last = currentTrack ?? playedHistory[playedHistory.length - 1];
	const open = new Set(useTabsStore.getState().tabs.map(t => canonicalUrl(t.url)));
	const all = sites();
	const recentSites = [...all]
		.sort((a, b) => b.lastAt - a.lastAt)
		.filter(s => !open.has(s.canonical))
		.map(s => siteRow(s.url, s.title, s.icon, 1));
	return {
		recentGames,
		lastSong: last ? playerSongRow(last, 1) : null,
		recentSites,
		topSites: all.filter(s => !open.has(s.canonical)).map(s => siteRow(s.url, s.title, s.icon, 1)),
		openTabs: otherTabs().map(t => tabRow(t, 1)),
	};
};
