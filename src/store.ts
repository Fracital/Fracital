import { create } from "zustand";
import { normalizePath } from "./views/Files/pathUtils";
import type { TabProps } from "./components/Tab";
import type { Track } from "./types";
import { createId } from "@paralleldrive/cuid2";
import { normalizeAboutUrl } from "./libs/aboutAlias";

export const usePanelsStore = create<{
	panelsOpen: boolean;
	current: "tabs" | "quickplayer";
	setCurrent: (panel: "tabs" | "quickplayer") => void;
	setPanelsOpen: (open: boolean) => void;
}>()(set => ({
	panelsOpen: false,
	current: "tabs",
	setCurrent: (panel: "tabs" | "quickplayer") => set({ current: panel }),
	setPanelsOpen: (open: boolean) => set({ panelsOpen: open }),
}));

const normalizeTabChanges = (rawChanges: Partial<TabProps>): Partial<TabProps> => {
	const changes = { ...rawChanges };
	if ("url" in changes) changes.url = normalizeAboutUrl(changes.url);
	if ("displayUrl" in changes) changes.displayUrl = normalizeAboutUrl(changes.displayUrl);
	return changes;
};

const baseId = createId();
export const useTabsStore = create<{
	tabs: TabProps[];
	groups: { id: string; name: string; icon?: string; accent?: string }[];
	setCurrentTab: (id: string | null) => void;
	tabsOpen: boolean;
	newTab: (props: TabProps) => void;
	closeTab: (id: string) => void;
	updateTab: (id: string, changes: Partial<TabProps>) => void;
	navigateTab: (id: string, changes: Partial<TabProps>) => void;
	refreshTab: (id: string) => void;
	getHistory: (id: string) => { url: string; title: string; icon?: string; displayUrl?: string }[] | null;
	setHistory: (id: string, history: { url: string; title: string; icon?: string; displayUrl?: string }[]) => void;
	getHistoryIndex: (id: string) => number;
	setHistoryIndex: (id: string, index: number) => void;
	pushHistory: (id: string, entry: { url: string; title: string; icon?: string; displayUrl?: string }) => void;
	newGroup: (id: string | null, name: string, icon?: string) => void;
	addTabToGroup: (groupId: string, tab: TabProps) => void;
	moveTabRelative: (draggedId: string, targetId: string, placeBefore: boolean) => void;
	closeGroup: (id: string) => void;
	updateGroup: (id: string, changes: Partial<{ id: string; name: string; icon?: string; accent?: string }>) => void;
}>()((set, get) => ({
	groups: [],
	tabs: [
		{
			id: baseId,
			title: "New Tab",
			url: "about:newtab",
			current: true,
			displayUrl: "about:newtab",
			index: 0,
			history: [{ url: "about:newtab", title: "New Tab", displayUrl: "about:newtab" }] as any,
			historyIndex: 0,
		},
	],
	setCurrentTab: (id: string | null) =>
		set(state => {
			return {
				tabs: state.tabs.map(t => ({
					...t,
					current: t.id === id,
				})),
			};
		}),
	tabsOpen: false,
	newTab: (rawProps: TabProps) => {
		const props = { ...rawProps, url: normalizeAboutUrl(rawProps.url), displayUrl: normalizeAboutUrl(rawProps.displayUrl) };
		const id = props.id ?? createId();
		const initialHistory = [
			{
				url: props.url,
				title: props.title,
				icon: typeof props.icon === "string" ? props.icon : undefined,
				displayUrl: props.displayUrl,
			},
		] as any;
		const tabWithId: TabProps = { ...props, id, current: true, history: initialHistory, historyIndex: 0 } as TabProps;
		set(state => ({
			tabs: state.tabs.map(tab => ({ ...tab, current: false })).concat(tabWithId as TabProps & { current: boolean }),
		}));
	},
	closeTab: (id: string) => {
		set(state => {
			const filteredTabs = state.tabs.filter(tab => tab.id !== id);
			const currentTab = state.tabs.find(tab => tab.current);
			const closingCurrent = currentTab && currentTab.id === id;
			let newTabs = filteredTabs;
			if (closingCurrent && filteredTabs.length > 0) {
				newTabs = filteredTabs.map((tab, idx) => (idx === filteredTabs.length - 1 ? { ...tab, current: true } : { ...tab, current: false }));
			}

			return {
				tabs: newTabs,
			};
		});
	},
	updateTab: (id: string, rawChanges: Partial<TabProps>) => {
		const changes = normalizeTabChanges(rawChanges);
		set(state => ({
			tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, ...changes } : tab)),
		}));
	},
	// A navigation the user asked for (address bar, quick link, back/forward):
	// the same writes as updateTab plus a new navNonce, so a proxied tab runs it
	// even when `url` is unchanged (the page moved itself elsewhere since, or
	// this is the same URL again). Page-made navigations use updateTab.
	navigateTab: (id: string, rawChanges: Partial<TabProps>) => {
		const changes = normalizeTabChanges(rawChanges);
		set(state => ({
			tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, ...changes, navNonce: (tab.navNonce ?? 0) + 1 } : tab)),
		}));
	},
	refreshTab: (id: string) =>
		set(state => ({
			tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, refreshKey: (tab.refreshKey ?? 0) + 1 } : tab)),
		})),
	getHistory: (id: string) => {
		const tab = get().tabs.find(t => t.id === id);
		return (tab as any)?.history ?? null;
	},
	setHistory: (id: string, history: { url: string; title: string; icon?: string; displayUrl?: string }[]) => {
		set(state => ({
			tabs: state.tabs.map(tab => (tab.id === id ? ({ ...tab, history } as unknown as TabProps) : tab)),
		}));
	},
	getHistoryIndex: (id: string) => {
		const tab = get().tabs.find(t => t.id === id);
		return (tab as any)?.historyIndex ?? 0;
	},
	setHistoryIndex: (id: string, index: number) => {
		set(state => ({
			tabs: state.tabs.map(tab => (tab.id === id ? ({ ...tab, historyIndex: index } as unknown as TabProps) : tab)),
		}));
	},
	pushHistory: (id: string, entry: { url: string; title: string; icon?: string; displayUrl?: string }) => {
		const tab = get().tabs.find(t => t.id === id);
		if (!tab) return;

		const currentHistory = (tab as any)?.history ?? [];
		const currentIndex = (tab as any)?.historyIndex ?? 0;

		entry = { ...entry, url: normalizeAboutUrl(entry.url), displayUrl: normalizeAboutUrl(entry.displayUrl) };
		const newHistory = [...currentHistory.slice(0, currentIndex + 1), entry];
		const newIndex = newHistory.length - 1;

		set(state => ({
			tabs: state.tabs.map(t => (t.id === id ? ({ ...t, history: newHistory, historyIndex: newIndex } as unknown as TabProps) : t)),
		}));
	},
	moveTabRelative: (draggedId: string, targetId: string, placeBefore: boolean) =>
		set(state => {
			const tabs = [...state.tabs];
			const from = tabs.findIndex(t => t.id === draggedId);
			if (from === -1) return state;

			let to = tabs.findIndex(t => t.id === targetId);
			if (to === -1) return state;

			if (from === to) return state;

			const item = tabs.splice(from, 1)[0];

			to = tabs.findIndex(t => t.id === targetId);
			if (!placeBefore) to = to + 1;

			tabs.splice(to, 0, item);
			return { tabs };
		}),
	newGroup: (id: string | null, name: string, icon?: string) =>
		set(state => ({
			groups: [...state.groups, { id: id ?? createId(), name, icon }],
		})),
	addTabToGroup: (groupId: string, tab: TabProps) =>
		set(state => {
			const tabId = tab.id ?? createId();

			const tabExists = state.tabs.some(t => t.id === tabId);
			const newTabs = tabExists ? state.tabs : state.tabs.concat({ ...tab, id: tabId });

			const updatedTabs = newTabs.map(t => (t.id === tabId ? { ...t, groupId } : t));

			return {
				tabs: updatedTabs,
			};
		}),
	closeGroup: (id: string) =>
		set(state => ({
			groups: state.groups.filter(group => group.id !== id),
			tabs: state.tabs.map(tab => (tab.groupId === id ? { ...tab, groupId: undefined } : tab)),
		})),
	updateGroup: (id: string, changes: Partial<{ id: string; name: string; icon?: string }>) =>
		set(state => ({
			groups: state.groups.map(group => (group.id === id ? { ...group, ...changes } : group)),
		})),
}));

