import { create } from "zustand"
import type { TabProps } from "./components/Tab"
import { createId } from "@paralleldrive/cuid2"

interface TabsState {
    tabs: TabProps[]
    currentTab: TabProps | null
    setCurrentTab: (id: string | null) => void
    tabsOpen: boolean
    setTabsOpen: (open: boolean) => void
    newTab: (props: TabProps) => void
    closeTab: (id: string) => void
    updateTab: (id: string, changes: Partial<TabProps>) => void
}

const baseId = createId()

export const useTabsStore = create<TabsState>()((set) => ({
    tabs: [{id: baseId, title: "New Tab", url: "newtab"}],
    currentTab: {
        id: baseId,
        title: "New Tab",
        url: "newtab"
    },
    setCurrentTab: (id: string | null) => set(state => {
        const tab: TabProps | undefined = state.tabs.find((tab: TabProps) => tab.id === id);
        return { currentTab: tab ? { id: tab.id, title: tab.title, url: tab.url }: { id: createId(), title: "New Tab", url: "newtab" } }
    }),
    tabsOpen: false,
    setTabsOpen: (open: boolean) => set({ tabsOpen: open }),
    newTab: (props: TabProps) => {
        const updateState = (state: TabsState) => {
            return {
                tabs: [...state.tabs, props],
                currentTab: props
            }
        }
        const newState = updateState(useTabsStore.getState())
        set(newState)
    },
    closeTab: (id: string) => {
        set(state => {
            const filteredTabs = state.tabs.filter(tab => tab.id !== id)
            const newCurrentTab =
                state.currentTab && state.currentTab.id === id
                    ? (filteredTabs.length > 0 ? filteredTabs[filteredTabs.length - 1] : null)
                    : state.currentTab;

            return {
                tabs: filteredTabs,
                currentTab: newCurrentTab
            }
        })
    },
    updateTab: (id: string, changes: Partial<TabProps>) => set(state => {
        const updatedTabs = state.tabs.map(tab =>
            tab.id === id ? { ...tab, ...changes } : tab
        );

        const updatedCurrentTab = state.currentTab?.id === id
            ? { ...state.currentTab, ...changes }
            : state.currentTab;

        console.log(updatedTabs, updatedCurrentTab);

        return {
            tabs: updatedTabs,
            currentTab: updatedCurrentTab
        };
    })
}))