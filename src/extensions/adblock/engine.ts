import type { FiltersEngine } from "@ghostery/adblocker";
import { cryptoFetch } from "../../libs/api-crypto-fetch";
import type { ExtensionStatus } from "../types";

/*
 * The ad blocker's filter engine (Ghostery's adblocker, which reads uBlock/AdBlock Plus filter lists). The library
 * loads only once the ad blocker is switched on. The engine built from the lists is cached in the browser's virtual
 * drive, and rebuilt only when our server has new versions of the lists.
 */

type AdblockerLib = typeof import("@ghostery/adblocker");

const DIR = "/extensions";
const ENGINE_DIR = `${DIR}/adblock`;
const ENGINE_PATH = `${ENGINE_DIR}/engine.bin`;
const META_PATH = `${ENGINE_DIR}/meta.json`;
/** The server's id for uBlock's resources (scriptlets and stand-in files), loaded with the lists. */
const RESOURCES_ID = "resources";

let lib: AdblockerLib | null = null;
let engine: FiltersEngine | null = null;
/** Bumped on every (re)load, so a slow load that's been replaced doesn't overwrite a newer one. */
let generation = 0;

/** The engine, once it's ready; null while it loads or while the ad blocker is off. */
export const currentEngine = () => (lib && engine ? { lib, engine } : null);

const exists = async (path: string) => {
	try {
		await window.fr.fs.promises.stat(path);
		return true;
	} catch {
		return false;
	}
};

const readCache = async (key: string) => {
	try {
		const meta = JSON.parse(await window.fr.fs.promises.readFile(META_PATH, "utf8"));
		if (meta?.key !== key) return null;
		return new Uint8Array(await window.fr.fs.promises.readFile(ENGINE_PATH));
	} catch {
		return null;
	}
};

const writeCache = async (key: string, bytes: Uint8Array) => {
	try {
		if (!(await exists(DIR))) await window.fr.fs.promises.mkdir(DIR);
		if (!(await exists(ENGINE_DIR))) await window.fr.fs.promises.mkdir(ENGINE_DIR);
		await window.fr.fs.promises.writeFile(ENGINE_PATH, window.fr.buffer.from(bytes));
		await window.fr.fs.promises.writeFile(META_PATH, JSON.stringify({ key }), "utf8");
	} catch {
		// Without a cache it just rebuilds next time.
	}
};

/** The last cache key written, whatever lists it was for: used when the server can't be reached. */
const readAnyCache = async () => {
	try {
		return new Uint8Array(await window.fr.fs.promises.readFile(ENGINE_PATH));
	} catch {
		return null;
	}
};

const fetchJson = async <T>(path: string): Promise<T> => {
	const response = await cryptoFetch(path);
	if (!response.ok) throw new Error(`${response.status}`);
	return response.json() as Promise<T>;
};

const formatCount = (n: number) => n.toLocaleString();

/** Loads (or rebuilds) the engine for these lists, reporting progress for the extension's card. */
export const loadEngine = async (lists: string[], report: (status: ExtensionStatus) => void) => {
	const mine = ++generation;
	report({ state: "loading" });
	lib ??= await import("@ghostery/adblocker");
	const { FiltersEngine } = lib;

	let versions: { id: string; version: string | null }[] | null = null;
	let resources: { id: string; version: string | null } | undefined;
	try {
		const offered = (await fetchJson<{ lists: { id: string; version: string | null }[] }>("/api/extensions/filters")).lists;
		versions = offered.filter(list => lists.includes(list.id));
		// The scripts and stand-in files the filters refer to, loaded with any list (uBlock's need them; the rest may).
		resources = offered.find(list => list.id === RESOURCES_ID && list.version);
		if (resources) versions.push(resources);
	} catch {
		// Offline or the server can't reach the lists: fall back to whatever was cached.
	}
	const key = versions ? versions.map(list => `${list.id}@${list.version}`).join("+") : null;

	let built: FiltersEngine | null = null;
	const cached = key ? await readCache(key) : await readAnyCache();
	if (cached) {
		try {
			built = FiltersEngine.deserialize(cached);
		} catch {
			built = null;
		}
	}
	if (!built) {
		if (!versions?.length) throw new Error("The filter lists couldn't be loaded.");
		const texts = await Promise.all(versions.map(list => fetchJson<{ text: string }>(`/api/extensions/filters/${encodeURIComponent(list.id)}`).then(body => body.text)));
		const filters = texts.filter((_, i) => versions?.[i].id !== RESOURCES_ID);
		built = FiltersEngine.parse(filters.join("\n"), { loadCosmeticFilters: true, loadNetworkFilters: true, enableHtmlFiltering: false, loadExtendedSelectors: false });
		const resourcesAt = versions.findIndex(list => list.id === RESOURCES_ID);
		if (resourcesAt >= 0) built.updateResources(texts[resourcesAt], versions[resourcesAt].version ?? "");
		if (key) void writeCache(key, built.serialize());
	}
	if (mine !== generation) return;
	engine = built;
	const { networkFilters, cosmeticFilters } = built.getFilters();
	report({ state: "ready", detail: formatCount(networkFilters.length + cosmeticFilters.length) });
};

export const unloadEngine = () => {
	generation++;
	engine = null;
};
