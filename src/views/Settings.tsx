import { useState } from "react";
import { RectangleGroupIcon, PaintBrushIcon, PlusIcon } from "@heroicons/react/24/solid";
import LinkCard from "../components/LinkCard";
import { isColorBright } from "../libs/colorBright";
import { quickLinks } from "../libs/init";
import type { linkProps } from "./Home";

interface SettingsProps {
    className?: string
}

const Settings = ({ className }: SettingsProps) => {
    const [page, setpage] = useState<string>("general")
    const [links] = useState<linkProps[]>(
        (() => {
            const stored = window.localStorage.getItem("quicklinks");
            try {
                return stored ? JSON.parse(stored) : quickLinks;
            } catch {
                return quickLinks;
            }
        })()
    );

    return (
        <div className={"size-full flex p-2 gap-3" + " " + className}>
            <div className="flex flex-col gap-2">
                <div className="flex flex-col py-2 px-3.5 gap-2 bg-quaternary inset-shadow-primary-lighter rounded-lg">
                    <TabItem
                        currentPage={page}
                        setPage={setpage}
                        icon={<RectangleGroupIcon className="size-8 text-current" />}
                        name="General"
                        pageKey="general"
                    />
                    <TabItem
                        currentPage={page}
                        setPage={setpage}
                        icon={<PaintBrushIcon className="size-7 text-current" />}
                        name="Appearance"
                        pageKey="app"
                    />
                </div>
            </div>
            <div className="relative">
                {
                    page === "general" ? (
                        <div className="flex flex-col gap-2">
                            <h1 className="text-2xl font-bold">Quick Links</h1>
                            <div className="flex flex-wrap gap-2">
                                {
                                    links.length > 0 && links.map((link, index) => (
                                        <LinkCard
                                            key={index}
                                            title={link.title}
                                            icon={link.icon}
                                            color={link.color}
                                            edit={true}
                                            href={link.href}
                                            id={index}
                                            brightness={isColorBright(link.color)}
                                        />
                                    ))
                                }
                                <div className="flex flex-col p-3 rounded-2xl bg-[#ffffff25] hover:bg-[#ffffff35] overflow-hidden cursor-pointer duration-200" onMouseDown={() => {
                                    const linkname = prompt("Enter the name of the new link:");
                                    if (!linkname || linkname.trim() === "") return;
                                    const linkicon = prompt("Enter the URL of the icon for this link (leave empty for default):");
                                    const linkcolor = prompt("Enter the color for this link (leave empty for default):");
                                    const linkurl = prompt("Enter the URL for this link:");
                                    if (!linkurl || linkurl.trim() === "") return;
                                    const newLink: linkProps = {
                                        title: linkname,
                                        icon: linkicon && linkicon.trim() !== "" ? linkicon : "default",
                                        color: linkcolor && linkcolor.trim() !== "" ? linkcolor : "#ffffff",
                                        href: linkurl
                                    };
                                    const stored = window.localStorage.getItem("quicklinks");
                                    const links = stored ? JSON.parse(stored) : [];
                                    links.push(newLink);
                                    window.localStorage.setItem("quicklinks", JSON.stringify(links));
                                    window.location.reload();
                                }}>
                                    <div className="*:pointer-events-none *:select-none">
                                        <div className="flex items-center justify-center py-5 px-22">
                                            <div className="flex sm:size-16 size-8 justify-center items-center">
                                                {
                                                    <PlusIcon className="size-10 rounded-full stroke-current stroke-2 duration-200" />
                                                }
                                            </div>
                                        </div>
                                        <div className="flex w-full justify-center">
                                            <span className={"font-extrabold text-lg leading-none" + " " + `text-[#ffffffc7]
                                            `}>Add Site</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : page === "app" ? (
                        <div className="flex flex-col gap-2">
                            <h1 className="text-2xl font-bold">Coming soon!</h1>
                        </div>
                    ) : null
                }
            </div>
        </div>
    )
}
interface TabItemProps {
    currentPage: string;
    setPage: (page: string) => void;
    icon: React.ReactNode;
    name: string;
    pageKey: string;
}

const TabItem = ({ currentPage, setPage, icon, name, pageKey }: TabItemProps) => {
    return (
        <div className={"flex items-center gap-1.5 *:pointer-events-none cursor-pointer duration-150" + " " + `
            ${currentPage === pageKey ? "text-text-primary" : "text-text-tertiary hover:text-text-primary"}
        `} onClick={() => setPage(pageKey)}>
            {icon}
            <span className="leading-none text-xl font-semibold text-current">{name}</span>
        </div>
    )
}

export default Settings