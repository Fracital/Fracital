import { XMarkIcon, GlobeAltIcon, MusicalNoteIcon, SpeakerWaveIcon, SpeakerXMarkIcon, ChevronDownIcon, PlusIcon, ArrowPathIcon, DocumentDuplicateIcon, LinkIcon, RectangleStackIcon, ArrowUturnLeftIcon, XCircleIcon, BarsArrowDownIcon, BarsArrowUpIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { fixLayout, groupKey, nextGroupName, tabKey, topLevel, useMusicStore, usePanelsStore, usePlaybackStore, useSettingsStore, useTabAudioStore, useTabsStore } from "../store";
import { useEffect, useRef, useState } from "react";
import { handleImg } from "../libs/imgHandler";
import { appRoot } from "../libs/cloak";
import { toggleMute } from "../libs/playback";
import { useHolyAttr } from "../libs/holy-attr";
import { HolyText } from "./common/HolyText";
import { GroupIcon } from "./GroupIcon";
import { TAB_VIEW_SETTING } from "../types";

const isMusicTabUrl = (url: string | undefined) => !!url && /^about:(music|player)(\?|$)/.test(url);

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

/**
 * A tab's shown title and icon: the playing song on the music tab, otherwise the tab's own (favicons load
 * through handleImg, with a globe when there is none). Shared by the side panel's tabs and the tab view's cards.
 */
export const useTabFace = ({ title, url, id, icon }: Pick<TabProps, "title" | "url" | "id" | "icon">, iconClassName = "") => {
	const thisTab = useTabsStore(state => state.tabs.find(tab => tab.id === id));
	const currentTrack = useMusicStore(state => state.currentTrack);
	const musicPlaying = usePlaybackStore(state => state.isPlaying);

	const isMusicTab = isMusicTabUrl(thisTab?.url ?? url);
	const songPlaying = musicPlaying && !!currentTrack;
	const currTitle = isMusicTab ? (songPlaying ? currentTrack.title : "Fracital Music") : (thisTab?.title ?? title);
	const currIcon = isMusicTab ? songPlaying && currentTrack.cover ? <img src={currentTrack.cover} alt="" className="size-5 shrink-0 rounded object-cover" /> : <MusicalNoteIcon className="size-5" /> : (thisTab?.icon ?? icon);

	const [loadedIcon, setLoadedIcon] = useState<{ key: string; src?: string; failed: boolean } | null>(null);
	const hasStringIcon = typeof currIcon === "string" && currIcon.trim() !== "";
	const iconUrl = hasStringIcon ? currIcon : null;

	useEffect(() => {
		if (!iconUrl) return;
		let cancelled = false;
		handleImg(iconUrl, result => {
			if (!cancelled) setLoadedIcon({ key: iconUrl, src: result, failed: !result });
		});
		return () => {
			cancelled = true;
		};
	}, [iconUrl]);

	const iconState = loadedIcon && loadedIcon.key === currIcon ? loadedIcon : null;
	const iconSrc = iconState?.src;
	const iconFailed = iconState?.failed ?? false;
	const handleIconError = () => {
		if (typeof currIcon === "string") setLoadedIcon({ key: currIcon, failed: true });
	};

	const iconNode = hasStringIcon ? (
		iconSrc && !iconFailed ? (
			<img src={iconSrc} alt={currTitle} className={`size-5 ${iconClassName}`} onError={handleIconError} />
		) : (
			<GlobeAltIcon className="size-5" />
		)
	) : currIcon && typeof currIcon !== "string" ? (
		currIcon
	) : (
		<GlobeAltIcon className="size-5" />
	);

	return { title: currTitle, icon: iconNode };
};

/**
 * A tab's sound state and its menu (New tab, Reload, Duplicate, groups, close…). Shared by the side panel's tabs
 * ("list": its batch closes read above/below) and the tab view's cards ("grid": left/right).
 */
export const useTabMenu = (id: string, layout: "grid" | "list" = "list") => {
	const tabs = useTabsStore(state => state.tabs);
	const closeTab = useTabsStore(state => state.closeTab);
	const currentTrack = useMusicStore(state => state.currentTrack);
	const musicPlaying = usePlaybackStore(state => state.isPlaying);
	const musicMuted = usePlaybackStore(state => state.muted);
	const webAudible = useTabAudioStore(state => Boolean(state.audible[id]));
	const webMuted = useTabAudioStore(state => Boolean(state.muted[id]));
	const songPlaying = musicPlaying && !!currentTrack;

	// The app's music belongs to one tab: Now Playing if open, otherwise the first music tab.
	const musicOwnerId = (tabs.find(t => /^about:(player|music\?player)/.test(t.url)) ?? tabs.find(t => isMusicTabUrl(t.url)))?.id;
	const playsMusic = songPlaying && musicOwnerId === id;
	const showSpeaker = playsMusic || webAudible || webMuted;
	const speakerMuted = playsMusic ? musicMuted : webMuted;

	const menuItems = (): MenuItem[] => {
		const store = useTabsStore.getState();
		const self = store.tabs.find(t => t.id === id);
		if (!self) return [];
		/** Opens a tab right after this one, in the same group. */
		const openAfter = (props: Omit<TabProps, "id">) => {
			const newId = createId();
			store.newTab({ ...props, id: newId } as TabProps);
			if (self.groupId) store.updateTab(newId, { groupId: self.groupId });
			store.moveTabRelative(newId, id, false);
		};
		const items: MenuItem[] = [
			{ title: <HolyText text="New tab" />, icon: <PlusIcon className="size-5" />, onClick: () => openAfter({ title: "New Tab", url: "about:newtab", displayUrl: "about:newtab" }) },
			{ title: <HolyText text="Reload" />, icon: <ArrowPathIcon className="size-5" />, onClick: () => window.dispatchEvent(new CustomEvent("reload-tab", { detail: { tab: id } })) },
			{
				title: <HolyText text="Duplicate" />,
				icon: <DocumentDuplicateIcon className="size-5" />,
				onClick: () => openAfter({ title: self.title, url: self.url, displayUrl: self.displayUrl, icon: self.icon }),
			},
			{ title: <HolyText text="Copy link" />, icon: <LinkIcon className="size-5" />, onClick: () => void navigator.clipboard?.writeText(self.displayUrl || self.url).catch(() => undefined) },
		];
		if (showSpeaker)
			items.push({
				title: <HolyText text={speakerMuted ? "Unmute tab" : "Mute tab"} />,
				icon: speakerMuted ? <SpeakerWaveIcon className="size-5" /> : <SpeakerXMarkIcon className="size-5" />,
				onClick: () => (playsMusic ? toggleMute() : useTabAudioStore.getState().toggleMuted(id)),
			});
		items.push({
			title: <HolyText text="Add to group" />,
			icon: <RectangleStackIcon className="size-5" />,
			onClick: () => undefined,
			children: [
				{
					title: <HolyText text="New group" />,
					icon: <PlusIcon className="size-4" />,
					onClick: () => {
						const groupId = createId();
						// The new group stands where the tab stood (or just after the group it was in), not at the end.
						const order = fixLayout(useTabsStore.getState());
						const from = self.groupId ? order.indexOf(groupKey(self.groupId)) : order.indexOf(tabKey(id));
						store.newGroup(groupId, nextGroupName(store.groups));
						store.updateTab(id, { groupId });
						if (from !== -1) {
							// A loose tab's own key leaves the list, so its slot is `from`; after its old group is `from + 1`.
							const rest = order.filter(k => k !== tabKey(id));
							rest.splice(self.groupId ? from + 1 : from, 0, groupKey(groupId));
							useTabsStore.getState().setTopOrder(rest);
						}
					},
				},
				// Group names are the user's own text (data), shown as-is.
				...store.groups.filter(g => g.id !== self.groupId).map(g => ({ title: g.name, icon: <GroupIcon icon={g.icon} className="size-4 opacity-60" />, onClick: () => store.updateTab(id, { groupId: g.id }) })),
			],
		});
		if (self.groupId) items.push({ title: <HolyText text="Remove from group" />, icon: <ArrowUturnLeftIcon className="size-5" />, onClick: () => store.updateTab(id, { groupId: undefined }) });
		const others = store.tabs.filter(t => t.id !== id);
		// Closing all to one side acts on the tabs shown with this one, in order: its group's, or the loose tabs in the
		// top level's order (groups between them are left alone).
		const siblings = self.groupId
			? store.tabs.filter(t => t.groupId === self.groupId)
			: topLevel(store).flatMap(item => (item.kind === "tab" ? store.tabs.filter(t => t.id === item.id) : []));
		const at = siblings.findIndex(t => t.id === id);
		const after = siblings.slice(at + 1);
		const before = siblings.slice(0, at);
		const grid = layout === "grid";
		items.push({ title: <HolyText text="Close tab" />, icon: <XMarkIcon className="size-5" />, onClick: () => closeTab(id) });
		if (others.length) items.push({ title: <HolyText text="Close other tabs" />, icon: <XCircleIcon className="size-5" />, onClick: () => others.forEach(t => store.closeTab(t.id)) });
		if (after.length) items.push({ title: <HolyText text={grid ? "Close all right" : "Close all below"} />, icon: grid ? <ChevronDoubleRightIcon className="size-5" /> : <BarsArrowDownIcon className="size-5" />, onClick: () => after.forEach(t => store.closeTab(t.id)) });
		if (before.length) items.push({ title: <HolyText text={grid ? "Close all left" : "Close all above"} />, icon: grid ? <ChevronDoubleLeftIcon className="size-5" /> : <BarsArrowUpIcon className="size-5" />, onClick: () => before.forEach(t => store.closeTab(t.id)) });
		return items;
	};

	return { playsMusic, showSpeaker, speakerMuted, menuItems };
};

/** `topKey`: the tab's top-level key, passed only to a loose tab in the side panel (marks it for drops and the group drag). */
export const Tab = ({ title, url, id, icon, topKey }: TabProps & { topKey?: string }) => {
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const setCurrentTab = useTabsStore(state => state.setCurrentTab);
	const closeTab = useTabsStore(state => state.closeTab);
	const settings = useSettingsStore(state => state.settings);

	const panelsOpen = usePanelsStore(state => state.panelsOpen);
	// In the tab view the side panel's collapsed layouts don't apply.
	const tabView = settings[TAB_VIEW_SETTING] === true;
	const collapsed = !tabView && !panelsOpen && settings["compact-tabs"] === true;
	const tabsLeft = settings["tabs-position"] === "left";
	const mirrored = !tabView && tabsLeft && settings["compact-tabs"] !== true && !panelsOpen;

	const { title: currTitle, icon: iconNode } = useTabFace({ title, url, id, icon }, collapsed ? "rounded-full object-cover" : "");

	const { playsMusic, showSpeaker, speakerMuted, menuItems: tabMenu } = useTabMenu(id);
	const { ref: speakerRef, placeholder: speakerAttrs } = useHolyAttr({ title: speakerMuted ? "Unmute tab" : "Mute tab", "aria-label": speakerMuted ? "Unmute tab" : "Mute tab" });
	const { ref: menuBtnRef, placeholder: menuBtnAttrs } = useHolyAttr({ title: "Tab options", "aria-label": "Tab options" });
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

	const closeRef = useRef<SVGSVGElement>(null);

	return (
		<>
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
				data-top-item={topKey}
				// Where the Shift+arrow tab switcher finds this tab on screen.
				data-tab-spot={id}
				className={
					(collapsed ? "group/tab flex w-full min-w-0 justify-center p-1.5 rounded-3xl duration-150" : "group/tab flex w-full min-w-0 justify-between p-3 rounded-xl duration-150") +
					" " +
					`
            ${currentTab && id === currentTab.id ? "bg-(--accent-opaque)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000025] hover:bg-[#0000001a]"}`}
        `
				}
				onMouseDown={e => {
					if (e.button === 2) return;
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
				onContextMenu={e => {
					e.preventDefault();
					setMenu({ x: e.clientX, y: e.clientY });
				}}
				onAuxClick={e => {
					if (e.button !== 1) return;
					e.preventDefault();
					closeTab(id);
				}}
			>
				<div className={`flex w-full min-w-0 items-center gap-1.5 duration-150 ${collapsed ? "justify-center" : "justify-between"} ${mirrored ? "flex-row-reverse" : ""}`}>
					<div className={`relative flex min-w-0 items-center gap-1.5 *:pointer-events-none *:shrink-0 ${collapsed ? "flex-none" : "flex-1"} ${mirrored ? "flex-row-reverse" : ""}`} title={currTitle}>
						{iconNode}
						{collapsed && showSpeaker && (
							<span className={`absolute -bottom-1 ${tabsLeft ? "-right-1.5" : "-left-1.5"} flex size-3.5 items-center justify-center rounded-full bg-(--secondary) text-(--text-primary)`}>{speakerMuted ? <SpeakerXMarkIcon className="size-2.5" /> : <SpeakerWaveIcon className="size-2.5" />}</span>
						)}
						<span
							className={
								(collapsed ? "hidden " : "") +
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
					{!collapsed && (
						<button
							ref={menuBtnRef}
							{...menuBtnAttrs}
							aria-haspopup="menu"
							className={`flex shrink-0 items-center justify-center rounded-full text-[#ffffff70] hover:text-(--text-primary) cursor-pointer duration-150 ${menu ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"}`}
							onMouseDown={e => e.stopPropagation()}
							onClick={e => {
								e.stopPropagation();
								const r = e.currentTarget.getBoundingClientRect();
								setMenu({ x: r.left, y: r.bottom + 6 });
							}}
						>
							<ChevronDownIcon className="size-4 stroke-current stroke-1" />
						</button>
					)}
					{showSpeaker && !collapsed && (
						<button
							ref={speakerRef}
							{...speakerAttrs}
							aria-pressed={speakerMuted}
							className="flex shrink-0 items-center justify-center rounded text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-150"
							onMouseDown={e => e.stopPropagation()}
							onClick={e => {
								e.stopPropagation();
								if (playsMusic) toggleMute();
								else useTabAudioStore.getState().toggleMuted(id);
							}}
						>
							{speakerMuted ? <SpeakerXMarkIcon className="size-4" /> : <SpeakerWaveIcon className="size-4" />}
						</button>
					)}
					<XMarkIcon
						ref={closeRef}
						className={`size-5 shrink-0 text-[#ffffff70] hover:text-(--text-primary) stroke-current stroke-2 cursor-pointer duration-150 ${collapsed ? "hidden" : ""}`}
						onClick={e => {
							e.stopPropagation();
							closeTab(id);
						}}
					/>
				</div>
			</div>
			{/* A sibling, not a child: React events from the (portaled) menu would otherwise bubble into the tab's handlers. */}
			{menu && <ContextMenu items={tabMenu()} position={menu} onClose={() => setMenu(null)} />}
		</>
	);
};
