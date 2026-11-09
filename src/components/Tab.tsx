import { XMarkIcon, GlobeAltIcon } from "@heroicons/react/24/solid";
import { useSettingsStore, useTabsStore } from "../store";
import { useEffect, useRef, useState } from "react";
import { handleImg } from "../libs/imgHandler";
import { appRoot } from "../libs/cloak";
import { HolyText } from "./common/HolyText";

export interface TabProps {
	title: string;
	url: string;
	displayUrl: string;
	id: string;
	icon?: string | React.ReactNode | null;
	history?: string[];
	historyIndex?: number;
	index?: number;
	current?: boolean;
	groupId?: string;
	refreshKey?: number;
	/** Bumped by every navigation the user asks for (navigateTab); a proxied tab runs one go() per value. */
	navNonce?: number;
}

export const Tab = ({ title, url, id, icon }: TabProps) => {
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const setCurrentTab = useTabsStore(state => state.setCurrentTab);
	const closeTab = useTabsStore(state => state.closeTab);
	const settings = useSettingsStore(state => state.settings);

	const thisTab = tabs.find(tab => tab.id === id);
	const currTitle = thisTab?.title ?? title;
	const currIcon = thisTab?.icon ?? icon;

	const [loadedIcon, setLoadedIcon] = useState<{ key: string; src?: string; failed: boolean } | null>(null);
	const closeRef = useRef<SVGSVGElement>(null);

	const hasStringIcon = typeof currIcon === "string" && currIcon.trim() !== "";

	useEffect(() => {
		if (typeof currIcon !== "string" || !currIcon.trim()) return;
		let cancelled = false;
		handleImg(currIcon, result => {
			if (!cancelled) setLoadedIcon({ key: currIcon, src: result, failed: !result });
		});
		return () => {
			cancelled = true;
		};
	}, [currIcon]);

	const iconState = loadedIcon && loadedIcon.key === currIcon ? loadedIcon : null;
	const iconSrc = iconState?.src;
	const iconFailed = iconState?.failed ?? false;
	const handleIconError = () => {
		if (typeof currIcon === "string") setLoadedIcon({ key: currIcon, failed: true });
	};

	return (
		<div
			draggable
			onDragStart={e => {
				e.dataTransfer.setData("text/tab-id", id);
				try {
					e.dataTransfer.effectAllowed = "move";
				} catch {}
			}}
			onDragOver={e => {
				e.preventDefault();
			}}
			onDrop={e => {
				e.preventDefault();
				e.stopPropagation();
				const draggedId = e.dataTransfer.getData("text/tab-id");
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
			data-url={url}
			id={id}
			className={
				"flex w-full min-w-0 justify-between p-3 rounded-md duration-150" +
				" " +
				`
            ${currentTab && id === currentTab.id ? "bg-(--accent-opaque) rounded-b-md" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000025] hover:bg-[#0000001a]"}`}
        `
			}
			onMouseDown={e => {
				if (e.button === 1) {
					// Suppress the browser's middle-click autoscroll; the close happens in onAuxClick.
					e.preventDefault();
					return;
				}
				if (e.target === closeRef.current) return;

				const latestCurrentTab = useTabsStore.getState().tabs.find(tab => tab.current);
				if (latestCurrentTab?.id !== id) {
					setCurrentTab(id);

					const input = appRoot().querySelector<HTMLInputElement>("#input");
					if (input && latestCurrentTab) {
						input.value = latestCurrentTab.displayUrl || latestCurrentTab.url || "about:newtab";
					}
				}
			}}
			onAuxClick={e => {
				if (e.button !== 1) return;
				e.preventDefault();
				closeTab(id);
			}}
		>
			<div className="flex w-full min-w-0 justify-between items-center gap-1.5 duration-150">
				{/* min-w-0 + truncate: the title takes whatever width the icon and close button leave. */}
				<div className="flex flex-1 min-w-0 items-center gap-1.5 *:pointer-events-none *:shrink-0" title={currTitle}>
					{hasStringIcon ? iconSrc && !iconFailed ? <img src={iconSrc} alt={currTitle} className="size-5" onError={handleIconError} /> : <GlobeAltIcon className="size-5" /> : currIcon && typeof currIcon !== "string" ? currIcon : <GlobeAltIcon className="size-5" />}
					<span
						className={
							"min-w-0 shrink! truncate font-medium select-none" +
							" " +
							`
                        ${currentTab && id === currentTab.id ? "font-semibold" : "font-medium"}
                    `
						}
					>
						{/* Dynamic titles (proxied pages) pass through; registry strings (brand tabs) decrypt. Either way the text reveals into a closed shadow root. */}
						<HolyText text={currTitle} ellipsis />
					</span>
				</div>
				<XMarkIcon
					ref={closeRef}
					className="size-5 shrink-0 text-[#ffffff70] hover:text-(--text-primary) stroke-current stroke-2 cursor-pointer duration-150"
					onClick={e => {
						e.stopPropagation();
						closeTab(id);
					}}
				/>
			</div>
		</div>
	);
};
