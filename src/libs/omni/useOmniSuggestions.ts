/**
 * The omnibox's rows for what's typed: local sources at once, the catalog and search completions after a short
 * pause (one request in flight, a late answer for an older query is dropped). The empty box gets top picks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMusicStore, useTabsStore } from "../../store";
import { useBrowsingHistory } from "../browsingHistory";
import { useGameHistory } from "../gameHistory";
import { ensureInstalledGames, useFavoriteGames, useInstalledGames } from "../installedGames";
import { ensurePlaylistsLoaded, usePlaylistStore } from "../playlists";
import { ensureSavedLoaded, useSavedStore } from "../savedLibrary";
import { type Ranked, rankAndGroup, type Suggestion, topPicks } from "./rank";
import { localSuggestions, pickParts, rankOptions, remoteSuggestions } from "./sources";

const REMOTE_DELAY_MS = 250;
const REMOTE_MIN_CHARS = 2;
const EMPTY: Ranked = { groups: [], rows: [] };

export function useOmniSuggestions(query: string, enabled: boolean): { ranked: Ranked; loading: boolean } {
	const q = query.trim();
	// Subscribed only to re-rank when something changes; the sources read the stores themselves.
	const visits = useBrowsingHistory(s => s.visits);
	const tabs = useTabsStore(s => s.tabs);
	const games = useInstalledGames(s => s.games);
	const favorites = useFavoriteGames(s => s.favorites);
	const plays = useGameHistory(s => s.plays);
	const currentTrack = useMusicStore(s => s.currentTrack);
	const playedHistory = useMusicStore(s => s.playedHistory);
	const savedTracks = useSavedStore(s => s.tracks);
	const savedArtists = useSavedStore(s => s.artists);
	const liked = usePlaylistStore(s => s.liked);

	useEffect(() => {
		if (!enabled) return;
		ensureInstalledGames();
		ensureSavedLoaded();
		ensurePlaylistsLoaded();
	}, [enabled]);

	const [remote, setRemote] = useState<{ forQuery: string; rows: Suggestion[] } | null>(null);
	const [loading, setLoading] = useState(false);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => {
		controller.current?.abort();
		controller.current = null;
		const opts = rankOptions(q);
		if (!enabled || q.length < REMOTE_MIN_CHARS || opts.urlLike) {
			setLoading(false);
			return;
		}
		const ac = new AbortController();
		controller.current = ac;
		const timer = window.setTimeout(() => {
			setLoading(true);
			remoteSuggestions(q, ac.signal)
				.then(rows => {
					if (!ac.signal.aborted) setRemote({ forQuery: q, rows });
				})
				.finally(() => {
					if (!ac.signal.aborted) setLoading(false);
				});
		}, REMOTE_DELAY_MS);
		return () => {
			window.clearTimeout(timer);
			ac.abort();
		};
	}, [q, enabled]);

	// The store slices are read inside the sources; they're listed so a change re-ranks.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	const ranked = useMemo(() => {
		if (!enabled) return EMPTY;
		if (!q) return topPicks(pickParts());
		const remoteRows = remote && remote.forQuery === q ? remote.rows : [];
		return rankAndGroup(q, [...localSuggestions(q), ...remoteRows], rankOptions(q));
	}, [q, enabled, remote, visits, tabs, games, favorites, plays, currentTrack, playedHistory, savedTracks, savedArtists, liked]);

	return { ranked, loading };
}
