import { useRef, useState } from "react";
import { useModal } from "./ModalContext";
import { useSettingsStore } from "../../store";
import { ArrowLeftCircleIcon, BriefcaseIcon, CheckCircleIcon, GifIcon, GiftIcon, GlobeAltIcon, MusicalNoteIcon, NewspaperIcon, PlusCircleIcon, PuzzlePieceIcon, ShoppingBagIcon } from "@heroicons/react/24/solid";
import type { linkProps } from "../../views/Home";

interface FavoriteProps {
	data: {
		url: string;
		name: string;
		color: string;
		icon: string;
	};
	open: boolean;
	setOpen: () => void;
	onClose: () => void;
	onSave: (data: { url: string; name: string; color: string; icon: string }) => void;
}

const FavoriteModal = () => {
	const settings = useSettingsStore(state => state.settings);
	const { closeModal, data } = useModal();
	const viewRef = useRef<HTMLDivElement>(null);
	const previewRef = useRef<HTMLDivElement>(null);
	const colorRef = useRef<HTMLDivElement>(null);
	const iconRef = useRef<HTMLDivElement>(null);

	const colorsCards = ["#ffffff", "#ff4500", "#0079d3", "#f4c430"];
	const randomColor = Math.floor(Math.random() * colorsCards.length);
	const [selecting, setSelecting] = useState<"color" | "icon" | "preview">("preview");
	const [color, setColor] = useState<string>(colorsCards[randomColor]);
	const [icon, setIcon] = useState<string>(typeof data.icon === "string" ? data.icon : "");
	const [name, setName] = useState<string>(data.name ?? "");
	const [url, setUrl] = useState<string>(data.url ?? "");

	return (
		<div className="flex flex-col w-full gap-4">
			<div className="flex flex-col gap-2 p-1 leading-none">
				<div className="relative flex flex-col items-center justify-center min-w-35 min-h-50 gap-6">
					<div
						ref={previewRef}
						className={
							"flex flex-col justify-center gap-2 duration-150" +
							" " +
							`
                        ${selecting !== "preview" ? "absolute opacity-0 scale-50 pointer-events-none" : ""}
                    `
						}
					>
						<div className="grid grid-cols-3 grid-rows-1 w-85 h-25 gap-2">
							<div className="grid grid-cols-3 col-span-3 grid-rows-1 row-span-1 gap-2">
								<div
									className={
										"group relative flex items-center justify-center col-span-1 rounded-lg overflow-hidden cursor-pointer" +
										" " +
										`
                                    ${color === "#ffffff" ? "text-[black]" : ""}
                                `
									}
									onClick={() => {
										setSelecting("icon");
									}}
								>
								<div className="absolute flex size-full opacity-100 group-hover:opacity-80 duration-150" style={{ backgroundColor: color }}></div>
								{icon === "gifticon" ? (
									<GiftIcon className="size-10 z-10" />
								) : icon === "musicalicon" ? (
									<MusicalNoteIcon className="size-10 z-10" />
								) : icon === "puzzleicon" ? (
									<PuzzlePieceIcon className="size-10 z-10" />
								) : icon === "shoppingicon" ? (
									<ShoppingBagIcon className="size-10 z-10" />
								) : icon === "brieficon" ? (
									<BriefcaseIcon className="size-10 z-10" />
								) : icon === "newspapericon" ? (
									<NewspaperIcon className="size-10 z-10" />
								) : typeof icon === "string" && icon.includes("https://") ? (
									<img src={icon} alt={data.name} className="size-10 z-10" />
								) : (
									<GlobeAltIcon className="size-10 z-10" />
								)}
								</div>
								<div
									className={"group flex items-center justify-center col-span-2 rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"}
									style={{ backgroundColor: color }}
									onClick={() => {
										setSelecting("color");
									}}
								>
									<span
										className={
											"text-lg font-semibold opacity-0 group-hover:opacity-100 duration-150" +
											" " +
											`
                                        ${color === "#ffffff" ? "text-black" : ""}
                                    `
										}
									>
										Color
									</span>
								</div>
							</div>
						</div>
						<div
							className={
								"flex flex-col items-center justify-center row-span-3 col-span-3 h-22 gap-2 rounded-lg" +
								" " +
								`
                            ${settings.brightness === "dark" ? "bg-[#ffffff20] hover:bg-[#ffffff30] cursor-pointer duration-150" : ""}
                        `
							}
							onClick={() => {
								var namePrompt = "";
								window.fr.dialog.prompt({
									title: "Enter Name",
									message: "Enter site name, hit enter to skip",
									defaultValue: name,
									onOk: (res: string) => {
										namePrompt = res;
									},
								});
								if (namePrompt) {
									if (namePrompt !== "") {
										setName(namePrompt);
									}
								}
								var urlPrompt = "";
								window.fr.dialog.prompt({
									title: "Enter URL",
									message: "Enter site url, hit enter to skip",
									defaultValue: url,
									onOk: (res: string) => {
										urlPrompt = res;
									},
								});
								if (urlPrompt) {
									if (urlPrompt === "") setSelecting("preview");
									else {
										setUrl(urlPrompt);
										setSelecting("preview");
									}
								}
							}}
						>
							<div className="flex flex-col">
								<span className="text-xl font-semibold">Name: {name}</span>
								<span className="text-xl font-semibold">URL: {url}</span>
							</div>
						</div>
					</div>
					<div
						ref={colorRef}
						className={
							"flex flex-col items-center justify-center gap-3 duration-150" +
							" " +
							`
                        ${selecting !== "color" ? "absolute opacity-0 scale-50 pointer-events-none" : ""}
                    `
						}
					>
						<div
							className={
								"grid grid-cols-3 w-100 h-45 p-2 rounded-xl gap-2" +
								" " +
								`
                            ${settings.brightness === "dark" ? "bg-[#ffffff10] inset-shadow-[0_0_0_2px_#ffffff10]" : ""}
                        `
							}
						>
							<div className="row-span-2 col-span-2 grid grid-cols-2 grid-rows-2 gap-2">
								<div
									className="group flex items-center justify-center bg-[#ffffff] text-black rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setColor("#ffffff");
										setSelecting("preview");
									}}
								>
									<CheckCircleIcon className="size-8 opacity-0 group-hover:opacity-100 duration-150" />
								</div>
								<div
									className="group flex items-center justify-center bg-[#ff4500] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setColor("#ff4500");
										setSelecting("preview");
									}}
								>
									<CheckCircleIcon className="size-8 opacity-0 group-hover:opacity-100 duration-150" />
								</div>
								<div
									className="group flex items-center justify-center bg-[#0079d3] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setColor("#0079d3");
										setSelecting("preview");
									}}
								>
									<CheckCircleIcon className="size-8 opacity-0 group-hover:opacity-100 duration-150" />
								</div>
								<div
									className="group flex items-center justify-center bg-[#f4c430] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setColor("#f4c430");
										setSelecting("preview");
									}}
								>
									<CheckCircleIcon className="size-8 opacity-0 group-hover:opacity-100 duration-150" />
								</div>
							</div>
							<div
								className="group flex items-center justify-center col-span-1 row-span-2 bg-[#ffffff20] rounded-md opacity-90 hover:opacity-100 cursor-pointer duration-150"
								onClick={() => {
									const cpe = document.createElement("input");
									cpe.value = color;
									cpe.type = "color";
									cpe.click();

									cpe.addEventListener("input", e => {
										const value = (e.target as HTMLInputElement).value;
										setColor(value);
									});
									cpe.addEventListener("change", e => {
										const value = (e.target as HTMLInputElement).value;
										setColor(value);
									});
									cpe.addEventListener("blur", () => cpe.remove());
									setSelecting("preview");
								}}
							>
								<PlusCircleIcon className="size-8 opacity-80 group-hover:opacity-100 duration-150" />
							</div>
						</div>
					</div>
					<div
						ref={iconRef}
						className={
							"flex flex-col items-center justify-center gap-3 duration-150" +
							" " +
							`
                        ${selecting !== "icon" ? "absolute opacity-0 scale-50 pointer-events-none" : ""}
                    `
						}
					>
						<div className="grid grid-cols-8 w-90 h-40 gap-2">
							<div className="row-span-2 col-span-6 grid grid-cols-3 grid-rows-2 gap-2">
								<div
									className="group flex items-center justify-center bg-[#ffffff50] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setIcon("gifticon");
									}}
								>
									<GiftIcon className="size-8 opacity-80 group-hover:opacity-100 duration-150" />
								</div>
								<div
									className="group flex items-center justify-center bg-[#ffffff50] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setIcon("musicalicon");
										setSelecting("preview");
									}}
								>
									<MusicalNoteIcon className="size-8 opacity-80 group-hover:opacity-100 duration-150" />
								</div>
								<div
									className="group flex items-center justify-center bg-[#ffffff50] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setIcon("puzzleicon");
										setSelecting("preview");
									}}
								>
									<PuzzlePieceIcon className="size-8 opacity-80 group-hover:opacity-100 duration-150" />
								</div>
								<div
									className="group flex items-center justify-center bg-[#ffffff50] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setIcon("shoppingicon");
										setSelecting("preview");
									}}
								>
									<ShoppingBagIcon className="size-8 opacity-80 group-hover:opacity-100 duration-150" />
								</div>
								<div
									className="group flex items-center justify-center bg-[#ffffff50] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setIcon("brieficon");
										setSelecting("preview");
									}}
								>
									<BriefcaseIcon className="size-8 opacity-80 group-hover:opacity-100 duration-150" />
								</div>
								<div
									className="group flex items-center justify-center bg-[#ffffff50] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
									onClick={() => {
										setIcon("newspapericon");
										setSelecting("preview");
									}}
								>
									<NewspaperIcon className="size-8 opacity-80 group-hover:opacity-100 duration-150" />
								</div>
							</div>
							<div
								className="group flex items-center justify-center row-span-2 w-25 bg-[#ffffff20] rounded-lg opacity-90 hover:opacity-100 cursor-pointer duration-150"
								onClick={() => {
									var askUrl = "";
									window.fr.dialog.prompt({
										title: "Change Icon URL",
										message: "Enter the url for your image, hit enter to skip",
										onOk: (res: string) => {
											askUrl = res;
										},
									});
									if (askUrl) {
										if (askUrl === "") setSelecting("preview");
										else {
											setIcon(askUrl);
											setSelecting("preview");
										}
									} else {
										setSelecting("preview");
									}
								}}
							>
								<PlusCircleIcon className="size-8 opacity-80 group-hover:opacity-100 duration-150" />
							</div>
						</div>
					</div>
				</div>
			</div>
			<div className="flex items-center w-full">
				<button
					onClick={closeModal}
					className={
						"flex p-2.5 px-3 leading-none rounded-lg cursor-pointer duration-150" +
						" " +
						`
                    ${settings.brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000028]"}
                `
					}
				>
					Cancel
				</button>
				<div className={"flex justify-center w-full"}>
					<button
						className={
							"cursor-pointer duration-150" +
							" " +
							`
                        ${selecting !== "preview" ? "opacity-80 hover:opacity-100" : "scale-70 opacity-0 pointer-events-auto"}
                    `
						}
						onClick={() => {
							setSelecting("preview");
						}}
					>
						<ArrowLeftCircleIcon className="size-8" />
					</button>
				</div>
				<button
					onClick={() => {
						const currLinks = JSON.parse(window.localStorage.getItem("quicklinks") || "[]");
						const newLink: linkProps = {
							title: name,
							icon: icon && icon.trim() !== "" ? icon : "default",
							color: color && color.trim() !== "" ? color : "#ffffff",
							href: url,
						};
						currLinks.push(newLink);
						window.localStorage.setItem("quicklinks", JSON.stringify(currLinks));
						window.dispatchEvent(new Event("links-upd"));
						closeModal();
					}}
					className={
						"flex p-2.5 px-3 leading-none rounded-lg cursor-pointer duration-150" +
						" " +
						`
                    ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000028]"}
                    hover:bg-(--accent)
                `
					}
				>
					Save
				</button>
			</div>
		</div>
	);
};

export default FavoriteModal;
