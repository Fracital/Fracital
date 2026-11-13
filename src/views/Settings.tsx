import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RectangleGroupIcon, PaintBrushIcon, TrashIcon, ScaleIcon, GlobeAltIcon, ChevronDownIcon } from "@heroicons/react/24/solid";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { QuickLinksGrid } from "../components/LinkCard";
import { quickLinks } from "../libs/init";
import { BIG_PLAYER_DEFAULT_SETTING, useSettingsStore } from "../store";
import { loadTheme } from "../libs/theme";
import { ThemePath, SettingsPath, EXPERIMENTAL_PROXIES_SETTING, TAB_VIEW_SETTING, CLOSE_GROUP_TABS_SETTING, GROUPS_ON_TOP_SETTING, getProxy, isProxyEngine, type ProxyEngine } from "../types";
import { useEngineVersions } from "../libs/proxyEngines";
import { currentSearchEngine, SEARCH_ENGINE_SETTING, SEARCH_ENGINES } from "../libs/searchEngines";

const ENGINE_NAMES: Record<ProxyEngine, string> = { sj: "Scramjet", uv: "UV", st: "Stomp" };
const ENGINE_ABOUT: Record<ProxyEngine, string> = { sj: "The default. Works with most sites.", uv: "Another engine to try when a site doesn't load.", st: "Experimental. May not work on every site." };
const SEARCH_ABOUT: Record<(typeof SEARCH_ENGINES)[number]["id"], string> = {
	duckduckgo: "The default. Doesn't keep a profile of your searches.",
	google: "Google Search.",
	bing: "Microsoft's search engine.",
	brave: "Brave's own independent index.",
	startpage: "Google's results without the tracking.",
};
import { HolyText } from "../components/common/HolyText";
import { isMotionSetting, MOTION_SETTING } from "../libs/motion";

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

interface SliderOption<T extends string> {
	value: T;
	/** Its name, on the pill and in the list. */
	label: string;
	/** What picking it does, for the list under the pills. */
	about: string;
	/** Shown after the name on the pill only (an engine's version): a data value. */
	extra?: React.ReactNode;
}

interface OptionSliderProps<T extends string> {
	title: string;
	/** A sentence on what the choice is about. */
	summary: string;
	options: SliderOption<T>[];
	value: T;
	onChange: (value: T) => void;
}

/**
 * A choice between a few options: pills with a highlight that slides to the picked one, a sentence on what the choice
 * is about, then a list of each option and what it does, the picked one in brighter text with an accent dash.
 */
