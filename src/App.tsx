import { ChevronLeftIcon, ChevronRightIcon, Cog6ToothIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Api } from "./Api";
import { AD_UNITS, AdBanner, RevSlot, TabsAd, useShowAds } from "./components/AdBanner";
import { MusicAdBreak } from "./components/MusicAdBreak";
import { ProfileCardHost } from "./components/ProfileCard";
import { StreakWinNotice } from "./components/StreakBadge";
import { Tab } from "./components/Tab";
import Shell from "./gui/Shell";
import { NewGroupButton, NewTabButton } from "./gui/tabBatch";
import { appRoot } from "./libs/cloak";
import { scrollParent } from "./libs/dragFeel";
import type { detailProps } from "./libs/eventBus";

const QuickPlayer = lazy(() => import("./gui/QuickPlayer").then(module => ({ default: module.QuickPlayer })));
const Home = lazy(() => import("./views/Home"));
const ExternalSite = lazy(() => import("./views/ExternalSite"));

import { Controller } from "@mercuryworkshop/scramjet-controller";
import { ModalProvider } from "./components/Modal/ModalContext";
import { SpinnerLoader } from "./components/SsrLoader";
import TabGroup from "./components/TabGroup";
import { startExtensions } from "./extensions/runtime";
import { TabView } from "./gui/TabView";
import { View } from "./gui/View";
import { aboutPages, getPageFromUrl, getQueryFromUrl, openLibraryPage } from "./libs/aboutPages";
import { startGameSaveSync } from "./libs/gameSaves";
import { init, quickLinks } from "./libs/init";
import { applyMotionSetting, MOTION_SETTING } from "./libs/motion";
import { isPlayerUrl, togglePlay } from "./libs/playback";
import { ResilientTransport } from "./libs/resilientTransport";
import { bootStomp, useStompStore } from "./libs/stompEngine";
import { initTheme } from "./libs/theme";
import { groupKey, tabKey, tabsInOrder, topLevel, useMusicStore, usePanelsStore, useSettingsStore, useTabsStore } from "./store";
import { EXPERIMENTAL_PROXIES_SETTING, getProxy, isProxyEngine, isWebOS, type ProxyEngine, SettingsPath, TAB_VIEW_SETTING, wispURL } from "./types";
import StompSite from "./views/StompSite";

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

	// An active worker that doesn't control this page yet (first visit, hard reload) is asked to claim it,
	// which takes a moment instead of a second page load. Reloading stays the fallback.
	if (!isExpectedController()) {
		await new Promise<void>(resolve => {
			const done = () => {
				window.clearTimeout(timeout);
				navigator.serviceWorker.removeEventListener("controllerchange", done);
				resolve();
			};
			const timeout = window.setTimeout(done, 2000);
			navigator.serviceWorker.addEventListener("controllerchange", done);
			(registration.active ?? worker)?.postMessage("claim");
		});
	}

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
		transport: new ResilientTransport({
			wisp: wispURL,
		}),
	});
	// A worker of a new build takes the page over a moment after a visit begins (sw.js differs with every build,
	// and the new worker claims its clients). It knows no controller, and the controller would go on talking to
	// the worker it was made with, which is gone: every proxied request after that was let through to the server
	// until a reload. The controller registers with the worker that controls the page now. (public/sw.js holds a
	// request that arrives before it has.)
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		const worker = navigator.serviceWorker.controller;
		if (!worker || worker === scramjet.serviceWorkerController) return;
		scramjet.serviceWorkerController = worker;
		(scramjet as unknown as { setupMessagePort(): void }).setupMessagePort();
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

	const setPanelsOpen = usePanelsStore(state => state.setPanelsOpen);

	const tabs = useTabsStore(state => state.tabs);
	const groups = useTabsStore(state => state.groups);
	const layout = useTabsStore(state => state.layout);
	const currentTab = tabs.find(tab => tab.current === true);
	const setCurrentTab = useTabsStore(state => state.setCurrentTab);
	const panelsOpen = usePanelsStore(state => state.panelsOpen);
	const tabsLeft = useSettingsStore(state => state.settings["tabs-position"] === "left");
	/** How clicks inside the collapsed side panel open it: "anywhere", "except-tabs" (default) or "off". */
	const panelClickOpen = useSettingsStore(state => (["anywhere", "except-tabs", "off"].includes(state.settings["panel-click-open"]) ? state.settings["panel-click-open"] : "except-tabs")) as "anywhere" | "except-tabs" | "off";
	const rail = !panelsOpen && settings["compact-tabs"] === true;
	const peek = !panelsOpen && settings["compact-tabs"] !== true;
	/** The tab view setting: the tabs move from the side panel into the tab view, opened from the top bar. */
	const tabView = settings[TAB_VIEW_SETTING] === true;
	const tabViewOpen = usePanelsStore(state => state.tabViewOpen);
	/** While the tab view is open every tab's page shows, scaled into its card. */
	const previewing = tabView && tabViewOpen;
	const hidden = (id: string) => !!currentTab && currentTab.id !== id && !previewing;
	/** The box around a tab's page; the tab view moves and scales it (see TabView). */
	const frameClass = (id: string) => `absolute inset-0 ${hidden(id) ? "pointer-events-none" : ""}`;
	// Rail containers use rounded-3xl, not rounded-full: on the 40px rail 24px is clamped to a full pill, and
	// unlike rounded-full it animates smoothly from the open panel's rounded-2xl.
	const playerView = useMusicStore(state => state.playerView);
	// The side player stays mounted (it owns the <audio> element) but is hidden while the full player tab is
	// focused, and while there's no song and nothing queued.
	const playerTabOpen = isPlayerUrl(currentTab?.url);
	const hasMusic = useMusicStore(state => !!state.currentTrack || state.queue.length > 0);

	const newTab = useTabsStore(state => state.newTab);
	const closeTab = useTabsStore(state => state.closeTab);
	const updateTab = useTabsStore(state => state.updateTab);

	const [platform, setPlatform] = useState<string>("");
	const [proxy, setProxy] = useState<ProxyEngine>("sj");
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

	useEffect(() => {
		const music = new URLSearchParams(window.location.search).get("music");
		if (!music || music.length > 600) return;
		const given = new URLSearchParams(music);
		const query = new URLSearchParams();
		for (const key of ["track", "by", "artistName"]) {
			const value = given.get(key)?.trim();
			if (value) query.set(key, value.slice(0, 200));
		}
		if (!query.has("track") && !query.has("artistName")) return;
		window.history.replaceState(null, "", window.location.pathname);
		openLibraryPage(query.toString(), query.get("track") || query.get("artistName") || "Music");
	}, []);

	useEffect(() => {
		const code = new URLSearchParams(window.location.search).get("artist-invite");
		if (!code || !/^[\w-]{6,40}$/.test(code)) return;
		window.history.replaceState(null, "", window.location.pathname);
		const url = `about:artists?invite=${code}`;
		newTab({ id: createId(), url, displayUrl: url, title: "Fracital for Artists", icon: null, current: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const kind = params.get("account");
		if (kind !== "verified" && kind !== "reset") return;
		window.history.replaceState(null, "", window.location.pathname);
		const token = params.get("token") || "";
		const error = params.get("error") ? "error" : "";
		const query = kind === "reset" ? (token && !error && /^[\w-]{8,200}$/.test(token) ? `reset=${token}` : "reset-error") : error ? "verify-error" : "verified";
		const url = `about:account?${query}`;
		newTab({ id: createId(), url, displayUrl: kind === "reset" ? "about:account" : url, title: "Fracital Account", icon: null, current: true });
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
			const newProxy = (event as CustomEvent<{ proxy: unknown }>).detail.proxy;
			if (isProxyEngine(newProxy)) {
				proxyUserChangedRef.current = true;
				setProxy(newProxy);
			}
		};
		getProx();
		window.addEventListener("proxy-change", handleProxyChange);
		return () => window.removeEventListener("proxy-change", handleProxyChange);
	}, []);

	// stomp is opt-in (the experimental proxies setting) and boots only once it
	// is the selected engine; Scramjet keeps booting at startup as before.
	const stompActive = proxy === "st" && settings[EXPERIMENTAL_PROXIES_SETTING] === true;
	// UV boots its transport the first time it's chosen; its tabs wait for that.
	const [uvReady, setUvReady] = useState(false);
	useEffect(() => {
		if (proxy !== "uv" || uvReady) return;
		void import("./libs/uvEngine")
			.then(({ bootUv }) => bootUv())
			.then(() => setUvReady(true))
			.catch(error => console.error("UV failed to start:", error));
	}, [proxy, uvReady]);
	// Cross-site sign-in (libs/crossSite.ts), once per load: a signed-out site signs in from the
	// hub when this browser is linked; a signed-in one links it, unless it was turned off here.
	useEffect(() => {
		void (async () => {
			const { getMe, refreshMe } = await import("./libs/auth");
			const cross = await import("./libs/crossSite");
			if (!(await getMe())) {
				if (!(await cross.crossSiteSignIn())) return;
				await refreshMe();
				await window.fr?.sync.get().catch(() => false);
				return;
			}
			const status = await cross.crossSiteStatus();
			if (status && !status.linked && !status.off) await cross.linkCrossSite("startup");
		})().catch(() => undefined);
	}, []);

	useEffect(() => {
		useStompStore.setState({ active: stompActive });
		if (stompActive && !isWebOS) void bootStomp().catch(() => undefined);
	}, [stompActive]);

	useEffect(() => {
		// Use the store value; re-reading settings.json here races with loadTheme's write
		if (window.fr && typeof settings.theme === "string") void initTheme(settings.theme);
	}, [settings.theme]);

	useEffect(() => {
		applyMotionSetting(settings[MOTION_SETTING]);
	}, [settings[MOTION_SETTING]]);

	// Extensions (about:extensions) run in proxied pages; this starts the ones that are on and follows their settings.
	useEffect(() => startExtensions(), []);

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
				setSettings("compact-tabs", false);
			}
		};
		getSettings();
	}, []);

	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent<detailProps>).detail;

			// Every navigate event is one the user asked for: bump the tab's navNonce so a stomp tab runs it even when url is unchanged.
			useTabsStore.getState().navigateTab(detail.id, {
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

	/** The tabs in the order the side panel shows them: each group's tabs where the group stands, loose tabs where they stand. */
	const shownTabs = () => tabsInOrder(useTabsStore.getState());
	/**
	 * Shift+arrows: to the nearest tab on screen in that direction (the tab view lays tabs out in rows and groups side
	 * by side; the side panel is one column). With none that way, the next or previous tab in the order shown, wrapping.
	 */
	const moveTab = (dir: "up" | "down" | "left" | "right") => {
		const spots = [...appRoot().querySelectorAll<HTMLElement>("[data-tab-spot]")].map(el => ({ id: el.dataset.tabSpot ?? "", el, r: el.getBoundingClientRect() })).filter(s => s.r.width > 0 && s.r.height > 0 && s.el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
		const current = tabs.find(tab => tab.current);
		const here = spots.find(s => s.id === current?.id);
		const forward = dir === "down" || dir === "right";
		// Nothing on screen to go by (the panels are closed, or the tab is in a collapsed group): the order shown.
		const order = here ? spots.map(s => s.id) : shownTabs().map(tab => tab.id);
		const index = order.indexOf(current?.id ?? "");
		if (index === -1 || order.length < 2) return;
		let target = order[(index + (forward ? 1 : -1) + order.length) % order.length];
		if (here) {
			const cx = here.r.left + here.r.width / 2;
			const cy = here.r.top + here.r.height / 2;
			let best = Number.POSITIVE_INFINITY;
			for (const s of spots) {
				if (s.id === here.id) continue;
				const dx = s.r.left + s.r.width / 2 - cx;
				const dy = s.r.top + s.r.height / 2 - cy;
				const ahead = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
				// Ahead by at least a few px: a tab in the same column (or row) isn't "to the side" of this one.
				if (ahead <= 4) continue;
				const aside = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
				// Straight ahead beats close but off to the side.
				const score = ahead + aside * 2;
				if (score < best) {
					best = score;
					target = s.id;
				}
			}
		}
		setCurrentTab(target);
		// Bring it into view in its own list only. scrollIntoView also scrolls the overflow-hidden layout around it, which
		// slid the whole app sideways when the collapsed side panel's tab was off the edge.
		const spot = spots.find(s => s.id === target)?.el;
		const list = scrollParent(spot ?? null);
		if (spot && list) {
			const r = spot.getBoundingClientRect();
			const box = list.getBoundingClientRect();
			if (r.top < box.top) list.scrollTop -= box.top - r.top + 8;
			else if (r.bottom > box.bottom) list.scrollTop += r.bottom - box.bottom + 8;
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

	useEffect(() => {
		document.title = "Fracital";
	}, []);

	// Space plays/pauses while a music page is the open tab, unless you're typing. A button that was
	// clicked keeps focus and Space would press it again, so only keyboard-focused controls keep Space.
	useEffect(() => {
		const MUSIC_PAGES = new Set(["music", "player", "library"]);
		const onSpace = (e: KeyboardEvent) => {
			if (e.code !== "Space" || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
			const tab = useTabsStore.getState().tabs.find(t => t.current);
			if (!tab || !MUSIC_PAGES.has(getPageFromUrl(tab.url) ?? "") || !useMusicStore.getState().currentTrack) return;
			const focused = document.activeElement;
			if (focused instanceof HTMLElement && focused !== document.body) {
				if (focused.isContentEditable || focused.closest("input, textarea, select, [contenteditable], [role=textbox], [role=combobox], [role=slider], iframe")) return;
				if (focused.matches(":focus-visible")) return;
			}
			e.preventDefault();
			void togglePlay();
		};
		window.addEventListener("keydown", onSpace);
		return () => window.removeEventListener("keydown", onSpace);
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
			// Shift+arrows select text while typing; only switch tabs elsewhere.
			const root = appRoot();
			const focused = ("activeElement" in root ? root.activeElement : null) ?? document.activeElement;
			const typing = focused instanceof HTMLElement && (focused.isContentEditable || !!focused.closest("input, textarea, select, [contenteditable], [role=textbox], [role=combobox]"));
			if (typing) return;
			const ARROWS: Record<string, "up" | "down" | "left" | "right"> = { arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right" };
			const dir = ARROWS[e.key.toLowerCase()];
			if (e.shiftKey && dir && !e.ctrlKey && !e.altKey && !e.metaKey) {
				e.preventDefault();
				moveTab(dir);
			}
		};
		window.addEventListener("keydown", handleKeys);

		return () => {
			window.removeEventListener("keydown", handleKeys);
		};
	});

	// There is always a tab: closing the last one opens a new one.
	useEffect(() => {
		if (tabs.length > 0) return;
		newTab({
			id: createId(),
			title: "New Tab",
			url: "about:newtab",
			current: true,
			displayUrl: "about:newtab",
		});
	}, [tabs.length]);

	// Turning the tab view setting off closes the view, so it doesn't reopen when it is turned back on.
	useEffect(() => {
		if (!tabView) usePanelsStore.getState().setTabViewOpen(false);
	}, [tabView]);

	/** The side panel's tab list and its new tab/group buttons. */
	const renderTabList = (listRail: boolean, listPeek: boolean, adEnabled: boolean) => (
		<>
			<div
				className={`relative flex w-full flex-1 min-h-0 overflow-auto flex-col items-stretch duration-200 ${listRail ? "gap-1 p-1 [scrollbar-width:none]" : "gap-2 p-2"}`}
				onDragOver={e => e.preventDefault()}
				onDrop={e => {
					e.preventDefault();
					const draggedId = e.dataTransfer.getData("text/tab-id");
					if (!draggedId) return;
					/** Out of any group, at the top-level spot under the pointer: after every item whose middle is above it. */
					const container = e.currentTarget;
					const placeAtPointer = () => {
						const items = [...container.querySelectorAll<HTMLElement>(":scope > [data-top-item]")].filter(item => item.dataset.topItem !== tabKey(draggedId));
						const index = items.filter(item => {
							const r = item.getBoundingClientRect();
							return r.top + r.height / 2 < e.clientY;
						}).length;
						useTabsStore.getState().placeLoose(draggedId, index);
					};

					// The app's root, so this finds the panel inside the cloak's shadow root too.
					const el = appRoot().elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
					if (!el) {
						placeAtPointer();
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
						const groupTabs = useTabsStore.getState().tabs.filter(t => t.groupId === gid && t.id !== draggedId);
						if (groupTabs.length > 0) {
							const lastId = groupTabs[groupTabs.length - 1].id;
							useTabsStore.getState().moveTabRelative(draggedId, lastId, false);
						}
						return;
					}

					placeAtPointer();
				}}
			>
				{/* Groups and loose tabs in one order; each top-level item is marked for the drops and the group drag. */}
				{topLevel({ tabs, groups, layout }).map(item => {
					if (item.kind === "group") {
						const group = groups.find(g => g.id === item.id);
						return group ? <TabGroup key={groupKey(group.id)} id={group.id} name={group.name} icon={group.icon} /> : null;
					}
					const tab = tabs.find(t => t.id === item.id);
					return tab ? <Tab title={tab.title} url={tab.url} id={tab.id} icon={tab.icon} displayUrl={tab.url} topKey={tabKey(tab.id)} key={tabKey(tab.id)} /> : null;
				})}
				{tabs.length === 0 && (
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
				)}
				<TabsAd enabled={adEnabled} />
			</div>
			<div
				className={
					(listRail
						? "flex w-[calc(100%-0.5rem)] m-1 p-0 rounded-3xl justify-center [&_button:not(:first-child)]:hidden [&_button]:p-1.5 [&_button]:rounded-3xl"
						: `flex min-max-1 w-[calc(100%-1rem)] m-2 p-1 rounded-xl items-start justify-between gap-1 ${listPeek && tabsLeft ? "flex-row-reverse [&>div]:flex-row-reverse" : ""}`) +
					" " +
					`
	                                    ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}
	                                `
				}
			>
				<div className="flex gap-1">
					<NewTabButton title={platform.includes("Mac") ? "New Tab ⌃ + T" : "New Tab: Alt + T"} />
					{/* Hidden in the icon rail, which keeps only the new tab button. */}
					<NewGroupButton title={platform.includes("Mac") ? "New Group ⌃ + T" : "New Group: Alt + T"} className={listRail ? "hidden!" : ""} />
				</div>
				<div className="flex gap-0.5 items-center h-full" />
			</div>
		</>
	);

	return (
		<ModalProvider>
			{/* clip, not hidden: the collapsed side panel reaches past the window edge, and an overflow-hidden box can still be
			    scrolled (by focus moving into a page, scrollIntoView), which slid the whole app sideways. A clipped box can't. */}
			<div className="relative flex flex-col h-screen w-full gap-2.5 p-3 overflow-clip">
				<Shell />
				<StreakWinNotice />
				<ProfileCardHost />
				<div className="flex flex-col flex-1 min-h-0">
					<div id="main" className={`relative flex flex-1 min-h-0 gap-2.5 ${tabsLeft ? "flex-row-reverse" : ""}`}>
						{/* Ad panel (hidden for premium accounts and on narrow windows) */}
						<SideAd />
						<div className={"relative flex-1 min-h-0 h-[calc(100%+2px)] bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-2xl overflow-hidden"}>
							<Suspense fallback={<SpinnerLoader />}>
								{tabs.length > 0 ? (
									tabs.map(item => {
										if (item.url.includes("about:")) {
											const pageName = getPageFromUrl(item.url);
											const viewKey = `${item.id}-${item.refreshKey ?? 0}`;

											if (!pageName || !aboutPages[pageName]) {
												return (
													<div key={item.id} data-tab-frame={item.id} className={frameClass(item.id)}>
														{currentTab && (
															<View key={viewKey} id={item.id}>
																<Home
																	key={viewKey}
																	className={
																		"absolute inset-0 duration-150" +
																		" " +
																		`
																${hidden(item.id) ? "opacity-0 translate-y-2 pointer-events-none" : ""}
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
													<div key={item.id} data-tab-frame={item.id} className={frameClass(item.id)}>
														{currentTab && (
															<View key={viewKey} id={item.id}>
																<PageComponent
																	key={viewKey}
																	className={
																		"absolute inset-0 duration-150" +
																		" " +
																		`
															${hidden(item.id) ? "opacity-0 translate-y-2 pointer-events-none" : ""}
														`
																	}
																	query={query}
																	active={currentTab?.id === item.id}
																/>
															</View>
														)}
													</div>
												);
											}

											return (
												<div key={item.id} data-tab-frame={item.id} className={frameClass(item.id)}>
													<View key={viewKey} id={item.id}>
														<PageComponent
															key={viewKey}
															query={query}
															className={
																"absolute inset-0 duration-150" +
																" " +
																`
														${hidden(item.id) ? "opacity-0 translate-y-2 pointer-events-none" : ""}
													`
															}
														/>
													</View>
												</div>
											);
										}
										if (stompActive) {
											// The engine's view waits for its own controller; no url gate needed.
											return (
												<div key={`st-${item.id}`} data-tab-frame={item.id} className={frameClass(item.id)}>
													<StompSite
														id={item.id}
														current={!hidden(item.id)}
														url={item.url}
														navNonce={item.navNonce}
														className={
															"absolute inset-0" +
															" " +
															`
													${hidden(item.id) ? "opacity-0 pointer-events-none" : ""}
	                                            `
														}
													/>
												</div>
											);
										}
										return (
											<div key={proxy === "uv" ? `uv-${item.id}` : item.id} data-tab-frame={item.id} className={frameClass(item.id)}>
												<ExternalSite
													id={item.id}
													current={!hidden(item.id)}
													engine={proxy === "uv" ? "uv" : "sj"}
													url={proxyReady && (proxy !== "uv" || uvReady) ? item.url : undefined}
													className={
														"absolute inset-0" +
														" " +
														`
													${hidden(item.id) ? "opacity-0 pointer-events-none" : ""}
	                                            `
													}
												/>
											</div>
										);
									})
								) : (
									<Home />
								)}
							</Suspense>
							{tabView && <TabView />}
						</div>
						<div
							className={
								"flex flex-col shrink-0 gap-2.5 duration-150" +
								" " +
								`
                            ${panelsOpen ? "w-78" : "w-10"}
                            ${peek && tabsLeft ? "items-end" : ""}
                            ${tabView && (playerTabOpen || !hasMusic) ? "hidden" : ""}
						`
							}
						>
							<div
								className={
									"flex w-full h-max py-2 gap-2 items-center bg-(--secondary) hover:bg-(--tertiary) inset-shadow-(--inset-shadow-primary) *:pointer-events-none cursor-pointer duration-150" +
									" " +
									`
                                ${panelsOpen ? "px-2.5 justify-between" : "px-2 justify-center"}
                                ${rail ? "rounded-3xl" : "rounded-xl"}
                            `
								}
								title={panelsOpen ? "Close Panels" : "Open Panels"}
								onMouseDown={() => {
									panelsOpen ? setPanelsOpen(false) : setPanelsOpen(true);
								}}
							>
								{tabsLeft ? (
									<>
										{panelsOpen ? <ChevronLeftIcon className="size-6 stroke-2 stroke-current" /> : <ChevronRightIcon className="size-6 stroke-2 stroke-current" />}
										{panelsOpen && <span className="font-semibold">Close Panels</span>}
										{panelsOpen && <span className="size-6" />}
									</>
								) : (
									<>
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
									</>
								)}
							</div>
							{/* tabs panel (the tab view shows the tabs instead while the tab view setting is on) */}
							{!tabView && (
								<div
									ref={tabsRef}
									className={
										"flex flex-col flex-1 min-h-0 bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-hidden duration-150" +
										" " +
										`
	                                ${peek ? "w-50" : "w-full"}
	                                ${rail ? "rounded-3xl" : "rounded-2xl"}
	                            `
									}
									// Open on click (capture), not mousedown: widening on mousedown moved the button out from
									// under the cursor before mouseup, so collapsed items never got their click.
									onClickCapture={e => {
										if (panelsOpen || panelClickOpen === "off") return;
										if (panelClickOpen === "except-tabs" && (e.target as Element).closest?.("[data-url][id]")) return;
										setPanelsOpen(true);
									}}
								>
									{renderTabList(rail, peek, panelsOpen)}
								</div>
							)}
							<QuickPlayer
								className={`
                                ${rail ? "flex-none" : playerView === "bigplayer" ? "flex-[1.3]" : "flex-1"} min-h-0
                                ${playerTabOpen || !hasMusic ? "hidden!" : ""}
                            `}
								panelsOpen={panelsOpen}
								onOpenPanels={() => panelClickOpen !== "off" && setPanelsOpen(true)}
							/>
							<MusicAdBreak />
						</div>
					</div>
				</div>
			</div>
		</ModalProvider>
	);
};

export default App;

/** The widest ad the side panel takes (300×250, 300×600); a wider one gets the panel's own unit instead. */
const MAX_SIDE_AD_WIDTH = 300;

function SideAd() {
	const show = useShowAds();
	const [closed, setClosed] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const [slots, setSlots] = useState(2);
	const [shortSlot, setShortSlot] = useState(false);

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
			const tall = Math.min(3, Math.max(2, Math.floor(usable / (AD_UNITS.side.height + 8))));
			setSlots(tall);
			setShortSlot(usable - tall * (AD_UNITS.side.height + 8) >= AD_UNITS.sideShort.height + 8);
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [show, closed]);

	if (!show || closed) return null;
	return (
		// As wide as its ads, up to a 300px one: anything wider is clipped and never widens the panel further.
		<div ref={panelRef} className="hidden lg:flex flex-col shrink-0 min-w-44 max-w-79 rounded-2xl bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-y-auto overflow-x-hidden scrollbar-none">
			<div className="sticky top-0 z-10 m-2 p-2 pb-1.5 bg-(--secondary)">
				<button className="flex items-center gap-1.5 w-full justify-center px-2 py-1 rounded-lg text-xs font-medium text-(--text-secondary) hover:text-(--text-primary) hover:bg-[#ffffff14] duration-150" title="Close ads" onClick={() => setClosed(true)}>
					<XMarkIcon className="size-3.5" />
					Close
				</button>
			</div>
			<div className="flex flex-col items-center gap-2 px-2 pb-2">
				<RevSlot name="left-rail-2" fallback={AD_UNITS.side} maxWidth={MAX_SIDE_AD_WIDTH} className="max-w-full overflow-hidden" />
				{Array.from({ length: slots }, (_, i) => (
					<AdBanner key={i} unit={AD_UNITS.side} refreshMinutes={[5, 10]} className="rounded-lg" />
				))}
				{shortSlot && <AdBanner key="short" unit={AD_UNITS.sideShort} refreshMinutes={[5, 10]} className="rounded-lg" />}
			</div>
		</div>
	);
}
