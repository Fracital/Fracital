import { useEffect, useState, useRef } from "react";
import { XMarkIcon, MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import type { TabProps } from "./Tab";
import { useTabsStore } from "../store";
import { navigationEvent } from "../libs/eventBus";
import { useNavigate } from "react-router-dom";
import { createId } from "@paralleldrive/cuid2";

interface SearchProps {
    tab?: TabProps
}

export const Search = ({ tab }: SearchProps) => {
    const navigate = useNavigate()
    const tabs = useTabsStore(state => state.tabs)
    const currentTab = tabs.find(tab => tab.current === true);
    const newTab = useTabsStore(state => state.newTab)

    const searchRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const [searchFocused, setSearchFocused] = useState(false);
    const [hasQuery, setHasQuery] = useState(tab?.url || false);

    const searchHandler = (query: string) => {
        if (query.length > 0) {
            // navigate("/?q=" + encodeURI(query));
            // if (isUrl(query, { lenient: true })) {
            //     console.log("URL detected");
            // } else {
            //     console.log("URL not detected");
            // }

            // try {
            //     new URL(query);
                if (tabs.length < 1) {
                    newTab({
                        title: "New Tab",
                        id: createId(),
                        url: query,
                        current: true
                    })
                    setHasQuery(true);
                } else {
                    navigationEvent({
                        url: query,
                        icon: null,
                        title: "New Tab"
                    });
                    setHasQuery(true);
                }
            // } catch (e) {
            //     navigate("/es", {
            //         state: {
            //             search: query
            //         }
            //     })
            // }
        }
    }

    useEffect(() => {
        if (inputRef.current) {
            if (tab) {
                inputRef.current.value = currentTab?.url || "newtab";
            }
        }
    }, [])

    const clearSearch = () => {
        setHasQuery(false);
        inputRef.current?.blur();
        if (inputRef.current) {
            inputRef.current.value = "";
        }
        navigationEvent({
            url: "newtab",
            title: "New Tab",
            icon: null
        })
        navigate("/");
    }

    return (
        <div className={"flex items-center justify-center gap-1.5" + " " + `
            ${
                tabs && tabs.length > 0 && tab && tab.current !== true ? "absolute opacity-0 pointer-events-none" : ""
            }
        `}>
            <XMarkIcon className={"size-6 text-text-secondary hover:text-text-primary stroke-current stroke-1 duration-150 cursor-pointer z-10" + " " + `
                ${hasQuery ? "" : "translate-x-2 opacity-0 duration-150 pointer-events-none"}
            `} onMouseDown={() => clearSearch()}/>
            <div ref={searchRef} className={"flex items-center bg-tertiary h-[48px] gap-1 rounded-lg cursor-text duration-150" + " " + `
                ${searchFocused ? "inset-shadow-accent" : "inset-shadow-secondary"}
            `} onMouseDown={() => {
                if (document.activeElement !== inputRef.current) {
                    setSearchFocused(true);
                    if (inputRef.current) {
                        inputRef.current.focus();
                    }

                }
            }}>
                <div className="relative flex items-center justify-start sm:w-[30rem] h-full z-10">
                    <span className={"absolute left-3 font-semibold ease-in-out pointer-events-none w-max" + " " + `
                        ${hasQuery ? "opacity-0 -translate-x-1 duration-100" : "duration-150"}
                        ${searchFocused ? "text-text-primary" : "text-text-secondary"}
                    `}>Search or enter a URL</span>
                    <input id="input" ref={inputRef} type="text" className="size-full pl-3 text-text-secondary font-medium focus:outline-none focus:ring-0 z-10"
                    onFocus={() => {
                        setSearchFocused(true);
                    }}
                    onBlur={() => {
                        setSearchFocused(false);
                    }}
                    onChange={() => {
                        setHasQuery(true);
                    }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") {
                            if (typeof inputRef.current?.value === "string") {
                                searchHandler(inputRef.current?.value);
                            }
                        }
                    }} />
                </div>
                <div className="p-1.5">
                    <button className="group flex items-center justify-center p-2 rounded-lg bg-primary hover:bg-accent duration-75 cursor-pointer z-20"
                    onClick={() => {
                        if (typeof inputRef.current?.value === "string") {
                            console.log(inputRef.current.value);
                            searchHandler(inputRef.current?.value);
                        }
                    }}>
                        <MagnifyingGlassIcon className="size-5 text-text-tertiary group-hover:text-text-primary stroke-current stroke-1 duration-75 pointer-events-none" />
                    </button>
                </div>
            </div>
        </div>
    )
}