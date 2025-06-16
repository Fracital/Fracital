import { XMarkIcon, GlobeAltIcon } from "@heroicons/react/24/solid"
import { useSettingsStore, useTabsStore } from "../store"
import { useRef } from "react"

export interface TabProps {
    title: string
    url: string
    displayUrl: string
    id: string
    icon?: string | React.ReactNode | null
    history?: string[]
    current?: boolean
}

export const Tab = ({ title, url, id, icon }: TabProps) => {
    const tabs = useTabsStore(state => state.tabs)
    const currentTab = tabs.find(tab => tab.current === true);
    const setCurrentTab = useTabsStore(state => state.setCurrentTab)
    const closeTab = useTabsStore(state => state.closeTab)
    const settings = useSettingsStore(state => state.settings)

    const closeRef = useRef<SVGSVGElement>(null)

    return (
        <div data-url={url} id={id} className={"flex w-full justify-between p-3 rounded-lg duration-150" + " " + `
            ${
                currentTab && id === currentTab.id ? "bg-(--accent-opaque) scale-105 rounded-b-md" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000025] hover:bg-[#0000001a]"}`
            }
        `} onMouseDown={(e) => {
            if (e.target === closeRef.current) return

            const latestCurrentTab = useTabsStore.getState().tabs.find(tab => tab.current);
            if (latestCurrentTab?.id !== id) {
                setCurrentTab(id);

                const input = document.querySelector<HTMLInputElement>("#input");
                if (input && latestCurrentTab) {
                    input.value = latestCurrentTab.displayUrl || latestCurrentTab.url || "newtab";
                }
            }
        }}>
            <div className="flex w-full justify-between duration-150">
                <div className="flex items-center gap-1.5 *:pointer-events-none">
                    {typeof icon === "string" ? (
                        <img src={icon} alt={title} className="size-5" />
                    ) : icon ? (
                        icon
                    ) : (
                        <GlobeAltIcon className="size-5" />
                    )}
                    <span className={"font-medium select-none" + " " + `
                        ${currentTab && id === currentTab.id ? "font-semibold" : "font-medium"}
                    `}>{title.length > 10 ? title.slice(0, 10) + "…" : title}</span>
                </div>
                <XMarkIcon ref={closeRef} className="size-5 text-[#ffffff70] hover:text-(--text-primary) stroke-current stroke-2 cursor-pointer duration-150" onClick={(e) => {
                    e.stopPropagation()
                    closeTab(id)
                }}/>
            </div>
        </div>
    )
}