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
import type { TabProps } from "./components/Tab";

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
    const tabs = useTabsStore(state => state.tabs);
    const currentTab = tabs.find(tab => tab.current === true);
    const tabsOpen = useTabsStore(state => state.tabsOpen)
    const setTabsOpen = useTabsStore(state => state.setTabsOpen)
    const newTab = useTabsStore(state => state.newTab)
    const closeTab = useTabsStore(state => state.closeTab)
    const updateTab = useTabsStore(state => state.updateTab)
    const [url, setUrl] = useState<string | undefined>(undefined);
    const [proxy] = useState<string | undefined>(localStorage.getItem("proxy") || undefined)
    const [mainHeight, setMainHeight] = useState<number | undefined>(document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height || 805)
    const [proxiedUrl, setProxied] = useState<string | undefined>();

    const tabsRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handle = (e: Event) => {
            const { detail } = e as CustomEvent<detailProps>;
            const current = tabs.find(tab => tab.current === true);

            if (current && detail) {
                console.log(detail);
                updateTab(current.id, {
                    url: detail.url,
                    title: detail.title,
                    icon: detail.icon
                });
            }
        }
        window.addEventListener("proxy-navigate", handle as EventListener)
        return () => window.removeEventListener("proxy-navigate", handle as EventListener)
    }, [])

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
        if (!url) return;
        const finalUrl = proxy === "sj" ? "/service/" + XOR.encode(url) : "/uv/service/" + XOR.encode(url);
        setProxied(finalUrl);
    }, [url]);

    useEffect(() => {
        const handleKeys = (e: KeyboardEvent) => {
            if (e.shiftKey && e.key === "S") tabsOpen ? setTabsOpen(false) : setTabsOpen(true)
            else if (e.shiftKey && e.key === "T") {
                newTab({
                    id: createId(),
                    title: "New Tab",
                    url: "newtab"
                })
            } else if (e.shiftKey && e.key === "W") {
                if (currentTab?.id) {
                    closeTab(currentTab.id)
                }
            }
        }
        window.addEventListener("keypress", handleKeys)

        return () => {
            window.removeEventListener("keypress", handleKeys)
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
                        `}>
                            <div style={{
                                height: `calc(${mainHeight}px - calc(var(--spacing) * 12))`
                            }} className={"relative flex w-full h-full overflow-auto gap- gap-2 p-2 flex-col items-center duration-150"}>
                                {
                                    tabs.length > 0 ? tabs.map((item, index) => (
                                        <Tab title={item.title} url={item.url} id={item.id} icon={item.icon} key={index} />
                                    )) :
                                    <span className={"absolute left-1/2 top-1/2 -translate-1/2 w-max font-semibold text-lg duration-150" + " " + `
                                        ${
                                            tabs.length < 0 ? "opacity-0" : ""
                                        }
                                    `}>No tabs open</span>
                                }
                            </div>
                            <div className="flex min-max-1 w-full p-1.5 items-start justify-start gap-0.5 bg-[#ffffff10]">
                                <div title="Toggle Tabs ⇧ + S" className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-text-secondary hover:text-text-primary rounded-md cursor-pointer duration-150" onClick={() => {
                                    tabsOpen ? setTabsOpen(false) : setTabsOpen(true)
                                }}>
                                    <RectangleStackIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" />
                                </div>
                                <div title="New Tab ⇧ + T" className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-text-secondary hover:text-text-primary rounded-md cursor-pointer duration-200"
                                onClick={() => {
                                    newTab({
                                        id: createId(),
                                        title: "New Tab",
                                        url: "newtab",
                                        current: true
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