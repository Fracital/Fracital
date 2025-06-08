import { useRef, useEffect, useState } from "react";
import { navigationEvent } from "../libs/eventBus";
import { TrashIcon, PencilSquareIcon, GlobeAltIcon } from "@heroicons/react/24/solid";
import type { linkProps } from "../views/Home";

interface LinkCardProps {
    title: string;
    icon: string | React.ReactNode;
    brightness: "light" | "dark"
    color: string;
    href: string;
    edit?: boolean;
    id?: number
}

const LinkCard: React.FC<LinkCardProps> = ({ title, icon, brightness, color, href, id, edit }) => {
    const cardRef = useRef<HTMLDivElement>(null)
    const [value, setValue] = useState<string>(href || "");

    useEffect(() => {
        cardRef.current?.style.setProperty("--color", color)
    }, [cardRef])

    return (
        <>
            {
                edit ? (
                    <div ref={cardRef} className="relative flex flex-col p-3 rounded-2xl bg-(--color) overflow-hidden duration-200">
                        {edit && id !== undefined && (
                            <div className="absolute top-2 right-2 flex gap-1 z-10">
                                <button className={"cursor-pointer duration-150" + " " + `
                                    ${brightness === "dark" ? "text-[#00000098] hover:text-[#000000]" : "text-[#ffffffc7] hover:text-[#ffffff]"}
                                `} onMouseDown={() => {
                                    const linkname = prompt("Enter the name of the link:", title);
                                    if (!linkname || linkname.trim() === "") return;
                                    const linkicon = prompt("Enter the URL of the icon for this link (leave empty for default):", typeof icon === "string" ? icon : "");
                                    const linkcolor = prompt("Enter the color for this link (leave empty for default):", color);
                                    const linkurl = prompt("Enter the URL for this link:", value);
                                    if (!linkurl || linkurl.trim() === "") return;
                                    const newLink: linkProps = {
                                        title: linkname,
                                        icon: linkicon && linkicon.trim() !== "" ? linkicon : "default",
                                        color: linkcolor && linkcolor.trim() !== "" ? linkcolor : "#ffffff",
                                        href: linkurl
                                    };
                                    const stored = window.localStorage.getItem("quicklinks");
                                    const links = stored ? JSON.parse(stored) : [];
                                    links[id] = newLink;
                                    window.localStorage.setItem("quicklinks", JSON.stringify(links));
                                    window.location.reload();
                                }}>
                                    <PencilSquareIcon className="size-6" />
                                </button>
                                <button className={"cursor-pointer duration-150" + " " + `
                                    ${brightness === "dark" ? "text-[#00000098] hover:text-[#000000]" : "text-[#ffffffc7] hover:text-[#ffffff]"}
                                `} onMouseDown={() => {
                                    if (!confirm("Are you sure you want to delete this link?")) return;
                                    const stored = window.localStorage.getItem("quicklinks");
                                    const links = stored ? JSON.parse(stored) : [];
                                    links.splice(id, 1);
                                    window.localStorage.setItem("quicklinks", JSON.stringify(links));
                                    window.location.reload();
                                }}>
                                    <TrashIcon className="size-6" />
                                </button>
                            </div>
                        )}
                        <div className="*:select-none">
                            <div className="flex items-center justify-center py-5 px-22">
                                {
                                    icon === "default" ? (
                                        <GlobeAltIcon className="sm:size-16 size-8 text-text-secondary" />
                                    ) :
                                    typeof icon === "string" ? (<img src={icon} alt={title} className="sm:size-16 size-8" />) : (<>{icon}</>)
                                }
                            </div>
                            <div className="flex flex-col w-full justify-center items-center gap-1">
                                <span className={"font-extrabold text-lg leading-none" + " " + `
                                    ${brightness === "dark" ? "text-[#00000098]" : "text-[#ffffffc7]"}
                                `}>{title}</span>
                                <span title={value} className={"font-extrabold text-lg leading-none z-10" + " " + `
                                    ${brightness === "dark" ? "text-[#00000070]" : "text-[#ffffff9a]"}
                                `}>{
                                    value.length > 30 ? value.slice(0, 20) + "..." : value
                                }</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div ref={cardRef} className="group relative flex flex-col p-3 rounded-2xl bg-(--color) overflow-hidden cursor-pointer duration-200" onMouseDown={async () => {
                        if (href) {navigationEvent({
                            icon: icon,
                            title: title,
                            url: href
                        })}
                    }}>
                        <div className="*:pointer-events-none *:select-none">
                            {edit && id !== undefined && (
                                <div className="absolute top-2 right-2 z-10">
                                    <button className={"cursor-pointer" + " " + `
                                        ${brightness === "dark" ? "text-[#00000098]" : "text-[#ffffffc7]"}
                                    `} onClick={() => {
                                        const stored = window.localStorage.getItem("quicklinks");
                                        const links = stored ? JSON.parse(stored) : [];
                                        links.splice(id, 1);
                                        window.localStorage.setItem("quicklinks", JSON.stringify(links));
                                        window.location.reload();
                                    }}>
                                        <TrashIcon className="size-6" />
                                    </button>
                                </div>
                            )}
                            <div className="flex items-center justify-center py-5 px-19">
                                {
                                    icon === "default" ? (
                                        <GlobeAltIcon className="sm:size-16 size-8 text-text-secondary group-hover:-translate-y-2 duration-200" />
                                    ) :
                                    typeof icon === "string" ? (<img src={icon} alt={title} className="sm:size-16 size-8 group-hover:-translate-y-2 duration-200" />) : (<>{icon}</>)
                                }
                            </div>
                            <div className="flex w-full justify-center">
                                <span className={"font-extrabold text-lg leading-none" + " " + `
                                    ${brightness === "dark" ? "text-[#00000098]" : "text-[#ffffffc7]"}
                                `}>{title}</span>
                            </div>
                        </div>
                    </div>
                )
            }
        </>
    )
}

export default LinkCard;