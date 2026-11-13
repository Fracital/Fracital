import { useEffect } from "react";
import { FireIcon } from "@heroicons/react/24/solid";
import { HolyText } from "./common/HolyText";
import { HolyDynamic, HolyRich } from "./common/HolyRich";
import { useModal } from "./Modal/ModalContext";
import { useHolyAttr } from "../libs/holy-attr";
import { useStreakStore } from "../libs/streak";

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
