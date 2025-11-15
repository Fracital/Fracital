import { useEffect, useState, useRef, type ChangeEvent } from "react";
import { XMarkIcon, MagnifyingGlassIcon, Cog6ToothIcon, FolderIcon, MusicalNoteIcon, IdentificationIcon } from "@heroicons/react/24/solid";
import type { TabProps } from "./Tab";
import { useTabsStore } from "../store";
import { navigationEvent } from "../libs/eventBus";
import { useNavigate } from "react-router-dom";
import { createId } from "@paralleldrive/cuid2";
import XOR from "../libs/XOR";

interface SearchProps {
	tab?: TabProps;
}

export const Search = ({ tab }: SearchProps) => {
	const navigate = useNavigate();
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const newTab = useTabsStore(state => state.newTab);

	const searchRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const [searchFocused, setSearchFocused] = useState(false);
	const [hasQuery, setHasQuery] = useState(XOR.decode(tab?.displayUrl ?? "") || false);

	const searchHandler = (query: string) => {
		if (query.length > 0) {
			const isSearch = (q: string) => {
				if (q.includes(" ")) return true;
				if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(q)) return false;
				if (q.startsWith("www.") || q.includes(".") || q.includes(":")) return false;
				return true;
			};
			const makeUrl = (q: string) => {
				if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(q)) return q;
				if (q.includes("about:")) return q;
				if (q.startsWith("www.")) return `https://${q}`;
				if (q.includes(".") || q.includes(":")) return `https://${q}`;
				return q;
			};

			const getAboutPageInfo = (url: string): { title: string; icon: React.ReactNode | null } => {
				const page = url.replace("about:", "").split("?")[0];
				switch (page) {
					case "newtab":
						return { title: "New Tab", icon: null };
					case "settings":
						return { title: "Settings", icon: <Cog6ToothIcon className="size-5" /> };
					case "music":
						return { title: "Music Library", icon: <MusicalNoteIcon className="size-5" /> };
					case "files":
						return { title: "File Manager", icon: <FolderIcon className="size-5" /> };
					case "account":
						return { title: "Account Management", icon: <IdentificationIcon className="size-5" /> };
					default:
						return { title: "New Tab", icon: null };
				}
			};

			let finalUrl: string;
			let displayUrl: string;
			let pageTitle = "New Tab";
			let pageIcon: React.ReactNode | null = null;

			if (isSearch(query)) {
				finalUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
				displayUrl = query;
			} else {
				finalUrl = makeUrl(query);
				displayUrl = query;

				if (finalUrl.includes("about:")) {
					const info = getAboutPageInfo(finalUrl);
					pageTitle = info.title;
					pageIcon = info.icon;
				}
			}

			if (tabs.length < 1) {
				newTab({
					title: pageTitle,
					id: createId(),
					url: finalUrl,
					current: true,
					displayUrl: displayUrl,
					icon: pageIcon,
				});
				setHasQuery(true);
			} else {
				navigationEvent({
					url: finalUrl,
					icon: pageIcon,
					title: pageTitle,
					displayUrl: displayUrl,
					id: tab?.id ?? currentTab?.id ?? "",
				});
				setHasQuery(true);
			}
		}
	};

	useEffect(() => {
		if (inputRef.current && currentTab) {
			inputRef.current.value = currentTab.displayUrl;
			setHasQuery(!!currentTab.displayUrl);
		}
	}, [currentTab]);

	const clearSearch = () => {
		setHasQuery(false);
		inputRef.current?.blur();
		if (inputRef.current) {
			inputRef.current.value = "";
		}
		navigationEvent({
			url: "about:newtab",
			title: "New Tab",
			icon: null,
			displayUrl: "about:newtab",
			id: tab?.id ?? currentTab?.id ?? "",
		});
	};

	return (
		<div
			className={
				"flex items-center justify-center gap-1.5 duration-250" +
				" " +
				`
            ${tabs && tabs.length > 0 && tab && tab.current !== true ? "absolute translate-y-8 opacity-0 pointer-events-none" : ""}
        `
			}
		>
			{/* <XMarkIcon className={"size-6 text-(--text-secondary) hover:text-(--text-primary) stroke-current stroke-1 duration-150 cursor-pointer z-10" + " " + `
                ${hasQuery ? "" : "translate-x-2 opacity-0 duration-150 pointer-events-none"}
            `} onMouseDown={() => clearSearch()}/> */}
			<div
				ref={searchRef}
				className={
					"flex items-center bg-(--secondary) h-12 gap-1 rounded-xl cursor-text duration-150" +
					" " +
					`
                ${searchFocused ? "inset-shadow-(--inset-shadow-accent)" : "inset-shadow-(--inset-shadow-secondary)"}
            `
				}
				onMouseDown={() => {
					if (document.activeElement !== inputRef.current) {
						setSearchFocused(true);
						if (inputRef.current) {
							inputRef.current.focus();
						}
					}
				}}
			>
				<div
					className={
						"relative flex items-center justify-start h-full z-10 duration-150" +
						" " +
						`
                    ${hasQuery ? "sm:w-[20rem] w-20" : "sm:w-50 w-20"}
                `
					}
				>
					<span
						className={
							"absolute left-4 font-semibold ease-in-out pointer-events-none w-max" +
							" " +
							`
                        ${hasQuery ? "opacity-0 -translate-x-1 duration-100" : "duration-150"}
                        ${searchFocused ? "text-(--text-primary)" : "text-(--text-secondary)"}
                    `
						}
					>
						Search or enter a URL
					</span>
					<input
						id="input"
						ref={inputRef}
						type="text"
						className="size-full pl-4 text-(--text-secondary) font-medium focus:outline-none focus:ring-0 z-10"
						onFocus={() => {
							setSearchFocused(true);
						}}
						onBlur={() => {
							setSearchFocused(false);
						}}
						onChange={(e: ChangeEvent) => {
							const value = (e.target as HTMLInputElement).value;
							if (value !== "") {
								setHasQuery(true);
							} else {
								setHasQuery(false);
							}
						}}
						onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
							if (e.key === "Enter") {
								if (typeof inputRef.current?.value === "string") {
									searchHandler(inputRef.current?.value);
								}
							}
						}}
					/>
				</div>
				<div className={"p-1.5 pl-0"}>
					<button
						className={"group flex items-center justify-center pl-1 p-2 cursor-pointer z-20"}
						onClick={() => {
							if (inputRef.current?.value === "") {
								inputRef.current?.focus();
								return;
							}
							if (typeof inputRef.current?.value === "string") {
								console.log(inputRef.current.value);
								searchHandler(inputRef.current?.value);
							}
						}}
					>
						<MagnifyingGlassIcon className="size-5 text-(--text-tertiary) group-hover:text-(--text-primary) stroke-current stroke-1 duration-150 pointer-events-none" />
					</button>
				</div>
			</div>
		</div>
	);
};
