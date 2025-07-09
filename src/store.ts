import { create } from "zustand"
import type { TabProps } from "./components/Tab"
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
    setCurrentTab: (id: string | null) => void
    tabsOpen: boolean
    newTab: (props: TabProps) => void
    closeTab: (id: string) => void
    updateTab: (id: string, changes: Partial<TabProps>) => void
}>()((set, get) => ({
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
        set(state => ({
            tabs: state.tabs.map(tab => ({ ...tab, current: false })).concat({ ...props, current: true })
        }))
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
        )}
    ))
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

export const useMusicStore = create<{
    currentTrack: {
        name: string
        artists: string[]
        releaseDate: string | Date
        album: string
        explicit: boolean
        cover: string
    }
    tracks: Record<string, any>
    queue: Record<string, any>
    addTrack: (id: string) => void
    removeTrack: (id: string) => void
}>((set, get) => ({
    currentTrack: {
        name: "stay another day",
        artists: ["Jenny Rejects"],
        releaseDate: "2025",
        album: "stay another day",
        explicit: true,
        cover: "https://i.imgur.com/kf0Mavx.jpeg"
    },
    tracks: [
        {
            name: "stay another day",
            artists: ["Jenny Rejects"],
            releaseDate: "2025",
            album: "stay another day",
            explicit: false
        },
        {
            name: "My Flaws Burn Through My Skin Like Demonic Flames from Hell",
            artists: "$uicideBoy$",
            releaseDate: "2015",
            album: "I No Longer Feel the Razor Guarding My Heel",
            explicit: true
        }
    ],
    queue: {},
    addTrack: () => {},
    removeTrack: () => {}
}))