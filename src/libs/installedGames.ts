/**
 * The games installed in the virtual file system (GamesPath), shared by about:games, the omnibox and For You.
 * Only metadata is kept here; a Flash game's bytes load when it opens (loadGameData), not for every listing.
 * Favorites live in localStorage ("favoriteGames", a list of folder names) as before.
 */
import { create } from "zustand";
import { GamesPath } from "../types";

export interface InstalledGame {
	/** The folder name, also the id in about:games?g=. */
	id: string;
	folderName: string;
	folderPath: string;
	title: string;
	type: "flash" | "html5";
	/** A data URI or URL. */
	thumbnail?: string;
	author?: string;
	version?: string;
	description?: string;
	tags?: string[];
	/** HTML5: the entry file; Flash: the .swf. */
	gameFile?: string;
	createdAt?: string;
	modifiedAt?: string;
}

interface InstalledState {
	games: InstalledGame[];
	loading: boolean;
	/** The first read has finished (even if it found nothing). */
	ready: boolean;
}

export const useInstalledGames = create<InstalledState>(() => ({ games: [], loading: false, ready: false }));

const fs = () => (typeof window !== "undefined" ? window.fr?.fs : undefined);

/** A game folder's index.json, as written by the installer and the upload dialog. */
interface GameMetadata {
	title?: string;
	type?: string;
	thumbnail?: string;
	gameFile?: string;
	author?: string;
	version?: string;
	description?: string;
	tags?: unknown;
	createdAt?: string;
	modifiedAt?: string;
}

async function readFolder(folderName: string): Promise<InstalledGame | null> {
	const folderPath = `${GamesPath}/${folderName}`;
	const entries: string[] = await window.fr.fs.promises.readdir(folderPath);
	let metadata: GameMetadata = {};
	if (entries.includes("index.json")) {
		try {
			metadata = JSON.parse(await window.fr.fs.promises.readFile(`${folderPath}/index.json`, "utf8"));
		} catch (err) {
			console.warn(`No metadata for ${folderName}:`, err);
		}
	}
	let thumbnail: string | undefined = metadata.thumbnail;
	if (!thumbnail) {
		const name = ["index.png", "icon.png", "thumbnail.png"].find(n => entries.includes(n));
		if (name) {
			try {
				const image = await window.fr.fs.promises.readFile(`${folderPath}/${name}`);
				thumbnail = `data:image/png;base64,${window.fr.buffer.from(image).toString("base64")}`;
			} catch (err) {
				console.warn(`Could not read thumbnail for ${folderName}:`, err);
			}
		}
	}
	const type: "flash" | "html5" = metadata.type === "html5" ? "html5" : "flash";
	const gameFile = type === "flash" ? entries.find(n => n.toLowerCase().endsWith(".swf")) : metadata.gameFile || "index.html";
	if (!gameFile || (type === "html5" && !entries.includes(gameFile))) return null;
	return {
		id: folderName,
		folderName,
		folderPath,
		title: metadata.title || folderName,
		type,
		thumbnail,
		author: metadata.author,
		version: metadata.version,
		description: metadata.description,
		tags: Array.isArray(metadata.tags) ? metadata.tags.filter((t): t is string => typeof t === "string") : undefined,
		gameFile,
		createdAt: metadata.createdAt,
		modifiedAt: metadata.modifiedAt,
	};
}

/** Re-reads the games folder. */
export async function refreshInstalledGames(): Promise<void> {
	if (!fs()) {
		useInstalledGames.setState({ games: [], loading: false, ready: true });
		return;
	}
	useInstalledGames.setState({ loading: true });
	try {
		const folders: string[] = await window.fr.fs.promises.readdir(GamesPath);
		const games: InstalledGame[] = [];
		for (const folderName of folders) {
			try {
				const game = await readFolder(folderName);
				if (game) games.push(game);
			} catch (err) {
				console.error(`Error reading game folder ${folderName}:`, err);
			}
		}
		useInstalledGames.setState({ games, loading: false, ready: true });
	} catch (err) {
		console.error("Failed to read games directory:", err);
		useInstalledGames.setState({ loading: false, ready: true });
	}
}

let started = false;
/** Reads the games once and follows changes to the folder. Safe to call from many places. */
export function ensureInstalledGames() {
	if (started || typeof window === "undefined") return;
	started = true;
	void refreshInstalledGames();
	// Without the file system (it failed to start) the list stays empty instead of taking the app down.
	const f = fs();
	if (!f) return;
	// Installing a game writes many files; one re-read a moment after the last one is enough.
	let timer: number | undefined;
	// @ts-expect-error Filer's types don't list watch.
	f.watch(GamesPath, { recursive: true }, () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => void refreshInstalledGames(), 300);
	});
}

/** A Flash game's bytes, read when it opens. */
export async function loadGameData(game: InstalledGame): Promise<ArrayBuffer> {
	const data = await window.fr.fs.promises.readFile(`${game.folderPath}/${game.gameFile}`);
	const bytes: Uint8Array = data instanceof Uint8Array ? data : data?.buffer instanceof ArrayBuffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// --- Favorites ---

const FAVORITES_KEY = "favoriteGames";

export const readFavorites = (): string[] => {
	try {
		const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
		return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
};

export const useFavoriteGames = create<{ favorites: string[] }>(() => ({ favorites: typeof window === "undefined" ? [] : readFavorites() }));

export const toggleFavorite = (folderName: string) => {
	const current = readFavorites();
	const next = current.includes(folderName) ? current.filter(n => n !== folderName) : [...current, folderName];
	try {
		localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
	} catch {}
	useFavoriteGames.setState({ favorites: next });
};

if (typeof window !== "undefined") {
	window.addEventListener("storage", e => {
		if (e.key === FAVORITES_KEY) useFavoriteGames.setState({ favorites: readFavorites() });
	});
}
