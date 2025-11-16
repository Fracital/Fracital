import {
	Cog6ToothIcon,
	ArrowsPointingOutIcon,
	ArrowsPointingInIcon,
	ChevronUpDownIcon,
	ChevronDownIcon,
	UserCircleIcon,
	ArrowLeftStartOnRectangleIcon,
	InformationCircleIcon,
	LifebuoyIcon,
	UserIcon,
	HomeIcon,
	ArrowPathIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	FolderIcon,
	StarIcon as StarIconSolid,
} from "@heroicons/react/24/solid";
import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import { FireIcon, WrenchScrewdriverIcon, CheckBadgeIcon } from "@heroicons/react/24/solid";
import { Suspense, useEffect, useState, useRef } from "react";
import { ShellButton } from "../components/ShellButton";
import { useTabsStore, useSettingsStore } from "../store";
import { createId } from "@paralleldrive/cuid2";
import { Search } from "../components/Search";
import { navigationEvent } from "../libs/eventBus";
import type { linkProps } from "../views/Home";

import { useModal } from "../components/Modal/ModalContext";
import FavoriteModal from "../components/Modal/Favorite";
import { Modal } from "../components/Modal/Modal";
import { changeProxy, getProxy } from "../types";

declare global {
	interface Window {
		$scramjetVersion: any;
		$scramjetLoadController: any;
	}
}

interface UserProps {
	id: string;
	display: string;
	handle: string;
	avatar: string | React.ReactNode;
}

