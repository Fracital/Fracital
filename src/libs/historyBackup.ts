/**
 * Keeps this browser's history (browsingHistory.ts) and the account's backup the same, once the account has turned
 * backup on (src/server/history-backup.ts). Every exchange is a merge on the server, so devices converge without
 * conflicts; a device's deletions travel as tombstones. Signed out, or with backup off, nothing leaves the browser.
 */
import { create } from "zustand";
import { getMe, meFetch } from "./auth";
import { applyRemote, getTombstones, onHistoryChange, setHistoryCap, useBrowsingHistory } from "./browsingHistory";
import { HISTORY_CAP, type HistoryTombstones, type HistoryVisit, mergeHistory } from "./history-limits";

type Meta = { enabled: boolean; cap: number; premiumCap: number; count: number; updatedAt: string | null };
type Full = Meta & { visits: HistoryVisit[]; tombstones: HistoryTombstones };

export type HistoryBackupStatus = "off" | "syncing" | "synced" | "error";

export const useHistoryBackup = create<{
	/** null until the account answered (or while signed out). */
	enabled: boolean | null;
	status: HistoryBackupStatus;
	count: number;
	cap: number;
	premiumCap: number;
	updatedAt: string | null;
	error?: string;
}>(() => ({ enabled: null, status: "off", count: 0, cap: HISTORY_CAP.free, premiumCap: HISTORY_CAP.premium, updatedAt: null }));

/** How long after the last change a backup goes out: a page load reports its URL, title and icon one after another. */
const PUSH_DELAY_MS = 5000;

// One exchange at a time; the exported entry points queue behind each other.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(op: () => Promise<T>) => {
	const next = chain.catch(() => undefined).then(op);
	chain = next;
	return next;
};

const adopt = (m: Meta) => {
	setHistoryCap(m.cap);
	useHistoryBackup.setState({ enabled: m.enabled, cap: m.cap, premiumCap: m.premiumCap, count: m.count, updatedAt: m.updatedAt });
};
const failed = (err: unknown) => useHistoryBackup.setState({ status: "error", error: err instanceof Error ? err.message : "Backup failed" });

const body = () => JSON.stringify({ visits: useBrowsingHistory.getState().visits, tombstones: getTombstones() });

/** Sends this browser's history; the server merges and answers with the account's copy, which this browser adopts. */
const pushNow = async (keepalive = false) => {
	if (!useHistoryBackup.getState().enabled) return;
	useHistoryBackup.setState({ status: "syncing", error: undefined });
	try {
		const data = body();
		const res = await meFetch<Full>("/api/me/history-backup", { method: "PUT", body: data, keepalive: keepalive && data.length < 60_000 });
		applyRemote(res.visits, res.tombstones);
		adopt(res);
		useHistoryBackup.setState({ status: "synced" });
	} catch (err) {
		failed(err);
	}
};

/** Merges the account's copy into this browser first (so nothing here is lost), then sends the result. */
const fullSyncNow = async () => {
	useHistoryBackup.setState({ status: "syncing", error: undefined });
	try {
		const remote = await meFetch<Full>("/api/me/history-backup");
		adopt(remote);
		if (!remote.enabled) {
			useHistoryBackup.setState({ status: "off" });
			return;
		}
		const merged = mergeHistory(useBrowsingHistory.getState().visits, remote.visits, getTombstones(), remote.tombstones, remote.cap);
		applyRemote(merged.visits, merged.tombstones);
	} catch (err) {
		failed(err);
		return;
	}
	await pushNow();
};

const refreshNow = async () => {
	const me = await getMe();
	if (!me) {
		setHistoryCap(HISTORY_CAP.free);
		useHistoryBackup.setState({ enabled: null, status: "off", count: 0, updatedAt: null, error: undefined });
		return;
	}
	try {
		const meta = await meFetch<Meta>("/api/me/history-backup?meta=1");
		adopt(meta);
	} catch (err) {
		failed(err);
		return;
	}
	if (useHistoryBackup.getState().enabled) await fullSyncNow();
	else useHistoryBackup.setState({ status: "off" });
};

/** Reads the account's switch and, when it's on, syncs. Runs at start and whenever the account changes. */
export const refreshHistoryBackup = () => serial(refreshNow);

/** The switch on the account page. On: merge and back up now. Off: the server deletes its copy; this browser keeps its own. */
export const setHistoryBackupEnabled = (enabled: boolean) =>
	serial(async () => {
		const meta = await meFetch<Meta>("/api/me/history-backup/enabled", { method: "PUT", body: JSON.stringify({ enabled }) });
		adopt(meta);
		if (enabled) await fullSyncNow();
		else useHistoryBackup.setState({ status: "off" });
	});

let started = false;

export function startHistoryBackup() {
	if (started) return;
	started = true;
	void refreshHistoryBackup();
	window.addEventListener("account-upd", () => void refreshHistoryBackup());

	let timer: number | undefined;
	onHistoryChange(() => {
		if (!useHistoryBackup.getState().enabled) return;
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = undefined;
			void serial(() => pushNow());
		}, PUSH_DELAY_MS);
	});
	// Leaving with a backup pending: send it now, if it's small enough for keepalive.
	window.addEventListener("pagehide", () => {
		if (timer === undefined || !useHistoryBackup.getState().enabled) return;
		window.clearTimeout(timer);
		timer = undefined;
		void serial(() => pushNow(true));
	});
}