const OptionSlider = <T extends string>({ title, summary, options, value, onChange }: OptionSliderProps<T>) => {
	const dark = useSettingsStore(state => state.settings.brightness !== "light");
	const groupRef = useRef<HTMLDivElement>(null);
	const [thumb, setThumb] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measured when the pick or the options change (and on resize).
	useLayoutEffect(() => {
		const group = groupRef.current;
		if (!group) return;
		const measure = () => {
			const pill = group.querySelector<HTMLElement>(`[data-option="${CSS.escape(value)}"]`);
			setThumb(pill ? { left: pill.offsetLeft, top: pill.offsetTop, width: pill.offsetWidth, height: pill.offsetHeight } : null);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(group);
		return () => ro.disconnect();
	}, [value, options.length]);

	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="text-xl font-medium">
					<HolyText text={title} />
				</h2>
				<div ref={groupRef} role="radiogroup" className={`relative flex flex-wrap gap-1 p-1 rounded-2xl ${dark ? "bg-[#ffffff10]" : "bg-[#00000025]"}`}>
					{thumb && <span aria-hidden="true" className="absolute rounded-full bg-(--accent) duration-200 ease-out pointer-events-none" style={thumb} />}
					{options.map(option => {
						const on = option.value === value;
						return (
							<button
								key={option.value}
								data-option={option.value}
								role="radio"
								aria-checked={on}
								className={`relative flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold cursor-pointer duration-150 ${on ? "text-white" : "text-(--text-secondary) hover:text-(--text-primary)"}`}
								onClick={() => !on && onChange(option.value)}
							>
								<HolyText text={option.label} />
								{option.extra}
							</button>
						);
					})}
				</div>
			</div>
			<HolyText as="p" className="text-sm text-(--text-secondary)" text={summary} />
			<ul className="flex flex-col gap-0.5 text-sm">
				{options.map(option => {
					const on = option.value === value;
					return (
						<li key={option.value} className={`flex gap-1.5 duration-150 ${on ? "text-(--text-primary)" : "text-(--text-tertiary)"}`}>
							{/* A plain dash marking each item. */}
							<span aria-hidden="true" className={on ? "text-(--accent)" : ""}>
								–
							</span>
							<span>
								<HolyText className="font-semibold" text={option.label} />
								{/* Punctuation between the name and what it does. */}
								{": "}
								<HolyText text={option.about} />
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
};

const Settings = ({ className }: SettingsProps) => {
	const setSettings = useSettingsStore(state => state.setSettings);
	const settings = useSettingsStore(state => state.settings);
	const [page, setpage] = useState<string>("general");
	const versions = useEngineVersions();
	const availableEngines: ProxyEngine[] = settings[EXPERIMENTAL_PROXIES_SETTING] === true ? ["sj", "uv", "st"] : ["sj", "uv"];
	// The engine in use, kept in step with the top bar's selector.
	const [engine, setEngine] = useState<ProxyEngine>("sj");
	useEffect(() => {
		void getProxy().then(setEngine);
		const onChange = (e: Event) => {
			const next = (e as CustomEvent<{ proxy: unknown }>).detail.proxy;
			if (isProxyEngine(next)) setEngine(next);
		};
		window.addEventListener("proxy-change", onChange);
		return () => window.removeEventListener("proxy-change", onChange);
	}, []);
	const [themes, setThemes] = useState<any[]>([]);
	const compactTabs = settings["compact-tabs"] === true;
	const tabView = settings[TAB_VIEW_SETTING] === true;
	const closeGroupTabs = settings[CLOSE_GROUP_TABS_SETTING] === true;
	const groupsOnTop = settings[GROUPS_ON_TOP_SETTING] === true;
	/** Saves settings to settings.json and the store. */
	const save = async (changes: Record<string, unknown>) => {
		await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, ...changes }, null, 4), "utf-8");
		for (const [key, value] of Object.entries(changes)) setSettings(key, value);
	};

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

	const pages = {
		general: (
			<div className="flex flex-col gap-5">
				<SettingsSection id="general" title="General" titleClassName="text-3xl font-bold">
					<OptionSlider
						title="Reduce Motion"
						summary="Turns off sliding, fading and other animations."
						value={isMotionSetting(settings[MOTION_SETTING]) ? settings[MOTION_SETTING] : "system"}
						options={[
							{ value: "system", label: "System", about: "Follows your device's setting." },
							{ value: "on", label: "On", about: "Always reduces animations." },
							{ value: "off", label: "Off", about: "Always shows animations." },
						]}
						onChange={choice => save({ [MOTION_SETTING]: choice })}
					/>
					<div className="flex flex-col gap-0.5">
						<div className="flex gap-2">
							<h2 className="text-xl font-medium">
								<HolyText text="Close Tabs With Group" />
							</h2>
							<label className="flex items-center gap-3 cursor-pointer select-none">
								<input
									type="checkbox"
									checked={closeGroupTabs}
									onChange={async () => {
										const next = !closeGroupTabs;
										await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, [CLOSE_GROUP_TABS_SETTING]: next }, null, 4), "utf-8");
										setSettings(CLOSE_GROUP_TABS_SETTING, next);
									}}
									className="sr-only peer"
								/>
								<span className={`relative inline-block w-12 h-7 transition-colors duration-200 rounded-full ${closeGroupTabs ? "bg-(--accent)" : settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}>
									<span className={`absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${closeGroupTabs ? "translate-x-5" : ""}`} />
								</span>
							</label>
						</div>
						<HolyText as="p" className="text-sm text-(--text-secondary)" text="Closing a group also closes the tabs in it. Off, they stay open, out of any group. A group's menu always has the other way." />
					</div>
					<div className="flex flex-col gap-0.5">
						<div className="flex gap-2">
							<h2 className="text-xl font-medium">
								<HolyText text="Keep Groups on Top" />
							</h2>
							<label className="flex items-center gap-3 cursor-pointer select-none">
								<input
									type="checkbox"
									checked={groupsOnTop}
									onChange={async () => {
										const next = !groupsOnTop;
										await window.fr.fs.promises.writeFile(SettingsPath, JSON.stringify({ ...settings, [GROUPS_ON_TOP_SETTING]: next }, null, 4), "utf-8");
										setSettings(GROUPS_ON_TOP_SETTING, next);
									}}
									className="sr-only peer"
								/>
								<span className={`relative inline-block w-12 h-7 transition-colors duration-200 rounded-full ${groupsOnTop ? "bg-(--accent)" : settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}>
									<span className={`absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${groupsOnTop ? "translate-x-5" : ""}`} />
								</span>
							</label>
						</div>
						<HolyText as="p" className="text-sm text-(--text-secondary)" text="Groups show first and tabs in no group after them. Off, groups and tabs mix in the order you put them; turning it back off brings that order back." />
					</div>
					<div className="flex flex-col gap-0.5">
						<div className="flex gap-2">
							<h2 className="text-xl font-medium">
								<HolyText text="Persistent Tabs" />
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
						<HolyText as="p" className="text-sm text-(--text-secondary)" text="Keeps your open tabs, pages and music queue across page refreshes." />
					</div>
				</SettingsSection>
				<SettingsSection id="quick-links" title="Quick Links">
					<HolyText as="p" className="-mt-1 text-sm text-(--text-secondary)" text="Shown on the new tab page. Use a link's ⋯ menu (or right-click it) to edit, move or remove it." />
					<QuickLinksGrid className="max-w-3xl" />
				</SettingsSection>
			</div>
		),
		network: (
			<div className="flex flex-col gap-5">
				<SettingsSection id="network" title="Network" bodyClassName="gap-3">
					<OptionSlider
						title="Proxy Engine"
						summary="The engine that loads websites in your tabs. The same choice is in the top bar."
						value={engine}
						options={availableEngines.map(choice => ({
							value: choice,
							label: ENGINE_NAMES[choice],
							about: ENGINE_ABOUT[choice],
							// The engine's version: a data value.
							extra: versions[choice] ? <span className={`text-xs font-medium ${engine === choice ? "text-white/70" : "text-(--text-tertiary)"}`}>{versions[choice]}</span> : null,
						}))}
						onChange={choice => window.dispatchEvent(new CustomEvent("proxy-change", { detail: { proxy: choice } }))}
					/>
					<div className="flex flex-col gap-0.5">
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
					<OptionSlider
						title="Search Engine"
						summary="Where the address bar sends anything that isn't a web address."
						value={currentSearchEngine(settings).id}
						options={SEARCH_ENGINES.map(choice => ({ value: choice.id, label: choice.name, about: SEARCH_ABOUT[choice.id] }))}
						onChange={choice => save({ [SEARCH_ENGINE_SETTING]: choice })}
					/>
				</SettingsSection>
			</div>
		),
		app: (
			<div className="flex flex-col gap-5">
				<SettingsSection id="tabs-appearance" title="Tabs Appearance">
					<OptionSlider
						title="Tabs List"
						summary="How your open tabs are shown."
						value={tabView ? "bigscreen" : compactTabs ? "compact" : "floating"}
						options={[
							{ value: "compact", label: "Compact", about: "The side panel collapses to a slim strip of round icons." },
							{ value: "floating", label: "Floating", about: "The collapsed side panel peeks out from the edge of the screen." },
							{ value: "bigscreen", label: "Big Screen", about: "Your tabs show as cards with live previews in a full view, opened from the top bar." },
						]}
						onChange={choice => save({ "compact-tabs": choice === "compact", [TAB_VIEW_SETTING]: choice === "bigscreen" })}
					/>
					<OptionSlider
						title="Open Panels on Click"
						summary="What clicking inside the collapsed side panel does."
						value={["anywhere", "except-tabs", "off"].includes(settings["panel-click-open"]) ? settings["panel-click-open"] : "except-tabs"}
						options={[
							{ value: "anywhere", label: "Anywhere", about: "Any click inside it opens it." },
							{ value: "except-tabs", label: "Except tabs", about: "Switching tabs keeps it collapsed; any other click opens it." },
							{ value: "off", label: "Off", about: "Only the open/close button opens it." },
						]}
						onChange={choice => save({ "panel-click-open": choice })}
					/>
					<OptionSlider
						title="Tabs Position"
						summary="Which side of the screen the side panel sits on."
						value={settings["tabs-position"] === "left" ? "left" : "right"}
						options={[
							{ value: "left", label: "Left", about: "On the left, next to the page." },
							{ value: "right", label: "Right", about: "On the right, next to the page." },
						]}
						onChange={choice => save({ "tabs-position": choice })}
					/>
				</SettingsSection>
				<SettingsSection id="theme" title="Theme">
					<div className="flex flex-wrap gap-2">
						{themes.length > 0 ? (
							themes.map((theme, index) => <ThemeCard key={index} config={theme} />)
						) : (
							<span className="text-(--text-secondary)">
								No themes found. Please add themes to the <code>/themes</code> directory.
							</span>
						)}
					</div>
				</SettingsSection>
				<SettingsSection id="quick-player" title="Quick Player">
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
										className={
											"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" + " " + `${(settings[BIG_PLAYER_DEFAULT_SETTING] ?? true) ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}`
										}
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
									<span
										className={"relative inline-block w-12 h-7 transition-colors duration-200 rounded-full" + " " + `${settings["disable-visualizers"] === false ? "bg-(--accent)" : `${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff20]" : "bg-[#00000025] hover:bg-[#00000035]"}`}`}
									>
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
				</SettingsSection>
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
					<TabItem currentPage={page} setPage={setpage} icon={<GlobeAltIcon className="size-6 text-current duration-150" />} name="Network" pageKey="network" />
					<TabItem currentPage={page} setPage={setpage} icon={<PaintBrushIcon className="size-6 text-current duration-150" />} name="Appearance" pageKey="app" />
				</div>
			</div>
			<div className="relative flex-1 min-w-0 overflow-y-auto sm:h-full h-[calc(100%-10rem)]">
				{Object.entries(pages).map(([key, pageComponent], index) => (
					<div
						key={index}
						className={
							"inset-0 flex flex-col gap-2 p-3.5 rounded-lg duration-150 h-full" +
							" " +
							`
                            ${page === key ? "" : "absolute -translate-y-2.5 opacity-0 pointer-events-none overflow-hidden invisible"}
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
/** Taller than this, a settings section can be folded down to its title. */
const COLLAPSIBLE_PX = 240;
/** The sections folded in this browser, by id. */
const COLLAPSED_KEY = "fracital:settings-collapsed";
const readCollapsed = (): Record<string, true> => {
	try {
		return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "{}") ?? {};
	} catch {
		return {};
	}
};

/** A titled group of settings; tall ones fold away under their title (remembered per browser). */
const SettingsSection = ({ id, title, titleClassName = "text-2xl font-bold", bodyClassName = "gap-2", children }: { id: string; title: string; titleClassName?: string; bodyClassName?: string; children: React.ReactNode }) => {
	const bodyRef = useRef<HTMLDivElement>(null);
	const [tall, setTall] = useState(false);
	const [collapsed, setCollapsed] = useState(() => !!readCollapsed()[id]);
	/** Clipped while it folds or unfolds, so nothing shows outside the moving edge; visible when open (hover lifts, focus rings). */
	const [moving, setMoving] = useState(false);
	useLayoutEffect(() => {
		const body = bodyRef.current;
		if (!body) return;
		// The body keeps its own height when folded, so this measures the same either way.
		const measure = () => setTall(body.offsetHeight > COLLAPSIBLE_PX);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(body);
		return () => observer.disconnect();
	}, []);
	const open = !tall || !collapsed;
	const toggle = () => {
		const next = !collapsed;
		setCollapsed(next);
		setMoving(true);
		try {
			const all = readCollapsed();
			if (next) all[id] = true;
			else delete all[id];
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify(all));
		} catch {
			// Storage unavailable: it stays folded for this visit only.
		}
	};
	return (
		<section className="flex flex-col gap-2">
			{tall ? (
				<button type="button" aria-expanded={open} onClick={toggle} className="group flex items-center gap-2 self-start text-left cursor-pointer">
					<HolyText as="h1" className={titleClassName} text={title} />
					<ChevronDownIcon className={`size-5 shrink-0 stroke-current stroke-1 text-(--text-tertiary) group-hover:text-(--text-primary) duration-200 ${open ? "" : "-rotate-90"}`} />
				</button>
			) : (
				<HolyText as="h1" className={titleClassName} text={title} />
			)}
			<div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} onTransitionEnd={e => e.target === e.currentTarget && setMoving(false)}>
				<div inert={!open} className={`min-h-0 ${!open || moving ? "overflow-hidden" : ""}`}>
					<div ref={bodyRef} className={`flex flex-col ${bodyClassName}`}>
						{children}
					</div>
				</div>
			</div>
		</section>
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
