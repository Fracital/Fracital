import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GiftIcon } from "@heroicons/react/24/solid";
import { portalTarget } from "../libs/cloak";
import { EMPTY_SLOT_SECONDS, endAdBreak, useMusicAds, watchForAdFree } from "../libs/music-ads";
import { useRewardedAd } from "../libs/rewarded-ad";
import { HolyText } from "./common/HolyText";
import { HolyDynamic, HolyRich } from "./common/HolyRich";

/** The music ad break: a card in the corner, not a modal, so the rest of the site keeps working. */
export function MusicAdBreak() {
	const breakUntil = useMusicAds(state => state.breakUntil);
	const adFreeUntil = useMusicAds(state => state.adFreeUntil);
	const rewardAds = useMusicAds(state => state.rewardAds);
	const ready = useRewardedAd(state => state.ready);
	const showing = useRewardedAd(state => state.showing);
	const slotRef = useRef<HTMLDivElement>(null);
	const [now, setNow] = useState(Date.now);
	const [earned, setEarned] = useState(false);

	useEffect(() => {
		if (!breakUntil) return;
		const tick = window.setInterval(() => setNow(Date.now()), 250);
		// Nothing filled the slot: there's no ad to wait for.
		const empty = window.setTimeout(() => {
			if (!slotRef.current?.querySelector("iframe, video, img")) endAdBreak();
		}, EMPTY_SLOT_SECONDS * 1000);
		return () => {
			window.clearInterval(tick);
			window.clearTimeout(empty);
		};
	}, [breakUntil]);

	// A short note once the hour is earned (not for one earned before this visit).
	const earnedBefore = useRef(adFreeUntil);
	useEffect(() => {
		if (adFreeUntil === earnedBefore.current) return;
		earnedBefore.current = adFreeUntil;
		setEarned(true);
		const t = window.setTimeout(() => setEarned(false), 5000);
		return () => window.clearTimeout(t);
	}, [adFreeUntil]);

	const card = "fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-32px))] rounded-2xl bg-(--secondary) text-(--text-primary) shadow-[0_8px_32px_#00000080] p-3 flex flex-col gap-2";

	if (breakUntil && !showing) {
		const left = Math.max(0, Math.ceil((breakUntil - now) / 1000));
		return createPortal(
			<div className={card}>
				<HolyRich className="text-xs font-medium text-(--text-secondary)">
					Ad break. Your music resumes in <HolyDynamic>{left}</HolyDynamic>s.
				</HolyRich>
				<div ref={slotRef} className="w-full overflow-hidden rounded-lg">
					<div data-ad="video" />
				</div>
				{ready && (
					<button className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-sm font-semibold bg-[#ffffff14] hover:bg-[#ffffff24] duration-150" onClick={() => void watchForAdFree()}>
						<GiftIcon className="size-4" />
						<HolyText text={rewardAds > 0 ? "Watch one more ad for 1 hour without breaks" : "Watch an ad for 1 hour without breaks"} />
					</button>
				)}
			</div>,
			portalTarget(),
		);
	}

	if (earned)
		return createPortal(
			<div className={card}>
				<HolyText className="text-sm font-medium" text="Thanks! No ad breaks in music for the next hour." />
			</div>,
			portalTarget(),
		);

	return null;
}
