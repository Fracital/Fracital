import { ChevronDownIcon, ChevronRightIcon, PlusIcon, RectangleStackIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ContextMenu } from "../components/ContextMenu";
import { HolyText } from "../components/common/HolyText";
import { GroupIcon } from "../components/GroupIcon";
import { Modal } from "../components/Modal/Modal";
import { useModal } from "../components/Modal/ModalContext";
import { portalTarget } from "../libs/cloak";
import { useHolyAttr } from "../libs/holy-attr";
import { urlFromInput } from "../libs/searchEngines";
import { nextGroupName, useSettingsStore, useTabsStore } from "../store";

/*
 * Adding tabs and groups in batches, shared by the tab view and the side panel: opening tabs (new tab pages, or links)
 * into a group or none, making groups, and the list of tabs with their own links and groups.
 */

const ICON_BUTTON = "flex shrink-0 items-center justify-center rounded-full cursor-pointer duration-150";

/** Moves a tab to the end of a group, or (no group) to the end of the list, after every group and loose tab. */
export const moveToEnd = (draggedId: string, groupId: string | undefined) => {
	if (!groupId) {
		useTabsStore.getState().placeLoose(draggedId, Number.MAX_SAFE_INTEGER);
		return;
	}
	useTabsStore.getState().updateTab(draggedId, { groupId });
	const store = useTabsStore.getState();
	const members = store.tabs.filter(t => t.groupId === groupId && t.id !== draggedId);
	const last = members[members.length - 1];
	if (last) store.moveTabRelative(draggedId, last.id, false);
};

/** The most tabs one batch opens: each loads its own live page. */
export const BATCH_MAX = 25;

/**
 * Opens `count` tabs, of a link or search (as the address bar reads it) or new tab pages, at the end of a group or of
 * the tabs in none. The open tab stays open, so the view shows them all.
 */
export const addTabs = (count: number, input: string, groupId: string | undefined) => {
	const store = useTabsStore.getState();
	const keep = store.tabs.find(tab => tab.current)?.id;
	const query = input.trim();
	for (let i = 0; i < Math.min(Math.max(1, count), BATCH_MAX); i++) {
		const id = createId();
		store.newTab(query ? { id, title: query, url: urlFromInput(query), displayUrl: query } : { id, title: "New Tab", url: "about:newtab", displayUrl: "about:newtab" });
		moveToEnd(id, groupId);
	}
	if (keep) store.setCurrentTab(keep);
};

/** Makes `count` groups, each with `tabsEach` new tab pages (no more than BATCH_MAX tabs in all). */
export const addGroups = (count: number, tabsEach: number) => {
	const groups = Math.min(Math.max(1, count), BATCH_MAX);
	const each = Math.min(Math.max(0, tabsEach), Math.floor(BATCH_MAX / groups));
	for (let i = 0; i < groups; i++) {
		const id = createId();
		useTabsStore.getState().newGroup(id, nextGroupName(useTabsStore.getState().groups));
		if (each) addTabs(each, "", id);
	}
};

/**
 * Handlers that open more options from a button: right-click, or holding it on a touch screen (the click after a
 * hold is swallowed). A normal click still does the button's own thing.
 */
export const useMoreOnHold = (onMore: (button: HTMLElement) => void) => {
	const timer = useRef(0);
	const held = useRef(false);
	const stop = () => window.clearTimeout(timer.current);
	return {
		onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
			held.current = false;
			if (e.pointerType !== "touch") return;
			const button = e.currentTarget;
			timer.current = window.setTimeout(() => {
				held.current = true;
				onMore(button);
			}, 450);
		},
		onPointerUp: stop,
		onPointerCancel: stop,
		onPointerLeave: stop,
		onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
			e.preventDefault();
			// A touch hold can also fire contextmenu; open the panel once.
			if (!held.current) onMore(e.currentTarget);
			held.current = true;
		},
		onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
			if (!held.current) return;
			held.current = false;
			e.preventDefault();
			e.stopPropagation();
		},
	};
};

/** Opens the list of new tabs with their own links and groups; `preset` is the group new rows go to ("" for none). */
export const useOpenLinks = () => {
	const { openModal, closeModal } = useModal();
	return (preset: string) =>
		openModal(
			<Modal>
				<LinkTabsDialog preset={preset} onClose={closeModal} />
			</Modal>,
		);
};

