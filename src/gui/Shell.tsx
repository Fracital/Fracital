import { Cog6ToothIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, ChevronUpDownIcon, ChevronDownIcon, UserCircleIcon, ArrowLeftStartOnRectangleIcon, InformationCircleIcon, LifebuoyIcon, UserIcon } from "@heroicons/react/24/solid";
import { FireIcon, WrenchScrewdriverIcon, CheckBadgeIcon } from "@heroicons/react/24/solid"
import { Suspense, useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { ShellButton } from "../components/ShellButton";
import { useTabsStore, useSettingsStore } from "../store";
import { createId } from "@paralleldrive/cuid2";
import { Search } from "../components/Search";

declare global {
    interface Window {
        $scramjet: any;
        ScramjetController: any;
    }
}

interface UserProps {
    id: string;
    display: string;
    handle: string;
    avatar: string | React.ReactNode;
    isDev: boolean;
    isActive: boolean;
    isVerified: boolean;
    isAmplified: boolean;
}

export const UserCard = ({ id, display, handle, avatar, isAmplified, isVerified, isDev }: UserProps) => {
    const [contextOpen, setContextOpen] = useState<boolean>(false)
    const settings = useSettingsStore(state => state.settings)

    return (
        <>
            <div className="relative flex flex-col gap-2.5 h-[28px]" onClick={() => {
                setContextOpen((prev) => !prev)
            }}>
                <div className="group flex gap-2.5 items-center cursor-pointer" title={display + "\n@" + handle}>
                    <ChevronDownIcon className={"text-(--text-tertiary) group-hover:text-(--text-primary) size-5 stroke-2 stroke-current group-hover:translate-y-0.5 pointer-events-none duration-200" + " " + `
                        ${
                            contextOpen ? "-rotate-180 group-hover:rotate-[-165deg] group-active:rotate-[-140deg]" : "group-hover:rotate-[-15deg] group-active:rotate-[-30deg]"
                        }
                    `} />
                    <Suspense fallback={<UserCircleIcon className="size-7 text-(--text-secondary) pointer-events-none" />}>
                        {
                            typeof avatar === "string" ? (
                                <img src={avatar} alt={`${display}'s avatar`} className="size-7 rounded-full pointer-events-none select-none" />
                            ) : (avatar)
                        }
                    </Suspense>
                </div>
                <div className={"absolute flex flex-col items-center gap-1 top-[calc(28px+28px)] -right-3 bg-(--secondary) shadow-[0_0_8px_1px_#00000035] inset-shadow-(--inset-shadow-secondary) rounded-xl z-10 duration-150 overflow-hidden" + " " + `
                    ${
                        contextOpen ? "" : "-translate-y-2 opacity-0 pointer-events-none"
                    }
                `}>
                    <div className={"flex flex-col w-full last:rounded-b-md p-1.5 pb-0 overflow-hidden duration-500" + " " + `
                        ${
                            contextOpen ? "" : "-translate-y-2 opacity-0"
                        }
                    `}>
                        <button className={"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" + " " + `
                            ${
                                settings.brightness === "light" ? "hover:bg-[#00000018]" : "hover:bg-[#ffffff10]"
                            }
                        `}>
                            <span className="text-md font-semibold leading-none w-max">Manage Account</span>
                            <UserIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
                        </button>
                        <button className={"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" + " " + `
                            ${
                                settings.brightness === "light" ? "hover:bg-[#00000018]" : "hover:bg-[#ffffff10]"
                            }
                        `}>
                            <span className="text-md font-semibold leading-none w-max">Privacy Policy</span>
                            <InformationCircleIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
                        </button>
                        <button className={"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" + " " + `
                            ${
                                settings.brightness === "light" ? "hover:bg-[#00000018]" : "hover:bg-[#ffffff10]"
                            }
                        `}>
                            <span className="text-md font-semibold leading-none w-max">Help</span>
                            <LifebuoyIcon className="size-5.5 group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
                        </button>
                        <button className={"group flex items-center justify-between gap-5 w-[calc(100%)] p-2 pl-3 pr-2 rounded-md leading-none text-(--text-secondary) hover:text-(--text-primary) duration-100 cursor-pointer" + " " + `
                            ${
                                settings.brightness === "light" ? "hover:bg-[#00000018] hover:text-[#ff5656] hover:text-shadow-[0_0_6px_#00000040]" : "hover:bg-[#ffffff10] hover:text-[#d03b3b]"
                            }
                        `}>
                            <span className="text-md font-semibold leading-none w-max">Logout</span>
                            <ArrowLeftStartOnRectangleIcon className="size-5.5 stroke-0.5 stroke-current group-active:scale-125 group-hover:scale-110 pointer-events-none duration-150" />
                        </button>
                    </div>
                    <div className="flex p-1.5 pt-0">
                        <div className={"flex justify-between items-center gap-6 w-full p-0.5 rounded-lg bg-(--tertiary) overflow-hidden" + " " + `
                            ${
                                settings.brightness === "light" ? "" : ""
                            }
                        `}>
                            <div className="group relative flex p-1.5 items-center gap-2.5 cursor-copy" onMouseDown={() => {
                                navigator.clipboard.writeText(`@${handle}`);
                            }}>
                                <span className="font-bold text-lg text-(--text-tertiary) rounded-lg p-1 translate-y-0 group-hover:-translate-y-1 group-hover:opacity-0 opacity-100 group-hover:text-(--text-primary) leading-none pointer-events-none duration-150">{display}</span>
                                <span className="absolute text-(--text-secondary) p-1 translate-y-2 group-hover:translate-y-0 group-hover:opacity-100 opacity-0 font-semibold leading-none pointer-events-none duration-200">@{handle}</span>
                            </div>
                            <div className="flex items-center pr-1">
                                {
                                    isVerified && (
                                        <CheckBadgeIcon className={"size-7 p-1 rounded-md stroke-0.5 duration-150" + " " + `
                                            ${
                                                settings.brightness === "light" ? "text-[#9fc8ff] hover:bg-[#ffffff30]" : "text-[#398fff] hover:bg-[#ffffff18]"
                                            }
                                        `} title="Verified User" />
                                    )
                                }
                                {
                                    isAmplified && (
                                        <FireIcon className={"size-7 p-1 rounded-md duration-150" + " " + `
                                            ${
                                                settings.brightness === "light" ? "text-[#d74040] hover:bg-[#ffffff30]" : "text-[#fb6262] hover:bg-[#ffffff18]"
                                            }
                                        `} title="Amplified since null" />
                                    )
                                }
                                {
                                    isDev && (
                                        <WrenchScrewdriverIcon className={"size-7 p-1.5 rounded-md duration-150" + " " + `
                                            ${
                                                settings.brightness === "light" ? "text-[#eef370] hover:bg-[#ffffff30]" : "text-[#dbe050] hover:bg-[#ffffff18]"
                                            }
                                        `} title="Developer: null items" />
                                    )
                                }
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

const Shell = () => {
    const newTab = useTabsStore(state => state.newTab)
    const tabs = useTabsStore(state => state.tabs)

    const [proxy, setProxy] = useState<"uv" | "sj">("uv");

    const uvRef = useRef<HTMLDivElement>(null);
    const sjRef = useRef<HTMLDivElement>(null);

    const [fullscreen] = useState<boolean>(false)

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
        <div className={"flex justify-between gap-2.5 p-3 rounded-xl bg-(--secondary) inset-shadow-(--inset-shadow-primary) duration-200"}>
            <div className="flex items-center justify-start gap-2.5">
                <Link to="/" className="group cursor-pointer">
                    <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-9 group-hover:-translate-y-1 duration-150 pointer-events-none">
                        <circle cx="64" cy="64" r="64" className="fill-(--logo-primary)" />
                        <path fillRule="evenodd" clipRule="evenodd" d="M64 0C99.3462 0 128 28.6538 128 64C128 99.3462 99.3462 128 64 128C28.6538 128 0 99.3462 0 64C0 28.6538 28.6538 0 64 0ZM64 7C32.5198 7 7 32.5198 7 64C7 95.4802 32.5198 121 64 121C95.4802 121 121 95.4802 121 64C121 32.5198 95.4802 7 64 7Z" fill="white" fillOpacity="0.5"/>
                        <path d="M51 87V41H81V51.5H62.1278V59.75H78.9222L76.5 70.25H62.1278V85L51 87Z" className="fill-(--logo-secondary)" />
                    </svg>
                </Link>
                <div className="relative flex items-center justify-center">
                    {
                        tabs && tabs.length > 0 ? tabs.map((tab, index) => (
                            <Search tab={tab} key={index} />
                        )) : (
                            <Search />
                        )
                    }
                </div>
            </div>
            {/* <div className="relative flex items-center justify-center">
            </div> */}
            <div className="flex items-center justify-end gap-2.5">
                <div className={"group relative flex justify-center items-center min-h-5 p-2 px-3 gap-1 rounded-full bg-(--primary) cursor-pointer duration-200" + " " + `
                    inset-shadow-(--inset-shadow-secondary)
                    hover:inset-shadow-[0_0_0_2px_var(--accent)]
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
                                <span className="text-(--text-secondary) group-hover:text-(--text-primary) font-bold text-lg duration-150">UV</span>
                                <span className="text-(--text-tertiary) group-hover:text-(--text-primary) font-semibold duration-150">{uvVersion}</span>
                            </div>
                            <div ref={sjRef} className={"flex items-center justify-center gap-2 duration-150" + " " + `
                                ${proxy === "sj" ? "" : "absolute opacity-0 pointer-events-none"}
                            `}>
                                <span className="text-(--text-secondary) group-hover:text-(--text-primary) font-bold text-lg duration-150">Scramjet</span>
                                <span className="text-(--text-tertiary) group-hover:text-(--text-primary) font-semibold duration-150">{sjVersion}</span>
                            </div>
                        </div>
                    </div>
                    <ChevronUpDownIcon className="size-5 text-(--text-tertiary) group-hover:text-(--text-secondary) stroke-current stroke-1 cursor-pointer duration-150" />
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
                    icon: <Cog6ToothIcon className="size-5" />,
                    displayUrl: "settings"
                })}></ShellButton>
                <UserCard avatar={<UserCircleIcon className="size-8" />} id="anon" display="Guest" handle="anon" isActive={true} isDev={true} isAmplified={true} isVerified={true} />
            </div>
        </div>
    );
}

export default Shell;