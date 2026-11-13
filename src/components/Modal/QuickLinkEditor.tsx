import { useState } from "react";
import { BriefcaseIcon, GiftIcon, GlobeAltIcon, LinkIcon as ChainIcon, MusicalNoteIcon, NewspaperIcon, PhotoIcon, PuzzlePieceIcon, ShoppingBagIcon, TrashIcon } from "@heroicons/react/24/solid";
import { useModal } from "./ModalContext";
import { HolyText } from "../common/HolyText";
import { LinkIcon } from "../LinkCard";
import { useHolyAttr } from "../../libs/holy-attr";
import { addLink, LINK_COLORS, normalizeHref, removeLink, safeColor, shortHref, siteIcon, updateLink, type QuickLink } from "../../libs/quickLinks";

const GLYPH_CHOICES = [
	{ name: "default", Icon: GlobeAltIcon, label: "Globe" },
	{ name: "gifticon", Icon: GiftIcon, label: "Gift" },
	{ name: "musicalicon", Icon: MusicalNoteIcon, label: "Music" },
	{ name: "puzzleicon", Icon: PuzzlePieceIcon, label: "Puzzle" },
	{ name: "shoppingicon", Icon: ShoppingBagIcon, label: "Shopping" },
	{ name: "brieficon", Icon: BriefcaseIcon, label: "Briefcase" },
	{ name: "newspapericon", Icon: NewspaperIcon, label: "News" },
];

type IconMode = "site" | "glyph" | "image";

const Label = ({ text }: { text: string }) => <HolyText as="span" className="text-xs font-bold uppercase tracking-wide text-(--text-tertiary)" text={text} />;

/** One choice in a row of options: highlighted when picked. */
const Choice = ({ on, onClick, label, children, className = "" }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode; className?: string }) => {
	const { ref, placeholder } = useHolyAttr({ title: label, "aria-label": label });
	return (
		<button ref={ref} {...placeholder} type="button" aria-pressed={on} onClick={onClick} className={`flex items-center justify-center rounded-xl cursor-pointer duration-150 ${on ? "bg-(--accent) text-white" : "bg-[#ffffff10] text-(--text-secondary) hover:bg-[#ffffff1c] hover:text-(--text-primary)"} ${className}`}>
			{children}
		</button>
	);
};

