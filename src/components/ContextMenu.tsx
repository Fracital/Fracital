import { ChevronRightIcon } from "@heroicons/react/24/solid";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { portalTarget } from "../libs/cloak";
import { handleImg } from "../libs/imgHandler";
import { useSettingsStore } from "../store";

export interface MenuItem {
	// allow rich titles (React nodes) so menu entries can include headers or formatted text
	title: string | React.ReactNode;
	onClick: () => void;
	icon: string | React.ReactNode | null;
	// when true, render as a non-clickable header row
	isHeader?: boolean;
	// when true, render as a thin horizontal divider
	isSeparator?: boolean;
	// rendered as-is in place of a row; pressing a button inside it closes the menu
	custom?: React.ReactNode;
	// optional submenu children
	children?: MenuItem[];
	// layout for children when shown: 'vertical' (column) or 'horizontal' (row)
	childrenLayout?: "vertical" | "horizontal" | "grid";
	// preferred submenu position relative to parent: 'left' or 'right'
	childrenPosition?: "left" | "right";
}

interface MenuProps {
	items: MenuItem[];
	position: { x: number; y: number };
	onClose: () => void;
	/** "end": `position.x` is the menu's right edge (for dropdowns lined up under a button's right side). */
	align?: "start" | "end";
}

export const ContextMenu = ({ items, position, onClose, align = "start" }: MenuProps) => {
	const menuRef = useRef<HTMLDivElement>(null);
	const itemsRef = useRef<HTMLDivElement>(null);
	const [adjustedPos, setAdjustedPos] = useState(position);
	const [maxHeight, setMaxHeight] = useState<number>();
	const parentRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const submenuRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const [submenuPositions, setSubmenuPositions] = useState<Record<number, "left" | "right">>({});
	const [submenuShift, setSubmenuShift] = useState<Record<number, number>>({});
	// Submenus are position: fixed so the menu's scroll box doesn't clip them; this is each parent row's rect.
	const [submenuAnchor, setSubmenuAnchor] = useState<Record<number, { top: number; left: number; right: number }>>({});
	/** Submenu opened by click/tap (hover opens them too). */
	const [openSub, setOpenSub] = useState<number | null>(null);

	const settings = useSettingsStore(state => state.settings);

	useEffect(() => {
		const menu = menuRef.current;
		if (!menu) return;

		const { innerWidth, innerHeight } = window;
		const { offsetWidth } = menu;
		// Fill the room below the anchor (up to 32rem) and scroll the rest; only move up when that room is too small.
		const below = innerHeight - position.y - 8;
		const cap = Math.min(512, below >= 240 ? below : innerHeight - 16);
		const height = Math.min(menu.scrollHeight, cap);

		let x = align === "end" ? position.x - offsetWidth : position.x;
		let y = position.y;
		if (x < 8) x = 8;

		if (x + offsetWidth > innerWidth) {
			x = innerWidth - offsetWidth - 8;
		}
		if (y + height > innerHeight) {
			y = innerHeight - height - 8;
		}

		setMaxHeight(cap);
		setAdjustedPos({ x, y });
	}, [position, align]);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			// composedPath: inside the cloak shadow root, e.target is retargeted to the host.
			if (menuRef.current && !e.composedPath().includes(menuRef.current)) {
				menuRef.current.classList.add("translate-y-2", "opacity-0", "duration-150");
				itemsRef.current?.classList.add("translate-y-4", "opacity-0");
				setTimeout(() => {
					menuRef.current?.classList.remove("duration-150");
					onClose();
				}, 150);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [onClose]);

	// auto-flip submenu position if it would overflow the viewport
	useEffect(() => {
		const update = () => {
			try {
				const { innerWidth, innerHeight } = window;
				const next: Record<number, "left" | "right"> = {};
				const nextShift: Record<number, number> = {};
				const nextAnchor: Record<number, { top: number; left: number; right: number }> = {};
				(items || []).forEach((item, i) => {
					if (!item.children) return;
					const parentEl = parentRefs.current[i];
					const submenuEl = submenuRefs.current[i];
					if (!parentEl || !submenuEl) return;
					const parentRect = parentEl.getBoundingClientRect();
					const submenuRect = submenuEl.getBoundingClientRect();
					const preferred = item.childrenPosition || "right";
					next[i] = parentRect.right + submenuRect.width + 8 > innerWidth ? "left" : preferred;
					// Lift the submenu so its bottom stays on screen (it opens level with its row).
					nextShift[i] = Math.max(0, Math.min(parentRect.top + submenuRect.height + 8 - innerHeight, parentRect.top - 8));
					// On narrow screens there's no room beside the menu, so overlap it rather than run off the edge.
					const room = innerWidth - submenuRect.width - 8;
					nextAnchor[i] = { top: parentRect.top, left: Math.max(8, Math.min(parentRect.right, room)), right: Math.max(8, Math.min(innerWidth - parentRect.left, room)) };
				});
				const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
				setSubmenuPositions(prev => (same(prev, next) ? prev : next));
				setSubmenuShift(prev => (same(prev, nextShift) ? prev : nextShift));
				setSubmenuAnchor(prev => (same(prev, nextAnchor) ? prev : nextAnchor));
			} catch {
				// ignore measurement errors
			}
		};

		// run on next tick so DOM has rendered
		const t = setTimeout(update, 0);
		// The open animation slides the menu in, so measure again once it has settled.
		const settled = setTimeout(update, 700);
		const scroller = menuRef.current;
		window.addEventListener("resize", update);
		scroller?.addEventListener("scroll", update, { passive: true });
		return () => {
			clearTimeout(t);
			clearTimeout(settled);
			window.removeEventListener("resize", update);
			scroller?.removeEventListener("scroll", update);
		};
	}, [items, adjustedPos.x, adjustedPos.y, maxHeight]);

	useEffect(() => {
		setTimeout(() => {
			if (menuRef.current) {
				menuRef.current.classList.add("duration-150");
				menuRef.current.classList.remove("translate-y-2", "opacity-0");
			}
			if (itemsRef.current) {
				itemsRef.current.classList.remove("translate-y-4", "opacity-0");
			}
		}, 100);
	}, []);

	const dark = settings.brightness === "dark";
	const rowHover = dark ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000010]";
	const rowActive = dark ? "bg-[#ffffff10]" : "bg-[#00000010]";

	const renderIcon = (item: MenuItem) =>
		item.icon === null || item.icon === undefined ? null : typeof item.icon === "string" ? <img src={item.icon} alt={typeof item.title === "string" ? item.title + " icon" : "icon"} className="size-5 shrink-0 object-contain" /> : <span className="flex shrink-0 items-center">{item.icon}</span>;

	const runChild = (e: React.MouseEvent, child: MenuItem) => {
		e.stopPropagation();
		child.onClick();
		onClose();
	};
	const runChildKey = (e: React.KeyboardEvent, child: MenuItem) => {
		if (e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		e.stopPropagation();
		child.onClick();
		onClose();
	};

	// Portaled to the app root: a transformed, filtered or contained ancestor would otherwise make this
	// fixed menu position against (and be clipped by) that ancestor instead of the window.
	return createPortal(
		<div ref={menuRef} className="fixed z-50 min-w-[180px] p-1.5 overflow-y-auto overscroll-contain text-(--text-primary) bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-xl shadow-lg translate-y-2 opacity-0" style={{ top: adjustedPos.y, left: adjustedPos.x, maxHeight }}>
			<div ref={itemsRef} className="flex flex-col translate-y-4 opacity-0 duration-500">
				{items.map((item, i) =>
					item.isSeparator ? (
						<span key={i} className="mx-2 my-1.5 block bg-current opacity-15" style={{ height: 2 }} />
					) : item.custom ? (
						<div key={i} className="flex justify-center p-1" onClick={e => (e.target as Element).closest("button") && onClose()}>
							{item.custom}
						</div>
					) : item.isHeader ? (
						<div key={i} className={"px-3 py-2 text-sm font-semibold text-(--text-primary)"}>
							{item.title}
						</div>
					) : (
						<div
							key={i}
							ref={el => {
								parentRefs.current[i] = el;
							}}
							className={`group relative flex items-center justify-between gap-5 leading-none pl-3 p-2.5 text-sm rounded-md cursor-pointer duration-150 ${rowHover} ${openSub === i ? rowActive : ""}`}
							onMouseEnter={() => setOpenSub(prev => (prev === i ? prev : null))}
							onClick={() => {
								// A row with a submenu opens it (for touch) instead of acting and closing.
								if (item.children?.length) {
									setOpenSub(prev => (prev === i ? null : i));
									return;
								}
								item.onClick();
								onClose();
							}}
						>
							<div className="font-medium w-max">{item.title}</div>
							<div className="flex shrink-0 items-center gap-1.5">
								{renderIcon(item)}
								{item.children && item.children.length > 0 && <ChevronRightIcon className={`size-3.5 opacity-60 ${submenuPositions[i] === "left" ? "rotate-180 -order-1" : ""}`} />}
							</div>

							{item.children && item.children.length > 0 && (
								<div
									ref={el => {
										submenuRefs.current[i] = el;
									}}
									// Padding (not margin) bridges the gap so the pointer can cross from the row to the submenu.
									style={
										submenuAnchor[i]
											? {
													top: submenuAnchor[i].top - 6 - (submenuShift[i] ?? 0),
													...(submenuPositions[i] === "left" ? { right: submenuAnchor[i].right } : { left: submenuAnchor[i].left }),
												}
											: undefined
									}
									className={`fixed ${submenuPositions[i] === "left" ? "pr-1.5" : "pl-1.5"} z-50 transition-opacity duration-150 ${openSub === i ? "opacity-100 pointer-events-auto" : "pointer-events-none opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto"}`}
								>
									{item.childrenLayout === "grid" ? (
										// Rows of round options (the group icons).
										<div className="grid w-max grid-cols-[repeat(6,auto)] gap-0.5 p-1.5 bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-2xl shadow-lg">
											{item.children.map((child, ci) => (
												<div key={ci} role="button" tabIndex={0} className={`flex p-1.5 rounded-lg cursor-pointer duration-150 hover:scale-110 ${rowHover}`} onClick={e => runChild(e, child)} onKeyDown={e => runChildKey(e, child)}>
													{child.title}
												</div>
											))}
										</div>
									) : item.childrenLayout === "horizontal" ? (
										// A pill of round options (the group colors).
										<div className="flex flex-row items-center gap-0.5 p-1.5 bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-full shadow-lg">
											{item.children.map((child, ci) => (
												<div key={ci} role="button" tabIndex={0} className={`flex p-1 rounded-full cursor-pointer duration-150 hover:scale-110 ${rowHover}`} onClick={e => runChild(e, child)} onKeyDown={e => runChildKey(e, child)}>
													{child.title}
												</div>
											))}
										</div>
									) : (
										<div className="flex flex-col min-w-[200px] max-w-72 max-h-[min(24rem,calc(100dvh-1rem))] overflow-y-auto p-1.5 bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-xl shadow-lg">
											{item.children.map((child, ci) =>
												child.isHeader ? (
													<div key={ci} className="px-3 py-2 text-xs font-semibold text-(--text-secondary)">
														{child.title}
													</div>
												) : (
													<div key={ci} role="button" tabIndex={0} className={`flex items-center justify-between gap-5 leading-none pl-3 p-2.5 text-sm rounded-md cursor-pointer duration-150 ${rowHover}`} onClick={e => runChild(e, child)} onKeyDown={e => runChildKey(e, child)}>
														<div className="min-w-0 truncate font-medium">{child.title}</div>
														{renderIcon(child)}
													</div>
												),
											)}
										</div>
									)}
								</div>
							)}
						</div>
					),
				)}
			</div>
		</div>,
		portalTarget(),
	);
};
