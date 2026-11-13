import { XMarkIcon, ChevronDownIcon, PlusIcon, BarsArrowDownIcon, BarsArrowUpIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, XCircleIcon, ArrowUturnLeftIcon } from "@heroicons/react/24/solid";
import { HolyText } from "./common/HolyText";
import { GROUP_ICONS, GroupIcon, type GroupIconKey } from "./GroupIcon";
import { groupKey, usePanelsStore, useSettingsStore, useTabsStore } from "../store";
import { Tab } from "./Tab";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createId } from "@paralleldrive/cuid2";
import { EASE, pressToDrag, scrollParent } from "../libs/dragFeel";
import { useHolyAttr } from "../libs/holy-attr";
import { reducedMotion } from "../libs/motion";
import { moveToEnd, useMoreOnHold, useOpenLinks } from "../gui/tabBatch";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { appRoot } from "../libs/cloak";
import { CLOSE_GROUP_TABS_SETTING, TAB_VIEW_SETTING } from "../types";

interface TabGroupProps {
	id: string;
	name: string;
	icon?: string | React.ReactNode | null;
}

/** Closes a group, with its tabs or keeping them (they stay open, out of any group). */
export const removeGroup = (id: string, withTabs: boolean) => {
	const store = useTabsStore.getState();
	if (withTabs) for (const tab of store.tabs.filter(t => t.groupId === id)) store.closeTab(tab.id);
	useTabsStore.getState().closeGroup(id);
};

/** Closes a group as Settings says: with its tabs when "close group tabs" is on. Every × and batch close uses this. */
export const closeGroupAsSet = (id: string) => removeGroup(id, useSettingsStore.getState().settings[CLOSE_GROUP_TABS_SETTING] === true);

/** A color in the group color row: a round swatch, ringed when it's the group's color. */
const ColorSwatch = ({ color, label, on }: { color: string | null | "custom"; label: string; on: boolean }) => {
	const { ref, placeholder } = useHolyAttr({ title: label, "aria-label": label });
	const fill = color === "custom" ? "conic-gradient(#ff4757, #ffd77b, #7bffb8, #7bdfff, #9bb0ff, #c77bff, #ff4757)" : color === null ? "linear-gradient(135deg, transparent 44%, #ff4757 44%, #ff4757 56%, transparent 56%)" : color;
	return <span ref={ref} {...placeholder} className={`block size-7 rounded-full ring-2 ring-offset-2 ring-offset-(--secondary) ${on ? "ring-(--text-primary)" : "ring-transparent"} ${color === null ? "inset-shadow-[0_0_0_1.5px_#ffffff40]" : "inset-shadow-[0_0_0_1px_#00000025]"}`} style={{ background: fill }} />;
};

/**
 * Opens the system color picker for a group, changing its color live as the picker moves. The input lives in the page
 * (not the menu, which closes as soon as the option is clicked) and is removed once a color is picked.
 */
const pickGroupColor = (id: string, current: string | undefined) => {
	const input = document.createElement("input");
	input.type = "color";
	input.value = current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#7bdfff";
	input.style.cssText = "position:fixed;left:50%;top:50%;width:0;height:0;opacity:0;pointer-events:none;";
	document.body.append(input);
	// Back at the color it opened with (Chrome's picker resets to it on Escape) means the group's own color, which may
	// be none: the starting value is only a stand-in for that.
	const seed = input.value;
	const apply = () => useTabsStore.getState().updateGroup(id, { accent: input.value === seed ? current : input.value });
	input.addEventListener("input", apply);
	input.addEventListener("change", () => {
		apply();
		input.remove();
	});
	// A picker closed without choosing fires nothing; drop the input the next time the page is clicked.
	window.addEventListener("pointerdown", () => input.remove(), { once: true, capture: true });
	try {
		input.showPicker();
	} catch {
		input.click();
	}
};

/**
 * A group's menu: rename it, change its color, close it the other way than its × does (with or without its tabs, per
 * Settings), or close every group to one side of it. Shared by the side panel's
 * groups ("list", in the store's order: above/below) and the tab view's ("grid", in the order shown: left/right).
 */
