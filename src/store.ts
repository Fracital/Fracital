import { create } from "zustand"
import type { TabProps } from "./components/Tab"
import { createId } from "@paralleldrive/cuid2"

interface TabsState {
    tabs: TabProps[]
    setCurrentTab: (id: string | null) => void
    tabsOpen: boolean
    setTabsOpen: (open: boolean) => void
    newTab: (props: TabProps) => void
    closeTab: (id: string) => void
    updateTab: (id: string, changes: Partial<TabProps>) => void
    getCurrentTab: () => TabProps | undefined
}

const baseId = createId()
export const useTabsStore = create<TabsState>()((set, get) => ({
    tabs: [{id: baseId, title: "New Tab", url: "newtab", current: true}],
    setCurrentTab: (id: string | null) => set(state => {
        return {
            tabs: state.tabs.map(t => ({
            ...t,
            current: t.id === id
            }))
        }
    }),
    tabsOpen: false,
    setTabsOpen: (open: boolean) => set({ tabsOpen: open }),
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
    updateTab: (id: string, changes: Partial<TabProps>) => set(state => {
        const updatedTabs = state.tabs.map(tab =>
            tab.id === id ? { ...tab, ...changes } : tab
        );
        return {
            tabs: updatedTabs
        };
    }),
    getCurrentTab: () => {
        const state = get()
        return state.tabs.find(tab => tab.current)
    }
}))