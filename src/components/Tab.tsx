import { XMarkIcon, GlobeAltIcon, MusicalNoteIcon, SpeakerWaveIcon, SpeakerXMarkIcon, ChevronDownIcon, PlusIcon, ArrowPathIcon, DocumentDuplicateIcon, LinkIcon, RectangleStackIcon, ArrowUturnLeftIcon, XCircleIcon, BarsArrowDownIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { useMusicStore, usePanelsStore, usePlaybackStore, useSettingsStore, useTabAudioStore, useTabsStore } from "../store";
import { useEffect, useRef, useState } from "react";
import { handleImg } from "../libs/imgHandler";
import { appRoot } from "../libs/cloak";
import { toggleMute } from "../libs/playback";
import { useHolyAttr } from "../libs/holy-attr";
import { HolyText } from "./common/HolyText";

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

export const Tab = ({ title, url, id, icon }: TabProps) => {
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const setCurrentTab = useTabsStore(state => state.setCurrentTab);
	const closeTab = useTabsStore(state => state.closeTab);
	const settings = useSettingsStore(state => state.settings);

	const thisTab = tabs.find(tab => tab.id === id);
	const panelsOpen = usePanelsStore(state => state.panelsOpen);
	const collapsed = !panelsOpen && settings["compact-tabs"] === true;
	const tabsLeft = settings["tabs-position"] === "left";
	const mirrored = tabsLeft && settings["compact-tabs"] !== true && !panelsOpen;
	const currentTrack = useMusicStore(state => state.currentTrack);
	const musicPlaying = usePlaybackStore(state => state.isPlaying);
	const musicMuted = usePlaybackStore(state => state.muted);
	const webAudible = useTabAudioStore(state => Boolean(state.audible[id]));
	const webMuted = useTabAudioStore(state => Boolean(state.muted[id]));

	const isMusicTab = isMusicTabUrl(thisTab?.url ?? url);
	const songPlaying = musicPlaying && !!currentTrack;
	const currTitle = isMusicTab ? (songPlaying ? currentTrack.title : "Fracital Music") : (thisTab?.title ?? title);
	const currIcon = isMusicTab ? songPlaying && currentTrack.cover ? <img src={currentTrack.cover} alt="" className="size-5 shrink-0 rounded object-cover" /> : <MusicalNoteIcon className="size-5" /> : (thisTab?.icon ?? icon);

	// The app's music belongs to one tab: Now Playing if open, otherwise the first music tab.
	const musicOwnerId = (tabs.find(t => /^about:(player|music\?player)/.test(t.url)) ?? tabs.find(t => isMusicTabUrl(t.url)))?.id;
	const playsMusic = songPlaying && musicOwnerId === id;
	const showSpeaker = playsMusic || webAudible || webMuted;
	const speakerMuted = playsMusic ? musicMuted : webMuted;
	const { ref: speakerRef, placeholder: speakerAttrs } = useHolyAttr({ title: speakerMuted ? "Unmute tab" : "Mute tab", "aria-label": speakerMuted ? "Unmute tab" : "Mute tab" });

	const { ref: menuBtnRef, placeholder: menuBtnAttrs } = useHolyAttr({ title: "Tab options", "aria-label": "Tab options" });
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

	/** The tab's menu (right-click, or the chevron that shows on hover). */
	const tabMenu = (): MenuItem[] => {
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
						store.newGroup(groupId, `Group ${store.groups.length + 1}`);
						store.updateTab(id, { groupId });
					},
				},
				// Group names are the user's own text (data), shown as-is.
				...store.groups.filter(g => g.id !== self.groupId).map(g => ({ title: g.name, icon: <RectangleStackIcon className="size-4 opacity-60" />, onClick: () => store.updateTab(id, { groupId: g.id }) })),
			],
		});
		if (self.groupId) items.push({ title: <HolyText text="Remove from group" />, icon: <ArrowUturnLeftIcon className="size-5" />, onClick: () => store.updateTab(id, { groupId: undefined }) });
		const others = store.tabs.filter(t => t.id !== id);
		const below = store.tabs.slice(store.tabs.findIndex(t => t.id === id) + 1);
		items.push({ title: <HolyText text="Close tab" />, icon: <XMarkIcon className="size-5" />, onClick: () => closeTab(id) });
		if (others.length) items.push({ title: <HolyText text="Close other tabs" />, icon: <XCircleIcon className="size-5" />, onClick: () => others.forEach(t => store.closeTab(t.id)) });
		if (below.length) items.push({ title: <HolyText text="Close tabs below" />, icon: <BarsArrowDownIcon className="size-5" />, onClick: () => below.forEach(t => store.closeTab(t.id)) });
		return items;
	};

	const [loadedIcon, setLoadedIcon] = useState<{ key: string; src?: string; failed: boolean } | null>(null);
	const closeRef = useRef<SVGSVGElement>(null);

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
						{hasStringIcon ? (
							iconSrc && !iconFailed ? (
								<img src={iconSrc} alt={currTitle} className={`size-5 ${collapsed ? "rounded-full object-cover" : ""}`} onError={handleIconError} />
							) : (
								<GlobeAltIcon className="size-5" />
							)
						) : currIcon && typeof currIcon !== "string" ? (
							currIcon
						) : (
							<GlobeAltIcon className="size-5" />
						)}
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
