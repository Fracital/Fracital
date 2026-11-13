import { BookmarkIcon, BookOpenIcon, ChevronDownIcon, FireIcon, PlusIcon, RectangleStackIcon, SpeakerWaveIcon, SpeakerXMarkIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ContextMenu } from "../components/ContextMenu";
import { HolyText } from "../components/common/HolyText";
import { GroupIcon } from "../components/GroupIcon";
import { type TabProps, useTabFace, useTabMenu } from "../components/Tab";
import { buildGroupMenu, closeGroupAsSet } from "../components/TabGroup";
import { EASE, pressToDrag } from "../libs/dragFeel";
import { useHolyAttr } from "../libs/holy-attr";
import { reducedMotion } from "../libs/motion";
import { toggleMute } from "../libs/playback";
import { groupKey, nextGroupName, tabKey, topLevel, usePanelsStore, useSettingsStore, useTabAudioStore, useTabsStore } from "../store";
import { GROUPS_ON_TOP_SETTING } from "../types";
import { addGroups, addTabs, BatchAdd, moveToEnd, useMoreOnHold, useOpenLinks } from "./tabBatch";

/*
 * Each tab's page stays where App mounts it (a [data-tab-frame] box filling the page area). While the view is
 * open, the frames are moved and scaled over their card's [data-preview-slot] and clipped to what of the slot
 * is scrolled into view, so the cards show the live pages without reloading them.
 */

