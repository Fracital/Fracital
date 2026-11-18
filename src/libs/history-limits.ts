/**
 * Browsing-history backup: the caps by tier and the merge that keeps every device and the account's copy the same.
 * Dependency-free so the server (src/server/history-backup.ts) and the client (src/libs/historyBackup.ts) share it.
 */

/** How many visits a backup (and the local history while backup is on) holds, by plan. */
export const HISTORY_CAP = { free: 5000, premium: 20000 } as const;
export const historyCap = (premium: boolean) => (premium ? HISTORY_CAP.premium : HISTORY_CAP.free);

export interface HistoryVisit {
	id: string;
	url: string;
	title: string;
	/** The page's icon URL, when it has one. */
	icon?: string;
	/** When it was visited (ms since epoch). */
	at: number;
}

/**
 * What was deleted, so a merge never brings it back: single visits by id, "clear the last hour / today" as time
 * ranges, and "clear everything" as a watermark (every visit from before it is gone).
 */
export interface HistoryTombstones {
	ids: string[];
	ranges: { from: number; to: number }[];
	clearedBefore: number;
}

export const TOMBSTONE_LIMITS = { ids: 2000, ranges: 50 } as const;

export const emptyTombstones = (): HistoryTombstones => ({ ids: [], ranges: [], clearedBefore: 0 });

export const isDeleted = (v: HistoryVisit, t: HistoryTombstones) => v.at < t.clearedBefore || t.ids.includes(v.id) || t.ranges.some(r => v.at >= r.from && v.at <= r.to);

/** The union of two sets of deletions, trimmed to the limits (the newest entries win). */
export const mergeTombstones = (a: HistoryTombstones, b: HistoryTombstones): HistoryTombstones => ({
	ids: [...new Set([...a.ids, ...b.ids])].slice(-TOMBSTONE_LIMITS.ids),
	ranges: dedupeRanges([...a.ranges, ...b.ranges]).slice(-TOMBSTONE_LIMITS.ranges),
	clearedBefore: Math.max(a.clearedBefore, b.clearedBefore),
});

const dedupeRanges = (ranges: { from: number; to: number }[]) => ranges.filter((r, i) => ranges.findIndex(o => o.from === r.from && o.to === r.to) === i);

/**
 * Two copies of a history (a device's and the account's, say) as one: the visits of both, less what either side
 * deleted, newest first, at most `cap`. Order-independent, so any number of devices converge on the same list.
 */
export function mergeHistory(a: HistoryVisit[], b: HistoryVisit[], ta: HistoryTombstones, tb: HistoryTombstones, cap: number): { visits: HistoryVisit[]; tombstones: HistoryTombstones } {
	const tombstones = mergeTombstones(ta, tb);
	const byId = new Map<string, HistoryVisit>();
	for (const v of [...a, ...b]) {
		const have = byId.get(v.id);
		// The same visit seen twice: keep the copy that learned more (a title, an icon) after the page loaded.
		if (!have || score(v) > score(have)) byId.set(v.id, v);
	}
	// Every tombstone stays (within the limits): a device that hasn't synced yet may still hold the visit.
	const visits = [...byId.values()].filter(v => !isDeleted(v, tombstones)).sort((x, y) => y.at - x.at);
	return { visits: visits.slice(0, cap), tombstones };
}

const score = (v: HistoryVisit) => (v.title ? v.title.length : 0) + (v.icon ? 1000 : 0);
