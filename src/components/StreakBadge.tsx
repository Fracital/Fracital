import { FireIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useState } from "react";
import { meFetch } from "../libs/auth";
import { useHolyAttr } from "../libs/holy-attr";
import { useStreakStore } from "../libs/streak";
import { useTabsStore } from "../store";
import { HolyDynamic, HolyRich } from "./common/HolyRich";
import { HolyText } from "./common/HolyText";
import { useModal } from "./Modal/ModalContext";

const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });

/** A flame and the streak's day count; dimmed until today counts. Nothing while there's no streak. */
export const StreakBadge = ({ className = "" }: { className?: string }) => {
	const streak = useStreakStore(state => state.streak);
	const label = streak ? `${streak.current}-day streak (best ${streak.best})${streak.activeToday ? "" : `, ${streak.todayMinutes} of ${streak.goalMinutes} minutes today`}` : "";
	const { ref, placeholder } = useHolyAttr({ title: label, "aria-label": label });
	if (!streak?.current) return null;
	return (
		<span ref={ref} {...placeholder} className={`flex items-center gap-0.5 text-sm font-bold leading-none duration-150 ${streak.activeToday ? "text-[#ff8a3d]" : "text-(--text-tertiary)"} ${className}`}>
			<FireIcon className="size-4.5" />
			{streak.current}
		</span>
	);
};

/** Next to a name in Social: the member's streak, when they have one. */
export const NameStreak = ({ streak }: { streak?: number }) => {
	const label = `${streak}-day streak`;
	const { ref, placeholder } = useHolyAttr({ title: label, "aria-label": label });
	if (!streak) return null;
	return (
		<span ref={ref} {...placeholder} className="inline-flex items-center gap-0.5 text-xs font-bold leading-none text-[#ff8a3d]">
			<FireIcon className="size-3.5" />
			{streak}
		</span>
	);
};

/** The Account page's card: the streak, today's progress and, while it runs, the promo. */
export const StreakCard = () => {
	const streak = useStreakStore(state => state.streak);
	if (!streak) return null;
	const promo = streak.promo;
	const todayPct = Math.min(100, (streak.todayMinutes / streak.goalMinutes) * 100);
	return (
		<div className="flex flex-col gap-3 p-4 rounded-2xl bg-(--tertiary)">
			<div className="flex items-center gap-3">
				<FireIcon className={`size-9 shrink-0 ${streak.activeToday ? "text-[#ff8a3d]" : "text-(--text-tertiary)"}`} />
				<div className="flex flex-col gap-1">
					<HolyRich className="text-lg font-bold leading-none">
						<HolyDynamic>{streak.current}</HolyDynamic> day streak
					</HolyRich>
					<HolyRich className="text-sm text-(--text-secondary) leading-none">
						Best: <HolyDynamic>{streak.best}</HolyDynamic> days
					</HolyRich>
				</div>
			</div>
			{streak.activeToday ? (
				<HolyText className="text-sm text-(--text-secondary)" text="Today counts. Come back tomorrow to keep it going." />
			) : (
				<div className="flex flex-col gap-1.5">
					<HolyRich className="text-sm text-(--text-secondary)">
						Today: <HolyDynamic>{streak.todayMinutes}</HolyDynamic> of <HolyDynamic>{streak.goalMinutes}</HolyDynamic> minutes
					</HolyRich>
					<span className="h-1.5 rounded-full bg-(--secondary) overflow-hidden">
						<span style={{ width: `${todayPct}%` }} className="block h-full rounded-full bg-[#ff8a3d]" />
					</span>
				</div>
			)}
			{promo?.won && promo.premiumUntil ? (
				<HolyRich className="text-sm font-semibold text-[#ff8a3d]">
					You won the streak promo: premium until <HolyDynamic>{dateText(promo.premiumUntil)}</HolyDynamic>
				</HolyRich>
			) : promo?.active ? (
				<div className="flex flex-col gap-1 p-3 rounded-xl bg-(--secondary)">
					<HolyRich className="text-sm font-semibold">
						Streak promo: <HolyDynamic>{promo.progress}</HolyDynamic> of <HolyDynamic>{promo.need}</HolyDynamic> days
					</HolyRich>
					<HolyRich className="text-xs text-(--text-secondary)">
						The first accounts to reach <HolyDynamic>{promo.need}</HolyDynamic> days in a row get <HolyDynamic>{promo.rewardDays}</HolyDynamic> days of premium. <HolyDynamic>{promo.slotsLeft}</HolyDynamic> spots left.
					</HolyRich>
				</div>
			) : null}
		</div>
	);
};