/** A new tab in the links list: its link or search, and where it goes (a group's id, "" for no group, "new" for a new group). */
interface LinkRow {
	key: string;
	link: string;
	target: string;
}

/**
 * Adding tabs with their own links: one row per tab, each with a link or search and a group (none, an existing one,
 * or one new group shared by every row that picks it). Opened from the tab ⌄'s panel, or a group's + (that group picked).
 */
export const LinkTabsDialog = ({ preset, onClose }: { preset: string; onClose: () => void }) => {
	const groups = useTabsStore(state => state.groups);
	const dark = useSettingsStore(state => state.settings.brightness !== "light");
	const [rows, setRows] = useState<LinkRow[]>(() => [{ key: createId(), link: "", target: preset }]);
	const [picker, setPicker] = useState<{ key: string; x: number; y: number } | null>(null);
	const inputs = useRef(new Map<string, HTMLInputElement>());
	/** The row whose input gets focus once it renders: the first, then each one added. */
	const focusKey = useRef<string | null>(rows[0].key);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once a new row has rendered, to focus its input.
	useEffect(() => {
		if (!focusKey.current) return;
		inputs.current.get(focusKey.current)?.focus();
		focusKey.current = null;
	}, [rows]);

	useEffect(() => {
		// Escape closes the group picker, else the dialog; never the tab view behind it.
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopImmediatePropagation();
			if (picker) setPicker(null);
			else onClose();
		};
		window.addEventListener("keydown", key, true);
		return () => window.removeEventListener("keydown", key, true);
	}, [picker, onClose]);

	const update = (key: string, changes: Partial<LinkRow>) => setRows(prev => prev.map(row => (row.key === key ? { ...row, ...changes } : row)));
	/** A new row, going where the last one goes. */
	const addRow = () =>
		setRows(prev => {
			if (prev.length >= BATCH_MAX) return prev;
			const key = createId();
			focusKey.current = key;
			return [...prev, { key, link: "", target: prev[prev.length - 1]?.target ?? preset }];
		});
	const filled = rows.filter(row => row.link.trim());

	const add = () => {
		const store = useTabsStore.getState();
		let newGroupId: string | undefined;
		if (filled.some(row => row.target === "new")) {
			newGroupId = createId();
			store.newGroup(newGroupId, nextGroupName(store.groups));
		}
		for (const row of filled) {
			// A group closed while the dialog was open: the tab goes in no group.
			const groupId = row.target === "new" ? newGroupId : useTabsStore.getState().groups.some(group => group.id === row.target) ? row.target : undefined;
			addTabs(1, row.link, groupId);
		}
		onClose();
	};

	const targetLabel = (target: string) => {
		if (target === "new") return <HolyText text="New group" />;
		const group = groups.find(g => g.id === target);
		// A group's own name: a data value.
		return group ? group.name : <HolyText text="No group" />;
	};
	const pickerItems = (key: string) => [
		{ title: <HolyText text="No group" />, icon: null, onClick: () => update(key, { target: "" }) },
		{ title: <HolyText text="New group" />, icon: <PlusIcon className="size-4.5" />, onClick: () => update(key, { target: "new" }) },
		// Group names are the user's own text (data), shown as-is.
		...groups.map(group => ({ title: group.name, icon: <GroupIcon icon={group.icon} className="size-4.5 opacity-60" />, onClick: () => update(key, { target: group.id }) })),
	];
	const quiet = `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer duration-150 ${dark ? "hover:bg-[#ffffff14]" : "hover:bg-[#00000010]"}`;

	return (
		<div className="flex flex-col gap-3">
			<HolyText as="h2" className="text-lg font-bold" text="Add tabs with links" />
			<div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto -m-1 p-1">
				{rows.map(row => (
					<LinkRowView
						key={row.key}
						row={row}
						dark={dark}
						label={targetLabel(row.target)}
						canRemove={rows.length > 1}
						inputRef={el => {
							if (el) inputs.current.set(row.key, el);
							else inputs.current.delete(row.key);
						}}
						onLink={link => update(row.key, { link })}
						onEnter={addRow}
						onPick={button => {
							const r = button.getBoundingClientRect();
							setPicker({ key: row.key, x: r.left, y: r.bottom + 6 });
						}}
						onRemove={() => setRows(prev => prev.filter(other => other.key !== row.key))}
					/>
				))}
			</div>
			<button type="button" className={`${quiet} self-start text-(--text-secondary) hover:text-(--text-primary) disabled:opacity-40 disabled:cursor-default`} disabled={rows.length >= BATCH_MAX} onClick={addRow}>
				<PlusIcon className="size-4 stroke-current stroke-1" />
				<HolyText text="Add another" />
			</button>
			<div className="flex justify-end gap-2">
				<button type="button" className={`${quiet} text-(--text-secondary) hover:text-(--text-primary)`} onClick={onClose}>
					<HolyText text="Cancel" />
				</button>
				<button type="button" disabled={!filled.length} className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-(--accent) text-white cursor-pointer duration-150 hover:brightness-110 disabled:opacity-40 disabled:cursor-default" onClick={add}>
					<HolyText text="Add" />
				</button>
			</div>
			{picker && <ContextMenu items={pickerItems(picker.key)} position={{ x: picker.x, y: picker.y }} onClose={() => setPicker(null)} />}
		</div>
	);
};

