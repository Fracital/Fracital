/**
 * The games this browser has opened, most recent first, for "Jump back in" and the omnibox. Kept in localStorage
 * under "fracital:" so game-save sync skips it (gameSaves.ts). Thumbnails aren't stored (they're data URIs);
 * resolve them against the installed games when showing a row.
 */
import { create } from "zustand";
import { cryptoFetch } from "./api-crypto-fetch";
import { listenerId } from "./artistPanel";

const STORAGE_KEY = "fracital:game-history";
const CAP = 200;
/** Opening the same game again within this long is the same sitting. */
const SAME_PLAY_MS = 10 * 60_000;

export interface GamePlay {
	/** The game's folder name (its id on about:games?g=). */
	id: string;
	title: string;
	count: number;
	lastAt: number;
}

const isPlay = (p: unknown): p is GamePlay => !!p && typeof (p as GamePlay).id === "string" && typeof (p as GamePlay).lastAt === "number";

const load = (): GamePlay[] => {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
		return Array.isArray(saved) ? saved.filter(isPlay) : [];
	} catch {
		return [];
	}
};

export const useGameHistory = create<{ plays: GamePlay[] }>(() => ({ plays: typeof window === "undefined" ? [] : load() }));

if (typeof window !== "undefined") {
	let saveTimer: number | undefined;
	useGameHistory.subscribe(({ plays }) => {
		window.clearTimeout(saveTimer);
		saveTimer = window.setTimeout(() => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(plays));
			} catch {
				// Storage full or unavailable: the history just isn't kept this time.
			}
		}, 500);
	});
	window.addEventListener("storage", e => {
		if (e.key === STORAGE_KEY) useGameHistory.setState({ plays: load() });
	});
}

/** Records that a game was opened. */
export const recordGamePlay = (game: { id: string; title: string }) => {
	const now = Date.now();
	useGameHistory.setState(({ plays }) => {
		const prev = plays.find(p => p.id === game.id);
		const next: GamePlay = prev ? { ...prev, title: game.title, lastAt: now, count: now - prev.lastAt < SAME_PLAY_MS ? prev.count : prev.count + 1 } : { id: game.id, title: game.title, count: 1, lastAt: now };
		return { plays: [next, ...plays.filter(p => p.id !== game.id)].slice(0, CAP) };
	});
};

/** The n games opened most recently. */
export const recentGames = (n: number) => useGameHistory.getState().plays.slice(0, n);

/** Tells the server about a play, once the game has been open for a while (for trending games and the account's history). */
export const postGameEvent = (game: { id: string; title: string }) => cryptoFetch("/api/game-event", { method: "POST", body: JSON.stringify({ game: game.id, title: game.title, listener: listenerId() }) }).catch(() => undefined);
