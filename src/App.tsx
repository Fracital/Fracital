import { createId } from "@paralleldrive/cuid2"
import { useEffect, useRef, useState } from "react"
import { RectangleStackIcon, PlusIcon, Cog6ToothIcon, ChevronLeftIcon, ChevronRightIcon, IdentificationIcon, EllipsisVerticalIcon, XMarkIcon } from "@heroicons/react/24/solid";
import type { detailProps } from "./libs/eventBus";
import XOR from "./libs/XOR";
import { useLocation } from "react-router-dom";

import { Api } from "./Api";

import Shell from "./gui/Shell";
import { QuickPlayer } from "./gui/QuickPlayer"
import { Tab } from "./components/Tab";

import Home from "./views/Home";
import Settings from "./views/Settings";
import ExternalSite from "./views/ExternalSite";
import Files from "./views/Files/Files";

import { BareMuxConnection } from "@mercuryworkshop/bare-mux";
import { usePanelsStore, useSettingsStore, useTabsStore } from "./store";
import { quickLinks } from "./libs/init";
import { initTheme } from "./libs/theme";
import { MusicLibrary } from "./views/Music/MusicLibrary";
import { View } from "./gui/View";
import TabGroup from "./components/TabGroup";
import { Login } from "./views/Login";
import FavoriteModal from "./components/Modal/Favorite";
import { ModalProvider } from "./components/Modal/ModalContext";

const regSw = async () => {
    await navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => {
            registration.unregister()
            .catch(error => {
                console.error('Error unregistering service worker:', error);
            })
        })
    })
    const connection = new BareMuxConnection("/baremux/worker.js");
    await connection.setTransport("/epoxy/index.mjs", [{ wisp: `${window.location.origin.replace(/^https?:\/\//, 'ws://')}/wisp/` }]);
    const { ScramjetController } = window.$scramjetLoadController()
    const scramjet = new ScramjetController({
        prefix: "/service/",
        files: {
			wasm: "/scramjet/scramjet.wasm.wasm",
			all: "/scramjet/scramjet.all.js",
			sync: "/scramjet/scramjet.sync.js",
		},
		defaultFlags: {
			rewriterLogs: false,
		},
		codec: {
			encode: function encode(input: string): string {
				let result = "";
				let len = input.length;
				for (let i = 0; i < len; i++) {
					const char = input[i];
					result += i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char;
				}
				return encodeURIComponent(result);
			},
			decode: function decode(input: string): string {
				if (!input) return input;
				input = decodeURIComponent(input);
				let result = "";
				let len = input.length;
				for (let i = 0; i < len; i++) {
					const char = input[i];
					result += i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char;
				}
				return result;
			},
		},
    });
    scramjet.init()
    navigator.serviceWorker.register("/uv/sw.js", { scope: "/uv/service/" })
    navigator.serviceWorker.register("/scramjet-sw.js", { scope: '/service/' })
}
regSw();


