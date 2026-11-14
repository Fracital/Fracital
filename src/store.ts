import { createId } from "@paralleldrive/cuid2";
import { create } from "zustand";
import type { TabProps } from "./components/Tab";
import { normalizeAboutUrl } from "./libs/aboutAlias";
import { bootSettings, readBootLayout, writeBootLayout } from "./libs/bootCache";
import { recordVisit } from "./libs/browsingHistory";
import { GROUPS_ON_TOP_SETTING, type Track } from "./types";
import { normalizePath } from "./views/Files/pathUtils";

/** A name for a new group: one past the highest "Group N" there is, so closing one never repeats a name. */
export const nextGroupName = (groups: { name: string }[]) => {
	const highest = Math.max(0, ...groups.map(group => Number(/^Group (\d+)$/.exec(group.name)?.[1] ?? 0)));
	return `Group ${highest + 1}`;
};

export const usePanelsStore = create<{
	panelsOpen: boolean;
	current: "tabs" | "quickplayer";
	setCurrent: (panel: "tabs" | "quickplayer") => void;
	setPanelsOpen: (open: boolean) => void;
	/** The tab view (opened from the top bar), which holds the tabs while the tab view setting is on. */
	tabViewOpen: boolean;
	setTabViewOpen: (open: boolean) => void;
}>()(set => ({
	panelsOpen: false,
	current: "tabs",
	setCurrent: (panel: "tabs" | "quickplayer") => set({ current: panel }),
	setPanelsOpen: (open: boolean) => set({ panelsOpen: open }),
	tabViewOpen: false,
	setTabViewOpen: (open: boolean) => set({ tabViewOpen: open }),
}));

// Kept apart from the tabs store so loading state is never persisted with saved tabs.
export const useTabLoadingStore = create<{
	loading: Record<string, true>;
	setLoading: (id: string, loading: boolean) => void;
}>()(set => ({
	loading: {},
	setLoading: (id, loading) =>
		set(state => {
			if (Boolean(state.loading[id]) === loading) return state;
			const next = { ...state.loading };
			if (loading) next[id] = true;
			else delete next[id];
			return { loading: next };
		}),
}));

const setFlag = (flags: Record<string, true>, id: string, on: boolean) => {
	if (Boolean(flags[id]) === on) return flags;
	const next = { ...flags };
	if (on) next[id] = true;
	else delete next[id];
	return next;
};

/** Web tabs whose page is playing sound, and the ones the user muted from the tab strip. */
export const useTabAudioStore = create<{
	audible: Record<string, true>;
	muted: Record<string, true>;
	setAudible: (id: string, audible: boolean) => void;
	toggleMuted: (id: string) => void;
	clear: (id: string) => void;
}>()(set => ({
	audible: {},
	muted: {},
	setAudible: (id, audible) => set(state => (Boolean(state.audible[id]) === audible ? state : { audible: setFlag(state.audible, id, audible) })),
	toggleMuted: id => set(state => ({ muted: setFlag(state.muted, id, !state.muted[id]) })),
	clear: id => set(state => ({ audible: setFlag(state.audible, id, false), muted: setFlag(state.muted, id, false) })),
}));

const normalizeTabChanges = (rawChanges: Partial<TabProps>): Partial<TabProps> => {
	const changes = { ...rawChanges };
	if ("url" in changes) changes.url = normalizeAboutUrl(changes.url);
	if ("displayUrl" in changes) changes.displayUrl = normalizeAboutUrl(changes.displayUrl);
	return changes;
};

const baseId = createId();

/*
 * The top level of the tab list: groups and tabs in no group, in one order, so a loose tab can sit between groups.
 * `layout` holds their keys ("g:<group id>", "t:<tab id>"). The tabs inside a group keep the `tabs` array's order.
 * The actions below keep it in step; topLevel() repairs whatever they missed (a saved list from before, a tab added
 * some other way), so nothing goes missing from the list.
 */
export type TopItem = { kind: "group"; id: string } | { kind: "tab"; id: string };
export const groupKey = (id: string) => `g:${id}`;
export const tabKey = (id: string) => `t:${id}`;

type LayoutState = { tabs: TabProps[]; groups: { id: string }[]; layout: string[] };

