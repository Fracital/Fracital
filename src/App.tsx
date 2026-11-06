import { createId } from "@paralleldrive/cuid2";
import { AD_UNITS, AdBanner, useShowAds } from "./components/AdBanner";
import { useEffect, useRef, useState } from "react";
import { RectangleStackIcon, PlusIcon, Cog6ToothIcon, ChevronLeftIcon, ChevronRightIcon, RadioIcon, XMarkIcon } from "@heroicons/react/24/solid";
import type { detailProps } from "./libs/eventBus";
import { useLocation } from "react-router-dom";

import { Api } from "./Api";

import Shell from "./gui/Shell";
import { QuickPlayer } from "./gui/QuickPlayer";
import { Tab } from "./components/Tab";

import Home from "./views/Home";
import ExternalSite from "./views/ExternalSite";

import { Controller } from "@mercuryworkshop/scramjet-controller";
import LibcurlTransport from "@mercuryworkshop/libcurl-transport";

import { useMusicStore, usePanelsStore, useSettingsStore, useTabsStore } from "./store";
import { init, quickLinks } from "./libs/init";
import { initTheme } from "./libs/theme";
import { startGameSaveSync } from "./libs/gameSaves";
import { View } from "./gui/View";
import TabGroup from "./components/TabGroup";
import { ModalProvider } from "./components/Modal/ModalContext";
import { getProxy, isWebOS, SettingsPath, wispURL } from "./types";
import { aboutPages, getPageFromUrl, getQueryFromUrl } from "./libs/aboutPages";
import { isPlayerUrl } from "./libs/playback";

declare global {
	interface Window {
		scramjetController?: Controller;
		scramjetReady?: Promise<void>;
		appReady?: Promise<void>;
	}
}

let serviceWorkerInit: Promise<void> | undefined;

const waitForServiceWorker = async (scope: string, scriptURL: string): Promise<ServiceWorker> => {
	let registration = await navigator.serviceWorker.getRegistration(scope);

	if (!registration) {
		registration = await navigator.serviceWorker.register(scriptURL, { scope });
	}

	registration.update().catch(() => undefined);

	// Prefer the already-active worker. An updated worker can't activate while the old one still has fetch
	// events in flight (e.g. stalled proxy requests), so waiting on it would time out and break the proxy.
	// The update takes over on its own once the old worker goes idle.
	let worker = registration.active ?? registration.waiting ?? registration.installing;

	if (!worker) {
		throw new Error(`No service worker found: ${scope}`);
	}

	if (worker.state !== "activated") {
		await new Promise<void>((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				cleanup();
				reject(new Error(`Service worker activation timed out: ${scope}`));
			}, 15_000);

			const finish = () => {
				if (worker!.state === "activated") {
					cleanup();
					resolve();
				} else if (worker!.state === "redundant") {
					cleanup();
					reject(new Error(`Service worker became redundant: ${scope}`));
				}
			};

			const cleanup = () => {
				window.clearTimeout(timeout);
				worker!.removeEventListener("statechange", finish);
			};

			worker!.addEventListener("statechange", finish);
			finish();
		});
	}

	const expectedScript = new URL(scriptURL, location.href).href;

	const isExpectedController = () => navigator.serviceWorker.controller?.scriptURL === expectedScript;

	if (!isExpectedController()) {
		const reloadKey = "fracital-sw-controller-reload";
		const previousReload = sessionStorage.getItem(reloadKey);

		if (previousReload !== expectedScript) {
			sessionStorage.setItem(reloadKey, expectedScript);
			window.location.reload();

			await new Promise<never>(() => undefined);
		}
	}

	await new Promise<void>((resolve, reject) => {
		if (isExpectedController()) {
			sessionStorage.removeItem("fracital-sw-controller-reload");
			resolve();
			return;
		}

		const timeout = window.setTimeout(() => {
			cleanup();
			reject(new Error(`Service worker did not take control: ${scope}`));
		}, 15_000);

		const finish = () => {
			if (!isExpectedController()) return;

			cleanup();
			sessionStorage.removeItem("fracital-sw-controller-reload");
			resolve();
		};

		const cleanup = () => {
			window.clearTimeout(timeout);
			navigator.serviceWorker.removeEventListener("controllerchange", finish);
		};

		navigator.serviceWorker.addEventListener("controllerchange", finish);
		finish();
	});

	// Return the worker that actually controls the page.
	worker = registration.active ?? worker;

	return worker;
};