const App = () => {
    Api()
    const settings = useSettingsStore(state => state.settings)
    const setSettings = useSettingsStore(state => state.setSettings)

    const location = useLocation()
    const pathname = location.pathname.replace("/", "")

    const currentPanel = usePanelsStore(state => state.current);
    const setCurrentPanel = usePanelsStore(state => state.setCurrent)
    const setPanelsOpen = usePanelsStore(state => state.setPanelsOpen)

    const tabs = useTabsStore(state => state.tabs)
    const groups = useTabsStore(state => state.groups)
    const currentTab = tabs.find(tab => tab.current === true);
    const setCurrentTab = useTabsStore(state => state.setCurrentTab)
    const panelsOpen = usePanelsStore(state => state.panelsOpen)

    const newGroup = useTabsStore(state => state.newGroup)
    const newTab = useTabsStore(state => state.newTab)
    const closeTab = useTabsStore(state => state.closeTab)
    const updateTab = useTabsStore(state => state.updateTab)

    const [platform, setPlatform] = useState<string>("")
    const [proxy] = useState<string | undefined>(localStorage.getItem("proxy") || undefined)

    const [mainHeight, setMainHeight] = useState<number | undefined>(document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height || 805)
    const [shellHeight, setShellHeight] = useState<number | undefined>(document.querySelector<HTMLDivElement>("#shell")?.getBoundingClientRect().height || 72)

    const tabsRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        initTheme()
    }, [settings.theme]);

    useEffect(() => {
        const getSettings = async () => {
            try {
                const settingsData = await window.fr.fs.promises.readFile("/settings.json", "utf-8");
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
    }, [])

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<detailProps>).detail;

            updateTab(detail.id, {
                url: detail.url,
                title: detail.title,
                icon: detail.icon,
                displayUrl: detail.url,
            });
        };
        window.addEventListener("proxy-navigate", handler);
        return () => window.removeEventListener("proxy-navigate", handler);
    }, []);


    useEffect(() => {
        let detectedPlatform = "";
        if ('userAgentData' in navigator && navigator.userAgentData) {
            // @ts-expect-error: userAgentData is not yet in TypeScript's Navigator type
            detectedPlatform = navigator.userAgentData.platform || "";
        } else if ('platform' in navigator) {
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

    useEffect(() => {
        const mainHeight = document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height
        setMainHeight(mainHeight)
        const shellHeight = document.querySelector<HTMLDivElement>("#shell")?.getBoundingClientRect().height;
        setShellHeight(shellHeight)

        const handleWindowSize = () => {
            const mainHeight = document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height;
            setMainHeight(mainHeight);
            const shellHeight = document.querySelector<HTMLDivElement>("#shell")?.getBoundingClientRect().height;
            setShellHeight(shellHeight)
        };
        window.addEventListener("resize", handleWindowSize);
        return () => window.removeEventListener("resize", handleWindowSize);
    }, [])

    const nextTab = () => {
        const currentIndex = tabs.findIndex(tab => tab.current);
        if (currentIndex !== -1) {
            setCurrentTab(tabs[(currentIndex + 1) % tabs.length].id);
        }
    }

    const prevTab = () => {
        const currentIndex = tabs.findIndex(tab => tab.current);
        if (currentIndex !== -1) {
            setCurrentTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length].id);
        }
    }

    useEffect(() => {
        if (currentTab && (pathname === "account" || pathname === "login" || pathname === "register")) {
            updateTab(currentTab.id, {
                displayUrl: pathname != "account" ? `about:account?${pathname}` : "about:account",
                title: "Account Management",
                url: pathname != "account" ? `about:account?${pathname}` : "about:account"
            })
        }
    }, [location.pathname])

    useEffect(() => {
        const handleKeys = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase()

            if (platform.includes("Mac")) {
                if (e.shiftKey && e.ctrlKey && key === "s") {
                    newTab({
                        id: createId(),
                        title: "Settings",
                        url: "settings",
                        icon: <Cog6ToothIcon className="size-5" />,
                        displayUrl: "settings"
                    })
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
                        url: "newtab",
                        displayUrl: "newtab"
                    })
                }
                if (e.ctrlKey && key === "w") {
                    if (currentTab?.id) {
                        closeTab(currentTab.id)
                    }
                }
                if (e.ctrlKey && key === "q") {
                    tabs.forEach((tab) => {
                        closeTab(tab.id)
                    })
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
                        url: "newtab",
                        displayUrl: "newtab"
                    })
                }
                if (e.altKey && key === "w") {
                    if (currentTab?.id) {
                        closeTab(currentTab.id)
                    }
                }
                if (e.altKey && key === "q") {
                    tabs.forEach((tab) => {
                        closeTab(tab.id)
                    })
                }
            }
            if (e.shiftKey && e.key.toLowerCase() === "arrowup") {
                e.preventDefault();
                prevTab();
            } else if (e.shiftKey && e.key.toLowerCase() === "arrowdown") {
                e.preventDefault();
                nextTab();
            }
        }
        window.addEventListener("keydown", handleKeys)

        return () => {
            window.removeEventListener("keydown", handleKeys)
        }
    })

    return (
        <ModalProvider>
            <div className="flex flex-col size-full gap-2.5 p-3">
                <Shell />
                <div className="flex flex-col size-full">
                    <div id="main" className="relative flex size-full gap-2.5" style={{height: (settings["floating-tabs"] ? "100%" : `calc(100% - calc(${shellHeight}px + calc(var(--spacing) * 2.5))`)}}>
                        <div className={"relative size-full bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-xl overflow-hidden" + " " + `
                            ${
                                settings
                            }
                        `}>
                            {
                                tabs.length > 0 ? tabs.map((item) => {
                                    if (item.url === "newtab") {
                                        return (
                                            <Home key={item.id} className={"absolute inset-0 duration-150" + " " + `
                                                ${
                                                    currentTab ? currentTab.id !== item.id ? "opacity-0 translate-y-2 pointer-events-none" : "" : ""
                                                }
                                            `} />
                                        );
                                    } else if (item.url.includes("about:")) {
                                        const page = item.url.replace("about:", "").split("?")[0];
                                        if (page === "settings") {
                                            return (
                                                <div key={item.id}>
                                                    {currentTab && <View key={item.id} id={item.id}><Settings /></View>}
                                                </div>
                                            );
                                        } else if (page === "music") {
                                            const query = item.url.includes("?") ? item.url.split("?")[1] : undefined;

                                            return (
                                                <div key={item.id}>
                                                    {currentTab && <View key={item.id} id={item.id}><MusicLibrary query={query}/></View>}
                                                </div>
                                            )
                                        } else if (page === "files") {
                                            const query = item.url.includes("?") ? item.url.split("?")[1] : undefined;
                                            return (
                                                <div key={item.id}>
                                                    {currentTab && <View key={item.id} id={item.id}><Files query={query} /></View>}
                                                </div>
                                            )
                                        } else if (page === "account") {
                                            return (
                                                <div key={item.id}>
                                                    {currentTab && <View key={item.id} id={item.id}><Login query={pathname} /></View>}
                                                </div>
                                            )
                                        }
                                    } else {
                                        return (
                                            <ExternalSite
                                                id={item.id}
                                                current={currentTab?.id === item.id}
                                                key={item.id}
                                                url={proxy === "sj" ? "/service/" + XOR.encode(item.url) : "/uv/service/" + XOR.encode(item.url)}
                                                className={"absolute inset-0" + " " + `
                                                    ${
                                                        currentTab ? currentTab.id !== item.id ? "opacity-0 pointer-events-none" : "" : ""
                                                    }
                                                `}
                                            />
                                        );
                                    }
                                }) : <Home />
                            }
                        </div>
                        <div className={(settings["floating-tabs"] && "absolute py-2") + " " + "flex flex-col h-full duration-150" + " " + `
                            ${
                                settings["floating-tabs"] === true ? panelsOpen ? "w-60 right-2" : "w-10 -right-1" : panelsOpen ? "w-78 right-2" : "w-10 -right-1"
                            }
                            ${
                                settings["floating-tabs"] ? "gap-2" : "gap-2.5"
                            }
                        `}>
                            <div className={"flex w-full h-max p-1.5 py-2 gap-2 items-center justify-between bg-(--secondary) hover:bg-(--tertiary) inset-shadow-(--inset-shadow-primary) *:pointer-events-none cursor-pointer duration-150" + " " + `
                                ${
                                    settings["floating-tabs"] && panelsOpen ? "rounded-lg" : "rounded-xl"
                                }
                                ${
                                    settings["floating-tabs"] && panelsOpen ? "shadow-[0_0_16px_3px_#00000035]" : ""
                                }
                            `}
                            title={panelsOpen ? "Close Panels" : "Open Panels"}
                            onMouseDown={() => {
                                panelsOpen ? setPanelsOpen(false) :
                                setPanelsOpen(true)
                            }}>
                                <ChevronLeftIcon className={"size-6 stroke-2 stroke-current" + " " + `
                                    ${panelsOpen ? "opacity-0" : "opacity-100"}
                                `} />
                                {
                                    panelsOpen && (
                                        <>
                                            <span className="font-semibold">Close Panels</span>
                                            <ChevronRightIcon className="size-6 stroke-2 stroke-current" />
                                        </>
                                    )
                                }
                            </div>
                            {/* tabs panel */}
                            <div ref={tabsRef} className={"flex flex-col bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-hidden duration-150" + " " + `
                                ${
                                    currentPanel === "tabs" ? "h-2/3" : "h-1/3"
                                }
                                ${
                                    panelsOpen ? "w-full" : "w-50"
                                }
                                ${
                                    settings["floating-tabs"] && panelsOpen ? "rounded-lg" : "rounded-xl"
                                }
                                ${
                                    settings["floating-tabs"] && "shadow-[0_0_16px_3px_#00000035]"
                                }
                            `} onMouseDown={() => {
                                setPanelsOpen(true)
                                setCurrentPanel("tabs")
                            }}>
                                <div className={"relative flex w-full h-full overflow-auto gap-2 p-2 flex-col items-stretch duration-200"}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
                                        const tabEl = el?.closest('[data-url][id]') as HTMLElement | null;
                                        if (tabEl && tabEl.id) {
                                            const rect = tabEl.getBoundingClientRect();
                                            const y = e.clientY - rect.top;
                                            const placeBefore = y < rect.height / 2;
                                            return;
                                        }
                                        const groupHeader = el?.closest('[data-group-id]') as HTMLElement | null;
                                        if (groupHeader) { return; }
                                        const groupWrapper = el?.closest('[data-group-wrapper]') as HTMLElement | null;
                                        if (groupWrapper) { return; }
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        const draggedId = e.dataTransfer.getData('text/tab-id');
                                        if (!draggedId) return;

                                        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
                                        if (!el) { updateTab(draggedId, { groupId: undefined }); return; }

                                        const tabEl = el.closest('[data-url][id]') as HTMLElement | null;
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

                                        const groupHeader = el.closest('[data-group-id]') as HTMLElement | null;
                                        const groupWrapper = el.closest('[data-group-wrapper]') as HTMLElement | null;
                                        const gid = groupHeader?.getAttribute('data-group-id') || groupWrapper?.getAttribute('data-group-wrapper');
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
                                    {
                                        groups.length > 0 && groups.map((group) => (
                                            <TabGroup key={group.id} id={group.id} name={group.name} icon={group.icon} />
                                        ))
                                    }
                                    {
                                        (() => {
                                            const ungrouped = tabs.filter(t => !t.groupId);
                                            if (tabs.length === 0) {
                                                return (
                                                    <span className={"absolute left-1/2 top-1/2 -translate-1/2 w-max font-semibold text-lg duration-150" + " " + `
                                                        ${
                                                            tabs.length < 0 ? "opacity-0" : ""
                                                        }
                                                    `}>No tabs open</span>
                                                )
                                            }

                                            return ungrouped.length > 0 ? ungrouped.map((item) => (
                                                <Tab title={item.title} url={item.url} id={item.id} icon={item.icon} displayUrl={item.url} key={item.id} />
                                            )) : null
                                        })()
                                    }
                                </div>
                                <div className={"flex min-max-1 w-full p-1.5 items-start justify-between gap-0.5" + " " + `
                                    ${
                                        settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"
                                    }
                                `}>
                                    <div className="flex gap-0.5">
                                        <button title={platform.includes("Mac") ? "New Tab ⌃ + T" : "New Tab: Alt + T"}className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-200"
                                        onClick={() => {
                                            newTab({
                                                id: createId(),
                                                title: "New Tab",
                                                url: "newtab",
                                                current: true,
                                                displayUrl: "newtab"
                                            })
                                        }}>
                                            <PlusIcon className="size-5 stroke-current stroke-1 duration-150" />
                                        </button>
                                        <button title={platform.includes("Mac") ? "New Group ⌃ + T" : "New Group: Alt + T"}className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-200"
                                        onClick={() => {
                                            const groupId = createId();
                                            newGroup(groupId, `Group ${groups.length + 1}`)
                                        }}>
                                            <RectangleStackIcon className="size-4.5 duration-150" />
                                            <PlusIcon className="size-3 stroke-current stroke-1 duration-150" />
                                        </button>
                                    </div>
                                    <div className="flex gap-0.5 items-center h-full">
                                    </div>
                                </div>
                            </div>
                            <QuickPlayer className={`
                                ${
                                    currentPanel === "quickplayer" ? "h-2/3" : "h-1/3"
                                }
                            `} panelsOpen={panelsOpen} onMouseDown={() => {
                                setPanelsOpen(true)
                                setCurrentPanel("quickplayer")
                            }} />
                        </div>
                    </div>
                </div>
            </div>
        </ModalProvider>
    );
}

export default App;