interface LinkRowViewProps {
	row: LinkRow;
	dark: boolean;
	label: React.ReactNode;
	canRemove: boolean;
	inputRef: (el: HTMLInputElement | null) => void;
	onLink: (link: string) => void;
	onEnter: () => void;
	onPick: (button: HTMLElement) => void;
	onRemove: () => void;
}

/** One row of the links list: the link, the group picker, and × to drop the row. */
const LinkRowView = ({ row, dark, label, canRemove, inputRef, onLink, onEnter, onPick, onRemove }: LinkRowViewProps) => {
	const { ref: linkRef, placeholder: linkAttrs } = useHolyAttr({ placeholder: "Link or search", "aria-label": "Link or search" });
	const { ref: pickRef, placeholder: pickAttrs } = useHolyAttr({ title: "Group", "aria-label": "Group" });
	const { ref: removeRef, placeholder: removeAttrs } = useHolyAttr({ title: "Remove", "aria-label": "Remove" });
	const box = dark ? "bg-[#ffffff10]" : "bg-[#00000012]";

	return (
		<div className="flex items-center gap-2">
			{/* The link the user types: a form value. */}
			<input
				ref={el => {
					linkRef(el);
					inputRef(el);
				}}
				{...linkAttrs}
				type="text"
				value={row.link}
				onChange={e => onLink(e.target.value)}
				onKeyDown={e => {
					if (e.key !== "Enter") return;
					e.preventDefault();
					onEnter();
				}}
				className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-(--text-primary) outline-none inset-shadow-[0_0_0_1.5px_#ffffff20] focus:inset-shadow-[0_0_0_1.5px_var(--accent)] ${box}`}
			/>
			<button ref={pickRef} {...pickAttrs} type="button" aria-haspopup="menu" className={`flex w-32 shrink-0 items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium text-(--text-primary) cursor-pointer duration-150 ${box}`} onClick={e => onPick(e.currentTarget)}>
				<span className="truncate">{label}</span>
				<ChevronDownIcon className="size-4 shrink-0 stroke-current stroke-1" />
			</button>
			<button ref={removeRef} {...removeAttrs} type="button" className={`${ICON_BUTTON} p-1 text-(--text-secondary) hover:text-(--text-primary) ${canRemove ? "" : "invisible"}`} disabled={!canRemove} onClick={onRemove}>
				<XMarkIcon className="size-4.5" />
			</button>
		</div>
	);
};

interface BatchAddProps {
	/** The page area, which the panel is placed in. */
	area: DOMRect;
	/** The button's bottom-right corner, on screen, and (to open above it when there's no room below) its top. */
	at: { x: number; y: number; top?: number };
	kind: "tabs" | "groups";
	/** Tabs: how many new tab pages. Groups: how many, and new tabs in each ("" for none). */
	onAdd: (count: number, extra: string) => void;
	/** Opens the list of new tabs with their own links and groups (tabs only). */
	onLinks: () => void;
	onClose: () => void;
	/** Positioned on the screen rather than in `area` (for a portal into the page body). */
	fixed?: boolean;
}

/**
 * Adding several at once. Tabs: a number of new tab pages, or a list of tabs with their own links and groups.
 * Groups: a number of empty groups, or a number of groups with some new tabs in each.
 */
export const BatchAdd = ({ area, at, kind, onAdd, onLinks, onClose, fixed }: BatchAddProps) => {
	const ref = useRef<HTMLDivElement>(null);
	const groups = kind === "groups";
	const [count, setCount] = useState(groups ? 2 : 5);
	const [secondCount, setSecondCount] = useState(2);
	const [tabsEach, setTabsEach] = useState(3);
	const dark = useSettingsStore(state => state.settings.brightness !== "light");
	const { ref: countRef, placeholder: countAttrs } = useHolyAttr({ "aria-label": groups ? "Number of groups" : "Number of new tabs" });
	const { ref: secondCountRef, placeholder: secondCountAttrs } = useHolyAttr({ "aria-label": "Number of groups" });
	const { ref: tabsEachRef, placeholder: tabsEachAttrs } = useHolyAttr({ "aria-label": "New tabs in each group" });

	useEffect(() => {
		// Pressing outside closes it; so does Escape, without closing the view.
		const down = (e: PointerEvent) => ref.current && !e.composedPath().includes(ref.current) && onClose();
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopImmediatePropagation();
			onClose();
		};
		window.addEventListener("pointerdown", down, true);
		window.addEventListener("keydown", key, true);
		return () => {
			window.removeEventListener("pointerdown", down, true);
			window.removeEventListener("keydown", key, true);
		};
	}, [onClose]);

	// Below the button, or above it when it would run off the bottom.
	const [above, setAbove] = useState(false);
	useLayoutEffect(() => {
		const box = ref.current?.getBoundingClientRect();
		if (box && at.top !== undefined && box.bottom > window.innerHeight - 8) setAbove(true);
	}, [at.top]);

	const width = 288;
	const left = Math.min(Math.max(8, at.x - area.left - width), area.width - width - 8);
	const top = above && at.top !== undefined ? at.top - area.top - (ref.current?.offsetHeight ?? 0) : at.y - area.top;
	const field = `min-w-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-(--text-primary) outline-none inset-shadow-[0_0_0_1.5px_#ffffff20] focus:inset-shadow-[0_0_0_1.5px_var(--accent)] ${dark ? "bg-[#ffffff10]" : "bg-[#00000012]"}`;
	const addButton = "shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold bg-(--accent) text-white cursor-pointer duration-150 hover:brightness-110 disabled:opacity-40 disabled:cursor-default";
	const clampCount = (value: string) => Math.min(BATCH_MAX, Math.max(1, Number.parseInt(value, 10) || 1));

	return (
		<div ref={ref} className={`${fixed ? "fixed" : "absolute"} z-50 flex flex-col gap-3 p-3 rounded-2xl bg-(--secondary) shadow-[0_12px_32px_-8px_#000000b0] inset-shadow-(--inset-shadow-primary)`} style={{ left, top, width }}>
			<form
				className="flex flex-col gap-1.5"
				onSubmit={e => {
					e.preventDefault();
					onAdd(count, "");
				}}
			>
				<HolyText as="span" className="text-sm font-semibold text-(--text-secondary)" text={groups ? "Add groups" : "Add tabs"} />
				<div className="flex items-center gap-2">
					<input ref={countRef} {...countAttrs} type="number" min={1} max={BATCH_MAX} value={count} onChange={e => setCount(clampCount(e.target.value))} className={`${field} w-16 flex-none`} />
					<span className="flex-1" />
					<button type="submit" className={addButton}>
						<HolyText text="Add" />
					</button>
				</div>
			</form>
			{groups ? (
				<form
					className="flex flex-col gap-1.5"
					onSubmit={e => {
						e.preventDefault();
						onAdd(secondCount, String(tabsEach));
					}}
				>
					<HolyText as="span" className="text-sm font-semibold text-(--text-secondary)" text="Add groups with tabs" />
					<div className="flex items-center gap-2">
						<input ref={secondCountRef} {...secondCountAttrs} type="number" min={1} max={BATCH_MAX} value={secondCount} onChange={e => setSecondCount(clampCount(e.target.value))} className={`${field} w-16 flex-none`} />
						{/* A plain multiplication sign between the two numbers. */}
						<span className="text-sm font-semibold text-(--text-tertiary)">×</span>
						<input ref={tabsEachRef} {...tabsEachAttrs} type="number" min={1} max={BATCH_MAX} value={tabsEach} onChange={e => setTabsEach(clampCount(e.target.value))} className={`${field} w-16 flex-none`} />
						<HolyText as="span" className="flex-1 text-sm font-medium text-(--text-tertiary)" text="tabs" />
						<button type="submit" className={addButton}>
							<HolyText text="Add" />
						</button>
					</div>
				</form>
			) : (
				<button type="button" className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-(--text-primary) cursor-pointer duration-150 ${dark ? "bg-[#ffffff10] hover:bg-[#ffffff1c]" : "bg-[#00000012] hover:bg-[#0000001e]"}`} onClick={onLinks}>
					<HolyText text="Add tabs with links…" />
					<ChevronRightIcon className="size-4 stroke-current stroke-1" />
				</button>
			)}
		</div>
	);
};

/**
 * A side panel button split like the tab view's: a click does its one thing; the chevron (or a right-click, or a hold
 * on touch) opens the panel for adding several, the same one the tab view opens.
 */
const SplitAddButton = ({ kind, title, moreLabel, onMain, children, className = "" }: { kind: "tabs" | "groups"; title: string; moreLabel: string; onMain: () => void; children: React.ReactNode; className?: string }) => {
	const [at, setAt] = useState<{ x: number; y: number; top: number } | null>(null);
	const openLinks = useOpenLinks();
	const openAt = (anchor: HTMLElement) => {
		const r = anchor.getBoundingClientRect();
		setAt({ x: r.right, y: r.bottom + 6, top: r.top - 6 });
	};
	const hold = useMoreOnHold(button => openAt(button.parentElement ?? button));
	const { ref: moreRef, placeholder: moreAttrs } = useHolyAttr({ title: moreLabel, "aria-label": moreLabel });
	const half = "flex items-center justify-center self-stretch text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-200";
	return (
		<div className={`flex items-center rounded-lg hover:bg-[#ffffff10] duration-200 ${at ? "bg-[#ffffff10]" : ""} ${className}`}>
			<button title={title} className={`${half} py-2 pl-2 pr-0.5 rounded-l-lg`} {...hold} onClick={onMain}>
				{children}
			</button>
			<button ref={moreRef} {...moreAttrs} aria-haspopup="dialog" aria-expanded={!!at} className={`${half} pl-0.5 pr-1.5 rounded-r-lg`} {...hold} onClick={e => openAt(e.currentTarget.parentElement ?? e.currentTarget)}>
				<ChevronDownIcon className={`size-3.5 stroke-current stroke-1 duration-150 ${at ? "rotate-180" : ""}`} />
			</button>
			{at &&
				createPortal(
					<BatchAdd
						fixed
						area={new DOMRect(0, 0, window.innerWidth, window.innerHeight)}
						at={at}
						kind={kind}
						onAdd={(count, extra) => {
							if (kind === "groups") addGroups(count, Number(extra) || 0);
							else addTabs(count, "", undefined);
							setAt(null);
						}}
						onLinks={() => {
							setAt(null);
							openLinks("");
						}}
						onClose={() => setAt(null)}
					/>,
					portalTarget(),
				)}
		</div>
	);
};

/** The side panel's new tab button; its chevron adds several tabs, or tabs with their own links and groups. */
export const NewTabButton = ({ title, className = "" }: { title: string; className?: string }) => (
	<SplitAddButton kind="tabs" title={title} moreLabel="Add several tabs" className={className} onMain={() => useTabsStore.getState().newTab({ id: createId(), title: "New Tab", url: "about:newtab", current: true, displayUrl: "about:newtab" })}>
		<PlusIcon className="size-5 stroke-current stroke-1 duration-150" />
	</SplitAddButton>
);

/** The side panel's new group button; its chevron adds several groups, with or without new tabs in each. */
export const NewGroupButton = ({ title, className = "" }: { title: string; className?: string }) => (
	<SplitAddButton kind="groups" title={title} moreLabel="Add several groups" className={className} onMain={() => useTabsStore.getState().newGroup(createId(), nextGroupName(useTabsStore.getState().groups))}>
		<RectangleStackIcon className="size-4.5 duration-150" />
		<PlusIcon className="size-3 stroke-current stroke-1 duration-150" />
	</SplitAddButton>
);