export const UserCard = ({ id, display, handle, avatar }: UserProps) => {
	const [contextOpen, setContextOpen] = useState<boolean>(false);

	const settings = useSettingsStore(state => state.settings);
	const [isAmplified, setIsAmplified] = useState<boolean>(false);
	const [isVerified, setIsVerified] = useState<boolean>(false);
	const [isDev, setIsDev] = useState<boolean>(false);

	const accountRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleElseClick = (e: MouseEvent) => {
			if (e.target !== menuRef.current && e.target !== accountRef.current) {
				setContextOpen(false);
			}
		};

		window.addEventListener("mousedown", handleElseClick);
	}, []);

	return (
		<>
			<div
				className="relative flex flex-col gap-2.5 h-7"
				onClick={() => {
					contextOpen === true ? setContextOpen(false) : setContextOpen(true);
				}}
			>
				<div ref={accountRef} className="group flex gap-2.5 items-center cursor-pointer *:pointer-events-none" title={display + "\n@" + handle}>
					<ChevronDownIcon
						className={
							"text-(--text-tertiary) group-hover:text-(--text-primary) size-5 stroke-2 stroke-current group-hover:translate-y-0.5 pointer-events-none duration-200" +
							" " +
							`
                        ${contextOpen ? "-rotate-180" : ""}
                    `
						}
					/>
					<Suspense fallback={<UserCircleIcon className="size-7 text-(--text-secondary) pointer-events-none" />}>{typeof avatar === "string" ? <img src={avatar} alt={`${display}'s avatar`} className="size-7 rounded-full pointer-events-none select-none" /> : avatar}</Suspense>
				</div>
				<div
					ref={menuRef}
					className={
						"absolute flex flex-col items-center gap-1 top-[calc(20px+28px)] -right-3 bg-(--secondary) inset-shadow-(--inset-shadow-secondary) rounded-xl z-10 duration-150 overflow-hidden" +
						" " +
						`
                    ${contextOpen ? "" : "-translate-y-2 opacity-0 pointer-events-none"}
                `
					}
				>
					<div
						className={
							"flex flex-col w-full last:rounded-b-md p-1.5 pb-0 overflow-hidden duration-500" +
							" " +
							`
                        ${contextOpen ? "" : "-translate-y-2 opacity-0"}
                    `
						}
					>
						<button
							className={
								"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" +
								" " +
								`
                            ${settings.brightness === "light" ? "hover:bg-[#00000018]" : "hover:bg-[#ffffff10]"}
                        `
							}
						>
							<span className="text-md font-semibold leading-none w-max">Manage Account</span>
							<UserIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
						</button>
						<button
							className={
								"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" +
								" " +
								`
                            ${settings.brightness === "light" ? "hover:bg-[#00000018]" : "hover:bg-[#ffffff10]"}
                        `
							}
						>
							<span className="text-md font-semibold leading-none w-max">Privacy Policy</span>
							<InformationCircleIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
						</button>
						<button
							className={
								"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" +
								" " +
								`
                            ${settings.brightness === "light" ? "hover:bg-[#00000018]" : "hover:bg-[#ffffff10]"}
                        `
							}
						>
							<span className="text-md font-semibold leading-none w-max">Help</span>
							<LifebuoyIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
						</button>
						<button
							className={
								"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" +
								" " +
								`
                            ${settings.brightness === "light" ? "hover:bg-[#00000018] hover:text-[#ff5656] hover:text-shadow-[0_0_6px_#00000040]" : "hover:bg-[#ffffff10] hover:text-[#d03b3b]"}
                        `
							}
						>
							<span className="text-md font-semibold leading-none w-max">Logout</span>
							<ArrowLeftStartOnRectangleIcon className="size-5.5 stroke-0.5 stroke-current group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
						</button>
					</div>
					<div className="flex p-1.5 pt-0 w-full">
						<div
							className={
								"flex justify-between items-center gap-6 w-full rounded-lg bg-(--tertiary) overflow-hidden" +
								" " +
								`
                            ${settings.brightness === "light" ? "" : ""}
                        `
							}
						>
							<div
								className="group relative flex p-1.5 items-center gap-2.5 cursor-copy"
								onMouseDown={() => {
									navigator.clipboard.writeText(`@${handle}`);
								}}
							>
								<span className="font-bold text-lg text-(--text-tertiary) rounded-lg p-1 translate-y-0 group-hover:-translate-y-1 group-hover:opacity-0 opacity-100 group-hover:text-(--text-primary) leading-none pointer-events-none duration-150">{display}</span>
								<span className="absolute text-(--text-secondary) p-1 translate-y-2 group-hover:translate-y-0 group-hover:opacity-100 opacity-0 font-semibold leading-none pointer-events-none duration-200">@{handle}</span>
							</div>
							<div className="flex items-center pr-1">
								{isVerified && (
									<CheckBadgeIcon
										className={
											"size-7 p-1 rounded-md stroke-0.5 duration-150" +
											" " +
											`
                                            ${settings.brightness === "light" ? "text-[#9fc8ff] hover:bg-[#ffffff30]" : "text-[#398fff] hover:bg-[#ffffff18]"}
                                        `
										}
										title="Verified User"
									/>
								)}
								{isAmplified && (
									<FireIcon
										className={
											"size-7 p-1 rounded-md duration-150" +
											" " +
											`
                                            ${settings.brightness === "light" ? "text-[#d74040] hover:bg-[#ffffff30]" : "text-[#fb6262] hover:bg-[#ffffff18]"}
                                        `
										}
										title="Amplified since null"
									/>
								)}
								{isDev && (
									<WrenchScrewdriverIcon
										className={
											"size-7 p-1.5 rounded-md duration-150" +
											" " +
											`
                                            ${settings.brightness === "light" ? "text-[#eef370] hover:bg-[#ffffff30]" : "text-[#dbe050] hover:bg-[#ffffff18]"}
                                        `
										}
										title="Developer: null items"
									/>
								)}
								{!(isVerified && isAmplified && isDev) && <span className="text-xs font-medium text-[#ffffff68] cursor-default pr-1.5">No Badges</span>}
							</div>
						</div>
					</div>
				</div>
			</div>
		</>
	);
};

