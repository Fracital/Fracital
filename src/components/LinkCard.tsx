import { useEffect, useState } from "react";
import { createId } from "@paralleldrive/cuid2";
import { ArrowLeftIcon, ArrowRightIcon, ArrowTopRightOnSquareIcon, BriefcaseIcon, EllipsisHorizontalIcon, GiftIcon, GlobeAltIcon, MusicalNoteIcon, NewspaperIcon, PencilSquareIcon, PlusIcon, PuzzlePieceIcon, ShoppingBagIcon, TrashIcon } from "@heroicons/react/24/solid";
import { navigationEvent } from "../libs/eventBus";
import { isColorBright } from "../libs/colorBright";
import { useHolyAttr } from "../libs/holy-attr";
import { moveLink, readLinks, removeLink, safeColor, shortHref, type QuickLink } from "../libs/quickLinks";
import { useTabsStore } from "../store";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { HolyText } from "./common/HolyText";
import { useModal } from "./Modal/ModalContext";
import { Modal } from "./Modal/Modal";
import { QuickLinkEditor } from "./Modal/QuickLinkEditor";

/** URLs, site-relative paths ("/google.svg") and data URIs render as images. */
const isImageIcon = (icon: string) => /^(https?:\/\/|\/|data:image\/)/.test(icon);

const GLYPHS: Record<string, typeof GlobeAltIcon> = {
	default: GlobeAltIcon,
	gifticon: GiftIcon,
	musicalicon: MusicalNoteIcon,
	puzzleicon: PuzzlePieceIcon,
	shoppingicon: ShoppingBagIcon,
	brieficon: BriefcaseIcon,
	newspapericon: NewspaperIcon,
};

/** A link's icon on its color: the image, a built-in glyph, or (when the image won't load) the name's first letter. */
export const LinkIcon = ({ icon, color, title, className = "size-14 rounded-2xl" }: { icon: string; color: string; title: string; className?: string }) => {
	const bg = safeColor(color);
	const ink = isColorBright(bg) === "dark" ? "text-[#1a1a1a]" : "text-white";
	const [broken, setBroken] = useState(false);
	useEffect(() => setBroken(false), [icon]);
	const Glyph = GLYPHS[icon] ?? GlobeAltIcon;
	return (
		<span className={`flex shrink-0 items-center justify-center shadow-[0_4px_14px_#00000040] ${ink} ${className}`} style={{ backgroundColor: bg }}>
			{isImageIcon(icon) && !broken ? (
				<img src={icon} alt="" draggable={false} className="size-[58%] object-contain" onError={() => setBroken(true)} />
			) : isImageIcon(icon) ? (
				<span className="text-[1.6em] font-black leading-none">{title.trim().charAt(0).toUpperCase() || "?"}</span>
			) : (
				<Glyph className="size-[52%]" />
			)}
		</span>
	);
};

const CARD = "group relative flex flex-col items-center gap-2.5 min-w-0 px-2 pt-4 pb-3 rounded-2xl bg-(--secondary) inset-shadow-(--inset-shadow-secondary) duration-200";

