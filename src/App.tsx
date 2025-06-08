import { createId } from "@paralleldrive/cuid2"
import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Link } from 'react-router-dom';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { RectangleStackIcon, PlusIcon } from '@heroicons/react/24/solid';
import type { detailProps } from "./libs/eventBus";
import XOR from './libs/XOR';
import Shell from './gui/Shell';

import { Tab } from './components/Tab';

import Home from './views/Home';
import Settings from './views/Settings';
import ExternalSite from './views/ExternalSite';
import { BareMuxConnection } from '@mercuryworkshop/bare-mux';
import { useTabsStore } from './store';

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
    const scramjet = new window.ScramjetController({
        prefix: "/service/",
        files: {
            wasm: "/scramjet/scramjet.wasm.wasm",
            worker: "/scramjet/scramjet.worker.js",
            client: "/scramjet/scramjet.client.js",
            shared: "/scramjet/scramjet.shared.js",
            sync: "/scramjet/scramjet.sync.js",
        },
        defaultFlags: {
            rewriterLogs: false,
        },
        codec: {
            encode: `
                if (!url) return Promise.resolve(url);
                let result = "";
                let len = url.length;
                    for (let i = 0; i < len; i++) {
                        const char = url[i];
                        result += i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char;
                    }
                return encodeURIComponent(result);
            `,
            decode: `
                if (!url) return Promise.resolve(url);
                url = decodeURIComponent(url);
                let result = "";
                let len = url.length;
                for (let i = 0; i < len; i++) {
                    const char = url[i];
                    result += i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char;
                }
                return result;
            `,
        }
    });
    scramjet.init()
    navigator.serviceWorker.register("/uv/sw.js", { scope: "/uv/service/" })
    navigator.serviceWorker.register("/scramjet-sw.js", { scope: '/service/' })
}
regSw();

