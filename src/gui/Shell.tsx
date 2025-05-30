import { Cog6ToothIcon, MagnifyingGlassIcon, XMarkIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, ChevronUpDownIcon, RectangleStackIcon } from "@heroicons/react/24/solid";
import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ShellButton } from "../components/ShellButton";
import { useTabsStore } from "../store";
import { createId } from "@paralleldrive/cuid2";
import { Search } from "../components/Search";

declare global {
    interface Window {
        $scramjet: any;
        ScramjetController: any;
    }
}

const Shell = () => {
    const newTab = useTabsStore(state => state.newTab)
    const tabs = useTabsStore(state => state.tabs)
    const location = useLocation();

    const [proxy, setProxy] = useState<"uv" | "sj">("uv");

    const searchRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const uvRef = useRef<HTMLDivElement>(null);
    const sjRef = useRef<HTMLDivElement>(null);

    const currentTab = tabs.find(tab => tab.current === true);
    const [searchFocused, setSearchFocused] = useState(false);
    const [hasQuery, setHasQuery] = useState(currentTab?.url || false);
    const [fullscreen, setFullscreen] = useState<boolean>(false)

    const [uvVersion] = useState("v3.2.7");
    const [sjVersion] = useState(window.$scramjet.version.version);

    const handleProxyChange = (e: Event) => {
        const customEvent = e as CustomEvent;
        const newProxy = customEvent.detail.proxy;
        if (newProxy === "sj" || newProxy === "uv") {
            setProxy(newProxy);
            window.localStorage.setItem("proxy", newProxy);
        }
    };

    useEffect(() => {
        const storedProxy = window.localStorage.getItem("proxy");
        if (storedProxy === "sj" || storedProxy === "uv") {
            setProxy(storedProxy as "uv" | "sj");
        }
    }, []);

    useEffect(() => {
        window.addEventListener("proxy-change", handleProxyChange);
        return () => {
            window.removeEventListener("proxy-change", handleProxyChange);
        };
    }, []);

    return (
        <div className={"flex justify-between gap-2.5 p-3 rounded-xl bg-secondary inset-shadow-primary duration-200" + " " + `
            ${searchFocused ? "p-4" : "p-3"}
        `}>
            <div className="flex items-center justify-start gap-1.5">
                <Link to="/" className="group cursor-pointer">
                    <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-9 group-hover:-translate-y-1 duration-150 pointer-events-none">
                        <circle cx="64" cy="64" r="64" fill="#FB74FE"/>
                        <path fillRule="evenodd" clipRule="evenodd" d="M64 0C99.3462 0 128 28.6538 128 64C128 99.3462 99.3462 128 64 128C28.6538 128 0 99.3462 0 64C0 28.6538 28.6538 0 64 0ZM64 7C32.5198 7 7 32.5198 7 64C7 95.4802 32.5198 121 64 121C95.4802 121 121 95.4802 121 64C121 32.5198 95.4802 7 64 7Z" fill="white" fillOpacity="0.5"/>
                        <path d="M51 87V41H81V51.5H62.1278V59.75H78.9222L76.5 70.25H62.1278V85L51 87Z" fill="#FFE866"/>
                    </svg>
                </Link>
                <div className={"flex items-center gap-1.5 duration-150" + " " + `
                    ${location.pathname === "/" ? "opacity-0 pointer-events-none -translate-x-3" : ""}
                `}>
                    <span className="font-black text-xl">/</span>
                    <span className={"font-semibold text-xl duration-150" + " " + `
                        ${location.pathname === "/" ? "opacity-0 -translate-x-5" : ""}
                    `}>
                        {
                            location.pathname === "/settings" && "Settings"
                        }
                        {
                            location.pathname === "/games" && "Games"
                        }
                    </span>
                </div>
            </div>
            <div className="relative">
                {
                    tabs && tabs.length > 0 ? tabs.map((tab, index) => (
                        <Search tab={tab} key={index} />
                    )) : (
                        <Search tab={{title: "New Tab", url: "newtab", id: createId(), icon: null}}/>
                    )
                }
            </div>
            <div className="flex items-center justify-end gap-2.5">
                <div className={"group relative flex justify-center items-center min-h-5 p-2 px-3 gap-1 rounded-full bg-primary cursor-pointer duration-200" + " " + `
                    shadow-[inset_0_0_0_2px_#ffffff18_,_0_0_4px_2px_#00000040]
                    hover:shadow-[inset_0_0_0_2px_#fb74fe]
                `} onMouseDown={() => {
                    window.dispatchEvent(new CustomEvent("proxy-change", {
                        detail: {
                            proxy: proxy === "uv" ? "sj" : "uv"
                        }
                    }))
                }}>
                    <div className="flex items-center overflow-hidden h-5">
                        <div className={"flex flex-col items-start gap-2 h-4.5 duration-150" + " " + `
                            ${proxy === "uv" ? "" : "-translate-y-6.5 pointer-events-none"}
                        `}>
                            <div ref={uvRef} className={"flex items-center justify-center gap-2 duration-150"}>
                                <span className="text-text-secondary group-hover:text-text-primary font-bold text-lg duration-150">UV</span>
                                <span className="text-text-tertiary group-hover:text-text-secondary font-semibold duration-150">{uvVersion}</span>
                            </div>
                            <div ref={sjRef} className={"flex items-center justify-center gap-2 duration-150" + " " + `
                                ${proxy === "sj" ? "" : "absolute opacity-0 pointer-events-none"}
                            `}>
                                <span className="text-text-secondary group-hover:text-text-primary font-bold text-lg duration-150">Scramjet</span>
                                <span className="text-text-tertiary group-hover:text-text-secondary font-semibold duration-150">{sjVersion}</span>
                            </div>
                        </div>
                    </div>
                    <ChevronUpDownIcon className="size-5 text-text-tertiary group-hover:text-text-secondary stroke-current stroke-1 cursor-pointer duration-150" />
                </div>
                <ShellButton title={["Enter Fullscreen", "Exit Fullscreen"]} type="toggle"
                icon={fullscreen ? [
                    <ArrowsPointingInIcon className="size-6 text-current stroke-current stroke-0.5" />,
                    <ArrowsPointingOutIcon className="size-6 text-current stroke-current stroke-0.5" />
                ]: [
                    <ArrowsPointingOutIcon className="size-6 text-current stroke-current stroke-0.5" />,
                    <ArrowsPointingInIcon className="size-6 text-current stroke-current stroke-0.5" />
                ]}
                registerListeners={(toggleState) => {
                    const handleFullscreenChange = () => {
                        toggleState(document.fullscreenElement ? 1 : 0)
                    }
                    window.addEventListener("fullscreenchange", handleFullscreenChange)
                    return () => {
                        window.removeEventListener("fullscreenchange", handleFullscreenChange)
                    }
                }}
                onClick={() => {
                    if(document.fullscreenElement) {
                        document.exitFullscreen()
                    } else {
                        if (document.body) {
                            document.body.requestFullscreen().catch((err) => {
                                console.error("Error attempting to enable full-screen mode:", err);
                            })
                        }
                    }
                }}></ShellButton>
                <ShellButton title="Settings" type="icon" icon={<Cog6ToothIcon className="size-6" />} onClick={() => newTab({
                    id: createId(),
                    title: "Settings",
                    url: "settings",
                    icon: <Cog6ToothIcon className="size-5" />
                })}></ShellButton>
            </div>
        </div>
    );
}

export default Shell;