/** Shown once when a heartbeat wins the promo. Mount once, inside the ModalProvider. */
export const StreakWinNotice = () => {
	const justWon = useStreakStore(state => state.justWon);
	const dismiss = useStreakStore(state => state.dismissWin);
	const { openModal, closeModal } = useModal();
	useEffect(() => {
		if (!justWon) return;
		dismiss();
		const promo = useStreakStore.getState().streak?.promo;
		openModal(
			<div className="flex flex-col items-center gap-3 p-3 text-center">
				<FireIcon className="size-14 text-[#ff8a3d]" />
				<HolyText as="h2" className="text-xl font-bold" text="You made the streak promo!" />
				<HolyRich as="p" className="text-sm text-(--text-secondary)">
					You were one of the first to keep a <HolyDynamic>{promo?.need ?? 7}</HolyDynamic>-day streak. Premium is on until <HolyDynamic>{promo?.premiumUntil ? dateText(promo.premiumUntil) : ""}</HolyDynamic>.
				</HolyRich>
				<button className="mt-1 px-4 py-2 rounded-lg bg-(--accent) text-white font-semibold cursor-pointer" onClick={closeModal}>
					<HolyText text="Nice" />
				</button>
			</div>,
		);
	}, [justWon, dismiss, openModal, closeModal]);
	return null;
};

interface RunningPromo {
	id: string;
	need: number;
	rewardDays: number;
	slots: number;
	slotsLeft: number;
}

const PROMO_DISMISSED_KEY = "fracital:promo-dismissed";

const readDismissed = () => {
	try {
		return localStorage.getItem(PROMO_DISMISSED_KEY);
	} catch {
		return null;
	}
};

/**
 * The home page's notice while the streak promo runs: its terms and spots left, the account's progress when signed
 * in, or a way to sign in to join. Hidden once won, once the spots run out, or (for this run) once dismissed.
 */
export const PromoNotice = ({ className = "" }: { className?: string }) => {
	const [promo, setPromo] = useState<RunningPromo | null>(null);
	const [dismissed, setDismissed] = useState(readDismissed);
	const mine = useStreakStore(state => state.streak?.promo ?? null);
	const signedIn = useStreakStore(state => !!state.streak);
	const { ref: closeRef, placeholder: closeAttrs } = useHolyAttr({ "aria-label": "Dismiss", title: "Dismiss" });

	useEffect(() => {
		const load = () =>
			meFetch<{ promo: RunningPromo | null }>("/api/promo").then(
				r => setPromo(r.promo),
				() => setPromo(null),
			);
		void load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, []);

	if (!promo || dismissed === promo.id || mine?.won) return null;
	const slotsLeft = mine?.active ? mine.slotsLeft : promo.slotsLeft;
	if (!slotsLeft) return null;

	const dismiss = () => {
		setDismissed(promo.id);
		try {
			localStorage.setItem(PROMO_DISMISSED_KEY, promo.id);
		} catch {}
	};
	const openAccount = () => useTabsStore.getState().newTab({ id: createId(), url: "about:account", displayUrl: "about:account", title: "Fracital Account", icon: null, current: true });
	const progress = mine?.active ? mine.progress : 0;

	return (
		// One row on a wide page; on a narrow one (a phone) the button moves under the text so the text keeps its width.
		<div role="status" className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] @xl:grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3 bg-[#ff8a3d]/12 inset-shadow-[0_0_0_1.5px_#ff8a3d40] ${className}`}>
			<FireIcon className="size-9 shrink-0 self-start @xl:self-center text-[#ff8a3d]" />
			<div className="flex min-w-0 flex-col gap-1">
				<HolyText className="font-bold leading-tight" text="The streak promo is on" />
				<HolyRich as="p" className="text-sm text-(--text-secondary)">
					Keep a <HolyDynamic>{promo.need}</HolyDynamic>-day streak and get <HolyDynamic>{promo.rewardDays}</HolyDynamic> days of premium. The first <HolyDynamic>{promo.slots}</HolyDynamic> accounts win, <HolyDynamic>{slotsLeft}</HolyDynamic> spots left.
				</HolyRich>
				{signedIn && (
					<div className="flex items-center gap-2">
						<span className="h-1.5 flex-1 max-w-48 overflow-hidden rounded-full bg-(--secondary)">
							<span style={{ width: `${Math.min(100, (progress / promo.need) * 100)}%` }} className="block h-full rounded-full bg-[#ff8a3d]" />
						</span>
						<HolyRich className="text-xs font-semibold text-(--text-secondary)">
							<HolyDynamic>{progress}</HolyDynamic> of <HolyDynamic>{promo.need}</HolyDynamic> days
						</HolyRich>
					</div>
				)}
			</div>
			<button type="button" className="col-start-2 row-start-2 @xl:col-start-3 @xl:row-start-1 justify-self-start shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold bg-[#ff8a3d] text-black hover:brightness-110 cursor-pointer duration-150" onClick={openAccount}>
				<HolyText text={signedIn ? "Your streak" : "Sign in to join"} />
			</button>
			<button ref={closeRef} {...closeAttrs} type="button" className="col-start-3 row-start-1 @xl:col-start-4 shrink-0 self-start rounded-full p-1 text-(--text-tertiary) hover:text-(--text-primary) hover:bg-[#8882] cursor-pointer duration-150" onClick={dismiss}>
				<XMarkIcon className="size-4" />
			</button>
		</div>
	);
};
