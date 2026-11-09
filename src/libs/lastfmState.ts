/**
 * Client-side state for the signed-in user's listening service (Last.fm, or ListenBrainz
 * when Last.fm isn't connected): whether one is connected, which songs they've loved, and
 * their personal play counts. Shared so a heart toggled in one place updates everywhere.
 */
import { create } from "zustand";
import { getMe } from "./auth";
import { library } from "./music-service";

export const songKey = (title: string, artist: string) => `${artist}|${title}`.toLowerCase();

/** Songs whose stats are being fetched, so overlapping views don't ask twice. */
const loading = new Set<string>();

interface LastfmState {
	/** undefined until checked. */
	username: string | null | undefined;
	/** Where the library comes from: Last.fm when it's connected, else ListenBrainz. */
	service: "lastfm" | "listenbrainz" | null;
	/** Access was revoked: reads still work, likes and scrobbles wait for a reconnect. */
	needsReconnect: boolean;
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
	service: null,
	needsReconnect: false,
	loved: {},
	userPlays: {},
	refresh: async () => {
		const me = await getMe();
		const source = me?.lastfm ?? me?.listenbrainz ?? null;
		set({ username: source?.username ?? null, service: me?.lastfm ? "lastfm" : me?.listenbrainz ? "listenbrainz" : null, needsReconnect: !!source?.needsReconnect });
	},
	loadStats: async tracks => {
		if (!get().username) return;
		const { loved } = get();
		const todo = [...new Map(tracks.map(t => [songKey(t.title, t.artist), { key: songKey(t.title, t.artist), title: t.title, artist: t.artist }])).values()].filter(t => !(t.key in loved) && !loading.has(t.key));
		if (!todo.length) return;
		for (const t of todo) loading.add(t.key);
		const batches: (typeof todo)[] = [];
		for (let i = 0; i < todo.length; i += 50) batches.push(todo.slice(i, i + 50));
		// A few batches in flight at once; each shows up as soon as it arrives.
		let next = 0;
		const worker = async () => {
			while (next < batches.length) {
				const batch = batches[next++];
				const stats = await library.trackStats(batch).catch(() => null);
				for (const t of batch) loading.delete(t.key);
				if (!stats) continue;
				set(s => ({
					loved: { ...s.loved, ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.loved])) },
					userPlays: { ...s.userPlays, ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.userPlays])) },
				}));
			}
		};
		await Promise.all([worker(), worker(), worker()]);
	},
	toggleLove: async (title, artist) => {
		const key = songKey(title, artist);
		const next = !get().loved[key];
		set(s => ({ loved: { ...s.loved, [key]: next } })); // optimistic
		try {
			await library.love(title, artist, next);
		} catch (err) {
			set(s => ({ loved: { ...s.loved, [key]: !next } }));
			if ((err as { data?: { revoked?: boolean } }).data?.revoked) set({ needsReconnect: true });
		}
	},
	markLoved: keys => set(s => ({ loved: { ...s.loved, ...Object.fromEntries(keys.map(k => [k, true])) } })),
}));

// Account changes (sign in/out, connect/disconnect a service) reset what we know.
if (typeof window !== "undefined") {
	window.addEventListener("account-upd", () => {
		loading.clear();
		useLastfmStore.setState({ loved: {}, userPlays: {} });
		void useLastfmStore.getState().refresh();
	});
}