const App = () => {
    const [tabs, setTabs] = useState(useTabsStore(state => state.tabs));
    const currentTab = tabs.find(tab => tab.current === true);
    const tabsOpen = useTabsStore(state => state.tabsOpen)
    const setTabsOpen = useTabsStore(state => state.setTabsOpen)
    const newTab = useTabsStore(state => state.newTab)
    const closeTab = useTabsStore(state => state.closeTab)
    const updateTab = useTabsStore(state => state.updateTab)
    const [platform, setPlatform] = useState<string>("")
    const [proxy] = useState<string | undefined>(localStorage.getItem("proxy") || undefined)
    const [mainHeight, setMainHeight] = useState<number | undefined>(document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height || 805)

    const tabsRef = useRef<HTMLDivElement>(null)

    // useEffect(() => {
    //     const handle = (e: Event) => {
    //         const { detail } = e as CustomEvent<detailProps>;
    //         console.log("Event received:", detail);

    //         const tab = tabs.find((t) => t.id === detail.id);
    //         if (tab) {
    //             console.log("Updating tab:", tab.id);
    //             updateTab(tab.id, {
    //                 url: detail.url,
    //                 title: detail.title,
    //                 icon: detail.icon,
    //                 displayUrl: detail.url
    //             });
    //         } else {
    //             console.warn("Tab not found for ID:", detail.id);
    //         }
    //     }
    //     window.addEventListener("proxy-navigate", handle as EventListener)
    //     return () => window.removeEventListener("proxy-navigate", handle as EventListener)
    // }, [])

        useEffect(() => {
            const handler = (e: Event) => {
                const detail = (e as CustomEvent<detailProps>).detail;
                setTabs((prevTabs) => {
                    const index = prevTabs.findIndex((t) => t.id === detail.id);
                    if (index === -1) return prevTabs;
    
                    const updatedTabs = [...prevTabs];
                    updatedTabs[index] = {
                        ...updatedTabs[index],
                        url: detail.url,
                        displayUrl: detail.url,
                        title: detail.title,
                        icon: detail.icon,
                    };
                    return updatedTabs;
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
        const height = document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height
        setMainHeight(height)

        const handleWindowSize = () => {
            const height = document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height;
            setMainHeight(height);
        };
        window.addEventListener("resize", handleWindowSize);
        return () => window.removeEventListener("resize", handleWindowSize);
    })

    useEffect(() => {
        const handleKeys = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase()

            if ((platform.includes("Mac") && e.ctrlKey && key === "s") || e.altKey && key === "s") tabsOpen ? setTabsOpen(false) : setTabsOpen(true)
            else if ((platform.includes("Mac") && e.ctrlKey && key === "t") || e.altKey && key === "t") {
                newTab({
                    id: createId(),
                    title: "New Tab",
                    url: "newtab",
                    displayUrl: "newtab"
                })
            } else if (e.shiftKey && e.key === "W") {
                if (currentTab?.id) {
                    closeTab(currentTab.id)
                }
            } else if (e.shiftKey && e.key === "Q") {
                tabs.forEach((tab) => {
                    closeTab(tab.id)
                })
            }
        }
        window.addEventListener("keydown", handleKeys)

        return () => {
            window.removeEventListener("keydown", handleKeys)
        }
    })

    return (
        <div className="flex flex-col size-full gap-2.5 p-3">
            <Shell />
            <div className="flex flex-col size-full gap-[1px]">
                <div id="main" className="relative flex size-full gap-2.5">
                    <div className={"relative size-full bg-secondary inset-shadow-primary rounded-xl overflow-hidden"}>
                        {/* <Routes>
                            <Route path="/" element={
                                url === undefined ?
                                <Home /> : <ExternalSite url={proxiedUrl} />
                            } />
                            <Route path="/settings" element={<Settings />} />
                        </Routes> */}
                        {
                            tabs.length > 0 ? tabs.map((item, index) => (
                                item.url === "newtab" ?
                                <Home key={index} className={"absolute inset-0" + " " + `
                                    ${
                                        currentTab ? currentTab.id !== item.id ? "opacity-0 pointer-events-none" : "" : ""
                                    }
                                `} /> :
                                item.url === "settings" ? <Settings className={"absolute inset-0" + " " + `
                                    ${
                                        currentTab ? currentTab.id !== item.id ? "opacity-0 pointer-events-none" : "" : ""
                                    }
                                `} /> :
                                <ExternalSite key={index} url={proxy === "sj" ? "/service/" + XOR.encode(item.url) : "/uv/service/" + XOR.encode(item.url)} className={"absolute inset-0" + " " + `
                                    ${
                                        currentTab ? currentTab.id !== item.id ? "opacity-0 pointer-events-none" : "" : ""
                                    }
                                `} />
                            )) : <Home />
                        }
                    </div>
                    <div className={"absolute flex flex-col justify-center h-full duration-150" + " " + `
                        ${
                            tabsOpen ? "w-60 right-1.5" :  "w-10 -right-1"
                        }
                    `}>
                        <div ref={tabsRef} className={"flex flex-col h-[calc(100%-12px)] bg-secondary shadow-[0_0_16px_3px_#00000035] inset-shadow-primary overflow-hidden duration-150" + " " + `
                            ${
                                tabsOpen ? "w-full rounded-lg" : "w-50 rounded-xl"
                            }
                        `} onMouseDown={() => {
                            setTabsOpen(true)
                        }}>
                            <div style={{
                                height: `calc(${mainHeight}px - calc(var(--spacing) * 12))`
                            }} className={"relative flex w-full h-full overflow-auto gap-2 p-2 px-3 flex-col items-center duration-200"}>
                                {
                                    tabs.length > 0 ? tabs.map((item, index) => (
                                        <Tab title={item.title} url={item.url} id={item.id} icon={item.icon} displayUrl={item.url} key={index} />
                                    )) :
                                    <span className={"absolute left-1/2 top-1/2 -translate-1/2 w-max font-semibold text-lg duration-150" + " " + `
                                        ${
                                            tabs.length < 0 ? "opacity-0" : ""
                                        }
                                    `}>No tabs open</span>
                                }
                            </div>
                            <div className="flex min-max-1 w-full p-1.5 items-start justify-start gap-0.5 bg-[#ffffff10]">
                                <div title={platform.includes("Mac") ? "Toggle Tabs ⌃ + S" : "Toggle Tabs: Alt + S"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-text-secondary hover:text-text-primary rounded-md cursor-pointer duration-150" onClick={() => {
                                    tabsOpen ? setTabsOpen(false) : setTabsOpen(true)
                                }}>
                                    <RectangleStackIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" />
                                </div>
                                <div title={platform.includes("Mac") ? "New Tab ⌃ + T" : "New Tab: Alt + T"}className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-text-secondary hover:text-text-primary rounded-md cursor-pointer duration-200"
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
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex items-center bg-secondary inset-shadow-primary rounded-md w-full overflow-hidden">
                <Link target="_blank" to="/LICENSE" className="flex items-center h-full px-2.5 leading-none text-text-quaternary font-bold text-lg hover:bg-quaternary duration-150">© Fracital 2025</Link>
                <div className="flex gap-1.5 p-1.5">
                    <Link target="_blank" to="https://discord.gg/unblock" className="flex items-center gap-1.5 text-text-quaternary hover:text-text-tertiary font-bold text-lg">
                        <FontAwesomeIcon icon={faDiscord} className="text-current duration-150" />
                        <span className="text-current duration-150">Discord</span>
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default App;