/** The layout with anything stale dropped and anything missing added at the end (groups, then loose tabs in `tabs` order). */
export const fixLayout = ({ tabs, groups, layout }: LayoutState): string[] => {
	const valid = new Set([...groups.map(group => groupKey(group.id)), ...tabs.filter(tab => !tab.groupId || !groups.some(group => group.id === tab.groupId)).map(tab => tabKey(tab.id))]);
	const seen = new Set<string>();
	const kept = layout.filter(key => valid.has(key) && !seen.has(key) && seen.add(key));
	for (const key of valid) if (!seen.has(key)) kept.push(key);
	return kept;
};

/** "Keep groups on top": groups show first, then the loose tabs, each in their own order from the layout. */
const groupsOnTop = () => useSettingsStore.getState().settings[GROUPS_ON_TOP_SETTING] === true;

/** The layout as shown: as it is, or with the groups first when they're kept on top. */
const shownLayout = (state: LayoutState) => {
	const layout = fixLayout(state);
	return groupsOnTop() ? [...layout.filter(key => key.startsWith("g:")), ...layout.filter(key => key.startsWith("t:"))] : layout;
};

/**
 * With groups kept on top, an order taken from the screen (groups first) only says how the groups go among
 * themselves and the loose tabs among themselves: they fill the layout's group places and tab places in that order,
 * so the mixed order comes back unchanged when the option is turned off.
 */
const keepPlaces = (layout: string[], order: string[]) => {
	const groups = order.filter(key => key.startsWith("g:"));
	const loose = order.filter(key => key.startsWith("t:"));
	return layout.map(key => (key.startsWith("g:") ? (groups.shift() ?? key) : (loose.shift() ?? key)));
};

/** The top level in the order shown: each group, and each tab in no group. */
export const topLevel = (state: LayoutState): TopItem[] => shownLayout(state).map(key => ({ kind: key.startsWith("g:") ? "group" : "tab", id: key.slice(2) }));

/** Every tab in the order the list shows them: each group's tabs where the group stands, loose tabs where they stand. */
export const tabsInOrder = (state: LayoutState): TabProps[] => topLevel(state).flatMap(item => (item.kind === "group" ? state.tabs.filter(tab => tab.groupId === item.id) : state.tabs.filter(tab => tab.id === item.id)));