export const buildGroupMenu = (id: string, name: string, layout: { kind: "grid" | "list"; order?: string[] } = { kind: "list" }): MenuItem[] => {
	const { updateGroup, groups } = useTabsStore.getState();
	const closesTabs = useSettingsStore.getState().settings[CLOSE_GROUP_TABS_SETTING] === true;
	const order = layout.order ?? groups.map(group => group.id);
	const at = order.indexOf(id);
	const after = order.slice(at + 1);
	const before = at > 0 ? order.slice(0, at) : [];
	const grid = layout.kind === "grid";
	const closeSide: MenuItem[] = [];
	if (after.length) closeSide.push({ title: <HolyText text={grid ? "Close all right" : "Close all below"} />, icon: grid ? <ChevronDoubleRightIcon className="size-5" /> : <BarsArrowDownIcon className="size-5" />, onClick: () => after.forEach(closeGroupAsSet) });
	if (before.length) closeSide.push({ title: <HolyText text={grid ? "Close all left" : "Close all above"} />, icon: grid ? <ChevronDoubleLeftIcon className="size-5" /> : <BarsArrowUpIcon className="size-5" />, onClick: () => before.forEach(closeGroupAsSet) });
	const baseColors = ["#ff4757", "#ff7b7b", "#7bdfff", "#7bffb8", "#ffd77b", "#c77bff", "#9bb0ff", "#7bffdf"];
	const current = groups.find(group => group.id === id)?.accent;
	const isPreset = !!current && baseColors.includes(current.toLowerCase());
	return [
		{
			title: <HolyText text="Rename group" />,
			icon: null,
			onClick: () => {
				let newName = "";
				window.fr.dialog.prompt({
					title: "Rename Group",
					message: "New group name",
					defaultValue: name,
					onOk: (res: string) => {
						newName = res;
					},
				});
				if (newName && newName.trim().length > 0) {
					updateGroup(id, { name: newName.trim() });
				}
			},
		},
		{
			title: <HolyText text="Change color" />,
			icon: null,
			onClick: () => {},
			children: [
				// No color: the group goes back to the theme's look.
				{ title: <ColorSwatch color={null} label="No color" on={!current} />, icon: null, onClick: () => updateGroup(id, { accent: undefined }) },
				// The preset hex values are data, shown as their own labels.
				...baseColors.map(c => ({ title: <ColorSwatch color={c} label={c} on={current?.toLowerCase() === c} />, icon: null, onClick: () => updateGroup(id, { accent: c }) })),
				{ title: <ColorSwatch color="custom" label="Custom color" on={!!current && !isPreset} />, icon: null, onClick: () => pickGroupColor(id, current) },
			],
			childrenLayout: "horizontal",
			childrenPosition: "right",
		},
		{
			title: <HolyText text="Change icon" />,
			icon: null,
			onClick: () => {},
			// The group's current icon is in the accent color.
			children: (Object.keys(GROUP_ICONS) as GroupIconKey[]).map(key => ({
				title: <GroupIcon icon={key} className={`size-5 ${(groups.find(g => g.id === id)?.icon ?? "stack") === key ? "text-(--accent)" : ""}`} />,
				icon: null,
				onClick: () => updateGroup(id, { icon: key }),
			})),
			childrenLayout: "grid",
			childrenPosition: "right",
		},
		// The other way to close it than its × (which follows Settings).
		{
			title: <HolyText text={closesTabs ? "Close group, keep tabs" : "Close group and tabs"} />,
			icon: closesTabs ? <ArrowUturnLeftIcon className="size-5" /> : <XCircleIcon className="size-5" />,
			onClick: () => removeGroup(id, !closesTabs),
		},
		...closeSide,
	];
};

const hexToRgb = (hex: string) => {
	if (!hex) return null;
	let h = hex.replace("#", "");
	if (h.length === 3)
		h = h
			.split("")
			.map(c => c + c)
			.join("");
	const bigint = parseInt(h, 16);
	return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
};

/** How long the lifted header takes to fade out after a group is dropped. */
const GHOST_FADE_MS = 160;

/** A group being dragged by its header: the lifted copy's top-left and width, and the line marking where it lands. */
interface GroupDragView {
	left: number;
	top: number;
	width: number;
	line: { left: number; top: number; width: number } | null;
	dropping: boolean;
}

const ICON_BUTTON = "flex shrink-0 items-center justify-center p-0.5 rounded-full text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-150";

