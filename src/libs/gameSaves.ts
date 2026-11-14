/**
 * Cloud backups of game saves for signed-in Fracital Accounts.
 *
 * Games keep their saves in this origin's localStorage: Ruffle writes Flash SharedObjects there
 * (keys like `localhost//papasfreezeria_1`, base64 SOL values), and HTML5 games run in a
 * same-origin srcdoc frame. A save is matched to a game by watching which keys change while the
 * game is open, plus a title match for Flash saves written before tracking existed. Snapshots
 * are keyed by the game's title, so the same game installed on another device finds its save.
 */
import { create } from "zustand";
import { getMe, meFetch } from "./auth";
import { GamesPath } from "../types";

export interface SaveGame {
	title: string;
	type: "flash" | "html5";
	folderName: string;
}

export type SaveStatus = "signed-out" | "syncing" | "synced" | "empty" | "conflict" | "error";

interface Snapshot {
	v: 1;
	ls: Record<string, string>;
}

interface RemoteMeta {
	key: string;
	title: string;
	hash: string;
	size: number;
	updatedAt: string;
}

const INDEX_KEY = "fracital:game-save-index";
const syncStateKey = (userId: string) => `fracital:game-save-sync:${userId}`;
// The app's own localStorage keys (everything else under "fracital" is skipped by prefix).
const APP_KEYS = new Set(["quicklinks", "quicklinks-v2", "favoriteGames", "gamesDetailsCollapsed", "intercom"]);
const MAX_BYTES = 4_000_000;

export const gameSaveKey = (title: string) =>
	title
		.toLowerCase()
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 100) || "game";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isAppKey = (k: string) => k.startsWith("fracital") || APP_KEYS.has(k);
// Ruffle stores SOL files base64-encoded; "AL8" is the 0x00BF SOL magic.
const isFlashSave = (v: string | null) => !!v && v.startsWith("AL8");

function readJSON<T>(key: string, fallback: T): T {
	try {
		return (JSON.parse(localStorage.getItem(key) || "null") as T) ?? fallback;
	} catch {
		return fallback;
	}
}
const writeJSON = (key: string, value: unknown) => {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage full or blocked; tracking just starts over next time.
	}
};

function lsKeys(): string[] {
	const keys: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (k !== null) keys.push(k);
	}
	return keys;
}

function addToIndex(key: string, keys: string[]) {
	const index = readJSON<Record<string, string[]>>(INDEX_KEY, {});
	const set = new Set(index[key] ?? []);
	const before = set.size;
	for (const k of keys) if (!isAppKey(k)) set.add(k);
	if (set.size === before) return;
	index[key] = [...set];
	writeJSON(INDEX_KEY, index);
}

/** localStorage keys that belong to this game's save. */
function trackedKeys(game: SaveGame): string[] {
	const keys = new Set(readJSON<Record<string, string[]>>(INDEX_KEY, {})[gameSaveKey(game.title)] ?? []);
	if (game.type === "flash") {
		const needles = [squash(game.title), squash(game.folderName)].filter(n => n.length >= 5);
		for (const k of lsKeys()) if (!isAppKey(k) && needles.some(n => squash(k).includes(n)) && isFlashSave(localStorage.getItem(k))) keys.add(k);
	}
	return [...keys];
}

// Ruffle keys a SharedObject by the page's hostname (`fracit.al//papasfreezeria_1`), so a save made on one
// host is invisible on another. Snapshots carry Flash keys with the hostname swapped for this placeholder,
// and a restore puts back this page's hostname.
const HOST = "{host}";
const isHostedFlashKey = (game: SaveGame, k: string, v: string) => game.type === "flash" && isFlashSave(v) && k.includes("/");
const keyHost = (k: string) => k.slice(0, k.indexOf("/"));
const rehost = (k: string, host: string) => host + k.slice(k.indexOf("/"));

function collect(game: SaveGame): Snapshot {
	const ls: Record<string, string> = {};
	for (const k of trackedKeys(game).sort()) {
		const v = localStorage.getItem(k);
		if (v === null) continue;
		if (!isHostedFlashKey(game, k, v)) ls[k] = v;
		// A copy under another hostname is one Ruffle never reads here (left by restores before HOST existed).
		else if (keyHost(k) === location.hostname) ls[rehost(k, HOST)] = v;
	}
	return { v: 1, ls };
}

/**
 * cyrb53 over the sorted entries; only used to tell snapshots apart. "h2-" marks snapshots with HOST keys: an
 * unmarked hash is from before them and can't be compared with one taken now.
 */
