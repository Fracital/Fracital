import { useRef, useEffect, useState } from "react";
import { navigationEvent } from "../libs/eventBus";
import { TrashIcon, PencilSquareIcon, GlobeAltIcon, GiftIcon, MusicalNoteIcon, PuzzlePieceIcon, ShoppingBagIcon, BriefcaseIcon, NewspaperIcon } from "@heroicons/react/24/solid";
import type { linkProps } from "../views/Home";
import { useTabsStore } from "../store";

/** URLs, site-relative paths ("/google.svg") and data URIs render as images. */
const isImageIcon = (icon: string) => /^(https?:\/\/|\/|data:image\/)/.test(icon);

interface LinkCardProps {
	title: string;
	icon: string;
	brightness: "light" | "dark";
	color: string;
	href: string;
	edit?: boolean;
	id?: number;
}

const LinkCard: React.FC<LinkCardProps> = ({ title, icon, brightness, color, href, id, edit }) => {
	const cardRef = useRef<HTMLDivElement>(null);
	const [value, setValue] = useState<string>(href || "");
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true) || { id: "" };

	useEffect(() => {
		cardRef.current?.style.setProperty("--color", color);
	}, [cardRef]);

	return (
		<>
			{edit ? (
				<div ref={cardRef} className="relative flex flex-col p-3 rounded-2xl bg-(--color) overflow-hidden duration-200">
					{edit && id !== undefined && (
						<div className="absolute top-2 right-2 flex gap-1 z-10">
							<button
								className={
									"cursor-pointer duration-150" +
									" " +
									`
                                    ${brightness === "dark" ? "text-[#00000098] hover:text-[#000000]" : "text-[#ffffffc7] hover:text-[#ffffff]"}
                                `
								}
								onMouseDown={() => {
									let linkname = "";
									let linkicon = "";
									let linkcolor = "";
									let linkurl = "";
									window.fr.dialog.prompt({
										title: "Create new Link",
										message: "Enter the name of the link:",
										onOk: (res: string) => {
											linkname = res;
										},
									});
									window.fr.dialog.prompt({
										title: "Create new Link",
										message: "Enter the URL of the icon for this link (leave empty for default):",
										defaultValue: typeof icon === "string" ? icon : "",
										onOk: (res: string) => {
											linkicon = res;
										},
									});
									window.fr.dialog.prompt({
										title: "Create new Link",
										message: "Enter the color for this link (leave empty for default):",
										defaultValue: color,
										onOk: (res: string) => {
											linkcolor = res;
										},
									});
									window.fr.dialog.prompt({
										title: "Create new Link",
										message: "Enter the URL for this link:",
										defaultValue: value,
										onOk: (res: string) => {
											linkurl = res;
										},
									});
									if (!linkname || linkname.trim() === "") return;
									if (!linkurl || linkurl.trim() === "") return;
									const newLink: linkProps = {
										title: linkname,
										icon: linkicon && linkicon.trim() !== "" ? linkicon : "default",
										color: linkcolor && linkcolor.trim() !== "" ? linkcolor : "#ffffff",
										href: linkurl,
									};
									const stored = window.localStorage.getItem("quicklinks");
									const links = stored ? JSON.parse(stored) : [];
									links[id] = newLink;
									window.localStorage.setItem("quicklinks", JSON.stringify(links));
									window.location.reload();
								}}
							>
								<PencilSquareIcon className="size-6" />
							</button>
							<button
								className={
									"cursor-pointer duration-150" +
									" " +
									`
                                    ${brightness === "dark" ? "text-[#00000098] hover:text-[#000000]" : "text-[#ffffffc7] hover:text-[#ffffff]"}
                                `
								}
								onMouseDown={() => {
									if (!confirm("Are you sure you want to delete this link?")) return;
									const stored = window.localStorage.getItem("quicklinks");
									const links = stored ? JSON.parse(stored) : [];
									links.splice(id, 1);
									window.localStorage.setItem("quicklinks", JSON.stringify(links));
									window.dispatchEvent(new Event("links-upd"));
								}}
							>
								<TrashIcon className="size-6" />
							</button>
						</div>
					)}
					<div className="*:select-none">
						<div
							className={
								"flex items-center justify-center py-5 px-22" +
								" " +
								`
                                ${color === "#ffffff" ? "text-black" : ""}
                            `
							}
						>
							{icon === "gifticon" ? (
								<GiftIcon className="sm:size-16 size-8" />
							) : icon === "musicalicon" ? (
								<MusicalNoteIcon className="sm:size-16 size-8" />
							) : icon === "puzzleicon" ? (
								<PuzzlePieceIcon className="sm:size-16 size-8" />
							) : icon === "shoppingicon" ? (
								<ShoppingBagIcon className="sm:size-16 size-8" />
							) : icon === "brieficon" ? (
								<BriefcaseIcon className="sm:size-16 size-8" />
							) : icon === "newspapericon" ? (
								<NewspaperIcon className="sm:size-16 size-8" />
							) : isImageIcon(icon) ? (
								<img src={icon} alt={title} className="sm:size-16 size-8" />
							) : (
								<GlobeAltIcon className="sm:size-16 size-8" />
							)}
						</div>
						<div className="flex flex-col w-full justify-center items-center gap-1">
							<span
								className={
									"font-extrabold text-lg leading-none" +
									" " +
									`
                                    ${brightness === "dark" ? "text-[#00000098]" : "text-[#ffffffc7]"}
                                `
								}
							>
								{title}
							</span>
							<span
								title={value}
								className={
									"font-extrabold text-lg leading-none z-10" +
									" " +
									`
                                    ${brightness === "dark" ? "text-[#00000070]" : "text-[#ffffff9a]"}
                                `
								}
							>
								{value.length > 30 ? value.slice(0, 20) + "..." : value}
							</span>
						</div>
					</div>
				</div>
			) : (
				<div
					ref={cardRef}
					className="group relative flex flex-col p-3 rounded-2xl bg-(--color) w-full min-w-0 h-[142px] overflow-hidden cursor-pointer duration-200"
					onClick={async () => {
						if (href) {
							navigationEvent({
								url: href,
								icon: icon,
								title: title,
								displayUrl: href,
								id: currentTab.id,
							});
						}
					}}
				>
					<div className="*:pointer-events-none *:select-none">
						{edit && id !== undefined && (
							<div className="absolute top-2 right-2 z-10">
								<button
									className={
										"cursor-pointer" +
										" " +
										`
                                        ${brightness === "dark" ? "text-[#00000098]" : "text-[#ffffffc7]"}
                                    `
									}
									onClick={() => {
										const stored = window.localStorage.getItem("quicklinks");
										const links = stored ? JSON.parse(stored) : [];
										links.splice(id, 1);
										window.localStorage.setItem("quicklinks", JSON.stringify(links));
										window.dispatchEvent(new Event("links-upd"));
										// Avoid full reload; listeners will update UI
									}}
								>
									<TrashIcon className="size-6" />
								</button>
							</div>
						)}
						<div
							className={
								"flex items-center justify-center py-5 px-2" +
								" " +
								`
                                ${color === "#ffffff" ? "text-black" : ""}
                            `
							}
						>
							{
								// icon === "default" ? (
								//     <GlobeAltIcon className="sm:size-16 size-8 text-(--text-secondary) group-hover:-translate-y-2 duration-200" />
								// ) :
								// typeof icon === "string" ? (<img src={icon} alt={title} className="sm:size-16 size-8 min-w-10 group-hover:-translate-y-2 duration-200" />) : (<>{icon}</>)
								icon === "gifticon" ? (
									<GiftIcon className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />
								) : icon === "musicalicon" ? (
									<MusicalNoteIcon className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />
								) : icon === "puzzleicon" ? (
									<PuzzlePieceIcon className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />
								) : icon === "shoppingicon" ? (
									<ShoppingBagIcon className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />
								) : icon === "brieficon" ? (
									<BriefcaseIcon className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />
								) : icon === "newspapericon" ? (
									<NewspaperIcon className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />
								) : isImageIcon(icon) ? (
									<img src={icon} alt={title} className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />
								) : (
									<GlobeAltIcon className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />
								)
							}
						</div>
						<div className="flex w-full justify-center">
							<span
								className={
									"font-extrabold text-lg leading-none truncate px-1" +
									" " +
									`
                                    ${brightness === "dark" ? "text-[#00000098]" : "text-[#ffffffc7]"}
                                `
								}
							>
								{title}
							</span>
						</div>
					</div>
				</div>
			)}
		</>
	);
};

export default LinkCard;
