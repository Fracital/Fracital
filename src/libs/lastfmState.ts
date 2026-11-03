/**
 * Client-side state for the signed-in user's Last.fm: whether it's connected, which
 * songs they've loved, and their personal play counts. Shared so a heart toggled in
 * one place updates everywhere.
 */
import { create } from "zustand";
import { getMe } from "./auth";
import { library } from "./music-service";

export const songKey = (title: string, artist: string) => `${artist}|${title}`.toLowerCase();

interface LastfmState {
	/** undefined until checked. */
	username: string | null | undefined;
	loved: Record<string, boolean>;
	userPlays: Record<string, number>;
	refresh: () => Promise<void>;
	/** Loads loved state + personal plays for songs not seen yet. */
	loadStats: (tracks: { title: string; artist: string }[]) => Promise<void>;
	toggleLove: (title: string, artist: string) => Promise<void>;
	markLoved: (keys: string[]) => void;
}

export const useLastfmStore = create<LastfmState>((set, get) => ({
	username: undefined,
	loved: {},
	userPlays: {},
	refresh: async () => {
		const me = await getMe();
		set({ username: me?.lastfm?.username ?? null });
	},
	loadStats: async tracks => {
		if (!get().username) return;
		const { loved } = get();
		const todo = tracks.map(t => ({ key: songKey(t.title, t.artist), title: t.title, artist: t.artist })).filter(t => !(t.key in loved));
		for (let i = 0; i < todo.length; i += 25) {
			const stats = await library.trackStats(todo.slice(i, i + 25)).catch(() => ({}) as Record<string, { userPlays: number; loved: boolean }>);
			set(s => ({
				loved: { ...s.loved, ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.loved])) },
				userPlays: { ...s.userPlays, ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.userPlays])) },
			}));
		}
	},
	toggleLove: async (title, artist) => {
		const key = songKey(title, artist);
		const next = !get().loved[key];
		set(s => ({ loved: { ...s.loved, [key]: next } })); // optimistic
		try {
			await library.love(title, artist, next);
		} catch {
			set(s => ({ loved: { ...s.loved, [key]: !next } }));
		}
	},
	markLoved: keys => set(s => ({ loved: { ...s.loved, ...Object.fromEntries(keys.map(k => [k, true])) } })),
}));

// Account changes (sign in/out, connect/disconnect Last.fm) reset what we know.
if (typeof window !== "undefined") {
	window.addEventListener("account-upd", () => {
		useLastfmStore.setState({ loved: {}, userPlays: {} });
		void useLastfmStore.getState().refresh();
	});
}