/** Adds a quick link, or edits the one at `index`. `initial` prefills it (the address bar's star passes the page). */
export const QuickLinkEditor = ({ index, initial }: { index?: number; initial?: Partial<QuickLink> }) => {
	const { closeModal } = useModal();
	const editing = index !== undefined;
	const startIcon = initial?.icon && initial.icon !== "default" ? initial.icon : "";
	const [title, setTitle] = useState(initial?.title ?? "");
	const [href, setHref] = useState(initial?.href ?? "");
	const [color, setColor] = useState(safeColor(initial?.color ?? LINK_COLORS[0]));
	const [mode, setMode] = useState<IconMode>(!startIcon ? (editing ? "glyph" : "site") : GLYPH_CHOICES.some(g => g.name === startIcon) ? "glyph" : startIcon === siteIcon(initial?.href ?? "") ? "site" : "image");
	const [glyph, setGlyph] = useState(GLYPH_CHOICES.some(g => g.name === startIcon) ? startIcon : "default");
	const [image, setImage] = useState(mode === "image" ? startIcon : "");

	const url = normalizeHref(href);
	const icon = mode === "site" ? (siteIcon(url) ?? "default") : mode === "image" ? image.trim() || "default" : glyph;
	const valid = title.trim() !== "" && url !== "";
	const link: QuickLink = { title: title.trim(), href: url, icon, color };

	const { ref: nameRef, placeholder: nameAttrs } = useHolyAttr({ placeholder: "Name", "aria-label": "Name" });
	const { ref: hrefRef, placeholder: hrefAttrs } = useHolyAttr({ placeholder: "youtube.com", "aria-label": "Address" });
	const { ref: imageRef, placeholder: imageAttrs } = useHolyAttr({ placeholder: "https://example.com/icon.png", "aria-label": "Image address" });
	const { ref: pickRef, placeholder: pickAttrs } = useHolyAttr({ title: "Custom color", "aria-label": "Custom color" });

	const save = () => {
		if (!valid) return;
		if (editing) updateLink(index, link);
		else addLink(link);
		closeModal();
	};
	const input = "w-full min-w-0 px-3 py-2.5 rounded-xl bg-[#ffffff10] text-(--text-primary) font-semibold outline-none placeholder:text-(--text-tertiary) focus:inset-shadow-(--inset-shadow-accent) duration-150";

	return (
		<form
			className="flex flex-col gap-4 p-1"
			onSubmit={e => {
				e.preventDefault();
				save();
			}}
		>
			<HolyText as="h2" className="text-xl font-bold" text={editing ? "Edit quick link" : "Add quick link"} />

			{/* Preview: what the card will look like. The name and address are the user's own (data values). */}
			<div className="flex items-center gap-3 p-3 rounded-2xl bg-(--primary)">
				<LinkIcon icon={link.icon} color={color} title={link.title || "?"} className="size-14 rounded-2xl" />
				<div className="flex flex-col min-w-0">
					<span className="truncate font-bold text-(--text-primary)">{link.title || " "}</span>
					<span className="truncate text-sm text-(--text-tertiary)">{url ? shortHref(url) : " "}</span>
				</div>
			</div>

			<label className="flex flex-col gap-1.5">
				<Label text="Name" />
				<input ref={nameRef} {...nameAttrs} autoFocus value={title} maxLength={40} onChange={e => setTitle(e.target.value)} className={input} />
			</label>
			<label className="flex flex-col gap-1.5">
				<Label text="Address" />
				<input ref={hrefRef} {...hrefAttrs} value={href} spellCheck={false} autoComplete="off" onChange={e => setHref(e.target.value)} className={input} />
			</label>

			<div className="flex flex-col gap-1.5">
				<Label text="Icon" />
				<div className="flex flex-wrap gap-1.5">
					<Choice on={mode === "site"} onClick={() => setMode("site")} label="The site's icon" className="gap-1.5 px-3 h-10 text-sm font-semibold">
						<ChainIcon className="size-4" />
						<HolyText text="Site" />
					</Choice>
					{GLYPH_CHOICES.map(({ name, Icon, label }) => (
						<Choice
							key={name}
							on={mode === "glyph" && glyph === name}
							onClick={() => {
								setMode("glyph");
								setGlyph(name);
							}}
							label={label}
							className="size-10"
						>
							<Icon className="size-5" />
						</Choice>
					))}
					<Choice on={mode === "image"} onClick={() => setMode("image")} label="An image from a link" className="gap-1.5 px-3 h-10 text-sm font-semibold">
						<PhotoIcon className="size-4" />
						<HolyText text="Image" />
					</Choice>
				</div>
				{mode === "image" && <input ref={imageRef} {...imageAttrs} value={image} spellCheck={false} autoComplete="off" onChange={e => setImage(e.target.value)} className={input} />}
			</div>

			<div className="flex flex-col gap-1.5">
				<Label text="Color" />
				<div className="flex flex-wrap items-center gap-2">
					{LINK_COLORS.map(c => (
						<Choice key={c} on={color.toLowerCase() === c} onClick={() => setColor(c)} label={c} className="size-8 rounded-full! p-0.5 bg-transparent!">
							<span className={`size-full rounded-full ring-2 ${color.toLowerCase() === c ? "ring-(--accent)" : "ring-[#ffffff20]"}`} style={{ backgroundColor: c }} />
						</Choice>
					))}
					{/* A native color picker under a rainbow swatch for anything else. */}
					<label ref={pickRef} {...pickAttrs} className={`relative size-8 rounded-full cursor-pointer ring-2 ${LINK_COLORS.includes(color.toLowerCase()) ? "ring-[#ffffff20]" : "ring-(--accent)"} bg-[conic-gradient(#ff4242,#ffd95c,#3ddc84,#0079d3,#9a5ae7,#ff4242)]`}>
						<input type="color" value={color.length === 4 ? `#${[...color.slice(1)].map(x => x + x).join("")}` : color} onChange={e => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
					</label>
				</div>
			</div>

			<div className="flex items-center gap-2 pt-1">
				{editing && (
					<button
						type="button"
						onClick={() => {
							removeLink(index);
							closeModal();
						}}
						className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-red-400 hover:bg-red-500/15 cursor-pointer duration-150"
					>
						<TrashIcon className="size-4" />
						<HolyText text="Remove" />
					</button>
				)}
				<span className="flex-1" />
				<button type="button" onClick={closeModal} className="px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#ffffff10] cursor-pointer duration-150">
					<HolyText text="Cancel" />
				</button>
				<button type="submit" disabled={!valid} className="px-4 py-2.5 rounded-xl text-sm font-bold bg-(--accent) text-white disabled:opacity-40 cursor-pointer disabled:cursor-default duration-150">
					<HolyText text={editing ? "Save" : "Add"} />
				</button>
			</div>
		</form>
	);
};
