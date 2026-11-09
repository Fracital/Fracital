import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon } from "@heroicons/react/24/solid";
import { useSettingsStore } from "../store";
import { handleImg } from "../libs/imgHandler";
import { portalTarget } from "../libs/cloak";

export interface MenuItem {
	// allow rich titles (React nodes) so menu entries can include headers or formatted text
	title: string | React.ReactNode;
	onClick: () => void;
	icon: string | React.ReactNode | null;
	// when true, render as a non-clickable header row
	isHeader?: boolean;
	// optional submenu children
	children?: MenuItem[];
	// layout for children when shown: 'vertical' (column) or 'horizontal' (row)
	childrenLayout?: "vertical" | "horizontal";
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
	const parentRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const submenuRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const [submenuPositions, setSubmenuPositions] = useState<Record<number, "left" | "right">>({});
	const [submenuShift, setSubmenuShift] = useState<Record<number, number>>({});
	/** Submenu opened by click/tap (hover opens them too). */
	const [openSub, setOpenSub] = useState<number | null>(null);

	const settings = useSettingsStore(state => state.settings);

	useEffect(() => {
		const menu = menuRef.current;
		if (!menu) return;

		const { innerWidth, innerHeight } = window;
		const { offsetWidth, offsetHeight } = menu;

		let x = align === "end" ? position.x - offsetWidth : position.x;
		let y = position.y;
		if (x < 8) x = 8;

		if (x + offsetWidth > innerWidth) {
			x = innerWidth - offsetWidth - 8;
		}
		if (y + offsetHeight > innerHeight) {
			y = innerHeight - offsetHeight - 8;
		}

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
				});
				const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
				setSubmenuPositions(prev => (same(prev, next) ? prev : next));
				setSubmenuShift(prev => (same(prev, nextShift) ? prev : nextShift));
			} catch {
				// ignore measurement errors
			}
		};

		// run on next tick so DOM has rendered
		const t = setTimeout(update, 0);
		window.addEventListener("resize", update);
		return () => {
			clearTimeout(t);
			window.removeEventListener("resize", update);
		};
	}, [items, adjustedPos.x, adjustedPos.y]);

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
		<div ref={menuRef} className="fixed z-50 min-w-[180px] p-1.5 text-(--text-primary) bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-xl shadow-lg translate-y-2 opacity-0" style={{ top: adjustedPos.y, left: adjustedPos.x }}>
			<div ref={itemsRef} className="flex flex-col translate-y-4 opacity-0 duration-500">
				{items.map((item, i) =>
					item.isHeader ? (
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
									style={{ top: -6 - (submenuShift[i] ?? 0) }}
									className={`absolute ${submenuPositions[i] === "left" ? "right-full pr-1.5" : "left-full pl-1.5"} z-50 transition-opacity duration-150 ${openSub === i ? "opacity-100 pointer-events-auto" : "pointer-events-none opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto"}`}
								>
									{item.childrenLayout === "horizontal" ? (
										<div className="flex flex-row gap-1 p-1.5 bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-xl shadow-lg">
											{item.children.map((child, ci) => (
												<div key={ci} role="button" tabIndex={0} className={`p-1 rounded-md cursor-pointer duration-150 ${rowHover}`} onClick={e => runChild(e, child)} onKeyDown={e => runChildKey(e, child)}>
													{child.title}
												</div>
											))}
										</div>
									) : (
										<div className="flex flex-col min-w-[200px] max-w-72 max-h-[min(24rem,calc(100vh-1rem))] overflow-y-auto p-1.5 bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-xl shadow-lg">
											{item.children.map((child, ci) =>
												child.isHeader ? (
													<div key={ci} className="px-3 py-2 text-xs font-semibold text-(--text-secondary)">
														{child.title}
													</div>
												) : (
													<div
														key={ci}
														role="button"
														tabIndex={0}
														className={`flex items-center justify-between gap-5 leading-none pl-3 p-2.5 text-sm rounded-md cursor-pointer duration-150 ${rowHover}`}
														onClick={e => runChild(e, child)}
														onKeyDown={e => runChildKey(e, child)}
													>
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
