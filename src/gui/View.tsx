import { useEffect } from "react"
import type { TabProps } from "../components/Tab"
import { useTabsStore } from "../store"

interface ViewProps {
    children: React.ReactNode
    id?: string
}

export const View = ({ children, id }: ViewProps) => {
    const tabs = useTabsStore(state => state.tabs)
    const currentTab = tabs.find(tab => tab.current === true);

    return (
        <div className={"absolute inset-0 duration-150" + " " + `
            ${
                currentTab ? currentTab.id !== id ? "opacity-0 translate-y-2 pointer-events-none" : "" : ""
            }
        `}>{children}</div>
    )
}