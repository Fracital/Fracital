/**
 * The account's active streak (src/server/streaks.ts). While signed in and the app is visible, a heartbeat a
 * minute counts toward the day; the server decides when a day counts and when the promo is won.
 */
import { create } from "zustand";
import { getMe, meFetch, refreshMe } from "./auth";

export interface StreakPromo {
	active: boolean;
	need: number;
	progress: number;
	slotsLeft: number;
	rewardDays: number;
	won: boolean;
	premiumUntil: string | null;
}

export interface StreakState {
	current: number;
	best: number;
	activeToday: boolean;
	todayMinutes: number;
	goalMinutes: number;
	promo: StreakPromo | null;
}

export const useStreakStore = create<{
	streak: StreakState | null;
	/** Set when a heartbeat just won the promo; cleared once the notice was shown. */
	justWon: boolean;
	dismissWin: () => void;
}>(set => ({
	streak: null,
	justWon: false,
	dismissWin: () => set({ justWon: false }),
}));

const HEARTBEAT_MS = 60_000;

let started = false;
let signedIn = false;
let timer: number | undefined;
let lastPing = 0;

const visible = () => document.visibilityState === "visible";

async function ping() {
	if (!signedIn || !visible()) return;
	lastPing = Date.now();
	const res = await meFetch<StreakState & { wonPromo: boolean }>("/api/me/activity", { method: "POST", body: "{}" }).catch(() => null);
	if (!res) return;
	const { wonPromo, ...streak } = res;
	useStreakStore.setState(wonPromo ? { streak, justWon: true } : { streak });
	// Premium switches ads off once the account is re-read.
	if (wonPromo) void refreshMe();
}

async function load() {
	window.clearInterval(timer);
	signedIn = !!(await getMe());
	if (!signedIn) {
		useStreakStore.setState({ streak: null });
		return;
	}
	const streak = await meFetch<StreakState>("/api/me/streak").catch(() => null);
	useStreakStore.setState({ streak });
	void ping();
	timer = window.setInterval(() => void ping(), HEARTBEAT_MS);
}

export function startStreak() {
	if (started) return;
	started = true;
	void load();
	// Signing in or out (or premium changing): start over for the account now signed in.
	window.addEventListener("account-upd", () => {
		const wasSignedIn = signedIn;
		void getMe().then(me => {
			if (!!me !== wasSignedIn) void load();
		});
	});
	// Coming back to the app: count right away instead of waiting out the interval.
	document.addEventListener("visibilitychange", () => {
		if (visible() && Date.now() - lastPing >= HEARTBEAT_MS) void ping();
	});
}
