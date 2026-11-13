import { PauseIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { useState } from "react";
import { HolyText } from "../components/common/HolyText";
import { ADBLOCK_LISTS, type AdblockSettings, adblock } from "../extensions/adblock";
import { EXTENSIONS } from "../extensions/registry";
import { useExtensionsStore } from "../extensions/runtime";
import { saveExtensionSettings, useExtensionSettings } from "../extensions/state";
import type { Extension, ExtensionSettings } from "../extensions/types";
import { useHolyAttr } from "../libs/holy-attr";
import { useSettingsStore, useTabsStore } from "../store";

/** about:extensions: every extension, with its switch, status, the sites it's paused on and its own options. */
const Extensions = ({ className = "" }: { className?: string }) => (
	<div className={`size-full overflow-y-auto p-6 ${className}`}>
		<div className="flex max-w-3xl flex-col gap-4">
			<div className="flex flex-col gap-1">
				<HolyText as="h1" className="text-3xl font-bold" text="Extensions" />
				<HolyText as="p" className="text-sm text-(--text-secondary)" text="Add features to the sites you visit. They run only inside the sites you open, and you can pause any of them on a site that breaks." />
			</div>
			{EXTENSIONS.map(extension => (
				<ExtensionCard key={extension.id} extension={extension} />
			))}
		</div>
	</div>
);

const ExtensionCard = ({ extension }: { extension: Extension }) => {
	const settings = useExtensionSettings(extension);
	const status = useExtensionsStore(state => state.status[extension.id]);
	const blocked = useExtensionsStore(state => state.blocked[extension.id] ?? 0);
	const dark = useSettingsStore(state => state.settings.brightness !== "light");
	const Icon = extension.icon;
	const save = (changes: Partial<ExtensionSettings>) => void saveExtensionSettings(extension, changes);

	return (
		<section className={`flex flex-col gap-4 p-4 rounded-2xl inset-shadow-(--inset-shadow-secondary) ${dark ? "bg-[#ffffff08]" : "bg-[#00000008]"}`}>
			<div className="flex items-start gap-3">
				<span className={`flex size-11 shrink-0 items-center justify-center rounded-xl duration-150 ${settings.enabled ? "bg-(--accent) text-white" : dark ? "bg-[#ffffff12] text-(--text-secondary)" : "bg-[#00000012] text-(--text-secondary)"}`}>
					<Icon className="size-6" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<HolyText as="h2" className="text-xl font-semibold" text={extension.name} />
					<HolyText as="p" className="text-sm text-(--text-secondary)" text={extension.description} />
					<StatusLine enabled={settings.enabled} status={status} blocked={blocked} />
				</div>
				<Switch checked={settings.enabled} label={extension.name} onChange={enabled => save({ enabled })} />
			</div>
			<div className={`flex flex-col gap-4 duration-150 ${settings.enabled ? "" : "opacity-50"}`}>
				{extension.id === adblock.id && <AdblockOptions settings={settings as AdblockSettings} onChange={changes => save(changes)} />}
				<PausedSites allow={settings.allow} onChange={allow => save({ allow })} />
			</div>
		</section>
	);
};

const StatusLine = ({ enabled, status, blocked }: { enabled: boolean; status: ReturnType<typeof useExtensionsStore.getState>["status"][string] | undefined; blocked: number }) => {
	if (!enabled) return <HolyText as="p" className="text-xs font-medium text-(--text-tertiary)" text="Off" />;
	if (!status || status.state === "loading") return <HolyText as="p" className="text-xs font-medium text-(--text-tertiary)" text="Getting ready…" />;
	if (status.state === "error")
		return (
			<p className="text-xs font-medium text-red-400">
				<HolyText text="Couldn't start: " />
				{/* The reason it gave: a data value. */}
				{status.detail}
			</p>
		);
	return (
		<p className="flex flex-wrap gap-x-1.5 text-xs font-medium text-(--text-tertiary)">
			<HolyText className="text-(--accent)" text="On" />
			{status.state === "ready" && status.detail && (
				<span>
					{/* Counts: data values. */}· {status.detail} <HolyText text="rules" />
				</span>
			)}
			<span>
				· {blocked.toLocaleString()} <HolyText text="blocked since you opened Fracital" />
			</span>
		</p>
	);
};

const Switch = ({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) => {
	const dark = useSettingsStore(state => state.settings.brightness !== "light");
	const { ref, placeholder } = useHolyAttr({ "aria-label": label });
	return (
		<label className="flex shrink-0 cursor-pointer select-none items-center pt-1">
			<input ref={ref} {...placeholder} type="checkbox" checked={checked} onChange={() => onChange(!checked)} className="sr-only peer" />
			<span className={`relative inline-block w-12 h-7 transition-colors duration-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-(--accent) ${checked ? "bg-(--accent)" : dark ? "bg-[#ffffff18] hover:bg-[#ffffff24]" : "bg-[#00000025] hover:bg-[#00000035]"}`}>
				<span className={`absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${checked ? "translate-x-5" : ""}`} />
			</span>
		</label>
	);
};

/** The ad blocker's filter lists: at least one stays on. */
const AdblockOptions = ({ settings, onChange }: { settings: AdblockSettings; onChange: (changes: Partial<AdblockSettings>) => void }) => (
	<div className="flex flex-col gap-1.5">
		<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Filter lists" />
		<div className="flex flex-col gap-1">
			{ADBLOCK_LISTS.map(list => {
				const on = settings.lists.includes(list.id);
				const last = on && settings.lists.length === 1;
				return (
					<label key={list.id} className={`flex w-fit items-center gap-2 text-sm ${last ? "cursor-default" : "cursor-pointer"}`}>
						<input type="checkbox" checked={on} disabled={last} onChange={() => onChange({ lists: on ? settings.lists.filter(id => id !== list.id) : [...settings.lists, list.id] })} className="size-4 accent-(--accent)" />
						<HolyText className="font-semibold" text={list.name} />
						<HolyText className="text-(--text-tertiary)" text={list.about} />
					</label>
				);
			})}
		</div>
		<HolyText as="p" className="text-xs text-(--text-tertiary)" text="Works with the Scramjet and UV engines. Filter lists by EasyList (easylist.to), refreshed daily." />
	</div>
);

/** Turns typed text ("https://www.example.com/page", "example.com") into the site's hostname, or null. */
const toHost = (input: string) => {
	const text = input.trim().toLowerCase();
	if (!text) return null;
	try {
		const host = new URL(text.includes("://") ? text : `https://${text}`).hostname.replace(/^www\./, "");
		return host.includes(".") ? host : null;
	} catch {
		return null;
	}
};

/** The sites an extension is paused on: remove one, type one in, or pick one of the sites you have open. */
const PausedSites = ({ allow, onChange }: { allow: string[]; onChange: (allow: string[]) => void }) => {
	const [text, setText] = useState("");
	const tabs = useTabsStore(state => state.tabs);
	const dark = useSettingsStore(state => state.settings.brightness !== "light");
	const { ref: inputRef, placeholder: inputAttrs } = useHolyAttr({ placeholder: "example.com", "aria-label": "Site to pause on" });
	const { ref: addRef, placeholder: addAttrs } = useHolyAttr({ title: "Pause on this site", "aria-label": "Pause on this site" });
	const { ref: removeRef, placeholder: removeAttrs } = useHolyAttr({ title: "Unpause", "aria-label": "Unpause" });
	// Sites open in tabs that aren't paused yet, for one-tap pausing.
	const openSites = [...new Set(tabs.map(tab => (/^https?:/.test(tab.url) ? toHost(tab.url) : null)).filter((host): host is string => !!host && !allow.includes(host)))].slice(0, 6);
	const add = (host: string | null) => {
		if (!host || allow.includes(host)) return;
		onChange([...allow, host]);
		setText("");
	};
	const chip = `flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-sm font-medium ${dark ? "bg-[#ffffff12]" : "bg-[#00000012]"}`;

	return (
		<div className="flex flex-col gap-1.5">
			<HolyText as="h3" className="text-sm font-semibold text-(--text-secondary)" text="Paused on these sites" />
			{allow.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{allow.map(host => (
						<span key={host} className={chip}>
							{/* The site's hostname: a data value. */}
							{host}
							<button ref={removeRef} {...removeAttrs} type="button" className="flex rounded-full p-0.5 text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={() => onChange(allow.filter(other => other !== host))}>
								<XMarkIcon className="size-3.5" />
							</button>
						</span>
					))}
				</div>
			) : (
				<HolyText as="p" className="text-xs text-(--text-tertiary)" text="None. It runs on every site." />
			)}
			<form
				className="flex max-w-sm items-center gap-2"
				onSubmit={e => {
					e.preventDefault();
					add(toHost(text));
				}}
			>
				{/* The site the user types: a form value. */}
				<input
					ref={inputRef}
					{...inputAttrs}
					type="text"
					value={text}
					onChange={e => setText(e.target.value)}
					className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-(--text-primary) outline-none inset-shadow-[0_0_0_1.5px_#ffffff20] focus:inset-shadow-[0_0_0_1.5px_var(--accent)] ${dark ? "bg-[#ffffff10]" : "bg-[#00000012]"}`}
				/>
				<button ref={addRef} {...addAttrs} type="submit" disabled={!toHost(text)} className="flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-(--accent) text-white cursor-pointer disabled:opacity-40 disabled:cursor-default">
					<PauseIcon className="size-4" />
					<HolyText text="Pause" />
				</button>
			</form>
			{openSites.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					<HolyText className="text-xs text-(--text-tertiary)" text="Open now:" />
					{openSites.map(host => (
						<button key={host} type="button" className={`${chip} pr-2.5 cursor-pointer text-(--text-secondary) hover:text-(--text-primary)`} onClick={() => add(host)}>
							<PlusIcon className="size-3.5" />
							{/* The site's hostname: a data value. */}
							{host}
						</button>
					))}
				</div>
			)}
		</div>
	);
};

export default Extensions;
