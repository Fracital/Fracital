import { create } from "zustand"
import type { TabProps } from "./components/Tab"
import type { Track } from "./types"
import { createId } from "@paralleldrive/cuid2"

export const usePanelsStore = create<{
    panelsOpen: boolean
    current: "tabs" | "quickplayer"
    setCurrent: (panel: "tabs" | "quickplayer") => void
    setPanelsOpen: (open: boolean) => void
}>()((set) => ({
    panelsOpen: false,
    current: "tabs",
    setCurrent: (panel: "tabs" | "quickplayer") => set({current: panel}),
    setPanelsOpen: (open: boolean) => set({ panelsOpen: open }),
}))

const baseId = createId()
export const useTabsStore = create<{
    tabs: TabProps[]
    groups: { id: string; name: string; icon?: string, accent?: string }[]
    setCurrentTab: (id: string | null) => void
    tabsOpen: boolean
    newTab: (props: TabProps) => void
    closeTab: (id: string) => void
    updateTab: (id: string, changes: Partial<TabProps>) => void
    newGroup: (id: string | null, name: string, icon?: string) => void
    addTabToGroup: (groupId: string, tab: TabProps) => void
    moveTabRelative: (draggedId: string, targetId: string, placeBefore: boolean) => void
    closeGroup: (id: string) => void
    updateGroup: (id: string, changes: Partial<{ id: string; name: string; icon?: string, accent?: string}>) => void
}>()((set, get) => ({
    groups: [],
    tabs: [{
        id: baseId,
        title: "New Tab",
        url: "newtab",
        current: true,
        displayUrl: "newtab",
        index: 0,
    }],
    setCurrentTab: (id: string | null) => set(state => {
        return {
            tabs: state.tabs.map(t => ({
                ...t,
                current: t.id === id
            }))
        }
    }),
    tabsOpen: false,
    newTab: (props: TabProps) => {
        const id = props.id ?? createId();
        const tabWithId: TabProps = { ...props, id, current: true } as TabProps;
        set(state => ({
            tabs: state.tabs.map(tab => ({ ...tab, current: false })).concat(tabWithId as TabProps & { current: boolean })
        }));

    },
    closeTab: (id: string) => {
        set(state => {
            const filteredTabs = state.tabs.filter(tab => tab.id !== id)
            const currentTab = state.tabs.find(tab => tab.current)
            const closingCurrent = currentTab && currentTab.id === id
            let newTabs = filteredTabs
            if (closingCurrent && filteredTabs.length > 0) {
                newTabs = filteredTabs.map((tab, idx) =>
                    idx === filteredTabs.length - 1
                        ? { ...tab, current: true }
                        : { ...tab, current: false }
                )
            }

            return {
                tabs: newTabs
            }
        })
    },
    updateTab: (id: string, changes: Partial<TabProps>) =>
        set((state) => ({
            tabs: state.tabs.map((tab) =>
                tab.id === id ? { ...tab, ...changes } : tab
            )
        })
    ),
    moveTabRelative: (draggedId: string, targetId: string, placeBefore: boolean) => set((state) => {
        const tabs = [...state.tabs];
        const from = tabs.findIndex(t => t.id === draggedId);
        if (from === -1) return { tabs };
        const item = tabs.splice(from, 1)[0];
        let to = tabs.findIndex(t => t.id === targetId);
        if (to === -1) {
            // append to end
            tabs.push(item);
            return { tabs };
        }
        if (!placeBefore) to = to + 1;
        tabs.splice(to, 0, item);
        return { tabs };
    }),
    newGroup: (id: string | null, name: string, icon?: string) => set((state) => ({
        groups: [...state.groups, { id: id ?? createId(), name, icon }]
    })),
    addTabToGroup: (groupId: string, tab: TabProps) => set((state) => {
        const tabId = tab.id ?? createId();

        const tabExists = state.tabs.some(t => t.id === tabId);
        const newTabs = tabExists ? state.tabs : state.tabs.concat({ ...tab, id: tabId });

        const updatedTabs = newTabs.map(t => t.id === tabId ? { ...t, groupId } : t);

        return {
            tabs: updatedTabs
        }
    }),
    closeGroup: (id: string) => set((state) => ({
        groups: state.groups.filter(group => group.id !== id),
        tabs: state.tabs.map(tab => tab.groupId === id ? { ...tab, groupId: undefined } : tab)
    })),
    updateGroup: (id: string, changes: Partial<{ id: string; name: string; icon?: string}>) => set((state) => ({
        groups: state.groups.map((group) =>
            group.id === id ? { ...group, ...changes } : group
        )
    }))
}))

export const useSettingsStore = create<{
    settings: Record<string, any>
    setSettings: (key: string, value: any) => void
    getSettings: (key: string) => any
}>((set, get) => ({
    settings: {},
    setSettings: (key, value) => set((state) => ({
        settings: {
            ...state.settings,
            [key]: value
        }
    })),
    getSettings: (key) => {
        const settings = get().settings
        return settings[key] !== undefined ? settings[key] : null
    },
}))

export const useSetupStore = create<{
    step: number
    setStep: (step: number) => void
    isSetupComplete: boolean
    setSetupComplete: (complete: boolean) => void
}>((set) => ({
    step: 0,
    setStep: (step) => set({ step }),
    isSetupComplete: false,
    setSetupComplete: (complete) => set({ isSetupComplete: complete })
}))

interface MusicStore {
    src: string;
    currentTrack: Track | null;
    queue: Track[];

    addTrack: (track: Track) => void;
    removeTrack: (id: string) => void
    setCurrentTrack: (track: Track | null) => void

    playNext: () => void;
    playPrev: () => void;
}

export const useMusicStore = create<MusicStore>((set, get) => ({
    src: "",
    currentTrack: null,
    queue: [],

    addTrack: (track) => {
        set(state => ({
            queue: [...state.queue, {
                ...track,
                id: typeof track.id === "string" && track.id.length > 0 ? createId() : createId()
            }]
        }));
    },
    removeTrack: (id) => {
        set(state => ({
            queue: state.queue.filter(track => track.id !== id)
        }));
    },
    setCurrentTrack: (track) => {
    set({ currentTrack: track ? { ...track, id: typeof track.id === "string" && track.id.length > 0 ? createId() : createId() } : null, src: track?.src || "" });
    },

    playNext: () => {
        const { queue, currentTrack } = get();
        if (!currentTrack || queue.length === 0) return;

        const index = queue.findIndex((t) => t.id === currentTrack.id);
        const next = queue[index + 1];
        if (next) set({ currentTrack: next });
    },

    playPrev: () => {
        const { queue, currentTrack } = get();
        if (!currentTrack || queue.length === 0) return;

        const index = queue.findIndex((t) => t.id === currentTrack.id);
        const prev = queue[index - 1];
        if (prev) set({ currentTrack: prev });
    },
}))