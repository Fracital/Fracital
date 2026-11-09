import { useEffect, useState } from "react";
import { RectangleGroupIcon, PaintBrushIcon, PlusIcon, TrashIcon, ScaleIcon } from "@heroicons/react/24/solid";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import LinkCard from "../components/LinkCard";
import { isColorBright } from "../libs/colorBright";
import { quickLinks } from "../libs/init";
import type { linkProps } from "./Home";
import { BIG_PLAYER_DEFAULT_SETTING, useSettingsStore } from "../store";
import { loadTheme } from "../libs/theme";
import { ThemePath, SettingsPath, EXPERIMENTAL_PROXIES_SETTING, getProxy } from "../types";
import { HolyText } from "../components/common/HolyText";
import { isMotionSetting, MOTION_SETTING } from "../libs/motion";
import { useModal } from "../components/Modal/ModalContext";
import { Modal } from "../components/Modal/Modal";
import FavoriteModal from "../components/Modal/Favorite";

interface SettingsProps {
	className?: string;
}

const ThemeCard = (config: any) => {
	const settings = useSettingsStore.getState().settings;
	const license = config.config.license;
	const match = typeof license === "string" ? license.match(/\[([^\]]+)\]\(([^)]+)\)/) : null;
	const info = match ? { title: match[1], url: match[2] } : { title: "License", url: license || "" };
	config = config.config;

	return (
		<div
			className={
				`flex flex-col gap-2.5 max-w-68 rounded-2xl overflow-hidden duration-200` +
				" " +
				`
            ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000030]"}
        `
			}
			onMouseDown={e => {
				console.log("Button:" + " " + (e.target instanceof HTMLButtonElement));
				console.log("Title:" + " " + (e.target instanceof HTMLTitleElement));
				console.log("SVGPath:" + " " + (e.target instanceof SVGPathElement));

				if (e.target instanceof HTMLButtonElement) return;
				if (e.target instanceof HTMLTitleElement) return;
				if (e.target instanceof SVGPathElement) return;
				loadTheme(config.name.toLowerCase());
				useSettingsStore.getState().setSettings("theme", config.name.toLowerCase());
			}}
		>
			<div className={`flex items-center justify-between p-3.5 border-b ${settings.brightness === "dark" ? "bg-[#ffffff10] border-[#ffffff52]" : "bg-[#00000030] border-[#00000052]"}`}>
				<div className="flex gap-2 items-center">
					<CheckCircleIcon
						className={
							"size-6 text-(--text-secondary) stroke-current stroke-2" +
							" " +
							`
                        ${settings["theme"] === config.name.toLowerCase() ? "opacity-100" : "absolute opacity-0 pointer-events-none"}
                    `
						}
					/>
					<span className="text-2xl font-bold">{config.name}</span>
					<span className="text-lg font-medium">v{config.version}</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						className="group cursor-pointer"
						onMouseDown={() => {
							window.open(info.url, "_blank");
						}}
						title={info.title}
					>
						<ScaleIcon className="size-5 text-(--text-secondary) group-hover:text-(--text-primary) stroke-current stroke-0.5 duration-150 pointer-events-none" />
					</button>
					<TrashIcon
						className="size-5 text-(--text-secondary) stroke-current stroke-0.5 cursor-pointer hover:text-(--text-primary) duration-150"
						onMouseDown={async () => {
							if (!confirm("Are you sure you want to delete this theme?")) return;
							await window.fr.fs.promises.unlink(`${ThemePath}/${config.name.toLowerCase()}`);
							loadTheme("default");
						}}
						title="Delete Theme"
					/>
				</div>
			</div>
			<div className="flex flex-col w-full justify-center p-3.5 pt-0">
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
	);
};