/** The preview's shape, from the design: 480×285. */
const PREVIEW_ASPECT = 480 / 285;
/** The preview slot's corner radii in px: top-left, top-right, bottom-right, bottom-left. */
const SLOT_RADII = [6, 6, 14, 14];
/** How long the pages take to move into their cards and back; a smooth slow-down with no overshoot. */
const MOVE_MS = 320;
const MOVE = `transform ${MOVE_MS}ms cubic-bezier(0.32, 0.72, 0, 1), clip-path ${MOVE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
/** A page at full size, its corners rounded like the page area (rounded-2xl) so they stay round through the zoom. */
const FULL_SIZE = { transform: "translate(0px, 0px) scale(1)", clipPath: "inset(0px 0px 0px 0px round 16px 16px 16px 16px)" };
const DRAG_TYPE = "text/tab-id";
const GHOST_FADE_MS = 160;
/** The lifted header is at most this wide, so a full-width group doesn't cover the view while it's dragged. */
const GHOST_MAX_WIDTH = 288;

const frameEls = (content: HTMLElement) => content.querySelectorAll<HTMLElement>(":scope > [data-tab-frame]");

const releaseFrame = (frame: HTMLElement) => {
	for (const prop of ["transition", "transform", "transformOrigin", "clipPath", "zIndex", "pointerEvents", "opacity"] as const) frame.style[prop] = "";
};

/** Where a dragged card would land: beside a card, at the end of a group, or out of any group (at the spot under the pointer). */
type DropTarget = { kind: "tab"; id: string; before: boolean } | { kind: "group"; id: string } | { kind: "loose" } | null;

const CARD_MIN = 240;
const CARD_GAP = 8;
const GROUP_GAP = 12;
/** A group's border and padding around its cards, both sides. */
const GROUP_CHROME = 20;

/**
 * The card width for a view this wide, the same in every grid (as many 15rem+ cards as fit across a full-width
 * group, at least two on a phone), how many cards that is, and how many fit across a half-width group.
 */
const measureLayout = (width: number) => {
	const inner = width - GROUP_CHROME;
	const min = Math.min(CARD_MIN, (inner - CARD_GAP) / 2);
	const columns = Math.max(1, Math.floor((inner + CARD_GAP) / (min + CARD_GAP)));
	const cardWidth = (inner - (columns - 1) * CARD_GAP) / columns;
	const halfInner = (width - GROUP_GAP) / 2 - GROUP_CHROME;
	return { cardWidth, columns, halfCards: Math.max(0, Math.floor((halfInner + CARD_GAP) / (cardWidth + CARD_GAP))) };
};

/** A group's cards scroll past two rows, with a peek of the third so it's clear there's more. */
const VISIBLE_ROWS = 2.35;
/** The group card area's padding, top and bottom (pt-1.5, pb-2). */
const GROUP_SCROLL_PAD = 6 + 8;

/** A group being dragged by its header: where the pointer is, where it was grabbed, and where it would land. */
interface GroupHold {
	id: string;
	x: number;
	y: number;
	grabX: number;
	grabY: number;
	width: number;
	/** Ends the press (see pressToDrag). */
	stop: () => void;
}

interface GroupDragView {
	id: string;
	/** The held header's top-left, in the page area's coordinates. */
	left: number;
	top: number;
	width: number;
	/** The index among the other top-level units it would land at, and the line marking that spot (none at the very top or bottom). */
	to: number;
	line: { left: number; top: number; width: number; height: number } | null;
	dropping: boolean;
}

const sameTarget = (a: DropTarget, b: DropTarget) => JSON.stringify(a) === JSON.stringify(b);

type Group = ReturnType<typeof useTabsStore.getState>["groups"][number];
/** One block of the view's top level: a group, or a run of loose tabs next to each other (one grid, its own row). */
type Unit = { kind: "group"; key: string; group: Group } | { kind: "run"; key: string; tabs: TabProps[] };

/** Moves a tab next to another, into that tab's group. */
const moveBeside = (draggedId: string, targetId: string, before: boolean) => {
	const store = useTabsStore.getState();
	const target = store.tabs.find(t => t.id === targetId);
	if (!target || draggedId === targetId) return;
	store.updateTab(draggedId, { groupId: target.groupId });
	store.moveTabRelative(draggedId, targetId, before);
};

/** The tab view: the tabs as cards with live previews, over the page while the tab view setting is on. */
export const TabView = () => {
	const open = usePanelsStore(state => state.tabViewOpen);
	const setOpen = usePanelsStore(state => state.setTabViewOpen);
	const tabs = useTabsStore(state => state.tabs);
	const groups = useTabsStore(state => state.groups);
	const newTab = useTabsStore(state => state.newTab);
	const newGroup = useTabsStore(state => state.newGroup);
	const currentId = tabs.find(tab => tab.current)?.id;

	const rootRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	/** Whether the frames are in their cards (or on their way there). */
	const placed = useRef(false);
	const releaseTimer = useRef(0);
	/** When the move into the cards ends; until then, scrolls and resizes re-aim it instead of jumping to its end. */
	const movingUntil = useRef(0);
	/** The tab whose page zooms out into its card as the view opens; the others are placed in their cards at once. */
	const zooming = useRef<string | undefined>(undefined);

	/** The card being dragged (dragover can't read the drag's data). */
	const dragged = useRef<string | null>(null);
	const [drop, setDrop] = useState<DropTarget>(null);
	const [closedGroups, setClosedGroups] = useState<Record<string, true>>({});
	/** The top level's order (groups and loose tabs, see the store); `layout` below is the measured card layout. */
	const topOrder = useTabsStore(state => state.layout);
	// topLevel() puts the groups first when this is on; read here so the rows follow when it's turned on or off.
	const groupsOnTop = useSettingsStore(state => state.settings[GROUPS_ON_TOP_SETTING] === true);
	const setTopOrder = useTabsStore(state => state.setTopOrder);
	const placeLoose = useTabsStore(state => state.placeLoose);
	const [layout, setLayout] = useState(() => measureLayout(960));
	/** A card's rendered height (header and preview), for capping how tall a group with lots of tabs gets. */
	const [cardHeight, setCardHeight] = useState(0);

	/** The group held by its header, and how it shows while dragged. */
	const groupHold = useRef<GroupHold | null>(null);
	const [groupDrag, setGroupDrag] = useState<GroupDragView | null>(null);
	/** Each unit's element (a group's section, a loose run's grid), by unit key. */
	const unitEls = useRef(new Map<string, HTMLElement>());
	const groupsRef = useRef<HTMLDivElement>(null);
	/** The release after a drag still clicks the header; this swallows that so it doesn't collapse the group. */
	const suppressToggle = useRef(false);
	const ghostTimer = useRef(0);
	/**
	 * The units as shown, by row, read live by the drags (their handlers outlive the render that made them): each
	 * unit's key and the top-level keys it stands for (a group's own, a run's tabs in order).
	 */
	const shown = useRef<{ units: { key: string; items: string[] }[]; rowOf: Map<string, number>; paired: Set<string> }>({ units: [], rowOf: new Map(), paired: new Set() });

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		const measure = () => {
			// The scroller's content box: its width less its p-3 padding.
			const width = scroller.clientWidth - 24;
			if (width <= 0) return;
			const next = measureLayout(width);
			setLayout(prev => (prev.cardWidth === next.cardWidth && prev.columns === next.columns && prev.halfCards === next.halfCards ? prev : next));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(scroller);
		return () => {
			ro.disconnect();
			groupHold.current?.stop();
			window.clearTimeout(ghostTimer.current);
		};
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measured when the card width or the cards change.
	useLayoutEffect(() => {
		const card = scrollRef.current?.querySelector<HTMLElement>("[role=button][draggable]");
		if (card && card.offsetHeight !== cardHeight) setCardHeight(card.offsetHeight);
	}, [layout, tabs]);

	const { ref: newGroupRef, placeholder: newGroupAttrs } = useHolyAttr({ title: "New group", "aria-label": "New group" });
	const { ref: moreGroupsRef, placeholder: moreGroupsAttrs } = useHolyAttr({ title: "Add several groups", "aria-label": "Add several groups" });
	const { ref: newTabRef, placeholder: newTabAttrs } = useHolyAttr({ title: "New tab", "aria-label": "New tab" });
	const { ref: moreTabsRef, placeholder: moreTabsAttrs } = useHolyAttr({ title: "Add several tabs", "aria-label": "Add several tabs" });
	/** The batch-add panel: tabs (from the view's +, or a group's to add into that group) or groups. */
	const [batch, setBatch] = useState<{ x: number; y: number; kind: "tabs" | "groups"; groupId?: string } | null>(null);
	const openLinks = useOpenLinks();
	const openBatch = (anchor: HTMLElement, kind: "tabs" | "groups", groupId?: string) => {
		const r = anchor.getBoundingClientRect();
		setBatch({ x: r.right, y: r.bottom + 6, kind, groupId });
	};
	// The split buttons' chevrons open the panel; right-click (or a hold on touch) on either half does too.
	const newTabHold = useMoreOnHold(button => openBatch(button.parentElement ?? button, "tabs"));
	const newGroupHold = useMoreOnHold(button => openBatch(button.parentElement ?? button, "groups"));

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, setOpen]);

	useEffect(() => {
		const content = rootRef.current?.parentElement;
		return () => {
			// Turning the setting off unmounts the view: give the pages back their full size.
			window.clearTimeout(releaseTimer.current);
			if (content) for (const frame of frameEls(content)) releaseFrame(frame);
		};
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the cards move when tabs, groups or collapsed groups change, and the frames follow them.
	useLayoutEffect(() => {
		const root = rootRef.current;
		const scroller = scrollRef.current;
		const content = root?.parentElement;
		if (!root || !scroller || !content) return;
		const animate = !reducedMotion();

		if (!open) {
			if (!placed.current) return;
			placed.current = false;
			// The open tab grows back to full size. The others hide at once, so none shows over it on the way.
			const currentId = useTabsStore.getState().tabs.find(tab => tab.current)?.id;
			for (const frame of frameEls(content)) {
				if (frame.dataset.tabFrame === currentId) {
					frame.style.transition = animate ? MOVE : "none";
					frame.style.zIndex = "41";
					Object.assign(frame.style, FULL_SIZE);
				} else {
					frame.style.transition = "none";
					frame.style.opacity = "0";
				}
				frame.style.pointerEvents = "";
			}
			releaseTimer.current = window.setTimeout(() => frameEls(content).forEach(releaseFrame), animate ? MOVE_MS + 20 : 0);
			return;
		}

		window.clearTimeout(releaseTimer.current);
		const place = (transition: boolean) => {
			const area = content.getBoundingClientRect();
			const view = scroller.getBoundingClientRect();
			for (const frame of frameEls(content)) {
				const slot = root.querySelector<HTMLElement>(`[data-preview-slot="${CSS.escape(frame.dataset.tabFrame ?? "")}"]`);
				// Only the tab the view opened on moves smoothly; the rest go straight to their cards.
				frame.style.transition = transition && frame.dataset.tabFrame === zooming.current ? MOVE : "none";
				frame.style.transformOrigin = "0 0";
				frame.style.zIndex = "40";
				frame.style.pointerEvents = "none";
				frame.style.opacity = "";
				const r = slot?.getBoundingClientRect();
				// The part of the slot scrolled into view, in the view and in its group's own scroll area.
				const inner = slot?.closest("[data-group-scroll]")?.getBoundingClientRect() ?? view;
				const top = Math.max(r?.top ?? 0, view.top, inner.top);
				const bottom = Math.min(r?.bottom ?? 0, view.bottom, inner.bottom);
				const left = Math.max(r?.left ?? 0, view.left, inner.left);
				const right = Math.min(r?.right ?? 0, view.right, inner.right);
				if (!r || !slot || slot.closest("[data-dragging]") || bottom <= top || right <= left) {
					// No card on screen (its group is collapsed, held in a drag, or scrolled away): hide the page at once.
					frame.style.transition = "none";
					frame.style.clipPath = "inset(50%)";
					continue;
				}
				// The top of the page, filling the slot: by width, or by height (centered) when the page is wider.
				const scale = Math.max(r.width / area.width, r.height / area.height);
				const x = r.left + (r.width - area.width * scale) / 2;
				const y = r.top;
				frame.style.transform = `translate(${x - area.left}px, ${y - area.top}px) scale(${scale})`;
				// Clip to the visible slot, in the frame's own (unscaled) pixels: top, right, bottom, left.
				const inset = [(top - y) / scale, area.width - (right - x) / scale, area.height - (bottom - y) / scale, (left - x) / scale];
				const radii = SLOT_RADII.map(px => `${px / scale}px`).join(" ");
				frame.style.clipPath = `inset(${inset.map(v => `${v}px`).join(" ")} round ${radii})`;
			}
		};

		const opening = !placed.current;
		if (opening) {
			// The open tab starts from full size and shrinks into its card; the others fade in already in theirs.
			zooming.current = useTabsStore.getState().tabs.find(tab => tab.current)?.id;
			for (const frame of frameEls(content)) {
				if (frame.dataset.tabFrame !== zooming.current) continue;
				frame.style.transition = "none";
				Object.assign(frame.style, FULL_SIZE);
			}
			void content.offsetWidth;
			placed.current = true;
		}
		// Only opening animates. Later changes (collapsing a group, reordering, closing a tab) move the cards at once,
		// so the pages move with them; a change during the opening re-aims it.
		place(animate && (opening || performance.now() < movingUntil.current));
		if (animate && opening) movingUntil.current = performance.now() + MOVE_MS;

		let raf = 0;
		const follow = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => place(performance.now() < movingUntil.current));
		};
		// Captured: scroll doesn't bubble, and the groups scroll inside the view too.
		root.addEventListener("scroll", follow, { capture: true, passive: true });
		const ro = new ResizeObserver(follow);
		ro.observe(content);
		ro.observe(scroller);
		return () => {
			cancelAnimationFrame(raf);
			root.removeEventListener("scroll", follow, { capture: true });
			ro.disconnect();
		};
	}, [open, tabs, groups, topOrder, groupsOnTop, closedGroups, layout, cardHeight, groupDrag?.id]);

	const endDrag = () => {
		dragged.current = null;
		setDrop(null);
	};
	/** Drag handlers for a drop zone: dragging over shows where the card would land, dropping moves it there. */
	const dropZone = (target: Exclude<DropTarget, null>, onDrop: (id: string, e: React.DragEvent) => void) => ({
		onDragOver: (e: React.DragEvent) => {
			if (!dragged.current) return;
			e.preventDefault();
			e.stopPropagation();
			e.dataTransfer.dropEffect = "move";
			if (!sameTarget(drop, target)) setDrop(target);
		},
		onDrop: (e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const id = e.dataTransfer.getData(DRAG_TYPE) || dragged.current;
			if (id) onDrop(id, e);
			endDrag();
		},
	});

	/**
	 * Where a held group would land among the other units, from the live layout: anywhere above them puts it first,
	 * anywhere below puts it last; in between, it goes after every unit it's past (in reading order: rows above
	 * it, and on its own row those it's past the middle of). A run of loose tabs is one unit, so a group lands
	 * before or after a whole run, never inside it. The line marks spots between two units only.
	 */
	const groupTarget = (h: GroupHold): Pick<GroupDragView, "to" | "line"> | null => {
		const { units, rowOf, paired } = shown.current;
		const ids = units.map(unit => unit.key);
		const self = groupKey(h.id);
		const box = groupsRef.current?.getBoundingClientRect();
		const view = scrollRef.current?.getBoundingClientRect();
		const rects = new Map(ids.map(id => [id, unitEls.current.get(id)?.getBoundingClientRect()]));
		if (!box || !view || [...rects.values()].some(r => !r)) return null;
		const rect = (id: string) => rects.get(id) as DOMRect;
		// Each row's top and bottom, from all its units (the held one stays in place, so rows keep their shape).
		const rows = new Map<number, { top: number; bottom: number }>();
		for (const id of ids) {
			const row = rowOf.get(id) ?? 0;
			const r = rect(id);
			const prev = rows.get(row);
			rows.set(row, prev ? { top: Math.min(prev.top, r.top), bottom: Math.max(prev.bottom, r.bottom) } : { top: r.top, bottom: r.bottom });
		}
		const rowBox = (id: string) => rows.get(rowOf.get(id) ?? 0) as { top: number; bottom: number };
		const others = ids.filter(id => id !== self);
		if (!others.length) return { to: 0, line: null };
		const first = Math.min(...others.map(id => rowBox(id).top));
		const last = Math.max(...others.map(id => rowBox(id).bottom));
		let to = 0;
		if (h.y < first || h.y < view.top) to = 0;
		else if (h.y > last || h.y > view.bottom) to = others.length;
		else
			for (const id of others) {
				const row = rowBox(id);
				const r = rect(id);
				if (h.y > row.bottom || (h.y >= row.top && (paired.has(id) ? h.x > r.left + r.width / 2 : h.y > r.top + r.height / 2))) to++;
			}
		const from = ids.indexOf(self);
		if (to === 0 || to === others.length || to === from) return { to, line: null };
		// A line in the gap between the two units either side: upright between two groups on a row, flat between rows.
		const a = rect(others[to - 1]);
		const b = rect(others[to]);
		if (rowOf.get(others[to - 1]) === rowOf.get(others[to])) {
			const row = rowBox(others[to]);
			return { to, line: { left: (a.right + b.left) / 2 - 2 - box.left, top: row.top - box.top, width: 4, height: row.bottom - row.top } };
		}
		const y = (rowBox(others[to - 1]).bottom + rowBox(others[to]).top) / 2;
		const left = Math.min(a.left, b.left);
		return { to, line: { left: left - box.left, top: y - 2 - box.top, width: Math.max(a.right, b.right) - left, height: 4 } };
	};

	/** Re-reads where the held group is and would land, and shows it. */
	const refreshGroupDrag = (h: GroupHold) => {
		const area = rootRef.current?.parentElement?.getBoundingClientRect();
		const target = groupTarget(h);
		if (!area || !target) return;
		setGroupDrag({ id: h.id, left: h.x - h.grabX - area.left, top: h.y - h.grabY - area.top, width: h.width, ...target, dropping: false });
	};

	/** A press on a group's header, which becomes a drag once the pointer moves (or a finger holds), as in the music queue. */
	const onGroupPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
		// The header's own buttons (dropdown, +, ×) keep their clicks; its name (the collapse toggle) can be dragged.
		if (e.button !== 0 || groupHold.current || (e.target as HTMLElement).closest("button:not([aria-expanded])")) return;
		const header = e.currentTarget.getBoundingClientRect();
		suppressToggle.current = false;
		const width = Math.min(header.width, GHOST_MAX_WIDTH);
		// Grabbed past the narrower lifted copy's end: hold it near its end instead.
		const grabX = Math.min(e.clientX - header.left, width - 24);
		const h: GroupHold = { id, x: e.clientX, y: e.clientY, grabX, grabY: e.clientY - header.top, width, stop: () => {} };
		h.stop = pressToDrag(e, {
			scroller: () => scrollRef.current,
			onBegin: () => window.clearTimeout(ghostTimer.current),
			onMove: (x, y) => {
				h.x = x;
				h.y = y;
				refreshGroupDrag(h);
			},
			onRelease: () => {
				groupHold.current = null;
			},
			onEnd: (_x, _y, cancelled) => {
				suppressToggle.current = true;
				const target = cancelled ? null : groupTarget(h);
				const units = shown.current.units;
				const from = units.findIndex(unit => unit.key === groupKey(h.id));
				if (target && from !== -1 && target.to !== from) {
					const order = units.filter(unit => unit.key !== groupKey(h.id));
					order.splice(target.to, 0, units[from]);
					setTopOrder(order.flatMap(unit => unit.items));
				}
				// The lifted header fades out where it was let go while the groups settle into their new order.
				setGroupDrag(view => view && { ...view, line: null, dropping: true });
				ghostTimer.current = window.setTimeout(() => setGroupDrag(null), reducedMotion() ? 0 : GHOST_FADE_MS);
			},
		});
		groupHold.current = h;
	};

	/**
	 * The top-level index a card let go on empty space lands at, counted without the card: past every unit before
	 * the pointer in reading order (one above it, or on its row and left of it). A run is counted card by card, so a
	 * drop in a gap between its cards lands there.
	 */
	const looseSlot = (draggedId: string, x: number, y: number) => {
		const before = (r: DOMRect | undefined) => !!r && (r.bottom < y || (r.top <= y && y <= r.bottom && r.left + r.width / 2 < x));
		let index = 0;
		for (const unit of shown.current.units) {
			const el = unitEls.current.get(unit.key);
			if (!unit.key.startsWith("run:")) {
				if (before(el?.getBoundingClientRect())) index += unit.items.length;
				continue;
			}
			for (const key of unit.items) {
				if (key === tabKey(draggedId)) continue;
				if (before(el?.querySelector(`[data-tab-spot="${CSS.escape(key.slice(2))}"]`)?.getBoundingClientRect())) index++;
			}
		}
		return index;
	};

	/** A grid of cards: `columns` cards across (a half-width group hugs its cards), or as many as fit. */
	const grid = (list: TabProps[], columns?: number) => (
		<div className="grid gap-2" style={{ gridTemplateColumns: columns ? `repeat(${columns}, var(--card-w))` : "repeat(auto-fill, var(--card-w))" }}>
			{list.map(tab => (
				<TabCard
					key={tab.id}
					tab={tab}
					current={tab.id === currentId}
					dropSide={drop?.kind === "tab" && drop.id === tab.id ? (drop.before ? "before" : "after") : null}
					onDragStart={() => {
						dragged.current = tab.id;
					}}
					onDragEnd={endDrag}
					onDragOver={(e, before) => {
						if (!dragged.current) return;
						e.preventDefault();
						e.stopPropagation();
						e.dataTransfer.dropEffect = "move";
						const target: DropTarget = dragged.current === tab.id ? null : { kind: "tab", id: tab.id, before };
						if (!sameTarget(drop, target)) setDrop(target);
					}}
					onDrop={(e, before) => {
						e.preventDefault();
						e.stopPropagation();
						const id = e.dataTransfer.getData(DRAG_TYPE) || dragged.current;
						if (id) moveBeside(id, tab.id, before);
						endDrag();
					}}
				/>
			))}
		</div>
	);
	const membersOf = (groupId: string) => tabs.filter(tab => tab.groupId === groupId);
	/** Small enough to share a row: its cards fit in half the view (or it's collapsed or empty, just a header). */
	const isSmall = (groupId: string) => layout.halfCards > 0 && (!!closedGroups[groupId] || membersOf(groupId).length <= layout.halfCards);
	// The top level in the user's order, each run of loose tabs next to each other folded into one unit.
	const units: Unit[] = [];
	for (const item of topLevel({ tabs, groups, layout: topOrder })) {
		if (item.kind === "group") {
			const group = groups.find(g => g.id === item.id);
			if (group) units.push({ kind: "group", key: groupKey(group.id), group });
			continue;
		}
		const tab = tabs.find(t => t.id === item.id);
		if (!tab) continue;
		const last = units[units.length - 1];
		if (last?.kind === "run") last.tabs.push(tab);
		else units.push({ kind: "run", key: `run:${tab.id}`, tabs: [tab] });
	}
	// Rows: two small groups next to each other sit side by side, hugging their cards, each at most half the row; any
	// other group, and each run of loose tabs, has its row to itself and can grow to full width.
	const rows: Unit[][] = [];
	for (let i = 0; i < units.length; i++) {
		const unit = units[i];
		const next = units[i + 1];
		if (unit.kind === "group" && next?.kind === "group" && isSmall(unit.group.id) && isSmall(next.group.id)) {
			rows.push([unit, next]);
			i++;
		} else rows.push([unit]);
	}
	shown.current = {
		units: units.map(unit => ({ key: unit.key, items: unit.kind === "group" ? [unit.key] : unit.tabs.map(tab => tabKey(tab.id)) })),
		rowOf: new Map(rows.flatMap((row, index) => row.map(unit => [unit.key, index] as const))),
		paired: new Set(rows.filter(row => row.length === 2).flatMap(row => row.map(unit => unit.key))),
	};
	/** The groups in the order shown, for closing every group to one side of one. */
	const groupOrder = units.flatMap(unit => (unit.kind === "group" ? [unit.group.id] : []));
	const unitRef = (key: string) => (el: HTMLElement | null) => {
		if (el) unitEls.current.set(key, el);
		else unitEls.current.delete(key);
	};
	/** Past two rows of cards a group scrolls; the cap shows a peek of the third. */
	const scrollCap = cardHeight ? GROUP_SCROLL_PAD + VISIBLE_ROWS * cardHeight + Math.ceil(VISIBLE_ROWS) * CARD_GAP : undefined;
	const content = rootRef.current?.parentElement;
	const heldGroup = groupDrag ? groups.find(group => group.id === groupDrag.id) : undefined;

	/** A group: its header, then its cards (scrolling past two rows). Paired, it hugs its cards up to half the view; alone, up to all of it. */
	const groupSection = (group: Group, pairedRow: boolean) => {
		const members = membersOf(group.id);
		const groupOpen = !closedGroups[group.id];
		// A colored group's border and header: stronger while it's open and holds the open tab.
		const tone: GroupTone = !group.accent ? null : groupOpen && members.some(tab => tab.id === currentId) ? "strong" : "soft";
		const tabDrop = dropZone({ kind: "group", id: group.id }, id => moveToEnd(id, group.id));
		const held = groupDrag?.id === group.id;
		return (
			<section
				key={group.id}
				ref={unitRef(groupKey(group.id))}
				data-dragging={held || undefined}
				// A colored group: a 2px border in its color. Otherwise the theme's ring.
				className={`group/section flex w-max min-w-60 self-start flex-col rounded-2xl overflow-hidden duration-100 ${pairedRow ? "max-w-[calc(50%-0.375rem)]" : "max-w-full"} ${held ? "opacity-40" : ""} ${tone === "strong" ? "border-2 border-(--group-accent)/55" : tone === "soft" ? "border-2 border-(--group-accent)/35 hover:border-(--group-accent)/55" : "inset-shadow-(--inset-shadow-secondary)"} ${drop?.kind === "group" && drop.id === group.id ? "bg-[#ffffff12]" : ""}`}
				style={group.accent ? ({ "--group-accent": group.accent } as React.CSSProperties) : undefined}
				{...tabDrop}
			>
				<GroupHeader
					id={group.id}
					name={group.name}
					icon={group.icon}
					tone={tone}
					open={groupOpen}
					onToggle={() => {
						// The release at the end of a drag isn't a click on the name.
						if (suppressToggle.current) {
							suppressToggle.current = false;
							return;
						}
						setClosedGroups(prev => {
							const next = { ...prev };
							if (next[group.id]) delete next[group.id];
							else next[group.id] = true;
							return next;
						});
					}}
					onPointerDown={e => onGroupPointerDown(e, group.id)}
					onBatch={() => openLinks(group.id)}
					order={groupOrder}
				/>
				{groupOpen && members.length > 0 && (
					<div data-group-scroll className="overflow-y-auto overscroll-contain p-2 pt-1.5" style={{ maxHeight: scrollCap }}>
						{grid(members, pairedRow ? members.length : Math.min(members.length, layout.columns))}
					</div>
				)}
			</section>
		);
	};

	return (
		<div ref={rootRef} role="dialog" aria-hidden={!open} className={`absolute inset-0 z-30 flex flex-col bg-(--secondary) duration-150 ${open ? "" : "opacity-0 pointer-events-none invisible"}`}>
			<div className="flex shrink-0 items-center justify-between gap-3 p-3 pb-2">
				{/* Not wired up yet: these pages don't exist. */}
				<div className="flex min-w-0 items-center gap-4 overflow-x-auto [scrollbar-width:none]">
					<HeaderLink icon={<BookmarkIcon className="size-5" />} text="Bookmarks" />
					<HeaderLink icon={<BookOpenIcon className="size-5" />} text="History" />
					<HeaderLink icon={<FireIcon className="size-5" />} text="Recommended" />
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<div className={SPLIT_BUTTON}>
						<button ref={newGroupRef} {...newGroupAttrs} className={SPLIT_MAIN} {...newGroupHold} onClick={() => newGroup(createId(), nextGroupName(groups))}>
							<RectangleStackIcon className="size-4.5" />
							<PlusIcon className="size-3 stroke-current stroke-1" />
						</button>
						<button ref={moreGroupsRef} {...moreGroupsAttrs} aria-haspopup="dialog" aria-expanded={batch?.kind === "groups"} className={SPLIT_MORE} {...newGroupHold} onClick={e => openBatch(e.currentTarget.parentElement ?? e.currentTarget, "groups")}>
							<ChevronDownIcon className="size-4 stroke-current stroke-1" />
						</button>
					</div>
					<div className={SPLIT_BUTTON}>
						<button
							ref={newTabRef}
							{...newTabAttrs}
							className={SPLIT_MAIN}
							{...newTabHold}
							onClick={() => {
								newTab({ id: createId(), title: "New Tab", url: "about:newtab", current: true, displayUrl: "about:newtab" });
								setOpen(false);
							}}
						>
							<PlusIcon className="size-5 stroke-current stroke-1" />
						</button>
						<button ref={moreTabsRef} {...moreTabsAttrs} aria-haspopup="dialog" aria-expanded={batch?.kind === "tabs" && !batch.groupId} className={SPLIT_MORE} {...newTabHold} onClick={e => openBatch(e.currentTarget.parentElement ?? e.currentTarget, "tabs")}>
							<ChevronDownIcon className="size-4 stroke-current stroke-1" />
						</button>
					</div>
				</div>
			</div>
			{/* Dropping on empty space takes a card out of its group, to the spot on the top level under the pointer. */}
			<div ref={scrollRef} className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto p-3 pt-1" style={{ "--card-w": `${layout.cardWidth}px` } as React.CSSProperties} {...dropZone({ kind: "loose" }, (id, e) => placeLoose(id, looseSlot(id, e.clientX, e.clientY)))}>
				{rows.length > 0 && (
					<div ref={groupsRef} className={`relative flex shrink-0 flex-col gap-3 ${groupDrag && !groupDrag.dropping ? "select-none" : ""}`}>
						{rows.map(row => {
							const [unit, next] = row;
							if (unit.kind === "run")
								return (
									<div key={unit.key} ref={unitRef(unit.key)}>
										{grid(unit.tabs)}
									</div>
								);
							return next?.kind === "group" ? (
								<div key={unit.key} className="flex items-start gap-3">
									{groupSection(unit.group, true)}
									{groupSection(next.group, true)}
								</div>
							) : (
								groupSection(unit.group, false)
							);
						})}
						{groupDrag?.line && <span className="absolute z-10 rounded-full bg-(--accent) pointer-events-none" style={groupDrag.line} />}
					</div>
				)}
			</div>
			{/* The held group's header, lifted under the pointer. Over the page area, not in the view: the live previews sit above the view. */}
			{groupDrag &&
				heldGroup &&
				content &&
				createPortal(
					<div
						className="absolute z-50 rounded-2xl overflow-hidden bg-(--secondary) pointer-events-none"
						style={{
							left: groupDrag.left,
							top: groupDrag.top,
							width: groupDrag.width,
							transform: `scale(${groupDrag.dropping ? 1 : 1.02})`,
							opacity: groupDrag.dropping ? 0 : 1,
							transition: `transform ${GHOST_FADE_MS}ms ${EASE}, opacity ${GHOST_FADE_MS}ms ease`,
							boxShadow: "0 12px 28px -8px #000000a0, 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent)",
							...(heldGroup.accent ? ({ "--group-accent": heldGroup.accent } as React.CSSProperties) : {}),
						}}
					>
						<div className={`flex items-center gap-1.5 p-2.5 text-(--text-primary) ${heldGroup.accent ? "bg-(--group-accent)/55" : ""}`}>
							<GroupIcon icon={heldGroup.icon} className="size-5 shrink-0" />
							{/* The group's own name: a data value. */}
							<span className="truncate font-semibold">{heldGroup.name}</span>
						</div>
					</div>,
					content,
				)}
			{batch &&
				content &&
				createPortal(
					<BatchAdd
						area={content.getBoundingClientRect()}
						at={batch}
						kind={batch.kind}
						onAdd={(count, extra) => {
							if (batch.kind === "groups") addGroups(count, Number(extra) || 0);
							else addTabs(count, "", batch.groupId);
							setBatch(null);
						}}
						onLinks={() => {
							setBatch(null);
							openLinks(batch.groupId ?? "");
						}}
						onClose={() => setBatch(null)}
					/>,
					content,
				)}
		</div>
	);
};

/** A header button split in two: its action, then a chevron for more ways to do it. */
const SPLIT_BUTTON = "flex items-center h-9 rounded-xl text-(--text-secondary) inset-shadow-[0_0_0_1.5px_#ffffff30] hover:inset-shadow-[0_0_0_1.5px_#ffffff60] duration-150";
const SPLIT_MAIN = "flex items-center justify-center h-full pl-2 pr-1 rounded-l-xl hover:text-(--text-primary) cursor-pointer duration-150";
const SPLIT_MORE = "flex items-center justify-center h-full pl-0.5 pr-2 rounded-r-xl hover:text-(--text-primary) cursor-pointer duration-150";
const ICON_BUTTON = "flex shrink-0 items-center justify-center rounded-full cursor-pointer duration-150";

const HeaderLink = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
	<button type="button" className="flex shrink-0 items-center gap-1.5 text-lg font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-150">
		{icon}
		<HolyText className="max-sm:hidden" text={text} />
	</button>
);

/** A colored group's border and header color: 55% while it's open and holds the open tab (or is hovered), 35% otherwise. Null for no color. */
type GroupTone = "strong" | "soft" | null;

interface GroupHeaderProps {
	id: string;
	name: string;
	/** The group's icon key (see GroupIcon). */
	icon?: string;
	tone: GroupTone;
	open: boolean;
	onToggle: () => void;
	/** A press that may become a drag of the whole group. */
	onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
	/** Opens the batch-add panel for this group, under its + button. */
	onBatch: (button: HTMLElement) => void;
	/** The groups in the order shown, for closing every group to one side of this one. */
	order: string[];
}

/**
 * A group's header in the tab view: click to collapse; drag to move the group; its dropdown renames or recolors
 * it; + opens a tab in it; × closes it.
 */
const GroupHeader = ({ id, name, icon, tone, open, onToggle, onPointerDown, onBatch, order }: GroupHeaderProps) => {
	const addHold = useMoreOnHold(onBatch);
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const { ref: toggleRef, placeholder: toggleAttrs } = useHolyAttr({ title: open ? "Collapse group" : "Expand group", "aria-label": open ? "Collapse group" : "Expand group" });
	const { ref: menuRef, placeholder: menuAttrs } = useHolyAttr({ title: "Group options", "aria-label": "Group options" });
	const { ref: closeRef, placeholder: closeAttrs } = useHolyAttr({ title: "Close group", "aria-label": "Close group" });
	const { ref: addRef, placeholder: addAttrs } = useHolyAttr({ title: "New tab in group (right-click or hold to add several)", "aria-label": "New tab in group" });

	/** Opens a new tab at the end of this group and shows it. */
	const addTab = () => {
		const tabId = createId();
		useTabsStore.getState().newTab({ id: tabId, title: "New Tab", url: "about:newtab", current: true, displayUrl: "about:newtab" });
		moveToEnd(tabId, id);
		usePanelsStore.getState().setTabViewOpen(false);
	};

	return (
		<>
			{/* A drag handle for moving the group. */}
			<div className={`flex items-center gap-1.5 p-2.5 text-(--text-primary) select-none [-webkit-touch-callout:none] duration-100 ${tone === "strong" ? "bg-(--group-accent)/55" : tone === "soft" ? "bg-(--group-accent)/35 group-hover/section:bg-(--group-accent)/55" : ""}`} onPointerDown={onPointerDown}>
				<button ref={toggleRef} {...toggleAttrs} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 cursor-pointer" onClick={onToggle}>
					<GroupIcon icon={icon} className="size-5 shrink-0" />
					{/* The group's own name: a data value. */}
					<span className="truncate font-semibold">{name}</span>
				</button>
				<button
					ref={menuRef}
					{...menuAttrs}
					aria-haspopup="menu"
					className={`${ICON_BUTTON} p-0.5 text-(--text-secondary) hover:text-(--text-primary)`}
					onClick={e => {
						const r = e.currentTarget.getBoundingClientRect();
						setMenu({ x: r.left, y: r.bottom + 6 });
					}}
				>
					<ChevronDownIcon className="size-4.5 stroke-current stroke-1" />
				</button>
				<button ref={addRef} {...addAttrs} className={`${ICON_BUTTON} p-0.5 text-(--text-secondary) hover:text-(--text-primary)`} {...addHold} onClick={addTab}>
					<PlusIcon className="size-4.5 stroke-current stroke-1" />
				</button>
				<button ref={closeRef} {...closeAttrs} className={`${ICON_BUTTON} p-0.5 text-(--text-secondary) hover:text-(--text-primary)`} onClick={() => closeGroupAsSet(id)}>
					<XMarkIcon className="size-4.5" />
				</button>
			</div>
			{menu && <ContextMenu items={buildGroupMenu(id, name, { kind: "grid", order })} position={menu} onClose={() => setMenu(null)} />}
		</>
	);
};

interface TabCardProps {
	tab: TabProps;
	current: boolean;
	/** Where the dragged card would land relative to this one. */
	dropSide: "before" | "after" | null;
	onDragStart: () => void;
	onDragEnd: () => void;
	onDragOver: (e: React.DragEvent, before: boolean) => void;
	onDrop: (e: React.DragEvent, before: boolean) => void;
}

/** A tab's card: icon, title, menu and close over a slot the tab's live page is placed on. Drag to reorder. */
const TabCard = ({ tab, current, dropSide, onDragStart, onDragEnd, onDragOver, onDrop }: TabCardProps) => {
	const { title, icon } = useTabFace(tab);
	const { playsMusic, showSpeaker, speakerMuted, menuItems } = useTabMenu(tab.id, "grid");
	const setCurrentTab = useTabsStore(state => state.setCurrentTab);
	const closeTab = useTabsStore(state => state.closeTab);
	const setOpen = usePanelsStore(state => state.setTabViewOpen);
	const dark = useSettingsStore(state => state.settings.brightness !== "light");
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const { ref: menuRef, placeholder: menuAttrs } = useHolyAttr({ title: "Tab options", "aria-label": "Tab options" });
	const { ref: speakerRef, placeholder: speakerAttrs } = useHolyAttr({ title: speakerMuted ? "Unmute tab" : "Mute tab", "aria-label": speakerMuted ? "Unmute tab" : "Mute tab" });
	const { ref: closeRef, placeholder: closeAttrs } = useHolyAttr({ title: "Close tab", "aria-label": "Close tab" });

	const pick = () => {
		setCurrentTab(tab.id);
		setOpen(false);
	};
	/** Drops on the left half land before this card, on the right half after it. */
	const before = (e: React.DragEvent) => {
		const r = e.currentTarget.getBoundingClientRect();
		return e.clientX < r.left + r.width / 2;
	};

	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: the card holds its own buttons, and a button can't hold another. */}
			<div
				role="button"
				tabIndex={0}
				aria-current={current}
				// Where the Shift+arrow tab switcher finds this tab on screen.
				data-tab-spot={tab.id}
				draggable
				className={`group/card relative flex flex-col min-w-0 p-0.5 rounded-2xl cursor-pointer duration-150 ${current ? "bg-(--accent) text-white" : dark ? "bg-[#ffffff1c] hover:bg-[#ffffff2a] text-(--text-primary)" : "bg-[#00000022] hover:bg-[#00000030] text-(--text-primary)"}`}
				onClick={pick}
				onKeyDown={e => {
					if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
					e.preventDefault();
					pick();
				}}
				onContextMenu={e => {
					e.preventDefault();
					setMenu({ x: e.clientX, y: e.clientY });
				}}
				// Middle-click closes, as in the side panel. Stop the browser's autoscroll on press.
				onMouseDown={e => e.button === 1 && e.preventDefault()}
				onAuxClick={e => {
					if (e.button !== 1) return;
					e.preventDefault();
					closeTab(tab.id);
				}}
				onDragStart={e => {
					e.dataTransfer.setData(DRAG_TYPE, tab.id);
					e.dataTransfer.effectAllowed = "move";
					onDragStart();
				}}
				onDragEnd={onDragEnd}
				onDragOver={e => onDragOver(e, before(e))}
				onDrop={e => onDrop(e, before(e))}
			>
				{dropSide && <span className={`absolute inset-y-3 w-1 rounded-full bg-(--accent) pointer-events-none ${dropSide === "before" ? "-left-1.5" : "-right-1.5"}`} />}
				<div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
					<span className="flex shrink-0 pointer-events-none">{icon}</span>
					{/* The page's own title: a data value. */}
					<span className="flex-1 min-w-0 truncate text-lg font-semibold select-none">{title}</span>
					{/* The dropdown: on hover with a mouse, always on touch screens. */}
					<button
						ref={menuRef}
						{...menuAttrs}
						aria-haspopup="menu"
						className={`${ICON_BUTTON} ${menu ? "opacity-100" : "opacity-0 group-hover/card:opacity-80 hover:opacity-100! focus-visible:opacity-100 [@media(hover:none)]:opacity-80"}`}
						onClick={e => {
							e.stopPropagation();
							const r = e.currentTarget.getBoundingClientRect();
							setMenu({ x: r.left, y: r.bottom + 6 });
						}}
					>
						<ChevronDownIcon className="size-5 stroke-current stroke-1" />
					</button>
					{showSpeaker && (
						<button
							ref={speakerRef}
							{...speakerAttrs}
							aria-pressed={speakerMuted}
							className={`${ICON_BUTTON} opacity-80 hover:opacity-100`}
							onClick={e => {
								e.stopPropagation();
								if (playsMusic) toggleMute();
								else useTabAudioStore.getState().toggleMuted(tab.id);
							}}
						>
							{speakerMuted ? <SpeakerXMarkIcon className="size-4.5" /> : <SpeakerWaveIcon className="size-4.5" />}
						</button>
					)}
					<button
						ref={closeRef}
						{...closeAttrs}
						className={`${ICON_BUTTON} opacity-80 hover:opacity-100`}
						onClick={e => {
							e.stopPropagation();
							closeTab(tab.id);
						}}
					>
						<XMarkIcon className="size-5 stroke-current stroke-1" />
					</button>
				</div>
				<div data-preview-slot={tab.id} className="w-full rounded-t-md rounded-b-[14px] bg-(--primary)" style={{ aspectRatio: PREVIEW_ASPECT }} />
			</div>
			{/* A sibling, not a child: React events from the (portaled) menu would otherwise bubble into the card. */}
			{menu && <ContextMenu items={menuItems()} position={menu} onClose={() => setMenu(null)} />}
		</>
	);
};
