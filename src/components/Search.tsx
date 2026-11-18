import { MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { type ChangeEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { aboutPages, getPageFromUrl, getQueryFromUrl } from "../libs/aboutPages";
import { appRoot } from "../libs/cloak";
import { navigationEvent } from "../libs/eventBus";
import { isSearchQuery, searchUrl, urlFromInput } from "../libs/searchEngines";
import XOR from "../libs/XOR";
import { useTabsStore } from "../store";
import { HolyText } from "./common/HolyText";
import { type OmniTarget, useOmniBox } from "./OmniBox";
import type { TabProps } from "./Tab";

/**
 * Large screens: the bar fits its URL, between 22rem and half the screen, leaving room for the rest of the
 * top bar. Smaller screens: it fills the space it has.
 */
const URL_WIDTH = "xl:flex-none xl:w-[clamp(22rem,var(--url-w),50vw)]";

/** An about: page's tab title and icon, from the registry (the new tab page keeps no icon). */
const pageInfo = (url: string): { title: string; icon: ReactNode | null } => {
	const page = aboutPages[getPageFromUrl(url) ?? ""];
	if (!page || page.name === "newtab") return { title: "New Tab", icon: null };
	const q = getQueryFromUrl(url);
	return { title: page.titleFor?.(q) ?? page.title ?? "New Tab", icon: page.iconFor?.(q) ?? page.icon ?? null };
};

interface SearchProps {
	tab?: TabProps;
}

export const Search = ({ tab }: SearchProps) => {
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const newTab = useTabsStore(state => state.newTab);

	const searchRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const [searchFocused, setSearchFocused] = useState(false);
	const [hasQuery, setHasQuery] = useState(XOR.decode(tab?.displayUrl ?? "") || false);

	/** Opens a page in this tab (or a first tab), as a browser does, and gives the page the focus. */
	const openUrl = ({ url, displayUrl, title, icon }: OmniTarget) => {
		if (tabs.length < 1) newTab({ title, id: createId(), url, current: true, displayUrl, icon });
		else navigationEvent({ url, icon, title, displayUrl, id: tab?.id ?? currentTab?.id ?? "" });
		setHasQuery(true);
		// Done typing, as in a browser. An auto-hidden top bar stays up while the address bar has focus (Shell).
		inputRef.current?.blur();
	};

	/** What was typed, as an address or a search. */
	const searchHandler = (query: string) => {
		const q = query.trim();
		if (!q) return;
		const url = isSearchQuery(q) ? searchUrl(q) : urlFromInput(q);
		const info = url.includes("about:") ? pageInfo(url) : { title: "New Tab", icon: null };
		openUrl({ url, displayUrl: q, title: info.title, icon: info.icon });
	};

	// On large screens the bar is sized to its text (see URL_WIDTH below), so track what it shows.
	const [text, setText] = useState("");
	/** What the user has typed since focusing: the suggestions are for this, not for the address already shown. */
	const [typed, setTyped] = useState("");
	const measureRef = useRef<HTMLSpanElement>(null);
	const [textWidth, setTextWidth] = useState(0);
	useLayoutEffect(() => {
		if (measureRef.current) setTextWidth(measureRef.current.scrollWidth);
	}, [text]);

	useEffect(() => {
		if (inputRef.current && currentTab) {
			inputRef.current.value = currentTab.displayUrl;
			setHasQuery(!!currentTab.displayUrl);
			setText(currentTab.displayUrl);
			setTyped("");
		}
	}, [currentTab]);

	// Only the bar of the tab on screen can have focus, so the hidden copies never open a dropdown.
	const isCurrent = !tab || tab.current === true;
	const omni = useOmniBox({
		inputRef,
		anchorRef: searchRef,
		query: typed,
		enabled: searchFocused && isCurrent,
		onNavigate: openUrl,
		onFill: value => {
			if (inputRef.current) inputRef.current.value = value;
			setText(value);
			setTyped(value);
			setHasQuery(!!value);
		},
		onSubmitPlain: searchHandler,
	});

	return (
		<div
			className={
				"flex w-full min-w-0 items-center gap-1.5 duration-250" +
				" " +
				`
					${tabs && tabs.length > 0 && tab && tab.current !== true ? "absolute inset-x-0 translate-y-8 opacity-0 pointer-events-none" : ""}
				`
			}
		>
			<div
				ref={searchRef}
				// The text plus the side padding and search button.
				style={{ "--url-w": `${textWidth + 88}px` } as React.CSSProperties}
				className={
					`flex flex-1 min-w-0 ${URL_WIDTH} items-center bg-(--secondary) h-12 gap-1 rounded-2xl cursor-text duration-150` +
					" " +
					`
                ${searchFocused ? "inset-shadow-(--inset-shadow-accent)" : "inset-shadow-(--inset-shadow-secondary)"}
            `
				}
				onMouseDown={() => {
					if (appRoot().activeElement !== inputRef.current) {
						setSearchFocused(true);
						if (inputRef.current) {
							inputRef.current.focus();
						}
					}
				}}
			>
				<div className={"relative flex flex-1 min-w-0 items-center justify-start h-full z-10 overflow-hidden duration-150"}>
					{/* Invisible copy of the text, only used to measure its width. */}
					<span ref={measureRef} aria-hidden className="invisible absolute left-0 top-0 whitespace-pre font-semibold pointer-events-none">
						{text ? text : <HolyText text="Search or enter a URL" />}
					</span>
					<span
						className={
							"absolute left-4 right-0 truncate font-semibold ease-in-out pointer-events-none" +
							" " +
							`
                        ${hasQuery ? "opacity-0 -translate-x-1 duration-100" : "duration-150"}
                        ${searchFocused ? "text-(--text-primary)" : "text-(--text-secondary)"}
                    `
						}
					>
						<HolyText text="Search or enter a URL" />
					</span>
					<input
						id="input"
						ref={inputRef}
						type="text"
						{...omni.inputProps}
						className="size-full min-w-0 pl-4 text-(--text-secondary) font-medium focus:outline-none focus:ring-0 z-10"
						onFocus={() => {
							setSearchFocused(true);
						}}
						onBlur={() => {
							setSearchFocused(false);
						}}
						onChange={(e: ChangeEvent) => {
							const value = (e.target as HTMLInputElement).value;
							setText(value);
							setTyped(value);
							setHasQuery(value !== "");
						}}
						onKeyDown={omni.onKeyDown}
					/>
				</div>
				<div className={"p-1.5 pl-0"}>
					<button
						type="button"
						className={"group flex items-center justify-center pl-1 p-2 cursor-pointer z-20"}
						onClick={() => {
							if (inputRef.current?.value === "") {
								inputRef.current?.focus();
								return;
							}
							if (typeof inputRef.current?.value === "string") searchHandler(inputRef.current.value);
						}}
					>
						<MagnifyingGlassIcon className="size-5 text-(--text-tertiary) group-hover:text-(--text-primary) stroke-current stroke-1 duration-150 pointer-events-none" />
					</button>
				</div>
			</div>
			{omni.dropdown}
		</div>
	);
};