export const useSettingsStore = create<{
	settings: Record<string, any>;
	setSettings: (key: string, value: any) => void;
	getSettings: (key: string) => any;
}>((set, get) => ({
	settings: {},
	setSettings: (key, value) =>
		set(state => ({
			settings: {
				...state.settings,
				[key]: value,
			},
		})),
	getSettings: key => {
		const settings = get().settings;
		return settings[key] !== undefined ? settings[key] : null;
	},
}));

export const useSetupStore = create<{
	step: number;
	setStep: (step: number) => void;
	isSetupComplete: boolean;
	setSetupComplete: (complete: boolean) => void;
}>(set => ({
	step: 0,
	setStep: step => set({ step }),
	isSetupComplete: false,
	setSetupComplete: complete => set({ isSetupComplete: complete }),
}));

export const useMusicStore = create<{
	src: string;
	currentTrack: Track | null;
	queue: Track[];
	playerView: "tracks" | "bigplayer";
	playedHistory: Track[];

	addTrack: (track: Track) => void;
	/** Queues songs after the ones the user queued (ahead of autoplay radio). Starts them if nothing is playing. */
	addTracks: (tracks: Track[]) => void;
	/** Queues songs to play right after the current one. Starts them if nothing is playing. */
	queueNext: (tracks: Track[]) => void;
	removeTrack: (id: string) => void;
	clearQueue: () => void;
	setCurrentTrack: (track: Track | null) => void;

	/** Plays a song on its own: the queue is replaced (autoplay radio refills it if on). */
	playTrack: (track: Track) => void;
	/** Plays `tracks[index]` and replaces the queue with the songs after it in that list. */
	playList: (tracks: Track[], index?: number) => void;
	playNext: () => void;
	playPrev: () => boolean;

	changeView: (view: "tracks" | "bigplayer") => void;
	reorderQueue: (draggedId: string, targetId: string, placeBefore: boolean) => void;
}>((set, get) => ({
	src: "",
	currentTrack: null,
	queue: [],
	playerView: "bigplayer",
	playedHistory: [],

	addTrack: track => get().addTracks([track]),
	addTracks: tracks => {
		// Fresh ids: the same song can sit in the queue more than once.
		const fresh = tracks.map(t => ({ ...t, id: createId(), radio: undefined }));
		if (!fresh.length) return;
		const { currentTrack, queue } = get();
		if (!currentTrack) return get().playList(fresh, 0);
		// After what the user queued themselves, ahead of autoplay radio's picks.
		const firstRadio = queue.findIndex(t => t.radio);
		const at = firstRadio === -1 ? queue.length : firstRadio;
		set({ queue: [...queue.slice(0, at), ...fresh, ...queue.slice(at)] });
	},
	queueNext: tracks => {
		const fresh = tracks.map(t => ({ ...t, id: createId(), radio: undefined }));
		if (!fresh.length) return;
		if (!get().currentTrack) return get().playList(fresh, 0);
		set(state => ({ queue: [...fresh, ...state.queue] }));
	},
	removeTrack: id => {
		set(state => ({
			queue: state.queue.filter(track => track.id !== id),
		}));
	},
	clearQueue: () => set({ queue: [] }),
	setCurrentTrack: track => {
		const { currentTrack, playedHistory } = get();
		const nextHistory = currentTrack ? [...playedHistory, currentTrack] : playedHistory;
		set({ currentTrack: track ? { ...track, id: typeof track.id === "string" && track.id.length > 0 ? createId() : createId() } : null, src: track?.src || "", playedHistory: nextHistory });
	},
	playTrack: track => get().playList([track], 0),
	playList: (tracks, index = 0) => {
		const track = tracks[index];
		if (!track) return;
		const { currentTrack, playedHistory } = get();
		const nextHistory = currentTrack ? [...playedHistory, currentTrack] : playedHistory;
		// Fresh ids: the same song can sit in the queue more than once.
		const queue = tracks.slice(index + 1).map(t => ({ ...t, id: createId(), radio: undefined }));
		set({ currentTrack: track, src: track.src, queue, playedHistory: nextHistory });
	},
	playNext: () => {
		const { queue, currentTrack, playedHistory } = get();
		if (queue.length === 0) return;

		if (currentTrack) {
			const index = queue.findIndex(t => t.id === currentTrack.id);
			if (index !== -1 && index < queue.length - 1) {
				const next = queue[index + 1];
				const updatedQueue = queue.filter((_, i) => i !== index);
				const nextHistory = [...playedHistory, currentTrack];
				set({ currentTrack: next, queue: updatedQueue, playedHistory: nextHistory });
			} else if (index !== -1) {
				const updatedQueue = queue.filter((_, i) => i !== index);
				const nextHistory = [...playedHistory, currentTrack];
				set({ currentTrack: null, queue: updatedQueue, playedHistory: nextHistory });
			} else if (queue.length > 0) {
				const next = queue[0];
				const nextHistory = [...playedHistory, currentTrack];
				set({ currentTrack: next, queue: queue.slice(1), playedHistory: nextHistory });
			}
		} else if (queue.length > 0) {
			const next = queue[0];
			set({ currentTrack: next, queue: queue.slice(1) });
		}
	},
	playPrev: () => {
		const { playedHistory } = get();
		if (playedHistory.length > 0) {
			const prev = playedHistory[playedHistory.length - 1];
			set({ currentTrack: prev, playedHistory: playedHistory.slice(0, -1) });
			return true;
		}
		return false;
	},
	changeView: (view: "tracks" | "bigplayer") => set({ playerView: view }),
	reorderQueue: (draggedId: string, targetId: string, placeBefore: boolean) => {
		const { queue } = get();
		const draggedIndex = queue.findIndex(t => t.id === draggedId);
		const targetIndex = queue.findIndex(t => t.id === targetId);

		if (draggedIndex === -1 || targetIndex === -1) return;

		const newQueue = [...queue];
		const [draggedTrack] = newQueue.splice(draggedIndex, 1);

		const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
		const insertIndex = placeBefore ? adjustedTargetIndex : adjustedTargetIndex + 1;

		newQueue.splice(insertIndex, 0, draggedTrack);
		set({ queue: newQueue });
	},
}));