/** `key` moved to `index` (counted without it); appended when the index is past the end. */
const placeKey = (layout: string[], key: string, index: number) => {
	const rest = layout.filter(k => k !== key);
	rest.splice(Math.max(0, Math.min(index, rest.length)), 0, key);
	return rest;
};

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
	/** Rewrites the current entry in place: the page replaced its URL (history.replaceState) or changed its title. */
	replaceHistory: (id: string, entry: { url: string; title: string; icon?: string; displayUrl?: string }) => void;
	newGroup: (id: string | null, name: string, icon?: string) => void;
	addTabToGroup: (groupId: string, tab: TabProps) => void;
	moveTabRelative: (draggedId: string, targetId: string, placeBefore: boolean) => void;
	closeGroup: (id: string) => void;
	updateGroup: (id: string, changes: Partial<{ id: string; name: string; icon?: string; accent?: string }>) => void;
	/** Whether the user has put the groups in their own order (the tab view then keeps it instead of sorting by size). */
	groupsOrdered: boolean;
	/** Puts the groups in this order (by id; any not listed keep their place at the end) and marks it as the user's. */
	reorderGroups: (ids: string[]) => void;
	/** The top level's order: group and loose tab keys (see `layout` above). */
	layout: string[];
	/** Sets the top level's order as shown: these keys first, in this order, then any not listed in their old order. */
	setTopOrder: (keys: string[]) => void;
	/** Takes a tab out of any group and puts it at `index` of the top level as shown (counted without it; past the end = last). */
	placeLoose: (tabId: string, index: number) => void;
}>()((set, get) => ({
	groups: [],
	layout: [tabKey(baseId)],
	groupsOrdered: false,
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
			// A new loose tab goes last; one opened into a group goes there.
			layout: tabWithId.groupId ? state.layout : [...state.layout.filter(key => key !== tabKey(id)), tabKey(id)],
		}));
	},
	closeTab: (id: string) => {
		useTabLoadingStore.getState().setLoading(id, false);
		useTabAudioStore.getState().clear(id);
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
				layout: state.layout.filter(key => key !== tabKey(id)),
			};
		});
	},
	updateTab: (id: string, rawChanges: Partial<TabProps>) => {
		const changes = normalizeTabChanges(rawChanges);
		set(state => {
			const tabs = state.tabs.map(tab => (tab.id === id ? { ...tab, ...changes } : tab));
			const before = state.tabs.find(tab => tab.id === id);
			if (!before || !("groupId" in changes) || before.groupId === changes.groupId) return { tabs };
			const key = tabKey(id);
			// Into a group: it leaves the top level. Out of one: it stands just after the group it left.
			if (changes.groupId) return { tabs, layout: state.layout.filter(k => k !== key) };
			const rest = state.layout.filter(k => k !== key);
			const after = before.groupId ? rest.indexOf(groupKey(before.groupId)) : -1;
			return { tabs, layout: after === -1 ? [...rest, key] : placeKey(rest, key, after + 1) };
		});
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
		recordVisit(id, entry);
		const newHistory = [...currentHistory.slice(0, currentIndex + 1), entry];
		const newIndex = newHistory.length - 1;

		set(state => ({
			tabs: state.tabs.map(t => (t.id === id ? ({ ...t, history: newHistory, historyIndex: newIndex } as unknown as TabProps) : t)),
		}));
	},
	replaceHistory: (id: string, entry: { url: string; title: string; icon?: string; displayUrl?: string }) => {
		const tab = get().tabs.find(t => t.id === id);
		if (!tab) return;
		const currentHistory = (tab as any)?.history ?? [];
		const currentIndex = (tab as any)?.historyIndex ?? 0;
		if (!currentHistory[currentIndex]) return get().pushHistory(id, entry);
		entry = { ...entry, url: normalizeAboutUrl(entry.url), displayUrl: normalizeAboutUrl(entry.displayUrl) };
		recordVisit(id, entry);
		const newHistory = currentHistory.map((e: unknown, i: number) => (i === currentIndex ? entry : e));
		set(state => ({
			tabs: state.tabs.map(t => (t.id === id ? ({ ...t, history: newHistory } as unknown as TabProps) : t)),
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
			// Two loose tabs: the top level follows, so the dragged one lands beside the target there too.
			const target = tabs.find(t => t.id === targetId);
			if (item.groupId || target?.groupId) return { tabs };
			const layout = fixLayout({ ...state, tabs }).filter(k => k !== tabKey(draggedId));
			const at = layout.indexOf(tabKey(targetId));
			return { tabs, layout: at === -1 ? state.layout : placeKey(layout, tabKey(draggedId), placeBefore ? at : at + 1) };
		}),
	newGroup: (id: string | null, name: string, icon?: string) =>
		set(state => {
			const groupId = id ?? createId();
			return { groups: [...state.groups, { id: groupId, name, icon }], layout: [...state.layout, groupKey(groupId)] };
		}),
	addTabToGroup: (groupId: string, tab: TabProps) =>
		set(state => {
			const tabId = tab.id ?? createId();

			const tabExists = state.tabs.some(t => t.id === tabId);
			const newTabs = tabExists ? state.tabs : state.tabs.concat({ ...tab, id: tabId });

			const updatedTabs = newTabs.map(t => (t.id === tabId ? { ...t, groupId } : t));

			return {
				tabs: updatedTabs,
				layout: state.layout.filter(key => key !== tabKey(tabId)),
			};
		}),
	closeGroup: (id: string) =>
		set(state => {
			// The tabs it kept stand where the group stood, in their order.
			const freed = state.tabs.filter(tab => tab.groupId === id).map(tab => tabKey(tab.id));
			const layout = fixLayout(state);
			const at = layout.indexOf(groupKey(id));
			const rest = layout.filter(key => key !== groupKey(id) && !freed.includes(key));
			if (at !== -1) rest.splice(Math.min(at, rest.length), 0, ...freed);
			else rest.push(...freed);
			return {
				groups: state.groups.filter(group => group.id !== id),
				tabs: state.tabs.map(tab => (tab.groupId === id ? { ...tab, groupId: undefined } : tab)),
				layout: rest,
			};
		}),
	updateGroup: (id: string, changes: Partial<{ id: string; name: string; icon?: string }>) =>
		set(state => ({
			groups: state.groups.map(group => (group.id === id ? { ...group, ...changes } : group)),
		})),
	reorderGroups: (ids: string[]) =>
		set(state => {
			const listed = ids.map(id => state.groups.find(group => group.id === id)).filter(group => !!group);
			const groups = [...listed, ...state.groups.filter(group => !ids.includes(group.id))];
			// The groups take each other's places on the top level; loose tabs stay put.
			const layout = fixLayout(state);
			const queue = groups.map(group => groupKey(group.id));
			return { groups, groupsOrdered: true, layout: layout.map(key => (key.startsWith("g:") ? (queue.shift() ?? key) : key)) };
		}),
	setTopOrder: (keys: string[]) =>
		set(state => {
			const layout = fixLayout(state);
			const listed = keys.filter(key => layout.includes(key));
			const wanted = [...listed, ...layout.filter(key => !listed.includes(key))];
			const order = groupsOnTop() ? keepPlaces(layout, wanted) : wanted;
			// The groups array follows, so anything that still reads it sees the same order.
			const groups = order.filter(key => key.startsWith("g:")).map(key => state.groups.find(group => groupKey(group.id) === key)!);
			return { layout: order, groups, groupsOrdered: true };
		}),
	placeLoose: (tabId: string, index: number) => {
		const tab = get().tabs.find(t => t.id === tabId);
		if (!tab) return;
		if (tab.groupId) get().updateTab(tabId, { groupId: undefined });
		set(state => {
			const key = tabKey(tabId);
			if (!groupsOnTop()) return { layout: placeKey(fixLayout(state), key, index) };
			// Shown as groups then loose tabs: the index past the groups says which loose tab it goes before.
			const layout = fixLayout(state).filter(k => k !== key);
			const groupCount = layout.filter(k => k.startsWith("g:")).length;
			const loose = layout.filter(k => k.startsWith("t:"));
			const nth = Math.max(0, index - groupCount);
			const before = loose[nth];
			if (!before) return { layout: [...layout, key] };
			return { layout: placeKey(layout, key, layout.indexOf(before)) };
		});
	},
}));