function hashSnapshot(snap: Snapshot): string {
	const str = JSON.stringify(Object.entries(snap.ls).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return `h2-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

function applySnapshot(game: SaveGame, snap: Snapshot) {
	const incoming = new Map<string, string>();
	for (const [k, v] of Object.entries(snap.ls)) {
		if (isAppKey(k)) continue;
		// HOST keys, and the real hostnames that older snapshots carry, both land on this page's hostname.
		const local = isHostedFlashKey(game, k, v) ? rehost(k, location.hostname) : k;
		// Older snapshots can hold one save under two hostnames; keep the bigger (further along) one.
		if ((incoming.get(local)?.length ?? -1) < v.length) incoming.set(local, v);
	}
	for (const k of trackedKeys(game)) if (!incoming.has(k)) localStorage.removeItem(k);
	for (const [k, v] of incoming) localStorage.setItem(k, v);
	addToIndex(gameSaveKey(game.title), [...incoming.keys()]);
}

// ============================================================
// Status store (read by the Games view)
// ============================================================

export interface GameSaveInfo {
	status: SaveStatus;
	updatedAt?: string;
	error?: string;
}

export const useGameSaveStore = create<{ saves: Record<string, GameSaveInfo> }>(() => ({ saves: {} }));

const setInfo = (key: string, info: GameSaveInfo) => {
	useGameSaveStore.setState(s => ({ saves: { ...s.saves, [key]: info } }));
	return info;
};

// ============================================================
// Sync
// ============================================================

const running = new Set<string>();
const chains = new Map<string, Promise<unknown>>();

/** Runs operations for the same game one at a time. */
function serial<T>(key: string, op: () => Promise<T>): Promise<T> {
	const next = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(op);
	chains.set(key, next);
	return next;
}

const listRemote = async () => new Map((await meFetch<{ saves: RemoteMeta[] }>("/api/me/game-saves")).saves.map(s => [s.key, s]));

type SyncMode = "auto" | "upload" | "restore";

/**
 * Reconciles one game's save with the account.
 * - auto: uploads when only this device changed, restores when only the cloud changed
 *   (and the game isn't running), and reports a conflict when both changed.
 * - upload / restore: resolve a conflict one way or the other.
 */
export function syncGame(game: SaveGame, mode: SyncMode = "auto", opts: { remote?: Map<string, RemoteMeta>; keepalive?: boolean } = {}): Promise<GameSaveInfo> {
	const key = gameSaveKey(game.title);
	return serial(key, async () => {
		const me = await getMe();
		if (!me) return setInfo(key, { status: "signed-out" });
		const prev = useGameSaveStore.getState().saves[key];
		setInfo(key, { ...prev, status: "syncing" });

		const stateKey = syncStateKey(me.user.id);
		const states = readJSON<Record<string, { hash: string }>>(stateKey, {});
		const remember = (hash: string) => writeJSON(stateKey, { ...readJSON(stateKey, {}), [key]: { hash } });

		try {
			const remote = (opts.remote ?? (await listRemote())).get(key);
			const local = collect(game);
			const localHash = hashSnapshot(local);
			const empty = Object.keys(local.ls).length === 0;
			// The last synced state, unless it was recorded before HOST keys: then it's unknown, so the first sync
			// restores onto an empty device and otherwise asks, rather than overwriting either side.
			const base = states[key]?.hash.startsWith("h2-") ? states[key].hash : undefined;

			const upload = async (snap = local, hash = localHash): Promise<GameSaveInfo> => {
				const data = JSON.stringify(snap);
				if (data.length > MAX_BYTES) return setInfo(key, { status: "error", error: "This save is too large to back up" });
				const res = await meFetch<{ updatedAt: string }>(`/api/me/game-saves/${key}`, { method: "PUT", body: JSON.stringify({ title: game.title, hash, data }), keepalive: opts.keepalive && data.length < 60_000 });
				remember(hash);
				return setInfo(key, { status: "synced", updatedAt: res.updatedAt });
			};
			const restore = async (): Promise<GameSaveInfo> => {
				const res = await meFetch<{ data: string; updatedAt: string }>(`/api/me/game-saves/${key}`);
				const snap = JSON.parse(res.data) as Snapshot;
				if (snap?.v !== 1 || typeof snap.ls !== "object" || !snap.ls) throw new Error("Unreadable cloud save");
				applySnapshot(game, snap);
				const restored = collect(game);
				const hash = hashSnapshot(restored);
				// A cloud save from before HOST keys reads back with a new hash: store it again in the new form.
				if (remote && remote.hash !== hash) return await upload(restored, hash);
				remember(hash);
				return setInfo(key, { status: "synced", updatedAt: res.updatedAt });
			};

			if (mode === "upload") return empty ? setInfo(key, { status: "empty" }) : await upload();
			if (mode === "restore") return remote ? await restore() : setInfo(key, { status: "empty" });

			if (!remote) return empty ? setInfo(key, { status: "empty" }) : await upload();
			if (remote.hash === localHash) {
				remember(localHash);
				return setInfo(key, { status: "synced", updatedAt: remote.updatedAt });
			}
			const localChanged = localHash !== base;
			const remoteChanged = remote.hash !== base;
			if (empty && !running.has(key)) return await restore();
			if (base && localChanged && !remoteChanged) return await upload();
			if (base && !localChanged && remoteChanged && !running.has(key)) return await restore();
			return setInfo(key, { status: "conflict", updatedAt: remote.updatedAt });
		} catch (err) {
			return setInfo(key, { ...prev, status: "error", error: err instanceof Error ? err.message : "Backup failed" });
		}
	});
}

/** Syncs before a game starts, so a cloud save is in place when it loads. Never waits more than `timeoutMs`. */
export async function prepareGame(game: SaveGame, timeoutMs = 6000): Promise<void> {
	await Promise.race([syncGame(game).catch(() => {}), new Promise(r => setTimeout(r, timeoutMs))]);
}

const backupTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleBackup(game: SaveGame, delay = 8000) {
	const key = gameSaveKey(game.title);
	clearTimeout(backupTimers.get(key));
	backupTimers.set(
		key,
		setTimeout(() => {
			backupTimers.delete(key);
			void syncGame(game);
		}, delay),
	);
}

/**
 * Call while a game is open: records which localStorage keys it writes and backs them up
 * shortly after they change. Returns a stop function (which does a final backup).
 */
export function trackGameSession(game: SaveGame): () => void {
	const key = gameSaveKey(game.title);
	const flash = game.type === "flash";
	running.add(key);
	const seen = new Map<string, string | null>(lsKeys().map(k => [k, localStorage.getItem(k)]));

	const scan = () => {
		const changed: string[] = [];
		const present = new Set(lsKeys());
		for (const k of present) {
			if (isAppKey(k)) continue;
			const v = localStorage.getItem(k);
			if (seen.get(k) === v) continue;
			seen.set(k, v);
			if (!flash || isFlashSave(v)) changed.push(k);
		}
		const tracked = new Set(trackedKeys(game));
		for (const [k, v] of seen) {
			if (v === null || present.has(k)) continue;
			seen.set(k, null);
			if (tracked.has(k)) changed.push(k);
		}
		if (!changed.length) return false;
		addToIndex(
			key,
			changed.filter(k => present.has(k)),
		);
		return true;
	};

	const timer = setInterval(() => {
		if (scan()) scheduleBackup(game);
	}, 3000);
	const onHide = () => {
		scan();
		void syncGame(game, "auto", { keepalive: true });
	};
	window.addEventListener("pagehide", onHide);

	return () => {
		clearInterval(timer);
		window.removeEventListener("pagehide", onHide);
		// Ruffle may flush SharedObjects as the player is torn down; give it a moment.
		setTimeout(() => {
			scan();
			running.delete(key);
			clearTimeout(backupTimers.get(key));
			void syncGame(game);
		}, 750);
	};
}

/** Installed games, read from each folder's index.json. */
async function installedGames(): Promise<SaveGame[]> {
	const games: SaveGame[] = [];
	const folders: string[] = await window.fr.fs.promises.readdir(GamesPath).catch(() => []);
	for (const folderName of folders) {
		try {
			const entries: string[] = await window.fr.fs.promises.readdir(`${GamesPath}/${folderName}`);
			let meta: { title?: string; type?: string } = {};
			if (entries.includes("index.json")) meta = JSON.parse(await window.fr.fs.promises.readFile(`${GamesPath}/${folderName}/index.json`, "utf8"));
			// Same rules as the Games view: no metadata means a bare Flash game named after its folder.
			const type = meta.type === "html5" ? "html5" : "flash";
			if (type === "flash" && !entries.some(n => n.toLowerCase().endsWith(".swf"))) continue;
			games.push({ title: meta.title || folderName, type, folderName });
		} catch {
			// Unreadable folder or metadata; the Games view skips these too.
		}
	}
	return games;
}

let allSync: Promise<void> | null = null;

/** Backs up / restores saves for every installed game (no-op when signed out). */
export function syncAllGames(): Promise<void> {
	allSync ??= (async () => {
		try {
			if (!(await getMe())) return;
			const [games, remote] = await Promise.all([installedGames(), listRemote()]);
			for (const game of games) await syncGame(game, "auto", { remote });
		} catch (err) {
			console.warn("Game save sync failed:", err);
		} finally {
			allSync = null;
		}
	})();
	return allSync;
}

let started = false;
/** Syncs game saves now and whenever the account changes (sign in). */
export function startGameSaveSync() {
	if (started) return;
	started = true;
	void syncAllGames();
	window.addEventListener("account-upd", () => {
		useGameSaveStore.setState({ saves: {} });
		void syncAllGames();
	});
}