/** Setting that picks which view the quick player starts in; unset means the big player, as before. */
export const BIG_PLAYER_DEFAULT_SETTING = "big-player-default";

const defaultPlayerView = (settings: Record<string, unknown>) => (settings[BIG_PLAYER_DEFAULT_SETTING] === false ? "tracks" : "bigplayer");

// Apply the setting when it loads from settings.json or is changed, but leave manual toggles alone otherwise.
useSettingsStore.subscribe((state, prev) => {
	const view = defaultPlayerView(state.settings);
	if (view !== defaultPlayerView(prev.settings)) useMusicStore.getState().changeView(view);
});

type Updater<T> = T | ((prev: T) => T);
const applyUpdater = <T>(value: Updater<T>, prev: T): T => (typeof value === "function" ? (value as (p: T) => T)(prev) : value);

// Shared state of the single <audio> element (owned by QuickPlayer) so other views can render and drive playback.
export const usePlaybackStore = create<{
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	loop: boolean;
	volume: number;
	muted: boolean;
	analyser: AnalyserNode | null;
	/** Equalizer gains in dB (-12 to 12); QuickPlayer applies them to the audio graph. */
	eqBass: number;
	eqMid: number;
	eqTreble: number;
	/** Id of the current track when its audio couldn't load (shown as "Couldn't play this song"). */
	failedTrackId: string | null;

	setIsPlaying: (value: Updater<boolean>) => void;
	setCurrentTime: (value: Updater<number>) => void;
	setDuration: (value: Updater<number>) => void;
	setLoop: (value: Updater<boolean>) => void;
	setVolume: (value: Updater<number>) => void;
	setMuted: (value: Updater<boolean>) => void;
	setAnalyser: (analyser: AnalyserNode | null) => void;
	setEqBass: (value: Updater<number>) => void;
	setEqMid: (value: Updater<number>) => void;
	setEqTreble: (value: Updater<number>) => void;
}>()(set => ({
	isPlaying: false,
	currentTime: 0,
	duration: 0,
	loop: false,
	volume: 1,
	muted: false,
	analyser: null,
	eqBass: 0,
	eqMid: 0,
	eqTreble: 0,
	failedTrackId: null,

	setIsPlaying: value => set(state => ({ isPlaying: applyUpdater(value, state.isPlaying) })),
	setCurrentTime: value => set(state => ({ currentTime: applyUpdater(value, state.currentTime) })),
	setDuration: value => set(state => ({ duration: applyUpdater(value, state.duration) })),
	setLoop: value => set(state => ({ loop: applyUpdater(value, state.loop) })),
	setVolume: value => set(state => ({ volume: applyUpdater(value, state.volume) })),
	setMuted: value => set(state => ({ muted: applyUpdater(value, state.muted) })),
	setAnalyser: analyser => set({ analyser }),
	setEqBass: value => set(state => ({ eqBass: applyUpdater(value, state.eqBass) })),
	setEqMid: value => set(state => ({ eqMid: applyUpdater(value, state.eqMid) })),
	setEqTreble: value => set(state => ({ eqTreble: applyUpdater(value, state.eqTreble) })),
}));

