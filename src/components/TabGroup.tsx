import { RectangleStackIcon, XMarkIcon, EllipsisVerticalIcon } from "@heroicons/react/24/solid";
import { useSettingsStore, useTabsStore } from "../store";
import { Tab } from "./Tab";
import { useState } from "react";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface TabGroupProps {
	id: string;
	name: string;
	icon?: string | React.ReactNode | null;
}

const TabGroup = ({ id, name, icon }: TabGroupProps) => {
	const tabs = useTabsStore(state => state.tabs);
	const settings = useSettingsStore(state => state.settings);

	const setCurrentTab = useTabsStore(state => state.setCurrentTab);
	const closeGroup = useTabsStore(state => state.closeGroup);
	const updateTab = useTabsStore(state => state.updateTab);
	const moveTabRelative = useTabsStore(state => state.moveTabRelative);
	const updateGroup = useTabsStore(state => state.updateGroup);

	const [dragOver, setDragOver] = useState(false);
	const [groupOpen, setGroupOpen] = useState(true);
	const [groupAccent, setGroupAccent] = useState<string | null>(null);
	const [changingName, setChangingName] = useState(false);
	const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; visible: boolean; items: MenuItem[] }>(null);

	const onHeaderDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setDragOver(true);
	};
	const onHeaderDragLeave = () => setDragOver(false);
	const onHeaderDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setDragOver(false);
		const draggedId = e.dataTransfer.getData("text/tab-id");
		if (!draggedId) return;
		updateTab(draggedId, { groupId: id });
		const groupTabs = tabs.filter(t => t.groupId === id);
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
		const draggedId = e.dataTransfer.getData("text/tab-id");
		if (!draggedId) return;

		const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
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
		const groupTabs = tabs.filter(t => t.groupId === id);
		if (groupTabs.length > 0) {
			const lastId = groupTabs[groupTabs.length - 1].id;
			moveTabRelative(draggedId, lastId, false);
		}
	};

	// get group's accent from store (falls back to local groupAccent state)
	const groups = useTabsStore(state => state.groups);
	const group = groups.find(g => g.id === id);
	const accent = group?.accent ?? groupAccent;

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
	const hexToRgba = (hex: string, a: number) => {
		const rgb = hexToRgb(hex);
		if (!rgb) return undefined;
		return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
	};
	const readableTextColor = (hex?: string | null) => {
		if (!hex) return undefined;
		const rgb = hexToRgb(hex);
		if (!rgb) return undefined;
		const srgb = [rgb.r, rgb.g, rgb.b].map(v => v / 255).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
		const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
		return lum > 0.5 ? "#000000" : "#ffffff";
	};

	const headerStyle: React.CSSProperties = accent ? { borderLeft: `4px solid ${accent}`, backgroundColor: hexToRgba(accent, 0.1) } : {};

	return (
		<div key={id} data-group-wrapper={id} className="flex flex-col w-full h-max rounded-lg overflow-hidden inset-shadow-(--inset-shadow-secondary) flex-shrink-0 duration-150">
			<div
				data-group-id={id}
				onDragOver={onHeaderDragOver}
				onDragLeave={onHeaderDragLeave}
				onDrop={onHeaderDrop}
				onClick={() => {
					tabs.filter(t => t.groupId === id).length === 0 ? null : groupOpen ? setGroupOpen(false) : setGroupOpen(true);
				}}
				style={headerStyle}
				className={
					"flex items-center justify-between gap-1.5 p-2.5 duration-150" +
					" " +
					`
                ${dragOver ? "bg-[#ffffff12] rounded-md" : ""}
                ${tabs.filter(t => t.groupId === id).length === 0 ? "cursor-default" : "cursor-pointer"}
            `
				}
			>
				<div className="flex items-center gap-1.5">
					<RectangleStackIcon className="size-5 stroke-current stroke-1.5" />
					<span className="font-semibold pointer-events-none">{name}</span>
				</div>
				<div className="flex items-center gap-0.5">
					<button
						className="p-0.5 hover:bg-[#ffffff25] rounded-md duration-150 cursor-pointer"
						onClick={e => {
							e.stopPropagation();
							const rect = (e.target as HTMLElement).getBoundingClientRect();
							const x = rect.left;
							const y = rect.bottom;
							const baseColors = ["#ff4757", "#ff7b7b", "#7bdfff", "#7bffb8", "#ffd77b", "#c77bff", "#9bb0ff", "#7bffdf"];

							const hoverBg = settings.brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000010]";
							const colorRow = (
								<div className="flex items-center gap-2 py-1">
									{baseColors.map(c => (
										<div
											key={c}
											onClick={ev => {
												ev.stopPropagation();
												updateGroup(id, { accent: c });
												setGroupAccent(c);
												setContextMenu(null);
											}}
											onKeyDown={ev => {
												if (ev.key === "Enter" || ev.key === " ") {
													ev.preventDefault();
													updateGroup(id, { accent: c });
													setGroupAccent(c);
													setContextMenu(null);
												}
											}}
											role="button"
											tabIndex={0}
											className={`rounded-sm flex items-center justify-center p-1 ${hoverBg}`}
											style={{ width: 28, height: 28, background: c, border: "1px solid rgba(0,0,0,0.12)", cursor: "pointer" }}
										/>
									))}
									<button
										onClick={ev => {
											ev.stopPropagation();
											let color = "";
											window.fr.dialog.prompt({
												title: "Select new Color",
												message: "Enter the color for this link (leave empty for default):",
												defaultValue: groupAccent || "#ff7b7b",
												onOk: (res: string) => {
													color = res;
												},
											});
											if (color && color.trim()) {
												updateGroup(id, { accent: color.trim() });
												setGroupAccent(color.trim());
												setContextMenu(null);
											}
										}}
										className={`ml-2 text-sm p-1 rounded-md ${hoverBg}`}
									>
										Custom
									</button>
								</div>
							);

							const colorItems: MenuItem[] = baseColors.map(c => ({
								title: <div className={`rounded-sm flex items-center justify-center`} style={{ width: 28, height: 28, background: c, border: "1px solid rgba(0,0,0,0.12)" }} />,
								icon: null,
								onClick: () => {
									updateGroup(id, { accent: c });
									setGroupAccent(c);
								},
							}));

							const items: MenuItem[] = [
								{
									title: "Rename group",
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
									title: <div className="text-sm">Change color</div>,
									icon: null,
									onClick: () => {},
									children: colorItems.map((ci, idx) => ({
										title: ci.title,
										icon: null,
										onClick: () => {
											ci.onClick();
											setContextMenu(null);
										},
									})),
									childrenLayout: "horizontal",
									childrenPosition: "right",
								},
							];

							setContextMenu({ x, y, visible: true, items });
						}}
					>
						<EllipsisVerticalIcon className="size-5 stroke-current stroke-1.5" />
					</button>
					<button
						className="p-0.5 hover:bg-[#ffffff25] rounded-md duration-150 cursor-pointer"
						onClick={() => {
							useTabsStore.getState().closeGroup(id);
						}}
					>
						<XMarkIcon className="size-5 stroke-current stroke-1.5" />
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
                ${!groupOpen ? "p-0" : tabs.filter(t => t.groupId === id).length === 0 ? "p-0" : "p-1.5 pt-1"}
                ${groupOpen ? "" : "h-0 opacity-0"}
            `
				}
			>
				{groupOpen === true && tabs.filter(t => t.groupId === id).map(tab => <Tab title={tab.title} url={tab.url} id={tab.id} icon={tab.icon} displayUrl={tab.url} key={tab.id} />)}
			</div>
		</div>
	);
};

export default TabGroup;
