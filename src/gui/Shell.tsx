import { openLibraryPage } from "../libs/aboutPages";
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
	FireIcon,
	WrenchScrewdriverIcon,
	CheckBadgeIcon,
	MusicalNoteIcon,
	PlayIcon,
	Bars3Icon,
	AdjustmentsVerticalIcon,
	EyeSlashIcon,
	LockClosedIcon,
	LockOpenIcon,
	CheckIcon,
} from "@heroicons/react/24/solid";
import { BarOpenHandle, BarSettingsMenu, useCollapsibleBar, useHoverReveal } from "../components/CollapsibleBar";
import { useHolyAttr } from "../libs/holy-attr";
import { appRoot } from "../libs/cloak";
import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import { Suspense, useEffect, useState, useRef } from "react";
import { ShellButton } from "../components/ShellButton";
import { useTabsStore, useSettingsStore, useTabLoadingStore } from "../store";
import { createId } from "@paralleldrive/cuid2";
import { Search } from "../components/Search";
import { navigationEvent } from "../libs/eventBus";
import type { linkProps } from "../views/Home";

import { useModal } from "../components/Modal/ModalContext";
import FavoriteModal from "../components/Modal/Favorite";
import { Modal } from "../components/Modal/Modal";
import { changeProxy, EXPERIMENTAL_PROXIES_SETTING, getLogin, getProxy, isProxyEngine, type ProxyEngine } from "../types";
import { useStompStore } from "../libs/stompEngine";
import { getMe, signOut } from "../libs/auth";
import { runtimeGlobal } from "../libs/proxyGlobals";
import { HolyText } from "../components/common/HolyText";
import { ShieldCheckIcon } from "@heroicons/react/24/solid";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";

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
	const newTab = useTabsStore(state => state.newTab);
	const [isAdmin, setIsAdmin] = useState(false);
	useEffect(() => {
		const load = () => void getMe().then(m => setIsAdmin(!!m?.isAdmin));
		load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, []);
	const menuItemCls = "group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer " + (settings.brightness === "light" ? "hover:bg-[#00000018]" : "hover:bg-[#ffffff10]");

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
							onClick={() => {
								newTab({
									id: createId(),
									url: "about:account",
									displayUrl: "about:account",
									title: "Fracital Account",
									icon: null,
									current: true,
								});
							}}
						>
							<span className="text-md font-semibold leading-none w-max">Manage Account</span>
							<UserIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
						</button>
						<button className={menuItemCls} onClick={() => newTab({ id: createId(), url: "about:artists", displayUrl: "about:artists", title: "Fracital for Artists", icon: null, current: true })}>
							<span className="text-md font-semibold leading-none w-max">For Artists</span>
							<CheckBadgeIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
						</button>
						{isAdmin && (
							<button className={menuItemCls} onClick={() => newTab({ id: createId(), url: "about:admin", displayUrl: "about:admin", title: "Admin Dashboard", icon: null, current: true })}>
								<span className="text-md font-semibold leading-none w-max">Admin Dashboard</span>
								<ShieldCheckIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
							</button>
						)}
						<button
							className={
								"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" +
								" " +
								`
                            ${settings.brightness === "light" ? "hover:bg-[#00000018]" : "hover:bg-[#ffffff10]"}
                        `
							}
							onClick={() => {
								newTab({
									id: createId(),
									// Absolute: on a decoy host a relative path would stay on the decoy, which doesn't serve it.
									url: "https://fracit.al/privacy",
									displayUrl: "https://fracit.al/privacy",
									title: "Privacy Policy",
									icon: null,
									current: true,
								});
							}}
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
							onClick={() => {
								newTab({
									id: createId(),
									url: "https://corporate.terbiumon.top/cloud/help",
									displayUrl: "https://corporate.terbiumon.top/cloud/help",
									title: "Account Help",
									icon: null,
									current: true,
								});
							}}
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
							onClick={async () => {
								await signOut();
							}}
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

/**
 * Below this bar width the right-hand buttons fold into one menu so the URL bar can fill the row (it only
 * caps its width on screens wide enough to show everything); below TINY_WIDTH the favorite star folds too.
 */
const COMPACT_WIDTH = 1180;
const TINY_WIDTH = 600;
const HOVER_PRESETS = [8, 24, 48, 96];

const Shell = () => {
	const newTab = useTabsStore(state => state.newTab);
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const updateTab = useTabsStore(state => state.updateTab);
	const currentTabLoading = useTabLoadingStore(state => (currentTab ? Boolean(state.loading[currentTab.id]) : false));

	const settings = useSettingsStore(state => state.settings);

	const [proxy, setProxy] = useState<ProxyEngine>("sj");
	const proxyUserChangedRef = useRef(false);

	const navButtonsRef = useRef<HTMLDivElement>(null);

	const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));

	const dark = settings.brightness !== "light";
	const bar = useCollapsibleBar("shellBar");
	const overlayRef = useRef<HTMLDivElement>(null);
	useHoverReveal({
		enabled: bar.autoHide,
		threshold: bar.threshold,
		target: () => document,
		frames: () => appRoot(),
		edge: () => 0,
		barBottom: () => {
			const overlay = overlayRef.current;
			if (!overlay) return 0;
			// While typing in the address bar its suggestions hang below the bar; don't hide it under them.
			const active = appRoot().activeElement;
			return active && overlay.contains(active) ? Number.POSITIVE_INFINITY : overlay.getBoundingClientRect().bottom;
		},
		setRevealed: bar.setRevealed,
	});
	const { ref: barSettingsRef, placeholder: barSettingsAttrs } = useHolyAttr({ title: "Top bar settings", "aria-label": "Top bar settings" });
	const { ref: pinRef, placeholder: pinAttrs } = useHolyAttr({ title: bar.pinned ? "Auto-hide the top bar" : "Keep the top bar open", "aria-label": bar.pinned ? "Auto-hide the top bar" : "Keep the top bar open" });
	const { ref: closeBarRef, placeholder: closeBarAttrs } = useHolyAttr({ title: "Hide the top bar", "aria-label": "Hide the top bar" });

	const [uvVersion] = useState("v3.2.10");
	const runtime = runtimeGlobal();
	const sjVersion = runtime?.versionInfo?.version ? `v${runtime.versionInfo.version}` : "";
	// The engines on offer: stomp only behind the experimental proxies setting.
	const experimentalProxies = settings[EXPERIMENTAL_PROXIES_SETTING] === true;
	const engines: ProxyEngine[] = experimentalProxies ? ["sj", "uv", "st"] : ["sj", "uv"];
	const shownProxy: ProxyEngine = engines.includes(proxy) ? proxy : "sj";
	const stompStatus = useStompStore(state => state.status);
	const stompStale = useStompStore(state => state.stale);
	// The controller's build string (version plus commit), known once it booted.
	const stompBuild = useStompStore(state => state.build) ?? "";
	// What the stomp row says next to its version: starting, failed, or ready on an older service worker.
	const stompState = stompStatus === "booting" ? "starting" : stompStatus === "failed" ? "failed" : stompStale ? "older worker" : null;

	const { openModal } = useModal();
	const [isFavorited, setIsFavorited] = useState<boolean>(false);
	const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; visible: boolean; items: MenuItem[]; align?: "start" | "end" }>(null);
	const [accountinfo, setAccountinfo] = useState<{ id: string; display: string; handle: string; avatar: string | React.ReactNode } | null>(null);

	useEffect(() => {
		const fetchAccountInfo = async () => {
			const accountInfo = await getLogin();
			setAccountinfo(accountInfo);
		};
		window.addEventListener("account-upd", fetchAccountInfo);
		fetchAccountInfo();
		return () => {
			window.removeEventListener("account-upd", fetchAccountInfo);
		};
	}, []);

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
		if (isProxyEngine(newProxy)) {
			proxyUserChangedRef.current = true;
			setProxy(newProxy);
			await changeProxy(newProxy);
		}
	};

	useEffect(() => {
		const getProx = async () => {
			if (window.appReady) await window.appReady.catch(() => undefined);
			const proxy = await getProxy();
			if (!proxyUserChangedRef.current) setProxy(proxy);
		};
		getProx();
	}, []);

	useEffect(() => {
		window.addEventListener("proxy-change", handleProxyChange);
		return () => {
			window.removeEventListener("proxy-change", handleProxyChange);
		};
	}, []);

	const toggleFavorite = () => {
		const currLinks = JSON.parse(window.localStorage.getItem("quicklinks") || "[]");
		if (isFavorited && currentTab?.url) {
			const idx = currLinks.findIndex((l: linkProps) => l.href === currentTab?.url);
			if (idx !== -1) currLinks.splice(idx, 1);
			window.localStorage.setItem("quicklinks", JSON.stringify(currLinks));
			window.dispatchEvent(new Event("links-upd"));
			setIsFavorited(false);
		} else {
			openModal(
				<Modal>
					<FavoriteModal />
				</Modal>,
				{ url: currentTab?.url, name: currentTab?.title, icon: currentTab?.icon },
			);
		}
	};

	const toggleFullscreen = () => {
		if (document.fullscreenElement) void document.exitFullscreen();
		else document.body?.requestFullscreen().catch(err => console.error("Error attempting to enable full-screen mode:", err));
	};

	const setEngine = (engine: ProxyEngine) => window.dispatchEvent(new CustomEvent("proxy-change", { detail: { proxy: engine } }));

	const openPage = (url: string, title: string, icon: React.ReactNode = null) => newTab({ id: createId(), url, displayUrl: url, title, icon, current: true });

	const rowRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
	const compact = width < COMPACT_WIDTH;
	const tiny = width < TINY_WIDTH;
	useEffect(() => {
		const el = rowRef.current;
		if (!el) return;
		const measure = () => setWidth(el.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		// Window resizes too, for browsers that throttle ResizeObserver (background or embedded views).
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [bar.inFlow, bar.autoHide, bar.open]);

	const [isAdmin, setIsAdmin] = useState(false);
	useEffect(() => {
		const load = () => void getMe().then(m => setIsAdmin(!!m?.isAdmin));
		load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, []);

	const engineName = (engine: ProxyEngine) => (engine === "st" ? <HolyText text="Stomp" /> : engine === "uv" ? "UV" : "Scramjet");
	const check = (on: boolean) => (on ? <CheckIcon className="size-4" /> : null);

	const compactMenu = (): MenuItem[] => {
		const items: MenuItem[] = [];
		if (accountinfo) {
			items.push({
				isHeader: true,
				icon: null,
				onClick: () => undefined,
				title: (
					// The account's own name and handle: data values.
					<div className="flex flex-col gap-1 leading-none">
						<span>{accountinfo.display}</span>
						<span className="text-xs font-medium text-(--text-tertiary)">@{accountinfo.handle}</span>
					</div>
				),
			});
		}
		if (tiny) {
			items.push({
				title: <HolyText text={isFavorited ? "Remove from favorites" : "Add to favorites"} />,
				icon: isFavorited ? <StarIconSolid className="size-5" /> : <StarIconOutline className="size-5" />,
				onClick: toggleFavorite,
			});
		}
		items.push(
			{
				title: (
					<span>
						<HolyText text="Proxy" />: {engineName(shownProxy)}
					</span>
				),
				icon: <ChevronUpDownIcon className="size-5" />,
				onClick: () => undefined,
				children: engines.map(engine => ({ title: engineName(engine), icon: check(engine === shownProxy), onClick: () => setEngine(engine) })),
			},
			{
				title: <HolyText text={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} />,
				icon: isFullscreen ? <ArrowsPointingInIcon className="size-5" /> : <ArrowsPointingOutIcon className="size-5" />,
				onClick: toggleFullscreen,
			},
			{
				title: <HolyText text="Top bar" />,
				icon: <AdjustmentsVerticalIcon className="size-5" />,
				onClick: () => undefined,
				children: [
					{ title: <HolyText text="Show on hover" />, icon: check(bar.mode === "hover"), onClick: () => bar.setMode("hover") },
					{ title: <HolyText text="Open/close button" />, icon: check(bar.mode === "button"), onClick: () => bar.setMode("button") },
					bar.mode === "hover"
						? { title: <HolyText text={bar.pinned ? "Auto-hide the top bar" : "Keep the top bar open"} />, icon: bar.pinned ? <LockOpenIcon className="size-4" /> : <LockClosedIcon className="size-4" />, onClick: () => bar.setPinned(!bar.pinned) }
						: { title: <HolyText text="Hide the top bar" />, icon: <EyeSlashIcon className="size-4" />, onClick: () => bar.setOpen(false) },
					...(bar.mode === "hover"
						? [
								{ isHeader: true, title: <HolyText text="Hover zone" />, icon: null, onClick: () => undefined },
								...HOVER_PRESETS.map(px => ({ title: `${px}px`, icon: check(bar.threshold === px), onClick: () => bar.setThreshold(px) })),
							]
						: []),
				],
			},
			{ title: <HolyText text="Settings" />, icon: <Cog6ToothIcon className="size-5" />, onClick: () => openPage("about:settings", "Settings", <Cog6ToothIcon className="size-5" />) },
			{ title: <HolyText text="File Manager" />, icon: <FolderIcon className="size-5" />, onClick: () => openPage("about:files", "File Manager", <FolderIcon className="size-4.5" />) },
			{ title: <HolyText text="Games" />, icon: <PlayIcon className="size-5" />, onClick: () => openPage("about:games", "Games", <PlayIcon className="size-4.5" />) },
			{ title: <HolyText text="Music" />, icon: <MusicalNoteIcon className="size-5" />, onClick: () => openLibraryPage("") },
		);
		if (accountinfo) {
			items.push(
				{ title: <HolyText text="Manage Account" />, icon: <UserIcon className="size-5" />, onClick: () => openPage("about:account", "Fracital Account") },
				{ title: <HolyText text="For Artists" />, icon: <CheckBadgeIcon className="size-5" />, onClick: () => openPage("about:artists", "Fracital for Artists") },
			);
			if (isAdmin) items.push({ title: <HolyText text="Admin Dashboard" />, icon: <ShieldCheckIcon className="size-5" />, onClick: () => openPage("about:admin", "Admin Dashboard") });
			items.push(
				// Absolute: on a decoy host a relative path would stay on the decoy, which doesn't serve it.
				{ title: <HolyText text="Privacy Policy" />, icon: <InformationCircleIcon className="size-5" />, onClick: () => openPage("https://fracit.al/privacy", "Privacy Policy") },
				{ title: <HolyText text="Help" />, icon: <LifebuoyIcon className="size-5" />, onClick: () => openPage("https://corporate.terbiumon.top/cloud/help", "Account Help") },
				{ title: <HolyText text="Logout" />, icon: <ArrowLeftStartOnRectangleIcon className="size-5" />, onClick: () => void signOut() },
			);
		} else {
			items.push({ title: <HolyText text="Sign in" />, icon: <UserCircleIcon className="size-5" />, onClick: () => openPage("about:account", "Fracital Account") });
		}
		return items;
	};

	const { ref: menuTriggerRef, placeholder: menuTriggerAttrs } = useHolyAttr({ title: "Menu", "aria-label": "Menu" });
	const openCompactMenu = (e: React.MouseEvent<HTMLElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		// The menu keeps itself on screen, so anchoring at the right edge lines it up under the button.
		setContextMenu({ x: rect.right, y: rect.bottom + 8, visible: true, items: compactMenu(), align: "end" });
	};
	const compactTrigger = (
		<button ref={menuTriggerRef} {...menuTriggerAttrs} aria-haspopup="menu" className="group flex shrink-0 items-center gap-1.5 p-1 pl-2 rounded-full bg-(--secondary) inset-shadow-(--inset-shadow-secondary) hover:inset-shadow-(--inset-shadow-accent) cursor-pointer duration-200" onClick={openCompactMenu}>
			<Bars3Icon className="size-5 text-(--text-secondary) group-hover:text-(--text-primary) duration-150" />
			{accountinfo?.avatar ? (
				typeof accountinfo.avatar === "string" ? (
					<img src={accountinfo.avatar} alt="" className="size-7 rounded-full pointer-events-none select-none" />
				) : (
					<span className="flex size-7 items-center justify-center">{accountinfo.avatar}</span>
				)
			) : (
				<UserCircleIcon className="size-7 text-(--text-secondary) group-hover:text-(--text-primary) duration-150" />
			)}
		</button>
	);

	const row = (
		<div id="shell" ref={rowRef} className={"flex justify-between gap-2.5 p-1 duration-200"}>
			<div className="flex flex-1 min-w-0 items-center justify-start gap-2.5">
				<div className="relative flex items-center justify-center gap-1">
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
					<div ref={navButtonsRef} className={`flex items-center justify-center gap-0.5 p-1.5 bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-full duration-150`}>
						<button
							className={
								"group flex p-2 rounded-full cursor-pointer inset-shadow-[0_0_0_2px_transparent] hover:inset-shadow-[0_0_0_2px_var(--accent)] duration-150" +
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
							<ArrowPathIcon className={"size-4.5 stroke-current stroke-1 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) group-hover:rotate-180 duration-300" + (currentTabLoading ? " view-load-spin" : "")} />
						</button>
						<button
							className={
								"group p-2 rounded-full cursor-pointer inset-shadow-[0_0_0_2px_transparent] hover:inset-shadow-[0_0_0_2px_var(--accent)] duration-150" +
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
							<ArrowLeftIcon className={"size-4.5 stroke-current stroke-1 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) duration-300"} />
						</button>
						<button
							className={
								"group p-2 rounded-full cursor-pointer inset-shadow-[0_0_0_2px_transparent] hover:inset-shadow-[0_0_0_2px_var(--accent)] duration-150" +
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
							<ArrowRightIcon className={"size-4.5 stroke-current stroke-1 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) duration-300"} />
						</button>
						<button
							className={
								"group p-2 rounded-full cursor-pointer inset-shadow-[0_0_0_2px_transparent] hover:inset-shadow-[0_0_0_2px_var(--accent)] duration-150" +
								(tiny ? " hidden" : "") +
								" " +
								`
                            ${settings.brightness === "light" ? "text-(--text-tertiary) hover:text-(--text-primary) hover:bg-[#00000018]" : "text-(--text-primary) hover:text-(--text-secondary) hover:bg-[#ffffff10]"}
                        `
							}
							title={isFavorited ? "Remove from favorites" : "Add to favorites"}
							onClick={toggleFavorite}
						>
							{isFavorited ? (
								<StarIconSolid className={"size-4.5 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) duration-300"} />
							) : (
								<StarIconOutline className={"size-4.5 stroke-current stroke-2 text-(--text-tertiary) cursor-pointer group-hover:text-(--text-primary) duration-300"} />
							)}
						</button>
					</div>
				</div>
				<div className="relative flex flex-1 min-w-0 items-center">{tabs && tabs.length > 0 ? tabs.map((tab, index) => <Search tab={tab} key={index} />) : <Search />}</div>
			</div>
			<div className="flex shrink-0 items-center justify-end gap-2.5">
				{compact ? (
					compactTrigger
				) : (
				<>
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
									proxy: engines[(engines.indexOf(shownProxy) + 1) % engines.length],
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
                            ${shownProxy === "uv" ? "" : "-translate-y-6.5 pointer-events-none"}
                        `
							}
						>
							<div className={"flex items-center justify-center gap-2 duration-150"}>
								<span className="text-(--text-secondary) group-hover:text-(--text-primary) font-bold text-lg duration-150">UV</span>
								<span className="text-(--text-tertiary) group-hover:text-(--text-primary) font-semibold duration-150">{uvVersion}</span>
							</div>
							<div
								className={
									"flex items-center justify-center gap-2 duration-150" +
									" " +
									`
                                ${shownProxy === "sj" ? "" : "absolute opacity-0 pointer-events-none"}
                            `
								}
							>
								<span className="text-(--text-secondary) group-hover:text-(--text-primary) font-bold text-lg duration-150">Scramjet</span>
								<span className="text-(--text-tertiary) group-hover:text-(--text-primary) font-semibold duration-150">{sjVersion}</span>
							</div>
							{experimentalProxies && (
								<div
									className={
										"flex items-center justify-center gap-2 duration-150" +
										" " +
										`
                                ${shownProxy === "st" ? "" : "absolute opacity-0 pointer-events-none"}
                            `
									}
								>
									<HolyText as="span" className="text-(--text-secondary) group-hover:text-(--text-primary) font-bold text-lg duration-150" text="Stomp" />
									<span className="text-(--text-tertiary) group-hover:text-(--text-primary) font-semibold duration-150">{stompBuild}</span>
									{stompState && <HolyText as="span" className="text-(--text-tertiary) group-hover:text-(--text-primary) font-medium text-sm duration-150" text={stompState} />}
								</div>
							)}
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
					{isFullscreen ? <ArrowsPointingInIcon className="p-0.5 size-5 text-current stroke-current stroke-1" /> : <ArrowsPointingOutIcon className="p-0.5 size-5 text-current stroke-current stroke-1" />}
				</ShellButton>
				<BarSettingsMenu
					bar={bar}
					dark={dark}
					title="Top bar"
					trigger={(toggle, open) => (
						<div className={`flex items-center rounded-full bg-(--secondary) text-(--text-secondary) duration-200 inset-shadow-(--inset-shadow-secondary) hover:inset-shadow-(--inset-shadow-accent) ${open ? "inset-shadow-(--inset-shadow-accent)" : ""}`}>
							{bar.mode === "hover" ? (
								<button
									ref={pinRef}
									{...pinAttrs}
									aria-pressed={bar.pinned}
									className="flex items-center justify-center p-2 pr-1 rounded-l-full hover:text-(--text-primary) cursor-pointer duration-200"
									onClick={() => bar.setPinned(!bar.pinned)}
									onContextMenu={e => {
										e.preventDefault();
										toggle();
									}}
								>
									{bar.pinned ? <LockClosedIcon className="size-5" /> : <LockOpenIcon className="size-5" />}
								</button>
							) : (
								<button
									ref={closeBarRef}
									{...closeBarAttrs}
									className="flex items-center justify-center p-2 pr-1 rounded-l-full hover:text-(--text-primary) cursor-pointer duration-200"
									onClick={() => bar.setOpen(false)}
									onContextMenu={e => {
										e.preventDefault();
										toggle();
									}}
								>
									<EyeSlashIcon className="size-5" />
								</button>
							)}
							<button ref={barSettingsRef} {...barSettingsAttrs} aria-haspopup="dialog" aria-expanded={open} className="flex items-center justify-center p-2 pl-0.5 rounded-r-full hover:text-(--text-primary) cursor-pointer duration-200" onClick={toggle}>
								<ChevronDownIcon className={`size-4 stroke-current stroke-1 duration-200 ${open ? "rotate-180" : ""}`} />
							</button>
						</div>
					)}
				/>
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
					<Cog6ToothIcon className="size-5" />
				</ShellButton>
				<ShellButton
					title="Page selector"
					onClick={(e: React.MouseEvent) => {
						const items: MenuItem[] = [
							{
								title: "File Manager",
								onClick: () => {
									newTab({
										id: createId(),
										title: "File Manager",
										url: "about:files",
										icon: <FolderIcon className="size-4.5" />,
										displayUrl: "about:files",
									});
								},
								icon: <FolderIcon className="size-4.5" />,
							},
							{
								title: "Games",
								onClick: () => {
									newTab({
										id: createId(),
										title: "Games",
										url: "about:games",
										icon: <PlayIcon className="size-4.5" />,
										displayUrl: "about:games",
									});
								},
								icon: <PlayIcon className="size-4.5" />,
							},
							{
								title: "Music",
								onClick: () => openLibraryPage(""),
								icon: <MusicalNoteIcon className="size-4.5" />,
							},
						];

						const rect = e.currentTarget.getBoundingClientRect();
						setContextMenu({ x: rect.right, y: rect.bottom + 8, visible: true, items, align: "end" });
					}}
				>
					<Bars3Icon className="size-4.5 stroke-1 stroke-current" />
				</ShellButton>
				{accountinfo ? (
					<UserCard
						avatar={
							accountinfo.avatar ? (
								typeof accountinfo.avatar === "string" ? (
									<img src={accountinfo.avatar} alt={`${accountinfo.display}'s avatar`} className="size-7 rounded-full pointer-events-none select-none" />
								) : (
									accountinfo.avatar
								)
							) : (
								<UserCircleIcon
									className={
										"size-7" +
										" " +
										`
								${settings.brightness === "light" ? "text-(--text-secondary)" : "text-(--text-primary)"}
							`
									}
								/>
							)
						}
						id={accountinfo.id}
						display={accountinfo.display}
						handle={accountinfo.handle}
					/>
				) : (
					<UserCircleIcon
						className={
							"size-8" +
							" " +
							"cursor-pointer" +
							`
                        ${settings.brightness === "light" ? "text-(--text-secondary)" : "text-(--text-primary)"}
                    `
						}
						onClick={() => {
							newTab({
								id: createId(),
								url: "about:account",
								displayUrl: "about:account",
								title: "Fracital Account",
								icon: null,
								current: true,
							});
						}}
					/>
				)}
				</>
				)}
			</div>
			{contextMenu?.visible && <ContextMenu items={contextMenu.items} position={{ x: contextMenu.x, y: contextMenu.y }} align={contextMenu.align} onClose={() => setContextMenu(null)} />}
		</div>
	);

	return (
		<>
			{bar.inFlow && row}
			{/* Auto-hidden, the bar slides over the page so the page never resizes. */}
			{bar.autoHide && (
				<div ref={overlayRef} className={`absolute inset-x-3 top-3 z-40 duration-200 ease-out ${bar.shown ? "translate-y-0 opacity-100" : "-translate-y-[calc(100%+1rem)] opacity-0 pointer-events-none"}`}>
					<div className="rounded-2xl bg-(--primary) p-1.5 shadow-[0_10px_40px_#00000070] inset-shadow-(--inset-shadow-primary)">{row}</div>
				</div>
			)}
			{bar.mode === "button" && !bar.open && <BarOpenHandle dark={dark} onOpen={() => bar.setOpen(true)} />}
		</>
	);
};

export default Shell;