const TabGroup = ({ id, name, icon }: TabGroupProps) => {
	const tabs = useTabsStore(state => state.tabs);
	const settings = useSettingsStore(state => state.settings);
	const panelsOpen = usePanelsStore(state => state.panelsOpen);
	// In the tab view the side panel's collapsed layouts don't apply.
	const tabView = settings[TAB_VIEW_SETTING] === true;
	const collapsed = !tabView && !panelsOpen && settings["compact-tabs"] === true;
	const tabsLeft = settings["tabs-position"] === "left";
	const mirrored = !tabView && tabsLeft && settings["compact-tabs"] !== true && !panelsOpen;

	const setCurrentTab = useTabsStore(state => state.setCurrentTab);
	const closeGroup = useTabsStore(state => state.closeGroup);
	const updateTab = useTabsStore(state => state.updateTab);
	const moveTabRelative = useTabsStore(state => state.moveTabRelative);

	const [dragOver, setDragOver] = useState(false);
	const [groupOpen, setGroupOpen] = useState(true);
	const [changingName, setChangingName] = useState(false);
	const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; visible: boolean; items: MenuItem[] }>(null);

	const openLinks = useOpenLinks();
	const addHold = useMoreOnHold(() => openLinks(id));
	const { ref: menuRef, placeholder: menuAttrs } = useHolyAttr({ title: "Group options", "aria-label": "Group options" });
	const { ref: addRef, placeholder: addAttrs } = useHolyAttr({ title: "New tab in group (right-click or hold to add several)", "aria-label": "New tab in group" });
	const { ref: closeRef, placeholder: closeAttrs } = useHolyAttr({ title: "Close group", "aria-label": "Close group" });

	const wrapperRef = useRef<HTMLDivElement>(null);
	/** Ends the press on the header that may become a drag of the group. */
	const hold = useRef<(() => void) | null>(null);
	const [drag, setDrag] = useState<GroupDragView | null>(null);
	/** The release after a drag still clicks the header; this swallows that so it doesn't collapse the group. */
	const suppressToggle = useRef(false);
	const fadeTimer = useRef(0);
	useEffect(
		() => () => {
			hold.current?.();
			window.clearTimeout(fadeTimer.current);
		},
		[],
	);

	const onHeaderDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setDragOver(true);
	};
	const onHeaderDragLeave = () => setDragOver(false);
	const onHeaderDrop = (e: React.DragEvent) => {
		e.preventDefault();
		// Handled here; the panel's own drop would place the tab again.
		e.stopPropagation();
		setDragOver(false);
		const draggedId = e.dataTransfer.getData("text/tab-id");
		if (!draggedId) return;
		updateTab(draggedId, { groupId: id });
		const groupTabs = useTabsStore.getState().tabs.filter(t => t.groupId === id && t.id !== draggedId);
		if (groupTabs.length > 0) {
			const lastId = groupTabs[groupTabs.length - 1].id;
			moveTabRelative(draggedId, lastId, false);
		}
	};

	const onWrapperDragOver = (e: React.DragEvent) => {
		e.preventDefault();
	};
	const onWrapperDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const draggedId = e.dataTransfer.getData("text/tab-id");
		if (!draggedId) return;

		const el = appRoot().elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
		if (!el) {
			updateTab(draggedId, { groupId: undefined });
			return;
		}

		const tabEl = el.closest("[data-url][id]") as HTMLElement | null;
		if (tabEl && tabEl.id) {
			const targetId = tabEl.id;
			if (targetId === draggedId) return;
			updateTab(draggedId, { groupId: id });
			const rect = tabEl.getBoundingClientRect();
			const y = e.clientY - rect.top;
			const placeBefore = y < rect.height / 2;
			moveTabRelative(draggedId, targetId, placeBefore);
			return;
		}

		updateTab(draggedId, { groupId: id });
		const groupTabs = useTabsStore.getState().tabs.filter(t => t.groupId === id && t.id !== draggedId);
		if (groupTabs.length > 0) {
			const lastId = groupTabs[groupTabs.length - 1].id;
			moveTabRelative(draggedId, lastId, false);
		}
	};

	const groups = useTabsStore(state => state.groups);
	const group = groups.find(g => g.id === id);
	const accent = group?.accent;

	const readableTextColor = (hex?: string | null) => {
		if (!hex) return undefined;
		const rgb = hexToRgb(hex);
		if (!rgb) return undefined;
		const srgb = [rgb.r, rgb.g, rgb.b].map(v => v / 255).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
		const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
		return lum > 0.5 ? "#000000" : "#ffffff";
	};

	const members = tabs.filter(t => t.groupId === id);
	// A colored group's border and header: 55% while it's open and holds the open tab (or is hovered), 35% otherwise.
	const strong = groupOpen && members.some(t => t.current);
	const held = !!drag && !drag.dropping;

	/**
	 * Where the held group would land among the panel's top-level items (groups and loose tabs), as in the music
	 * queue: anywhere above them puts it first, anywhere below puts it last, in between it goes after every item whose
	 * middle it's past. The line marks spots between two items only. `ids` are the items' top-level keys.
	 */
	const selfKey = groupKey(id);
	const dropTarget = (y: number) => {
		const els = [...(wrapperRef.current?.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-top-item]") ?? [])];
		const ids = els.map(el => el.dataset.topItem ?? "");
		const others = els.filter(el => el.dataset.topItem !== selfKey).map(el => el.getBoundingClientRect());
		const box = scrollParent(wrapperRef.current)?.getBoundingClientRect();
		if (!others.length) return { ids, to: 0, line: null };
		let to = others.filter(r => r.top + r.height / 2 < y).length;
		if (y < others[0].top || (box && y < box.top)) to = 0;
		else if (y > others[others.length - 1].bottom || (box && y > box.bottom)) to = others.length;
		const line = to === 0 || to === others.length || to === ids.indexOf(selfKey) ? null : { left: others[to].left, top: (others[to - 1].bottom + others[to].top) / 2 - 2, width: others[to].width };
		return { ids, to, line };
	};

	/** A press on the header, which becomes a drag of the group once the pointer moves (or a finger holds). */
	const onHeaderPointerDown = (e: React.PointerEvent<HTMLElement>) => {
		if (e.button !== 0 || hold.current || (e.target as HTMLElement).closest("button")) return;
		const header = e.currentTarget.getBoundingClientRect();
		const grabX = e.clientX - header.left;
		const grabY = e.clientY - header.top;
		const scroller = scrollParent(wrapperRef.current);
		suppressToggle.current = false;
		hold.current = pressToDrag(e, {
			scroller: () => scroller,
			onBegin: () => window.clearTimeout(fadeTimer.current),
			onMove: (x, y) => setDrag({ left: x - grabX, top: y - grabY, width: header.width, line: dropTarget(y).line, dropping: false }),
			onRelease: () => {
				hold.current = null;
			},
			onEnd: (_x, y, cancelled) => {
				suppressToggle.current = true;
				const target = cancelled ? null : dropTarget(y);
				if (target && target.to !== target.ids.indexOf(selfKey)) {
					const order = target.ids.filter(other => other !== selfKey);
					order.splice(target.to, 0, selfKey);
					useTabsStore.getState().setTopOrder(order);
				}
				// The lifted header fades out where it was let go while the list settles into its new order.
				setDrag(view => view && { ...view, line: null, dropping: true });
				fadeTimer.current = window.setTimeout(() => setDrag(null), reducedMotion() ? 0 : GHOST_FADE_MS);
			},
		});
	};

	/** Opens a new tab at the end of this group and shows it. */
	const addTab = () => {
		const tabId = createId();
		useTabsStore.getState().newTab({ id: tabId, title: "New Tab", url: "about:newtab", current: true, displayUrl: "about:newtab" });
		moveToEnd(tabId, id);
	};

	// The lifted header and the drop line are fixed to the screen; they go in #main, which nothing transforms.
	const floatRoot = wrapperRef.current?.closest<HTMLElement>("#main");

	return (
		<div
			key={id}
			ref={wrapperRef}
			data-group-wrapper={id}
			// Its top-level key, for the panel's drops and the group drag.
			data-top-item={groupKey(id)}
			// A colored group: a 2px border in its color. Otherwise the theme's ring.
			className={`group/section flex flex-col w-full h-max ${collapsed ? "rounded-3xl" : "rounded-2xl"} overflow-hidden flex-shrink-0 duration-100 ${held ? "opacity-40" : ""} ${accent ? (strong ? "border-2 border-(--group-accent)/55" : "border-2 border-(--group-accent)/35 hover:border-(--group-accent)/55") : "inset-shadow-(--inset-shadow-secondary)"}`}
			style={accent ? ({ "--group-accent": accent } as React.CSSProperties) : undefined}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the header collapses the group on click and is its drag handle; its buttons are the keyboard path. */}
			<div
				data-group-id={id}
				onDragOver={onHeaderDragOver}
				onDragLeave={onHeaderDragLeave}
				onDrop={onHeaderDrop}
				onPointerDown={onHeaderPointerDown}
				onClick={() => {
					// The release at the end of a drag isn't a click on the header.
					if (suppressToggle.current) {
						suppressToggle.current = false;
						return;
					}
					if (members.length) setGroupOpen(!groupOpen);
				}}
				className={
					(collapsed ? "flex items-center justify-center p-1.5 duration-100" : "flex items-center justify-between gap-1.5 p-2.5 duration-100") +
					(mirrored ? " flex-row-reverse [&>div:first-child]:flex-row-reverse" : "") +
					` select-none [-webkit-touch-callout:none] ${accent ? (strong ? "bg-(--group-accent)/55" : "bg-(--group-accent)/35 group-hover/section:bg-(--group-accent)/55") : ""}` +
					` ${dragOver ? "bg-[#ffffff12]" : ""} ${members.length === 0 ? "cursor-default" : "cursor-pointer"}`
				}
			>
				<div className="flex min-w-0 items-center gap-1.5" title={collapsed ? name : undefined}>
					<GroupIcon icon={group?.icon} className="size-5 shrink-0" />
					{/* The group's own name: a data value. */}
					{!collapsed && <span className="truncate font-semibold pointer-events-none">{name}</span>}
				</div>
				<div className={`flex shrink-0 items-center gap-1 ${collapsed ? "hidden" : ""}`}>
					<button
						ref={menuRef}
						{...menuAttrs}
						aria-haspopup="menu"
						className={ICON_BUTTON}
						onClick={e => {
							e.stopPropagation();
							const rect = e.currentTarget.getBoundingClientRect();
							setContextMenu({ x: rect.left, y: rect.bottom + 6, visible: true, items: buildGroupMenu(id, name) });
						}}
					>
						<ChevronDownIcon className="size-4.5 stroke-current stroke-1" />
					</button>
					<button
						ref={addRef}
						{...addAttrs}
						className={ICON_BUTTON}
						{...addHold}
						onClick={e => {
							e.stopPropagation();
							addTab();
						}}
					>
						<PlusIcon className="size-4.5 stroke-current stroke-1" />
					</button>
					<button
						ref={closeRef}
						{...closeAttrs}
						className={ICON_BUTTON}
						onClick={e => {
							e.stopPropagation();
							closeGroupAsSet(id);
						}}
					>
						<XMarkIcon className="size-4.5" />
					</button>
				</div>
			</div>
			{contextMenu?.visible && <ContextMenu items={contextMenu.items} position={{ x: contextMenu.x, y: contextMenu.y }} onClose={() => setContextMenu(null)} />}
			<div
				onDragOver={onWrapperDragOver}
				onDrop={onWrapperDrop}
				className={
					"flex flex-col gap-1.5 duration-150" +
					" " +
					`
                ${!groupOpen ? "p-0" : members.length === 0 ? "p-0" : collapsed ? "p-0.5" : "p-1.5 pt-1"}
                ${groupOpen ? "" : "h-0 opacity-0"}
            `
				}
			>
				{groupOpen === true && members.map(tab => <Tab title={tab.title} url={tab.url} id={tab.id} icon={tab.icon} displayUrl={tab.url} key={tab.id} />)}
			</div>
			{drag &&
				floatRoot &&
				createPortal(
					<>
						{drag.line && <span className="fixed z-50 h-1 rounded-full bg-(--accent) pointer-events-none" style={{ left: drag.line.left, top: drag.line.top, width: drag.line.width }} />}
						<div
							className="fixed z-50 rounded-2xl overflow-hidden bg-(--secondary) pointer-events-none"
							style={{
								left: drag.left,
								top: drag.top,
								width: drag.width,
								transform: `scale(${drag.dropping ? 1 : 1.02})`,
								opacity: drag.dropping ? 0 : 1,
								transition: `transform ${GHOST_FADE_MS}ms ${EASE}, opacity ${GHOST_FADE_MS}ms ease`,
								boxShadow: "0 12px 28px -8px #000000a0, 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent)",
								...(accent ? ({ "--group-accent": accent } as React.CSSProperties) : {}),
							}}
						>
							<div className={`flex items-center gap-1.5 p-2.5 text-(--text-primary) ${accent ? "bg-(--group-accent)/55" : ""}`}>
								<GroupIcon icon={group?.icon} className="size-5 shrink-0" />
								{/* The group's own name: a data value. */}
								<span className="truncate font-semibold">{name}</span>
							</div>
						</div>
					</>,
					floatRoot,
				)}
		</div>
	);
};

export default TabGroup;