const regSw = async () => {
	if (!("serviceWorker" in navigator)) throw new Error("Service workers are not supported in this browser");
	const serviceWorker = await waitForServiceWorker("./", "./sw.js");
	const scramjet = new Controller({
		serviceworker: serviceWorker,
		transport: new LibcurlTransport({
			wisp: wispURL,
		}),
	});
	// The SW only routes a frame's requests after the controller handshake finishes.
	await scramjet.wait();
	window.scramjetController = scramjet;
};

if (!isWebOS) {
	serviceWorkerInit = regSw().catch(error => {
		console.error("Proxy service worker initialization failed:", error);
		throw error;
	});
	window.scramjetReady = serviceWorkerInit;
}

let bootstrapPromise: Promise<void> | undefined;

const App = () => {
	const settings = useSettingsStore(state => state.settings);
	const setSettings = useSettingsStore(state => state.setSettings);

	const location = useLocation();
	const pathname = location.pathname.replace("/", "");

	const currentPanel = usePanelsStore(state => state.current);
	const setCurrentPanel = usePanelsStore(state => state.setCurrent);
	const setPanelsOpen = usePanelsStore(state => state.setPanelsOpen);

	const tabs = useTabsStore(state => state.tabs);
	const groups = useTabsStore(state => state.groups);
	const currentTab = tabs.find(tab => tab.current === true);
	const setCurrentTab = useTabsStore(state => state.setCurrentTab);
	const panelsOpen = usePanelsStore(state => state.panelsOpen);
	const playerView = useMusicStore(state => state.playerView);
	// The side player stays mounted (it owns the <audio> element) but is hidden while the full player tab is focused.
	const playerTabOpen = isPlayerUrl(currentTab?.url);

	const newGroup = useTabsStore(state => state.newGroup);
	const newTab = useTabsStore(state => state.newTab);
	const closeTab = useTabsStore(state => state.closeTab);
	const updateTab = useTabsStore(state => state.updateTab);

	const [platform, setPlatform] = useState<string>("");
	const [, setProxy] = useState<"sj" | "uv">("sj");
	const [proxyReady, setProxyReady] = useState(false);
	const proxyUserChangedRef = useRef(false);

	const tabsRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bootstrapPromise ??= (async () => {
			await Api();
			await init();
			await initTheme();
			// After init, so the bundled games are on disk before their saves are matched.
			startGameSaveSync();
		})();
		window.appReady = bootstrapPromise;
		void bootstrapPromise;
	}, []);

	// Team invite links (fracital.xyz/?artist-invite=CODE) open the Artists panel.
	useEffect(() => {
		const code = new URLSearchParams(window.location.search).get("artist-invite");
		if (!code || !/^[\w-]{6,40}$/.test(code)) return;
		window.history.replaceState(null, "", window.location.pathname);
		const url = `about:artists?invite=${code}`;
		newTab({ id: createId(), url, displayUrl: url, title: "Fracital for Artists", icon: null, current: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (serviceWorkerInit) {
			void serviceWorkerInit.then(() => setProxyReady(true)).catch(() => setProxyReady(false));
		} else {
			setProxyReady(true);
		}

		const getProx = async () => {
			if (window.appReady) await window.appReady.catch(() => undefined);
			const savedProxy = await getProxy();
			if (!proxyUserChangedRef.current) setProxy(savedProxy);
		};
		const handleProxyChange = (event: Event) => {
			const newProxy = (event as CustomEvent<{ proxy: "sj" | "uv" }>).detail.proxy;
			if (newProxy === "sj" || newProxy === "uv") {
				proxyUserChangedRef.current = true;
				setProxy(newProxy);
			}
		};
		getProx();
		window.addEventListener("proxy-change", handleProxyChange);
		return () => window.removeEventListener("proxy-change", handleProxyChange);
	}, []);

	useEffect(() => {
		// Use the store value; re-reading settings.json here races with loadTheme's write
		if (window.fr && typeof settings.theme === "string") void initTheme(settings.theme);
	}, [settings.theme]);

	useEffect(() => {
		const getSettings = async () => {
			if (window.appReady) await window.appReady.catch(() => undefined);
			try {
				if (!window.fr?.fs) throw new Error("Filer API is not initialized");
				const settingsData = await window.fr.fs.promises.readFile(SettingsPath, "utf-8");
				const parsedSettings = JSON.parse(settingsData);
				Object.entries(parsedSettings).forEach(([key, value]) => {
					setSettings(key, value);
				});
			} catch (error) {
				console.error("Error reading settings.json:", error);
				setSettings("theme", "default");
				setSettings("proxy", "sj");
				setSettings("quicklinks", quickLinks);
				setSettings("floating-tabs", false);
			}
		};
		getSettings();
	}, []);

	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent<detailProps>).detail;

			updateTab(detail.id, {
				url: detail.url,
				title: detail.title,
				icon: detail.icon,
				displayUrl: detail.url,
			});

			if (detail.url.includes("about:") && !(detail as any).isHistoryNavigation) {
				const iconStr = typeof detail.icon === "string" ? detail.icon : undefined;
				useTabsStore.getState().pushHistory(detail.id, {
					url: detail.url,
					title: detail.title,
					icon: iconStr,
					displayUrl: detail.displayUrl,
				});
			}
		};
		window.addEventListener("navigate", handler);
		return () => window.removeEventListener("navigate", handler);
	}, []);

	useEffect(() => {
		const refreshHandler = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			const tabId = detail?.tab;
			if (tabId) {
				const tab = tabs.find(t => t.id === tabId);
				if (tab && tab.url.includes("about:")) {
					useTabsStore.getState().refreshTab(tabId);
				}
			}
		};
		window.addEventListener("reload-tab", refreshHandler);
		return () => window.removeEventListener("reload-tab", refreshHandler);
	}, [tabs]);

	useEffect(() => {
		let detectedPlatform = "";
		if ("userAgentData" in navigator && navigator.userAgentData) {
			// @ts-expect-error: userAgentData is not yet in TypeScript's Navigator type
			detectedPlatform = navigator.userAgentData.platform || "";
		} else if ("platform" in navigator) {
			detectedPlatform = navigator.platform || "";
		} else {
			const ua = (navigator as Navigator).userAgent;
			if (/Windows/i.test(ua)) detectedPlatform = "Windows";
			else if (/Macintosh|Mac OS X/i.test(ua)) detectedPlatform = "Mac";
			else if (/Linux/i.test(ua)) detectedPlatform = "Linux";
			else if (/Android/i.test(ua)) detectedPlatform = "Android";
			else if (/iPhone|iPad|iPod/i.test(ua)) detectedPlatform = "iOS";
			else detectedPlatform = "Unknown";
		}
		setPlatform(detectedPlatform);
	}, []);

	const nextTab = () => {
		const currentIndex = tabs.findIndex(tab => tab.current);
		if (currentIndex !== -1) {
			setCurrentTab(tabs[(currentIndex + 1) % tabs.length].id);
		}
	};

	const prevTab = () => {
		const currentIndex = tabs.findIndex(tab => tab.current);
		if (currentIndex !== -1) {
			setCurrentTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length].id);
		}
	};

	useEffect(() => {
		if (currentTab && (pathname === "account" || pathname === "login" || pathname === "register")) {
			updateTab(currentTab.id, {
				displayUrl: pathname != "account" ? `about:account?${pathname}` : "about:account",
				title: "Account Management",
				url: pathname != "account" ? `about:account?${pathname}` : "about:account",
			});
		}
	}, [location.pathname]);

	// The shipped shell's title is neutralized at build time; restore the
	// brand title once the app boots. The literal is encrypted in the
	// bundle, so the brand never appears in shipped plaintext.
	useEffect(() => {
		document.title = "Fracital";
	}, []);

	useEffect(() => {
		const handleKeys = (e: KeyboardEvent) => {
			const key = e.key.toLowerCase();

			if (platform.includes("Mac")) {
				if (e.shiftKey && e.ctrlKey && key === "s") {
					newTab({
						id: createId(),
						title: "Settings",
						url: "settings",
						icon: <Cog6ToothIcon className="size-5" />,
						displayUrl: "settings",
					});
				} else if (e.ctrlKey && key === "s") {
					if (panelsOpen) {
						setPanelsOpen(false);
					} else {
						setPanelsOpen(true);
					}
				}
				if (e.ctrlKey && key === "t") {
					newTab({
						id: createId(),
						title: "New Tab",
						url: "about:newtab",
						displayUrl: "about:newtab",
					});
				}
				if (e.ctrlKey && key === "w") {
					if (currentTab?.id) {
						closeTab(currentTab.id);
					}
				}
				if (e.ctrlKey && key === "q") {
					tabs.forEach(tab => {
						closeTab(tab.id);
					});
				}
			} else {
				if (e.altKey && key === "s") {
					if (panelsOpen) {
						setPanelsOpen(false);
					} else {
						setPanelsOpen(true);
					}
				}
				if (e.altKey && key === "t") {
					newTab({
						id: createId(),
						title: "New Tab",
						url: "about:newtab",
						displayUrl: "about:newtab",
					});
				}
				if (e.altKey && key === "w") {
					if (currentTab?.id) {
						closeTab(currentTab.id);
					}
				}
				if (e.altKey && key === "q") {
					tabs.forEach(tab => {
						closeTab(tab.id);
					});
				}
			}
			if (e.shiftKey && e.key.toLowerCase() === "arrowup") {
				e.preventDefault();
				prevTab();
			} else if (e.shiftKey && e.key.toLowerCase() === "arrowdown") {
				e.preventDefault();
				nextTab();
			}
		};
		window.addEventListener("keydown", handleKeys);

		return () => {
			window.removeEventListener("keydown", handleKeys);
		};
	});

	return (
		<ModalProvider>
			<div className="flex flex-col h-screen w-full gap-2.5 p-3 overflow-hidden">
				<Shell />
				<div className="flex flex-col flex-1 min-h-0">
					<div id="main" className="relative flex flex-1 min-h-0 gap-2.5">
						{/* Ad panel (hidden for premium accounts and on narrow windows) */}
						<SideAd />
						<div className={"relative flex-1 min-h-0 h-[calc(100%+2px)] bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-2xl overflow-hidden"}>
							{tabs.length > 0 ? (
								tabs.map(item => {
									if (item.url.includes("about:")) {
										const pageName = getPageFromUrl(item.url);
										const viewKey = `${item.id}-${item.refreshKey ?? 0}`;

										if (!pageName || !aboutPages[pageName]) {
											return (
												<div key={item.id}>
													{currentTab && (
														<View key={viewKey} id={item.id}>
															<Home
																key={viewKey}
																className={
																	"absolute inset-0 duration-150" +
																	" " +
																	`
																${currentTab ? (currentTab.id !== item.id ? "opacity-0 translate-y-2 pointer-events-none" : "") : ""}
															`
																}
															/>
														</View>
													)}
												</div>
											);
										}

										const pageConfig = aboutPages[pageName];
										const PageComponent = pageConfig.component;

										const query = pageConfig.hasQuery ? getQueryFromUrl(item.url) : undefined;

										if (pageName === "newtab") {
											return (
												<div key={item.id}>
													{currentTab && (
														<View key={viewKey} id={item.id}>
															<PageComponent
																key={viewKey}
																className={
																	"absolute inset-0 duration-150" +
																	" " +
																	`
															${currentTab ? (currentTab.id !== item.id ? "opacity-0 translate-y-2 pointer-events-none" : "") : ""}
														`
																}
																query={query}
															/>
														</View>
													)}
												</div>
											);
										}

										return (
											<div key={item.id}>
												<View key={viewKey} id={item.id}>
													<PageComponent
														key={viewKey}
														query={query}
														className={
															"absolute inset-0 duration-150" +
															" " +
															`
														${currentTab ? (currentTab.id !== item.id ? "opacity-0 translate-y-2 pointer-events-none" : "") : ""}
													`
														}
													/>
												</View>
											</div>
										);
									} else {
										return (
											<ExternalSite
												id={item.id}
												current={currentTab?.id === item.id}
												key={item.id}
												url={proxyReady ? item.url : undefined}
												className={
													"absolute inset-0" +
													" " +
													`
												${currentTab ? (currentTab.id !== item.id ? "opacity-0 pointer-events-none" : "") : ""}
                                            `
												}
											/>
										);
									}
								})
							) : (
								<Home />
							)}
						</div>
						<div
							className={
								(settings["floating-tabs"] && "absolute py-2 h-full") +
								" " +
								"flex flex-col shrink-0 duration-150" +
								" " +
								`
                            ${settings["floating-tabs"] === true ? (panelsOpen ? "w-74 right-2" : "w-10 -right-1") : panelsOpen ? "w-78" : "w-10"}
                            ${settings["floating-tabs"] ? "gap-2" : "gap-2.5"}
						`
							}
						>
							<div
								className={
									"flex w-full h-max p-1.5 py-2 gap-2 items-center justify-between bg-(--secondary) hover:bg-(--tertiary) inset-shadow-(--inset-shadow-primary) *:pointer-events-none cursor-pointer duration-150" +
									" " +
									`
                                ${settings["floating-tabs"] && panelsOpen ? "rounded-lg" : "rounded-xl"}
                                ${settings["floating-tabs"] && panelsOpen ? "shadow-[0_0_16px_3px_#00000035]" : ""}
                            `
								}
								title={panelsOpen ? "Close Panels" : "Open Panels"}
								onMouseDown={() => {
									panelsOpen ? setPanelsOpen(false) : setPanelsOpen(true);
								}}
							>
								<ChevronLeftIcon
									className={
										"size-6 stroke-2 stroke-current" +
										" " +
										`
                                    ${panelsOpen ? "opacity-0" : "opacity-100"}
                                `
									}
								/>
								{panelsOpen && (
									<>
										<span className="font-semibold">Close Panels</span>
										<ChevronRightIcon className="size-6 stroke-2 stroke-current" />
									</>
								)}
							</div>
							{/* tabs panel */}
							<div
								ref={tabsRef}
								className={
									"flex flex-col flex-1 min-h-0 bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-hidden duration-150" +
									" " +
									`
                                ${panelsOpen ? "w-full" : "w-50"}
                                ${settings["floating-tabs"] && panelsOpen ? "rounded-xl" : "rounded-2xl"}
                                ${settings["floating-tabs"] && "shadow-[0_0_16px_3px_#00000035]"}
                            `
								}
								// Open on click (capture), not mousedown: widening on mousedown moved the button out from
								// under the cursor before mouseup, so collapsed items (new tab, tabs…) never got their click.
								onClickCapture={() => setPanelsOpen(true)}
							>
								<div
									className={"relative flex w-full flex-1 min-h-0 overflow-auto gap-2 p-2 flex-col items-stretch duration-200"}
									onDragOver={e => {
										e.preventDefault();
										const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
										const tabEl = el?.closest("[data-url][id]") as HTMLElement | null;
										if (tabEl && tabEl.id) {
											const rect = tabEl.getBoundingClientRect();
											const y = e.clientY - rect.top;
											return;
										}
										const groupHeader = el?.closest("[data-group-id]") as HTMLElement | null;
										if (groupHeader) {
											return;
										}
										const groupWrapper = el?.closest("[data-group-wrapper]") as HTMLElement | null;
										if (groupWrapper) {
											return;
										}
									}}
									onDrop={e => {
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
											const targetTab = tabs.find(t => t.id === targetId);
											const targetGroupId = targetTab?.groupId;
											const rect = tabEl.getBoundingClientRect();
											const y = e.clientY - rect.top;
											const placeBefore = y < rect.height / 2;
											updateTab(draggedId, { groupId: targetGroupId });
											useTabsStore.getState().moveTabRelative(draggedId, targetId, placeBefore);
											return;
										}

										const groupHeader = el.closest("[data-group-id]") as HTMLElement | null;
										const groupWrapper = el.closest("[data-group-wrapper]") as HTMLElement | null;
										const gid = groupHeader?.getAttribute("data-group-id") || groupWrapper?.getAttribute("data-group-wrapper");
										if (gid) {
											updateTab(draggedId, { groupId: gid });
											const groupTabs = tabs.filter(t => t.groupId === gid);
											if (groupTabs.length > 0) {
												const lastId = groupTabs[groupTabs.length - 1].id;
												useTabsStore.getState().moveTabRelative(draggedId, lastId, false);
											}
											return;
										}

										updateTab(draggedId, { groupId: undefined });
									}}
								>
									{groups.length > 0 && groups.map(group => <TabGroup key={group.id} id={group.id} name={group.name} icon={group.icon} />)}
									{(() => {
										const ungrouped = tabs.filter(t => !t.groupId);
										if (tabs.length === 0) {
											newTab({
												id: createId(),
												title: "New Tab",
												url: "about:newtab",
												current: true,
												displayUrl: "about:newtab",
											});
											return (
												<span
													className={
														"absolute left-1/2 top-1/2 -translate-1/2 w-max font-semibold text-lg duration-150" +
														" " +
														`
													${tabs.length < 0 ? "opacity-0" : ""}
												`
													}
												>
													No tabs open
												</span>
											);
										}

										return ungrouped.length > 0 ? ungrouped.map(item => <Tab title={item.title} url={item.url} id={item.id} icon={item.icon} displayUrl={item.url} key={item.id} />) : null;
									})()}
								</div>
								<div
									className={
										"flex min-max-1 w-[calc(100%-1rem)] m-2 p-1 rounded-xl items-start justify-between gap-1" +
										" " +
										`
                                    ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}
                                `
									}
								>
									<div className="flex gap-1">
										<button
											title={platform.includes("Mac") ? "New Tab ⌃ + T" : "New Tab: Alt + T"}
											className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-200"
											onClick={() => {
												newTab({
													id: createId(),
													title: "New Tab",
													url: "about:newtab",
													current: true,
													displayUrl: "about:newtab",
												});
											}}
										>
											<PlusIcon className="size-5 stroke-current stroke-1 duration-150" />
										</button>
										<button
											title={platform.includes("Mac") ? "New Group ⌃ + T" : "New Group: Alt + T"}
											className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-200"
											onClick={() => {
												const groupId = createId();
												newGroup(groupId, `Group ${groups.length + 1}`);
											}}
										>
											<RectangleStackIcon className="size-4.5 duration-150" />
											<PlusIcon className="size-3 stroke-current stroke-1 duration-150" />
										</button>
									</div>
									<div className="flex gap-0.5 items-center h-full"></div>
								</div>
							</div>
							<QuickPlayer
								className={`
                                ${playerView === "bigplayer" ? "flex-[1.3]" : "flex-1"} min-h-0
                                ${playerTabOpen ? "hidden!" : ""}
                            `}
								panelsOpen={panelsOpen}
								onOpenPanels={() => setPanelsOpen(true)}
							/>
						</div>
					</div>
				</div>
			</div>
		</ModalProvider>
	);
};