interface FileEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	children?: FileEntry[];
}

const debounce = <T extends (...args: any[]) => void>(fn: T, delay: number) => {
	let timer: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
};

export const useFilesStore = create<{
	currentDirectory: string;
	fileTree: FileEntry[] | null;
	setCurrentDirectory: (path: string) => void;
	setFileTree: (tree: any) => void;
}>(set => {
	const debouncedReadDir = debounce(async (path: string) => {
		try {
			const dir = await window.fr.fs.promises.readdir(path);
			const entries: FileEntry[] = await Promise.all(
				dir.map(async (name: string) => {
					const fullPath = path.endsWith("/") ? path + name : path + "/" + name;
					const stat = await window.fr.fs.promises.stat(fullPath);
					return {
						name,
						path: fullPath,
						isDirectory: stat.isDirectory(),
					};
				}),
			);

			set({ fileTree: entries });
		} catch (err) {
			console.error("Failed to read directory:", err);
		}
	}, 300);
	return {
		currentDirectory: "/",
		setCurrentDirectory: async path => {
			const normalizedPath = normalizePath(path);
			set({ currentDirectory: normalizedPath });
			debouncedReadDir(normalizedPath);
		},
		fileTree: null,
		setFileTree: tree => set({ fileTree: tree }),
	};
});
// ============================================================
// Optional persistence (Settings → "Persistent Tabs")
// Tabs, groups and the music queue survive page refreshes when
// the flag is on. The flag lives in localStorage so it is
// readable synchronously at module load, and is kept in sync
// with settings.json by init() and the Settings toggle.
// ============================================================