/** One quick link: opens in this tab; its menu (⋯ or right-click) edits, moves, removes or opens it in a new tab. */
export const LinkCard = ({ link, index, count }: { link: QuickLink; index: number; count: number }) => {
	const { openModal } = useModal();
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const { ref: menuRef, placeholder: menuAttrs } = useHolyAttr({ title: "Link options", "aria-label": "Link options" });

	const open = () => {
		const tab = useTabsStore.getState().tabs.find(t => t.current);
		if (tab && link.href) navigationEvent({ url: link.href, icon: link.icon, title: link.title, displayUrl: link.href, id: tab.id });
	};
	const items = (): MenuItem[] => [
		{ title: <HolyText text="Open in new tab" />, icon: <ArrowTopRightOnSquareIcon className="size-5" />, onClick: () => useTabsStore.getState().newTab({ id: createId(), url: link.href, displayUrl: link.href, title: link.title, icon: null, current: true }) },
		{ title: <HolyText text="Edit" />, icon: <PencilSquareIcon className="size-5" />, onClick: () => openModal(<Modal><QuickLinkEditor index={index} initial={readLinks()[index]} /></Modal>) },
		...(index > 0 ? [{ title: <HolyText text="Move left" />, icon: <ArrowLeftIcon className="size-5" />, onClick: () => moveLink(index, -1) }] : []),
		...(index < count - 1 ? [{ title: <HolyText text="Move right" />, icon: <ArrowRightIcon className="size-5" />, onClick: () => moveLink(index, 1) }] : []),
		{ title: <HolyText text="Remove" />, icon: <TrashIcon className="size-5" />, onClick: () => removeLink(index) },
	];

	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: the card holds its own menu button, and a button can't hold another. */}
			<div
				role="button"
				tabIndex={0}
				className={`${CARD} cursor-pointer hover:-translate-y-0.5 hover:inset-shadow-(--inset-shadow-accent) focus-visible:inset-shadow-(--inset-shadow-accent) outline-none`}
				onClick={open}
				onKeyDown={e => {
					if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
					e.preventDefault();
					open();
				}}
				onContextMenu={e => {
					e.preventDefault();
					setMenu({ x: e.clientX, y: e.clientY });
				}}
			>
				<button
					ref={menuRef}
					{...menuAttrs}
					aria-haspopup="menu"
					className={`absolute top-1.5 right-1.5 flex items-center justify-center size-7 rounded-full text-(--text-secondary) hover:text-(--text-primary) hover:bg-[#ffffff14] cursor-pointer duration-150 ${menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"}`}
					onClick={e => {
						e.stopPropagation();
						const r = e.currentTarget.getBoundingClientRect();
						setMenu({ x: r.right, y: r.bottom + 6 });
					}}
				>
					<EllipsisHorizontalIcon className="size-5" />
				</button>
				<LinkIcon icon={link.icon} color={link.color} title={link.title} className="size-14 rounded-2xl group-hover:scale-105 duration-200" />
				{/* The link's own name and address: data values. */}
				<span className="flex flex-col items-center gap-0.5 w-full min-w-0 select-none">
					<span className="w-full truncate text-center text-sm font-bold text-(--text-primary)">{link.title}</span>
					<span className="w-full truncate text-center text-xs font-medium text-(--text-tertiary)">{shortHref(link.href)}</span>
				</span>
			</div>
			{menu && <ContextMenu items={items()} position={menu} onClose={() => setMenu(null)} align="end" />}
		</>
	);
};

/** The add tile at the end of the grid. */
const AddCard = () => {
	const { openModal } = useModal();
	return (
		<button className={`${CARD} justify-center cursor-pointer text-(--text-tertiary) hover:text-(--text-primary) hover:-translate-y-0.5 bg-transparent! inset-shadow-none! border-2 border-dashed border-(--text-quaternary) hover:border-(--text-tertiary)`} onClick={() => openModal(<Modal><QuickLinkEditor /></Modal>)}>
			<span className="flex items-center justify-center size-14">
				<PlusIcon className="size-8" />
			</span>
			<HolyText className="text-sm font-bold" text="Add link" />
		</button>
	);
};

/** Every quick link, in order, and the add tile. Follows changes made anywhere (the editor, Settings, the star). */
export const QuickLinksGrid = ({ className = "" }: { className?: string }) => {
	const [links, setLinks] = useState<QuickLink[]>(readLinks);
	useEffect(() => {
		const update = () => setLinks(readLinks());
		window.addEventListener("links-upd", update);
		window.addEventListener("storage", update);
		return () => {
			window.removeEventListener("links-upd", update);
			window.removeEventListener("storage", update);
		};
	}, []);
	return (
		<div className={`grid w-full grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3 ${className}`}>
			{links.map((link, i) => (
				<LinkCard key={`${i}-${link.href}`} link={link} index={i} count={links.length} />
			))}
			<AddCard />
		</div>
	);
};
