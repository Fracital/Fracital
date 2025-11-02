import { XMarkIcon, GlobeAltIcon } from "@heroicons/react/24/solid"
import { useSettingsStore, useTabsStore } from "../store"
import { useRef, useState } from "react"

export interface TabProps {
    title: string
    url: string
    displayUrl: string
    id: string
    icon?: string | React.ReactNode | null
    history?: string[]
    historyIndex?: number
    historyLength?: number
    historyPosition?: 'start' | 'middle' | 'end'
    index?: number
    current?: boolean
    groupId?: string
}

export const Tab = ({ title, url, id, icon }: TabProps) => {
    const tabs = useTabsStore(state => state.tabs)
    const currentTab = tabs.find(tab => tab.current === true);
    const setCurrentTab = useTabsStore(state => state.setCurrentTab)
    const closeTab = useTabsStore(state => state.closeTab)
    const settings = useSettingsStore(state => state.settings)
    const [currTitle, setTitle] = useState(title);
    const [currIcon, setIcon] = useState(icon);

    // @ts-expect-error Custom Event
    window.addEventListener("updatedTab", (e: CustomEvent) => {
        const response = JSON.parse(e.detail);
        if (response.id === id) {
            setTitle(response.title);
            setIcon(response.icon);
        }
    });
    const closeRef = useRef<SVGSVGElement>(null)

    return (
        <div draggable
            onDragStart={(e) => {
                e.dataTransfer.setData('text/tab-id', id);
                try { e.dataTransfer.effectAllowed = 'move'; } catch {}
            }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData('text/tab-id');
                if (!draggedId || draggedId === id) return;
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const y = e.clientY - rect.top;
                const placeBefore = y < rect.height / 2;
                const targetTab = useTabsStore.getState().tabs.find(t => t.id === id);
                const targetGroupId = targetTab?.groupId;
                if (targetGroupId !== undefined) {
                    useTabsStore.getState().updateTab(draggedId, { groupId: targetGroupId });
                } else {
                    useTabsStore.getState().updateTab(draggedId, { groupId: undefined });
                }
                useTabsStore.getState().moveTabRelative(draggedId, id, placeBefore);
            }}
            data-url={url} id={id} className={"flex w-full justify-between p-3 rounded-md duration-150" + " " + `
            ${
                currentTab && id === currentTab.id ? "bg-(--accent-opaque) rounded-b-md" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000025] hover:bg-[#0000001a]"}`
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
            <div className="flex w-full justify-between items-center duration-150">
                <div className="flex items-center gap-1.5 *:pointer-events-none">
                    {typeof currIcon === "string" ? (
                        <img src={currIcon} alt={currTitle} className="size-5" />
                    ) : currIcon ? (
                        currIcon
                    ) : (
                        <GlobeAltIcon className="size-5" />
                    )}
                    <span className={"font-medium select-none" + " " + `
                        ${currentTab && id === currentTab.id ? "font-semibold" : "font-medium"}
                    `}>{currTitle.length > 10 ? currTitle.slice(0, 10) + "…" : currTitle}</span>
                </div>
                <XMarkIcon ref={closeRef} className="size-5 text-[#ffffff70] hover:text-(--text-primary) stroke-current stroke-2 cursor-pointer duration-150" onClick={(e) => {
                    e.stopPropagation()
                    closeTab(id)
                }}/>
            </div>
        </div>
    )
}