export const PERSIST_FLAG = "fracital:persist-tabs";
export const PERSIST_TABS_KEY = "fracital:saved-tabs";
export const PERSIST_MUSIC_KEY = "fracital:saved-music";

const persistOn = () => {
	try {
		return localStorage.getItem(PERSIST_FLAG) === "true";
	} catch {
		return false;
	}
};

// React icon nodes aren't serializable; drop them (the Tab component re-derives them).
const serialize = (value: unknown) => JSON.stringify(value, (key, v) => (key === "icon" && typeof v !== "string" ? undefined : v));

if (typeof window !== "undefined") {
	// --- Hydrate ---
	if (persistOn()) {
		try {
			const savedTabs = JSON.parse(localStorage.getItem(PERSIST_TABS_KEY) || "null");
			if (savedTabs?.tabs?.length)
				useTabsStore.setState({
					tabs: savedTabs.tabs.map((t: TabProps) => ({ ...t, url: normalizeAboutUrl(t.url), displayUrl: normalizeAboutUrl(t.displayUrl) })),
					groups: savedTabs.groups ?? [],
				});
		} catch {
			/* corrupted snapshot — start fresh */
		}
		try {
			const savedMusic = JSON.parse(localStorage.getItem(PERSIST_MUSIC_KEY) || "null");
			if (savedMusic) {
				const alive = (t: Track | null) => !!t?.src && !t.src.startsWith("blob:");
				useMusicStore.setState({
					queue: (savedMusic.queue ?? []).filter(alive),
					currentTrack: alive(savedMusic.currentTrack) ? savedMusic.currentTrack : null,
					src: alive(savedMusic.currentTrack) ? savedMusic.currentTrack.src : "",
					playerView: savedMusic.playerView === "tracks" ? "tracks" : "bigplayer",
				});
			}
		} catch {
			/* corrupted snapshot — start fresh */
		}
	}

	// --- Save on change ---
	useTabsStore.subscribe(state => {
		if (!persistOn()) return;
		try {
			localStorage.setItem(PERSIST_TABS_KEY, serialize({ tabs: state.tabs, groups: state.groups }));
		} catch {
			/* storage full/unavailable */
		}
	});

	useMusicStore.subscribe(state => {
		if (!persistOn()) return;
		try {
			// Blob URLs die with the page; only server/remote tracks are restorable.
			const keep = (t: Track | null) => !!t?.src && !t.src.startsWith("blob:");
			localStorage.setItem(PERSIST_MUSIC_KEY, serialize({ queue: state.queue.filter(keep), currentTrack: keep(state.currentTrack) ? state.currentTrack : null, playerView: state.playerView }));
		} catch {
			/* storage full/unavailable */
		}
	});
}
