import { create } from "zustand";
import { cryptoFetch } from "./api-crypto-fetch";

/**
 * Google Publisher Tag rewarded ads, through the GPT that RevIQ's tag loads. A rewarded slot is the
 * only ad people may be rewarded for watching: GPT asks before showing it, and reports when it's
 * been earned. The unit comes from the server (REWARDED_AD_UNIT); without one, or without GPT on the
 * page, nothing is ever offered.
 */

interface Slot {
	addService: (service: PubAds) => Slot;
	getSlotElementId: () => string;
}

interface SlotEvent {
	slot: Slot;
	isEmpty?: boolean;
	makeRewardedVisible?: () => void;
}

interface PubAds {
	addEventListener: (type: string, listener: (event: SlotEvent) => void) => void;
	removeEventListener: (type: string, listener: (event: SlotEvent) => void) => void;
	isInitialLoadDisabled: () => boolean;
	refresh: (slots: Slot[]) => void;
}

interface GoogleTag {
	cmd: { push: (fn: () => void) => void };
	enums: { OutOfPageFormat: { REWARDED: unknown } };
	defineOutOfPageSlot: (path: string, format: unknown) => Slot | null;
	pubads: () => PubAds;
	enableServices: () => void;
	display: (slot: Slot) => void;
	destroySlots: (slots: Slot[]) => boolean;
}

declare global {
	interface Window {
		googletag?: GoogleTag;
	}
}

/** `ready`: an ad is loaded and can be offered. `showing`: it's on screen. */
export const useRewardedAd = create<{ ready: boolean; showing: boolean }>(() => ({ ready: false, showing: false }));

let unit: Promise<string | null> | null = null;
const rewardedUnit = () => {
	unit ??= cryptoFetch("/api/ads/config")
		.then(res => (res.ok ? res.json() : null))
		.then((data: { rewarded?: unknown } | null) => (typeof data?.rewarded === "string" && data.rewarded ? data.rewarded : null))
		.catch(() => {
			unit = null; // try again next time
			return null;
		});
	return unit;
};

let slot: Slot | null = null;
let reveal: (() => void) | null = null;
let shownAt = 0;
let earnedSeconds = 0;
let onClosed: ((seconds: number) => void) | null = null;
let listening = false;

const drop = () => {
	if (slot) window.googletag?.destroySlots([slot]);
	slot = null;
	reveal = null;
	useRewardedAd.setState({ ready: false, showing: false });
};

const listen = (gt: GoogleTag) => {
	if (listening) return;
	listening = true;
	const ads = gt.pubads();
	ads.addEventListener("rewardedSlotReady", e => {
		if (e.slot !== slot || !e.makeRewardedVisible) return;
		reveal = e.makeRewardedVisible;
		useRewardedAd.setState({ ready: true });
	});
	ads.addEventListener("slotRenderEnded", e => {
		if (e.slot === slot && e.isEmpty) drop(); // no ad to give
	});
	ads.addEventListener("rewardedSlotGranted", e => {
		if (e.slot === slot) earnedSeconds = (Date.now() - shownAt) / 1000;
	});
	ads.addEventListener("rewardedSlotClosed", e => {
		if (e.slot !== slot) return;
		const done = onClosed;
		const seconds = earnedSeconds;
		onClosed = null;
		drop();
		done?.(seconds);
	});
};

/** Requests a rewarded ad so one is ready to offer. Does nothing if one is already loaded or loading. */
export async function prepareRewardedAd() {
	if (slot) return;
	const path = await rewardedUnit();
	const gt = window.googletag;
	if (!path || !gt || slot) return;
	gt.cmd.push(() => {
		if (slot) return;
		// Null where GPT can't show the format on this page.
		const next = gt.defineOutOfPageSlot(path, gt.enums.OutOfPageFormat.REWARDED);
		if (!next) return;
		slot = next;
		next.addService(gt.pubads());
		listen(gt);
		gt.enableServices();
		gt.display(next);
		if (gt.pubads().isInitialLoadDisabled()) gt.pubads().refresh([next]);
	});
}

/** Shows the ready ad. Resolves once it's closed, with how long it ran if it was earned, else 0. */
export function showRewardedAd(): Promise<number> {
	if (!reveal) return Promise.resolve(0);
	return new Promise(resolve => {
		onClosed = resolve;
		earnedSeconds = 0;
		shownAt = Date.now();
		useRewardedAd.setState({ ready: false, showing: true });
		reveal?.();
		reveal = null;
	});
}