const Shell = () => {
	const newTab = useTabsStore(state => state.newTab);
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const updateTab = useTabsStore(state => state.updateTab);

	const settings = useSettingsStore(state => state.settings);

	const [proxy, setProxy] = useState<"uv" | "sj">("uv");

	const navButtonsRef = useRef<HTMLDivElement>(null);
	const uvRef = useRef<HTMLDivElement>(null);
	const sjRef = useRef<HTMLDivElement>(null);

	const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));

	const [uvVersion] = useState("v3.2.10");
	const [sjVersion] = useState(window.parent.$scramjetVersion.version);

	const { openModal } = useModal();
	const [isFavorited, setIsFavorited] = useState<boolean>(false);

	useEffect(() => {
		const handleFullscreenChange = () => {
			setIsFullscreen(Boolean(document.fullscreenElement));
		};
		window.addEventListener("fullscreenchange", handleFullscreenChange);
		const checkFavorited = () => {
			const currLinks = JSON.parse(window.localStorage.getItem("quicklinks") || "[]");
			const hrefs = currLinks.map((link: linkProps) => link.href);
			setIsFavorited(currentTab?.url ? hrefs.includes(currentTab.url) : false);
		};

		checkFavorited();

		const handleLinksUpdate = () => {
			setTimeout(checkFavorited, 0);
		};

		window.addEventListener("links-upd", handleLinksUpdate);

		window.addEventListener("storage", checkFavorited);

		return () => {
			window.removeEventListener("links-upd", handleLinksUpdate);
			window.removeEventListener("storage", checkFavorited);
			window.removeEventListener("fullscreenchange", handleFullscreenChange);
		};
	}, [currentTab?.url]);

	const handleProxyChange = async (e: Event) => {
		const customEvent = e as CustomEvent;
		const newProxy = customEvent.detail.proxy;
		if (newProxy === "sj" || newProxy === "uv") {
			setProxy(newProxy);
			await changeProxy(newProxy);
		}
	};

	useEffect(() => {
		const getProx = async () => {
			const proxy = await getProxy();
			setProxy(proxy);
		};
		getProx();
	}, []);

	useEffect(() => {
		window.addEventListener("proxy-change", handleProxyChange);
		return () => {
			window.removeEventListener("proxy-change", handleProxyChange);
		};
	}, []);

	return (
		<div id="shell" className={"flex justify-between gap-2.5 p-1 rounded-xl duration-200"}>
			<div className="flex items-center justify-start gap-2.5">
				<div className="relative flex items-center justify-center gap-0.5">
					<button
						className="group relative flex items-center justify-center mr-1 cursor-pointer"
						title={`Home - Go to the homepage`}
						onMouseDown={() => {
							if (currentTab) {
								updateTab(currentTab.id, {
									url: "about:newtab",
									displayUrl: "about:newtab",
									title: "New Tab",
									icon: null,
								});
							}
						}}
					>
						<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-9 group-hover:-translate-y-1 group-hover:opacity-0 duration-150 pointer-events-none">
							<circle cx="64" cy="64" r="64" className="fill-(--logo-primary)" />
							<path
								fillRule="evenodd"
								clipRule="evenodd"
								d="M64 0C99.3462 0 128 28.6538 128 64C128 99.3462 99.3462 128 64 128C28.6538 128 0 99.3462 0 64C0 28.6538 28.6538 0 64 0ZM64 7C32.5198 7 7 32.5198 7 64C7 95.4802 32.5198 121 64 121C95.4802 121 121 95.4802 121 64C121 32.5198 95.4802 7 64 7Z"
								fill="white"
								fillOpacity="0.5"
							/>
							<path d="M51 87V41H81V51.5H62.1278V59.75H78.9222L76.5 70.25H62.1278V85L51 87Z" className="fill-(--logo-secondary)" />
						</svg>
						<HomeIcon
							className={
								"absolute size-7 text-(--text-secondary) opacity-0 translate-y-1 group-hover:text-(--text-primary) group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none duration-150" +
								" " +
								`
                            ${settings.brightness === "light" ? "text-(--text-secondary)" : "text-(--text-primary)"}
                        `
							}
						/>
					</button>
					<div ref={navButtonsRef} className={`flex items-center justify-center gap-0.5 duration-150`}>
						<button
							className={
								"group size-8 p-1 rounded-md cursor-pointer duration-150" +
								" " +
								`
							${settings.brightness === "light" ? "text-(--text-tertiary) hover:text-(--text-primary) hover:bg-[#00000018]" : "text-(--text-primary) hover:text-(--text-secondary) hover:bg-[#ffffff10]"}
						`
							}
							title="Refresh Page"
							onClick={() => {
								window.dispatchEvent(
									new CustomEvent("reload-tab", {
										detail: {
											tab: tabs.find(tab => tab.current)?.id ?? null,
										},
									}),
								);
							}}
						>
							<ArrowPathIcon className={"size-full stroke-current stroke-1 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) group-hover:rotate-180 duration-300"} />
						</button>
						<button
							className={
								"group size-8 p-1 rounded-md cursor-pointer duration-150" +
								" " +
								`
                            ${settings.brightness === "light" ? "text-(--text-tertiary) hover:text-(--text-primary) hover:bg-[#00000018]" : "text-(--text-primary) hover:text-(--text-secondary) hover:bg-[#ffffff10]"}
                        `
							}
							title="Go back"
							onClick={() => {
								const currTab = tabs.find(tab => tab.current);
								if (!currTab) return;
								const currTabId = currTab.id;
								const currentIndex = useTabsStore.getState().getHistoryIndex(currTabId);
								if (currentIndex <= 0) return;
								const history = useTabsStore.getState().getHistory(currTabId);
								if (!history || history.length < 2) return;
								const target = history[currentIndex - 1];
								if (!target) return;
								useTabsStore.getState().setHistoryIndex(currTabId, currentIndex - 1);
								navigationEvent({
									url: target.url,
									icon: target.icon,
									title: target.title,
									displayUrl: target.displayUrl ?? target.url,
									id: currTabId,
									isHistoryNavigation: true,
								} as any);
							}}
						>
							<ArrowLeftIcon className={"size-full stroke-current stroke-1 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) duration-300"} />
						</button>
						<button
							className={
								"group size-8 p-1 rounded-md cursor-pointer duration-150" +
								" " +
								`
                            ${settings.brightness === "light" ? "text-(--text-tertiary) hover:text-(--text-primary) hover:bg-[#00000018]" : "text-(--text-primary) hover:text-(--text-secondary) hover:bg-[#ffffff10]"}
                        `
							}
							title="Go forward"
							onClick={() => {
								const currTab = tabs.find(tab => tab.current);
								if (!currTab) return;
								const currTabId = currTab.id;
								const history = useTabsStore.getState().getHistory(currTabId);
								if (!history || history.length < 2) return;
								const currentIndex = useTabsStore.getState().getHistoryIndex(currTabId);
								if (currentIndex >= history.length - 1) return;
								const target = history[currentIndex + 1];
								if (!target) return;
								useTabsStore.getState().setHistoryIndex(currTabId, currentIndex + 1);
								navigationEvent({
									url: target.url,
									icon: target.icon,
									title: target.title,
									displayUrl: target.displayUrl ?? target.url,
									id: currTabId,
									isHistoryNavigation: true,
								} as any);
							}}
						>
							<ArrowRightIcon className={"size-full stroke-current stroke-1 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) duration-300"} />
						</button>
						<button
							className={
								"group size-8 p-1 rounded-md cursor-pointer duration-150" +
								" " +
								`
                            ${settings.brightness === "light" ? "text-(--text-tertiary) hover:text-(--text-primary) hover:bg-[#00000018]" : "text-(--text-primary) hover:text-(--text-secondary) hover:bg-[#ffffff10]"}
                        `
							}
							title={isFavorited ? "Remove from favorites" : "Add to favorites"}
							onClick={async () => {
								const currLinks = JSON.parse(window.localStorage.getItem("quicklinks") || "[]");

								if (isFavorited && currentTab?.url) {
									const idx = currLinks.findIndex((l: linkProps) => l.href === currentTab?.url);
									if (idx !== -1) {
										currLinks.splice(idx, 1);
									}
									window.localStorage.setItem("quicklinks", JSON.stringify(currLinks));
									window.dispatchEvent(new Event("links-upd"));
									setIsFavorited(false);
								} else {
									openModal(
										<Modal>
											<FavoriteModal />
										</Modal>,
										{
											url: currentTab?.url,
											name: currentTab?.title,
											icon: currentTab?.icon,
										},
									);
								}
							}}
						>
							{isFavorited ? (
								<StarIconSolid className={"size-full text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) duration-300"} />
							) : (
								<StarIconOutline className={"size-full stroke-current stroke-2 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) duration-300"} />
							)}
						</button>
					</div>
				</div>
				<div className="relative flex items-center justify-center">{tabs && tabs.length > 0 ? tabs.map((tab, index) => <Search tab={tab} key={index} />) : <Search />}</div>
			</div>
			<div className="flex items-center justify-end gap-2.5">
				<div
					className={
						"group relative flex justify-center items-center min-h-5 p-2 px-3 gap-1 rounded-full bg-(--secondary) cursor-pointer duration-200" +
						" " +
						`
                    inset-shadow-(--inset-shadow-secondary)
                    hover:inset-shadow-[0_0_0_2px_var(--accent)]
                `
					}
					onMouseDown={() => {
						window.dispatchEvent(
							new CustomEvent("proxy-change", {
								detail: {
									proxy: proxy === "uv" ? "sj" : "uv",
								},
							}),
						);
					}}
				>
					<div className="flex items-center overflow-hidden h-5">
						<div
							className={
								"flex flex-col items-start gap-2 h-4.5 duration-150" +
								" " +
								`
                            ${proxy === "uv" ? "" : "-translate-y-6.5 pointer-events-none"}
                        `
							}
						>
							<div ref={uvRef} className={"flex items-center justify-center gap-2 duration-150"}>
								<span className="text-(--text-secondary) group-hover:text-(--text-primary) font-bold text-lg duration-150">UV</span>
								<span className="text-(--text-tertiary) group-hover:text-(--text-primary) font-semibold duration-150">{uvVersion}</span>
							</div>
							<div
								ref={sjRef}
								className={
									"flex items-center justify-center gap-2 duration-150" +
									" " +
									`
                                ${proxy === "sj" ? "" : "absolute opacity-0 pointer-events-none"}
                            `
								}
							>
								<span className="text-(--text-secondary) group-hover:text-(--text-primary) font-bold text-lg duration-150">Scramjet</span>
								<span className="text-(--text-tertiary) group-hover:text-(--text-primary) font-semibold duration-150">{sjVersion}</span>
							</div>
						</div>
					</div>
					<ChevronUpDownIcon className="size-5 text-(--text-tertiary) group-hover:text-(--text-secondary) stroke-current stroke-1 cursor-pointer duration-150" />
				</div>
				<ShellButton
					title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
					onClick={() => {
						if (document.fullscreenElement) {
							document.exitFullscreen();
						} else {
							if (document.body) {
								document.body.requestFullscreen().catch(err => {
									console.error("Error attempting to enable full-screen mode:", err);
								});
							}
						}
					}}
				>
					{isFullscreen ? <ArrowsPointingInIcon className="size-6 text-current stroke-current stroke-0.5" /> : <ArrowsPointingOutIcon className="size-6 text-current stroke-current stroke-0.5" />}
				</ShellButton>
				{/* <ShellButton title="File Manager" type="icon" icon={<FolderIcon className="size-6" />} onClick={() =>
					newTab({
						id: createId(),
						title: "File Manager",
						url: "about:files",
						icon: <FolderIcon className="size-5" />,
						displayUrl: "about:files",
					})
				}></ShellButton> */}
				<ShellButton
					title="Settings"
					onClick={() =>
						newTab({
							id: createId(),
							title: "Settings",
							url: "about:settings",
							icon: <Cog6ToothIcon className="size-5" />,
							displayUrl: "about:settings",
						})
					}
				>
					<Cog6ToothIcon className="size-6" />
				</ShellButton>
				{/* <UserCard avatar={
                    <UserCircleIcon className={"size-8" + " " + `
                        ${
                            settings.brightness === "light" ? "text-(--text-secondary)" : "text-(--text-primary)"
                        }
                    `} />
                } id="anon" display="Guest" handle="anon" /> */}
			</div>
		</div>
	);
};

export default Shell;
