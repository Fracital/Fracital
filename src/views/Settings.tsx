import { useEffect, useState } from "react";
import { RectangleGroupIcon, PaintBrushIcon, PlusIcon, EllipsisHorizontalIcon, TrashIcon, ScaleIcon } from "@heroicons/react/24/solid";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import LinkCard from "../components/LinkCard";
import { isColorBright } from "../libs/colorBright";
import { quickLinks } from "../libs/init";
import type { linkProps } from "./Home";
import { useSettingsStore } from "../store";
import { loadTheme } from "../libs/theme";

interface SettingsProps {
    className?: string
}

const ThemeCard = (config: any) => {
    const settings = useSettingsStore.getState().settings;
    config = config.config

    return (
        <div className={`flex flex-col p-3.5 gap-1 max-w-68 rounded-2xl overflow-hidden cursor-pointer duration-200` + " " + `
            ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000030]"}
        `} onMouseDown={() => {
            loadTheme(config.name.toLowerCase());
            useSettingsStore.getState().setSettings("theme", config.name.toLowerCase());
        }}>
            <div className="flex items-center justify-between">
                <div className="flex gap-2 items-center">
                    <CheckCircleIcon className={"size-6 text-(--text-secondary) stroke-current stroke-2" + " " + `
                        ${settings["theme"] === config.name.toLowerCase() ? "opacity-100" : "absolute opacity-0 pointer-events-none"}
                    `} />
                    <span className="text-2xl font-bold">{config.name}</span>
                    <span className="text-lg font-medium">v{config.version}</span>
                </div>
                <div className="flex items-center gap-1">
                    {
                        config.license && (
                            <ScaleIcon className="size-5 text-(--text-secondary) stroke-current stroke-0.5 cursor-pointer hover:text-(--text-primary) duration-150" onMouseDown={() => {
                                window.open(config.license, "_blank");
                            }} title="View License" />
                        )
                    }
                    <TrashIcon className="size-5 text-(--text-secondary) stroke-current stroke-0.5 cursor-pointer hover:text-(--text-primary) duration-150" onMouseDown={async () => {
                        if (!confirm("Are you sure you want to delete this theme?")) return;
                        await window.Filer.fs.promises.unlink(`/themes/${config.name.toLowerCase()}`);
                        loadTheme("default");
                    }} title="Delete Theme" />
                    {/* <EllipsisHorizontalIcon className="size-7 text-(--text-secondary) stroke-current stroke-1 cursor-pointer hover:text-(--text-primary) duration-150" onClick={(e) => {
                    }}/> */}
                </div>
            </div>
            <span className="flex w-full h-1 rounded-full bg-[#ffffff38]"></span>
            <div className="flex flex-col w-full justify-center">
                <div>
                    <span className="text-lg font-bold">Description: </span>
                    <span className="text-base font-medium">{config.description}</span>
                </div>
                <div>
                    <span className="text-lg font-bold">Author: </span>
                    <span className="text-base font-medium">{config.author}</span>
                </div>
                <div>
                    <span className="text-lg font-bold">Brightness: </span>
                    <code className="text-xs font-medium p-1.5 leading-none rounded-md bg-[#00000028]">{config.brightness}</code>
                </div>
            </div>
        </div>
    )
}

const Settings = ({ className }: SettingsProps) => {
    const setSettings = useSettingsStore(state => state.setSettings)
    const settings = useSettingsStore(state => state.settings)
    const [page, setpage] = useState<string>("general")
    const [floatingTabs, setFloatingTabs] = useState<boolean>(true)
    const [themes, setThemes] = useState<string[]>([])

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

    useEffect(() => {
        const getThemes = async () => {
            const themeDirs = await window.Filer.fs.promises.readdir("/themes");
            const themeNames: string[] = [];
            for (const dirName of themeDirs) {
                const indexPath = `/themes/${dirName}/index.json`;
                try {
                    const indexData = JSON.parse(await window.Filer.fs.promises.readFile(indexPath, "utf8"));
                    themeNames.push(indexData);
                } catch {
                    console.warn(`No index.json found in theme directory: ${dirName}`);
                    continue;
                }
            }
            setThemes(themeNames);
        };
        getThemes();
    }, []);

    useEffect(() => {
        const getSettings = async () => {
            try {
                const settingsData = await window.Filer.fs.promises.readFile("/settings.json", "utf-8");
                const parsedSettings = JSON.parse(settingsData);
                setFloatingTabs(parsedSettings["floating-tabs"] ?? true);
                Object.entries(parsedSettings).forEach(([key, value]) => {
                    setSettings(key, value);
                });
            } catch (error) {
                console.error("Error reading settings.json:", error);
                setSettings("theme", "default");
                setSettings("proxy", "uv");
                setSettings("quicklinks", quickLinks);
                setSettings("floating-tabs", true);
                setFloatingTabs(true);
            }
        };
        getSettings();
    }, [])

    return (
        <div className={"size-full flex p-2 gap-3" + " " + className}>
            <div className="flex flex-col gap-2">
                <div className={"flex flex-col py-2 px-3.5 gap-2 inset-shadow-(--inset-shadow-primary)-lighter rounded-lg" + " " + `
                    ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}
                `}>
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
                            <h1 className="text-3xl font-bold">General</h1>
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
                            <h1 className="text-3xl font-bold">Appearance</h1>
                            <div className="flex gap-2">
                                <h2 className="text-xl font-medium">Floating Tabs</h2>
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={settings["floating-tabs"] ?? true}
                                    onChange={async () => {
                                        const next = !floatingTabs;
                                        setFloatingTabs(next);
                                        await window.Filer.fs.promises.writeFile("/settings.json", JSON.stringify({
                                            ...settings,
                                            "floating-tabs": next
                                        }, null, 4), "utf-8");
                                        setSettings("floating-tabs", next);
                                    }} className="sr-only peer"
                                    />
                                    <span className={"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" + " " + `
                                        ${floatingTabs ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}
                                    `}>
                                        <span className={"absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200" + " " + `
                                            ${floatingTabs ? "translate-x-5" : ""}
                                        `} />
                                    </span>
                                </label>
                            </div>
                            <h1 className="text-2xl font-bold">Theme</h1>
                            <div className="flex flex-wrap gap-2">
                                {
                                    themes.length > 0 ? themes.map((theme, index) => (
                                            <ThemeCard key={index} config={theme} />
                                    )) : <span className="text-(--text-secondary)">No themes found. Please add themes to the <code>/themes</code> directory.</span>
                                }
                            </div>
                            {/* <button onMouseDown={() => {
                                loadTheme("default")
                            }}>default</button>
                            <button onMouseDown={() => {
                                loadTheme("amber")
                            }}>amber</button> */}
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
            ${currentPage === pageKey ? "text-(--text-primary)" : "text-(--text-tertiary) hover:text-(--text-primary)"}
        `} onClick={() => setPage(pageKey)}>
            {icon}
            <span className="leading-none text-xl font-semibold text-current">{name}</span>
        </div>
    )
}

export default Settings