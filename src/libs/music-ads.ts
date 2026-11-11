import { create } from "zustand";
import { isKnownPremium } from "../components/AdBanner";
import { usePlaybackStore } from "../store";
import { pause, play, setPlayGate } from "./playback";
import { prepareRewardedAd, showRewardedAd, useRewardedAd } from "./rewarded-ad";

/**
 * Ad breaks in music, between songs. After every BREAK_EVERY_MINUTES of listening the next song
 * waits up to BREAK_SECONDS while the video slot shows (less if nothing fills it); the rest of the
 * site stays usable. Listeners can choose to watch rewarded ads (one long one, or two short ones)
 * for REWARD_MINUTES with no breaks. Premium accounts never get breaks.
 */

const BREAK_EVERY_MINUTES = 30;
export const BREAK_SECONDS = 15;
/** A break whose slot is still empty after this long ends at once. */
export const EMPTY_SLOT_SECONDS = 5;
const REWARD_MINUTES = 60;
/** A rewarded ad at least this long earns the hour by itself; a shorter one needs a second. */
const LONG_AD_SECONDS = 30;
const MAX_REWARD_ADS = 2;

const LISTENED_KEY = "fr:music-listened";
const AD_FREE_KEY = "fr:music-adfree";

const readNumber = (key: string) => {
	try {
		return Number(localStorage.getItem(key)) || 0;
	} catch {
		return 0;
	}
};
const writeNumber = (key: string, value: number) => {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Storage blocked: the count only lasts this visit.
	}
};

interface MusicAdsState {
	/** When the current break ends; 0 when there's none. */
	breakUntil: number;
	/** No breaks until this time. */
	adFreeUntil: number;
	/** Rewarded ads watched toward the next hour. */
	rewardAds: number;
}

export const useMusicAds = create<MusicAdsState>(() => ({ breakUntil: 0, adFreeUntil: readNumber(AD_FREE_KEY), rewardAds: 0 }));

/** Seconds listened since the last break. */
let listened = readNumber(LISTENED_KEY);
/** Breaks only follow music played this visit, never a song restored on load. */
let playedThisVisit = false;
let rewardSeconds = 0;
let breakTimer = 0;

const adFree = () => isKnownPremium() || useMusicAds.getState().adFreeUntil > Date.now();
const inBreak = () => useMusicAds.getState().breakUntil > 0;

setPlayGate(() => inBreak() || useRewardedAd.getState().showing);

window.setInterval(() => {
	if (!usePlaybackStore.getState().isPlaying || adFree()) return;
	if (!playedThisVisit) {
		playedThisVisit = true;
		void prepareRewardedAd();
	}
	listened += 1;
	if (listened % 10 === 0) writeNumber(LISTENED_KEY, listened);
}, 1000);

/** Called as a new song loads. True means a break is on and the song must wait for it. */
export function adBreakDue(): boolean {
	if (inBreak()) return true;
	if (!playedThisVisit || adFree() || listened < BREAK_EVERY_MINUTES * 60) return false;
	listened = 0;
	writeNumber(LISTENED_KEY, 0);
	useMusicAds.setState({ breakUntil: Date.now() + BREAK_SECONDS * 1000 });
	window.clearTimeout(breakTimer);
	breakTimer = window.setTimeout(endAdBreak, BREAK_SECONDS * 1000);
	pause();
	void prepareRewardedAd();
	return true;
}

/** Ends the break and plays the song that was waiting. */
export function endAdBreak() {
	window.clearTimeout(breakTimer);
	if (!inBreak()) return;
	useMusicAds.setState({ breakUntil: 0 });
	void play().catch(() => {});
}

/** Shows a rewarded ad toward an hour with no breaks. Music waits while it plays. */
export async function watchForAdFree() {
	const breaking = inBreak();
	const wasPlaying = usePlaybackStore.getState().isPlaying;
	window.clearTimeout(breakTimer);
	pause();
	const seconds = await showRewardedAd();
	if (seconds > 0) {
		const ads = useMusicAds.getState().rewardAds + 1;
		rewardSeconds += seconds;
		if (ads >= MAX_REWARD_ADS || rewardSeconds >= LONG_AD_SECONDS) {
			const until = Date.now() + REWARD_MINUTES * 60_000;
			writeNumber(AD_FREE_KEY, until);
			listened = 0;
			rewardSeconds = 0;
			useMusicAds.setState({ adFreeUntil: until, rewardAds: 0 });
		} else useMusicAds.setState({ rewardAds: ads });
	}
	if (!adFree()) void prepareRewardedAd();
	if (breaking) endAdBreak();
	else if (wasPlaying) void play().catch(() => {});
}