const Settings = ({ className }: SettingsProps) => {
	const setSettings = useSettingsStore(state => state.setSettings);
	const settings = useSettingsStore(state => state.settings);
	const [page, setpage] = useState<string>("general");
	const [themes, setThemes] = useState<any[]>([]);
	const compactTabs = settings["compact-tabs"] === true;
	const { openModal } = useModal();

	const [links, setLinks] = useState<linkProps[]>(
		(() => {
			const stored = window.localStorage.getItem("quicklinks");
			try {
				return stored ? JSON.parse(stored) : quickLinks;
			} catch {
				return quickLinks;
			}
		})(),
	);

	useEffect(() => {
		const getThemes = async () => {
			const themeDirs = await window.fr.fs.promises.readdir(ThemePath);
			const themeNames: string[] = [];
			for (const dirName of themeDirs) {
				const indexPath = `${ThemePath}/${dirName}/index.json`;
				try {
					const indexData = JSON.parse(await window.fr.fs.promises.readFile(indexPath, "utf8"));
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
		const updLinks = () => {
			const stored = window.localStorage.getItem("quicklinks");
			try {
				const links = stored ? JSON.parse(stored) : [];
				setLinks(links);
			} catch {
				setLinks([]);
			}
		};
		window.addEventListener("links-upd", updLinks);
		window.addEventListener("storage", updLinks);
		return () => {
			window.removeEventListener("links-upd", updLinks);
			window.removeEventListener("storage", updLinks);
		};
	}, []);

	const pages = {
		general: (
			<div className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold">General</h1>
				<h1 className="text-2xl font-bold">Quick Links</h1>
				<div className="flex flex-wrap gap-2">
					{links.length > 0 && links.map((link, index) => <LinkCard key={index} title={link.title} icon={link.icon} color={link.color} edit={true} href={link.href} id={index} brightness={isColorBright(link.color)} />)}
					<div
						className="flex flex-col p-3 rounded-2xl bg-[#ffffff25] hover:bg-[#ffffff35] overflow-hidden cursor-pointer duration-200"
						onMouseDown={() => {
							openModal(
								<Modal>
									<FavoriteModal />
								</Modal>,
								{
									url: "https://example.com",
									name: "Example",
									icon: "",
									color: "#ffffff",
								},
							);
						}}
					>
						<div className="*:pointer-events-none *:select-none">
							<div className="flex items-center justify-center py-5 px-22">
								<div className="flex sm:size-16 size-8 justify-center items-center">{<PlusIcon className="size-10 rounded-full stroke-current stroke-2 duration-200" />}</div>
							</div>
							<div className="flex w-full justify-center">
								<span
									className={
										"font-extrabold text-lg leading-none" +
										" " +
										`text-[#ffffffc7]
                                `
									}
								>
									Add Site
								</span>
							</div>
						</div>
					</div>
				</div>
				<HolyText as="h1" className="text-2xl font-bold" text="Proxy" />
				<div className="flex gap-2">
					<HolyText as="h2" className="text-xl font-medium" text="Experimental Proxies" />
					<label className="flex items-center gap-3 cursor-pointer select-none">
						<input
							type="checkbox"
							checked={settings[EXPERIMENTAL_PROXIES_SETTING] === true}
							onChange={async () => {
								const next = !(settings[EXPERIMENTAL_PROXIES_SETTING] === true);
								await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, [EXPERIMENTAL_PROXIES_SETTING]: next }, null, 4), "utf-8");
								setSettings(EXPERIMENTAL_PROXIES_SETTING, next);
								// Turning it off takes the experimental engine out of the selector; a tab on it goes back to the default.
								if (!next && (await getProxy()) === "st") window.dispatchEvent(new CustomEvent("proxy-change", { detail: { proxy: "sj" } }));
							}}
							className="sr-only peer"
						/>
						<span
							className={
								"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" +
								" " +
								`
                            ${settings[EXPERIMENTAL_PROXIES_SETTING] === true ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}
                        `
							}
						>
							<span
								className={
									"absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200" +
									" " +
									`
                                ${settings[EXPERIMENTAL_PROXIES_SETTING] === true ? "translate-x-5" : ""}
                            `
								}
							/>
						</span>
					</label>
				</div>
				<HolyText as="p" className="text-(--text-secondary)" text="Adds the Stomp engine to the engine selector in the top bar. It is new and may not work on every site." />
			</div>
		),
		app: (
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold">Tabs Appearance</h1>
				<div className="flex flex-col gap-0.5">
					<div className="flex gap-2">
						<h2 className="text-xl font-medium">
							<HolyText text="Compact Mode" />
						</h2>
						<label className="flex items-center gap-3 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={compactTabs}
								onChange={async () => {
									const next = !compactTabs;
									await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, "compact-tabs": next }, null, 4), "utf-8");
									setSettings("compact-tabs", next);
								}}
								className="sr-only peer"
							/>
							<span className={`relative inline-block w-12 h-7 transition-colors duration-200 rounded-full ${compactTabs ? "bg-(--accent)" : settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}>
								<span className={`absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${compactTabs ? "translate-x-5" : ""}`} />
							</span>
						</label>
					</div>
					<HolyText as="p" className="text-sm text-(--text-secondary)" text="Collapsed side panels shrink to a slim strip of round icons. Off, they peek out from the screen edge." />
				</div>
				<div className="flex flex-col gap-0.5">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-xl font-medium">
							<HolyText text="Open Panels on Click" />
						</h2>
						<div role="radiogroup" className={`flex gap-1 p-1 rounded-full ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}`}>
							{(["anywhere", "except-tabs", "off"] as const).map(choice => {
								const current = ["anywhere", "except-tabs", "off"].includes(settings["panel-click-open"]) ? settings["panel-click-open"] : "except-tabs";
								const on = current === choice;
								return (
									<button
										key={choice}
										role="radio"
										aria-checked={on}
										className={`px-3 py-1 rounded-full text-sm font-semibold cursor-pointer duration-150 ${on ? "bg-(--accent) text-white" : "text-(--text-secondary) hover:text-(--text-primary)"}`}
										onClick={async () => {
											if (on) return;
											await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, "panel-click-open": choice }, null, 4), "utf-8");
											setSettings("panel-click-open", choice);
										}}
									>
										<HolyText text={choice === "anywhere" ? "Anywhere" : choice === "except-tabs" ? "Except tabs" : "Off"} />
									</button>
								);
							})}
						</div>
					</div>
					<HolyText as="p" className="text-sm text-(--text-secondary)" text="What clicking inside the collapsed side panel does. Except tabs: switching tabs keeps it collapsed. Off: only the open/close button opens it." />
				</div>
				<div className="flex items-center gap-2">
					<h2 className="text-xl font-medium">
						<HolyText text="Tabs Position" />
					</h2>
					<div role="radiogroup" className={`flex gap-1 p-1 rounded-full ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}`}>
						{(["left", "right"] as const).map(side => {
							const on = (settings["tabs-position"] === "left" ? "left" : "right") === side;
							return (
								<button
									key={side}
									role="radio"
									aria-checked={on}
									className={`px-3 py-1 rounded-full text-sm font-semibold cursor-pointer duration-150 ${on ? "bg-(--accent) text-white" : "text-(--text-secondary) hover:text-(--text-primary)"}`}
									onClick={async () => {
										if (on) return;
										await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, "tabs-position": side }, null, 4), "utf-8");
										setSettings("tabs-position", side);
									}}
								>
									<HolyText text={side === "left" ? "Left" : "Right"} />
								</button>
							);
						})}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<h2 className="text-xl font-medium">
						<HolyText text="Reduce Motion" />
					</h2>
					<div role="radiogroup" className={`flex gap-1 p-1 rounded-full ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}`}>
						{(["system", "on", "off"] as const).map(choice => {
							const on = (isMotionSetting(settings[MOTION_SETTING]) ? settings[MOTION_SETTING] : "system") === choice;
							return (
								<button
									key={choice}
									role="radio"
									aria-checked={on}
									className={`px-3 py-1 rounded-full text-sm font-semibold cursor-pointer duration-150 ${on ? "bg-(--accent) text-white" : "text-(--text-secondary) hover:text-(--text-primary)"}`}
									onClick={async () => {
										if (on) return;
										await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, [MOTION_SETTING]: choice }, null, 4), "utf-8");
										setSettings(MOTION_SETTING, choice);
									}}
								>
									<HolyText text={choice === "system" ? "System" : choice === "on" ? "On" : "Off"} />
								</button>
							);
						})}
					</div>
				</div>
				<HolyText as="p" className="-mt-1 text-sm text-(--text-secondary)" text="Turns off sliding, fading and other animations. System follows your device's setting." />
				<div className="flex gap-2">
					<h2 title="Keep your open tabs, pages and music queue across page refreshes" className="text-xl font-medium">
						Persistent Tabs
					</h2>
					<label className="flex items-center gap-3 cursor-pointer select-none">
						<input
							type="checkbox"
							checked={settings["persistent-tabs"] === true}
							onChange={async () => {
								const next = !(settings["persistent-tabs"] === true);
								await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, "persistent-tabs": next }, null, 4), "utf-8");
								setSettings("persistent-tabs", next);
								window.localStorage.setItem("fracital:persist-tabs", String(next));
								if (!next) {
									window.localStorage.removeItem("fracital:saved-tabs");
									window.localStorage.removeItem("fracital:saved-music");
								}
							}}
							className="sr-only peer"
						/>
						<span
							className={
								"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" +
								" " +
								`
                            ${settings["persistent-tabs"] === true ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}
                        `
							}
						>
							<span
								className={
									"absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200" +
									" " +
									`
                                ${settings["persistent-tabs"] === true ? "translate-x-5" : ""}
                            `
								}
							/>
						</span>
					</label>
				</div>
				<h1 className="text-2xl font-bold">Theme</h1>
				<div className="flex flex-wrap gap-2">
					{themes.length > 0 ? (
						themes.map((theme, index) => <ThemeCard key={index} config={theme} />)
					) : (
						<span className="text-(--text-secondary)">
							No themes found. Please add themes to the <code>/themes</code> directory.
						</span>
					)}
				</div>
				<h1 className="text-2xl font-bold">Quick Player</h1>
				<div className="flex flex-col gap-2">
					<div className="flex gap-5">
						<div className="flex flex-col gap-2">
							<label title="When off, the quick player opens on the track list instead of the big player" className="flex items-center justify-between gap-10 cursor-pointer select-none">
								<span className="text-xl font-medium">Open in big player</span>
								<input
									type="checkbox"
									checked={settings[BIG_PLAYER_DEFAULT_SETTING] ?? true}
									onChange={async () => {
										const next = !(settings[BIG_PLAYER_DEFAULT_SETTING] ?? true);
										const newSettings = { ...settings, [BIG_PLAYER_DEFAULT_SETTING]: next };
										await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify(newSettings, null, 4), "utf-8");
										setSettings(BIG_PLAYER_DEFAULT_SETTING, next);
									}}
									className="sr-only peer"
								/>
								<span
									className={"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" + " " + `${(settings[BIG_PLAYER_DEFAULT_SETTING] ?? true) ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}`}
								>
									<span className={"absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200" + " " + `${(settings[BIG_PLAYER_DEFAULT_SETTING] ?? true) ? "translate-x-5" : ""}`} />
								</span>
							</label>

							<label className="flex items-center justify-between cursor-pointer select-none">
								<span className="text-xl font-medium">All visualizers</span>
								<input
									type="checkbox"
									checked={settings["disable-visualizers"] === false ? true : false}
									onChange={async () => {
										const next = !(settings["disable-visualizers"] ?? false);
										const newSettings = {
											...settings,
											"disable-visualizers": next,
										};
										await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify(newSettings, null, 4), "utf-8");
										setSettings("disable-visualizers", next);
									}}
									className="sr-only peer"
								/>
								<span className={"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" + " " + `${settings["disable-visualizers"] === false ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}`}>
									<span className={"absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200" + " " + `${settings["disable-visualizers"] === false ? "translate-x-5" : ""}`} />
								</span>
							</label>

							<label className={"flex items-center justify-between cursor-pointer select-none " + (settings["disable-visualizers"] ? "opacity-50 pointer-events-none" : "")}>
								<span className="text-lg font-medium">Tracks visualizer</span>
								<input
									type="checkbox"
									checked={settings["tracks-visualizer"] ?? true}
									onChange={async () => {
										const next = !(settings["tracks-visualizer"] ?? true);
										const newSettings = { ...settings, "tracks-visualizer": next };
										await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify(newSettings, null, 4), "utf-8");
										setSettings("tracks-visualizer", next);
									}}
									className="sr-only peer"
									disabled={settings["disable-visualizers"] ?? false}
								/>
								<span className={"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" + " " + `${settings["tracks-visualizer"] ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}`}>
									<span className={"absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200" + " " + `${settings["tracks-visualizer"] ? "translate-x-5" : ""}`} />
								</span>
							</label>

							<label className={"flex items-center justify-between gap-10 cursor-pointer select-none " + (settings["disable-visualizers"] ? "opacity-50 pointer-events-none" : "")}>
								<span className="text-lg font-medium">Big player visualizer</span>
								<input
									type="checkbox"
									checked={settings["big-player-visualizer"] ?? true}
									onChange={async () => {
										const next = !(settings["big-player-visualizer"] ?? true);
										const newSettings = { ...settings, "big-player-visualizer": next };
										await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify(newSettings, null, 4), "utf-8");
										setSettings("big-player-visualizer", next);
									}}
									className="sr-only peer"
									disabled={settings["disable-visualizers"] ?? false}
								/>
								<span className={"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" + " " + `${settings["big-player-visualizer"] ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}`}>
									<span className={"absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200" + " " + `${settings["big-player-visualizer"] ? "translate-x-5" : ""}`} />
								</span>
							</label>
						</div>
					</div>
				</div>
			</div>
		),
	};

	return (
		<div className={"size-full flex sm:flex-row flex-col p-2 gap-3" + " " + className}>
			<div className="flex flex-col gap-2">
				<div
					className={
						"flex flex-col w-max py-2.5 pb-3 px-3.5 gap-2 inset-shadow-[0_0_0_1.5px_#ffffff10] rounded-lg" +
						" " +
						`
                    ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}
                `
					}
				>
					<TabItem currentPage={page} setPage={setpage} icon={<RectangleGroupIcon className="size-6 text-current duration-150" />} name="General" pageKey="general" />
					<TabItem currentPage={page} setPage={setpage} icon={<PaintBrushIcon className="size-6 text-current duration-150" />} name="Appearance" pageKey="app" />
				</div>
			</div>
			<div className="relative overflow-y-auto sm:h-full h-[calc(100%-10rem)]">
				{Object.entries(pages).map(([key, pageComponent], index) => (
					<div
						key={index}
						className={
							"inset-0 flex flex-col gap-2 p-3.5 rounded-lg duration-150 h-full" +
							" " +
							`
                            ${page === key ? "" : "absolute -translate-y-2.5 opacity-0 pointer-events-none"}
                        `
						}
					>
						{pageComponent}
					</div>
				))}
			</div>
		</div>
	);
};
interface TabItemProps {
	currentPage: string;
	setPage: (page: string) => void;
	icon: React.ReactNode;
	name: string;
	pageKey: string;
}

const TabItem = ({ currentPage, setPage, icon, name, pageKey }: TabItemProps) => {
	return (
		<div
			className={
				"flex items-center gap-1.5 *:pointer-events-none cursor-pointer duration-150" +
				" " +
				`
            ${currentPage === pageKey ? "text-(--text-primary)" : "text-(--text-tertiary) hover:text-(--text-primary)"}
        `
			}
			onClick={() => setPage(pageKey)}
		>
			{icon}
			<span className="leading-none text-xl font-[650] text-current">{name}</span>
		</div>
	);
};

export default Settings;
