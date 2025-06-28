import { ChevronDownIcon, UserCircleIcon, ArrowLeftStartOnRectangleIcon, InformationCircleIcon, LifebuoyIcon, UserIcon } from "@heroicons/react/24/solid";
import { FireIcon, WrenchScrewdriverIcon, CheckBadgeIcon } from "@heroicons/react/24/solid"
import { Suspense, useState } from "react";
import { useSettingsStore } from "../store";

interface UserProps {
    id: string;
    display: string;
    handle: string;
    email: string;
    avatar: string;
    size: number;
    createdAt: string;
    updatedAt: string;
    lastLogin: string;
    isDev: boolean;
    isActive: boolean;
    isVerified: boolean;
    isAmplified: boolean;
}

export const UserCard = ({ id, display, handle, avatar, size, isAmplified, isVerified, isDev }: UserProps) => {
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
                        <img src={avatar} alt={`${display}'s avatar`} className="size-7 rounded-full pointer-events-none select-none" />
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
                                        `} title="Amplified since Jun 28 2025" />
                                    )
                                }
                                {
                                    isDev && (
                                        <WrenchScrewdriverIcon className={"size-7 p-1.5 rounded-md duration-150" + " " + `
                                            ${
                                                settings.brightness === "light" ? "text-[#eef370] hover:bg-[#ffffff30]" : "text-[#dbe050] hover:bg-[#ffffff18]"
                                            }
                                        `} title="Developer: 12 Items" />
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