/** The tab layout settings as they were last time (bootCache), until settings.json is read. */
const bootLayout = readBootLayout();

export const useSettingsStore = create<{
	settings: Record<string, any>;
	/** settings.json has been read (or failed to, and the defaults are in). */
	loaded: boolean;
	/** The tab layout settings are known: settings.json has been read, or last time's copy stands in for them. */
	layoutReady: boolean;
	setSettings: (key: string, value: any) => void;
	getSettings: (key: string) => any;
}>((set, get) => ({
	settings: bootSettings(),
	loaded: false,
	layoutReady: !!bootLayout,
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

// Keep the copy current once the real settings are in (not before: the copy itself would be written back).
useSettingsStore.subscribe(state => {
	if (state.loaded) writeBootLayout(state.settings);
});

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
	/** Where the current list starts in playedHistory: songs played since then stay in the queue list. */
	historyStart: number;

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
	/**
	 * Plays a song from the queue list: picking an upcoming song moves the
	 * skipped ones to played; picking a played one goes back to it, the ones after it coming up
	 * again. The list itself stays as it is (and radio doesn't re-tune).
	 */
	playFromQueue: (id: string) => void;
	playPrev: () => boolean;

	changeView: (view: "tracks" | "bigplayer") => void;
	reorderQueue: (draggedId: string, targetId: string, placeBefore: boolean) => void;
	/**
	 * Moves a song to `index` in the queue list as shown (played since the list started, the playing
	 * song, then what's next). The playing song keeps playing: whatever ends up above it counts as
	 * played and whatever ends up below it comes next, so moving it or moving songs across it works.
	 */
	moveInList: (id: string, index: number) => void;
}>((set, get) => ({
	src: "",
	currentTrack: null,
	queue: [],
	playerView: "bigplayer",
	playedHistory: [],
	historyStart: 0,

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
		set(state => {
			const at = state.playedHistory.findIndex((t, i) => i >= state.historyStart && t.id === id);
			// A played song in the current list: drop it from the history the list shows.
			if (at !== -1) return { playedHistory: state.playedHistory.filter((_, i) => i !== at) };
			return { queue: state.queue.filter(track => track.id !== id) };
		});
	},
	clearQueue: () => set(state => ({ queue: [], historyStart: state.playedHistory.length })),
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
		// A new list: what played before it isn't part of this one.
		set({ currentTrack: track, src: track.src, queue, playedHistory: nextHistory, historyStart: nextHistory.length });
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
	playFromQueue: id => {
		const { queue, currentTrack, playedHistory, historyStart } = get();
		const ahead = queue.findIndex(t => t.id === id);
		if (ahead !== -1) {
			// Forward: the current song and any skipped ones count as played.
			const played = [...playedHistory, ...(currentTrack ? [currentTrack] : []), ...queue.slice(0, ahead)];
			return set({ currentTrack: queue[ahead], src: queue[ahead].src, queue: queue.slice(ahead + 1), playedHistory: played });
		}
		const back = playedHistory.findIndex((t, i) => i >= historyStart && t.id === id);
		if (back === -1) return;
		// Back: everything after it, the current song included, comes up again in order.
		const again = [...playedHistory.slice(back + 1), ...(currentTrack ? [currentTrack] : [])];
		set({ currentTrack: playedHistory[back], src: playedHistory[back].src, queue: [...again, ...queue], playedHistory: playedHistory.slice(0, back) });
	},
	playPrev: () => {
		const { playedHistory, currentTrack, queue, historyStart } = get();
		if (playedHistory.length > 0) {
			const prev = playedHistory[playedHistory.length - 1];
			// The song that was playing comes up next again, so the list keeps every song.
			set({ currentTrack: prev, playedHistory: playedHistory.slice(0, -1), queue: currentTrack ? [currentTrack, ...queue] : queue, historyStart: Math.min(historyStart, playedHistory.length - 1) });
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
	moveInList: (id: string, index: number) => {
		const { playedHistory, historyStart, currentTrack, queue } = get();
		const played = playedHistory.slice(historyStart);
		const list = [...played, ...(currentTrack ? [currentTrack] : []), ...queue];
		const from = list.findIndex(t => t.id === id);
		if (from === -1) return;
		const [moved] = list.splice(from, 1);
		list.splice(Math.max(0, Math.min(index, list.length)), 0, moved);
		// Without a playing song, the split between played and next stays where it was.
		const split = currentTrack ? list.findIndex(t => t.id === currentTrack.id) : played.length;
		set({ playedHistory: [...playedHistory.slice(0, historyStart), ...list.slice(0, split)], queue: list.slice(currentTrack ? split + 1 : split) });
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
	/** The song is loading or waiting for data, so nothing is audible yet. */
	buffering: boolean;

	setIsPlaying: (value: Updater<boolean>) => void;
	setBuffering: (buffering: boolean) => void;
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
	buffering: false,

	setIsPlaying: value => set(state => ({ isPlaying: applyUpdater(value, state.isPlaying) })),
	setBuffering: buffering => set(state => (state.buffering === buffering ? state : { buffering })),
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
			if (savedTabs?.tabs?.length) {
				const tabs = savedTabs.tabs.map((t: TabProps) => ({ ...t, url: normalizeAboutUrl(t.url), displayUrl: normalizeAboutUrl(t.displayUrl) }));
				const groups = savedTabs.groups ?? [];
				// A snapshot from before the top-level order has none: groups first, then loose tabs, as it showed then.
				const layout = fixLayout({ tabs, groups, layout: Array.isArray(savedTabs.layout) ? savedTabs.layout : [] });
				useTabsStore.setState({ tabs, groups, groupsOrdered: savedTabs.groupsOrdered === true, layout });
			}
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
			localStorage.setItem(PERSIST_TABS_KEY, serialize({ tabs: state.tabs, groups: state.groups, groupsOrdered: state.groupsOrdered, layout: state.layout }));
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