export default App;

/** Left-side 160×600 ad; the ad refreshes every 5–10 minutes (random). */
function SideAd() {
	const show = useShowAds();
	const [closed, setClosed] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const [slots, setSlots] = useState(2);

	useEffect(() => {
		if (!closed) return;
		const t = window.setTimeout(() => setClosed(false), (5 + Math.random() * 5) * 60_000);
		return () => window.clearTimeout(t);
	}, [closed]);

	useEffect(() => {
		const el = panelRef.current;
		if (!el) return;
		const fit = () => {
			const usable = el.clientHeight - 48;
			setSlots(Math.min(3, Math.max(2, Math.floor(usable / (AD_UNITS.side.height + 8)))));
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [show, closed]);

	if (!show || closed) return null;
	return (
		<div ref={panelRef} className="hidden lg:flex flex-col shrink-0 rounded-2xl bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
			<div className="sticky top-0 z-10 m-2 p-2 pb-1.5 bg-(--secondary)">
				<button className="flex items-center gap-1.5 w-full justify-center px-2 py-1 rounded-lg text-xs font-medium text-(--text-secondary) hover:text-(--text-primary) hover:bg-[#ffffff14] duration-150" title="Close ads" onClick={() => setClosed(true)}>
					<XMarkIcon className="size-3.5" />
					Close
				</button>
			</div>
			<div className="flex flex-col items-center gap-2 px-2 pb-2">
				{Array.from({ length: slots }, (_, i) => (
					<AdBanner key={i} unit={AD_UNITS.side} refreshMinutes={[5, 10]} className="rounded-lg" />
				))}
			</div>
		</div>
	);
}
