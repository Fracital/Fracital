import { create } from "zustand";
import type { TabProps } from "./components/Tab";
import type { Track } from "./types";
import { createId } from "@paralleldrive/cuid2";

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

const baseId = createId();
export const useTabsStore = create<{
	tabs: TabProps[];
	groups: { id: string; name: string; icon?: string; accent?: string }[];
	setCurrentTab: (id: string | null) => void;
	tabsOpen: boolean;
	newTab: (props: TabProps) => void;
	closeTab: (id: string) => void;
	updateTab: (id: string, changes: Partial<TabProps>) => void;
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
	newTab: (props: TabProps) => {
		const id = props.id ?? createId();
		const initialHistory = [{
			url: props.url,
			title: props.title,
			icon: typeof props.icon === 'string' ? props.icon : undefined,
			displayUrl: props.displayUrl
		}] as any;
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
	updateTab: (id: string, changes: Partial<TabProps>) =>
		set(state => ({
			tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, ...changes } : tab)),
		})),
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
			if (from === -1) return { tabs };
			const item = tabs.splice(from, 1)[0];
			let to = tabs.findIndex(t => t.id === targetId);
			if (to === -1) {
				tabs.push(item);
				return { tabs };
			}
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
	removeTrack: (id: string) => void;
	setCurrentTrack: (track: Track | null) => void;

	playTrack: (track: Track) => void;
	playNext: () => void;
	playPrev: () => boolean;

	changeView: (view: "tracks" | "bigplayer") => void;
}>((set, get) => ({
	src: "",
	currentTrack: null,
	queue: [],
	playerView: "bigplayer",
	playedHistory: [],

	addTrack: track => {
		set(state => ({
			queue: [
				...state.queue,
				{
					...track,
					id: typeof track.id === "string" && track.id.length > 0 ? createId() : createId(),
				},
			],
		}));
	},
	removeTrack: id => {
		set(state => ({
			queue: state.queue.filter(track => track.id !== id),
		}));
	},
	setCurrentTrack: track => {
		const { currentTrack, playedHistory } = get();
		const nextHistory = currentTrack ? [...playedHistory, currentTrack] : playedHistory;
		set({ currentTrack: track ? { ...track, id: typeof track.id === "string" && track.id.length > 0 ? createId() : createId() } : null, src: track?.src || "", playedHistory: nextHistory });
	},
	playTrack: track => {
		const { currentTrack, playedHistory } = get();
		const nextHistory = currentTrack ? [...playedHistory, currentTrack] : playedHistory;
		set({ currentTrack: track, src: track.src, playedHistory: nextHistory });
	},
	playNext: () => {
		const { queue, currentTrack } = get();
		if (!currentTrack || queue.length === 0) return;

		const index = queue.findIndex(t => t.id === currentTrack.id);
		const next = queue[index + 1];
		if (next) set({ currentTrack: next });
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
}>((set) => {
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
			set({ currentDirectory: path });
			debouncedReadDir(path);
		},
		fileTree: null,
		setFileTree: tree => set({ fileTree: tree }),
	};
});
