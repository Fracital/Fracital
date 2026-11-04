import { useEffect, useState, useRef } from "react";
import { useSettingsStore } from "../store";
import { handleImg } from "../libs/imgHandler";

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
}

export const ContextMenu = ({ items, position, onClose }: MenuProps) => {
	const menuRef = useRef<HTMLDivElement>(null);
	const itemsRef = useRef<HTMLDivElement>(null);
	const [adjustedPos, setAdjustedPos] = useState(position);
	const parentRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const submenuRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const [submenuPositions, setSubmenuPositions] = useState<Record<number, "left" | "right">>({});

	const settings = useSettingsStore(state => state.settings);

	useEffect(() => {
		const menu = menuRef.current;
		if (!menu) return;

		const { innerWidth, innerHeight } = window;
		const { offsetWidth, offsetHeight } = menu;

		let x = position.x;
		let y = position.y;

		if (x + offsetWidth > innerWidth) {
			x = innerWidth - offsetWidth - 8;
		}
		if (y + offsetHeight > innerHeight) {
			y = innerHeight - offsetHeight - 8;
		}

		setAdjustedPos({ x, y });
	}, [position]);

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
				const { innerWidth } = window;
				const next: Record<number, "left" | "right"> = { ...submenuPositions };
				let changed = false;
				(items || []).forEach((item, i) => {
					if (!item.children) return;
					const parentEl = parentRefs.current[i];
					const submenuEl = submenuRefs.current[i];
					if (!parentEl || !submenuEl) return;
					const parentRect = parentEl.getBoundingClientRect();
					const submenuRect = submenuEl.getBoundingClientRect();
					const preferred = item.childrenPosition || "right";
					const desired = parentRect.right + submenuRect.width + 8 > innerWidth ? "left" : preferred;
					if (next[i] !== desired) {
						next[i] = desired;
						changed = true;
					}
				});
				if (changed) setSubmenuPositions(next);
			} catch (err) {
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

	return (
		<div ref={menuRef} className="fixed z-50 min-w-[180px] p-1.5 bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-xl shadow-lg translate-y-2 opacity-0" style={{ top: adjustedPos.y, left: adjustedPos.x }}>
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
							className={`group relative flex items-center justify-between gap-5 leading-none pl-3 p-2.5 text-sm rounded-md cursor-pointer duration-150 ${settings.brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000010]"}`}
							onClick={() => {
								item.onClick();
								onClose();
							}}
						>
							<div className="font-medium w-max">{item.title}</div>
							{item.icon === null ? null : typeof item.icon === "string" ? <img src={item.icon as string} alt={typeof item.title === "string" ? item.title + " icon" : "icon"} className="size-5 object-contain" /> : item.icon}

							{/* render children submenu on hover */}
							{item.children && item.children.length > 0 && (
								<div
									ref={el => {
										submenuRefs.current[i] = el;
									}}
									className={`absolute top-0 ${submenuPositions[i] === "left" ? "right-full -mr-2" : "left-full ml-2"} z-50 pointer-events-none opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto transform transition-all duration-150`}
								>
									<div className={`bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-md p-2 flex ${item.childrenLayout === "horizontal" ? "flex-row" : "flex-col"} gap-2`} style={{ minWidth: item.childrenLayout === "horizontal" ? undefined : 160 }}>
										{item.children.map((child, ci) => (
											<div
												key={ci}
												className={`rounded-md ${item.childrenLayout === "horizontal" ? "" : "flex items-center justify-between pl-3 pr-3"} cursor-pointer ${settings.brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000010]"}`}
												onClick={e => {
													e.stopPropagation();
													child.onClick();
													onClose();
												}}
												onKeyDown={e => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														child.onClick();
														onClose();
													}
												}}
												role="button"
												tabIndex={0}
											>
												{child.title}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					),
				)}
			</div>
		</div>
	);
};
