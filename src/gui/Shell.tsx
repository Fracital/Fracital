import { Bars3Icon, MagnifyingGlassIcon, XMarkIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, ChevronUpDownIcon } from "@heroicons/react/24/solid";
import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

const Shell = () => {
    const [proxy, setProxy] = useState<"uv" | "sj">("uv");

    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const searchRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const uvRef = useRef<HTMLDivElement>(null);
    const sjRef = useRef<HTMLDivElement>(null);

    const [query, setQuery] = useState(searchParams.get("q") || "");
    const [search, setSearch] = useState(query || "");
    const [searchFocused, setSearchFocused] = useState(false);

    const [isFullscreen, setIsFullscreen] = useState(false);

    const [uvVersion, setUvVersion] = useState("v3.2.7");
    const [sjVersion, setSjVersion] = useState("v3.2.7");

    // window.$scramjet?.version

    const searchHandler = (query: string) => {
        if (query.length > 0) {
            // navigate("/?q=" + encodeURI(query));
            // setQuery(query);
            navigate("/es", {
                state: {
                    q: query
                }
            })
        }
    }

    const clearSearch = () => {
        setQuery("");
        setSearch("");
        inputRef.current?.blur();
        navigate("/");
    }

    const handleProxyChange = (e: Event) => {
        const customEvent = e as CustomEvent;
        const newProxy = customEvent.detail.proxy;
        if (newProxy === "sj" || newProxy === "uv") {
            setProxy(newProxy);
            window.localStorage.setItem("proxy", newProxy);
        }
    };

    useEffect(() => {
        const storedProxy = window.localStorage.getItem("proxy");
        if (storedProxy === "sj" || storedProxy === "uv") {
            setProxy(storedProxy as "uv" | "sj");
        }
    }, []);

    useEffect(() => {
        window.addEventListener("proxy-change", handleProxyChange);
        return () => {
            window.removeEventListener("proxy-change", handleProxyChange);
        };
    }, []);

    return (
        <div className={"flex justify-between gap-2.5 p-3 rounded-xl bg-secondary inset-shadow-primary duration-200" + " " + `
            ${searchFocused ? "p-4" : "p-3"}
        `}>
            <div className="flex items-center justify-start">
                <Link to="/" className="group cursor-pointer" onMouseDown={() => clearSearch()}>
                    <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-9 group-hover:-translate-y-1 duration-150 pointer-events-none">
                        <circle cx="64" cy="64" r="64" fill="#FB74FE"/>
                        <path fillRule="evenodd" clipRule="evenodd" d="M64 0C99.3462 0 128 28.6538 128 64C128 99.3462 99.3462 128 64 128C28.6538 128 0 99.3462 0 64C0 28.6538 28.6538 0 64 0ZM64 7C32.5198 7 7 32.5198 7 64C7 95.4802 32.5198 121 64 121C95.4802 121 121 95.4802 121 64C121 32.5198 95.4802 7 64 7Z" fill="white" fillOpacity="0.5"/>
                        <path d="M51 87V41H81V51.5H62.1278V59.75H78.9222L76.5 70.25H62.1278V85L51 87Z" fill="#FFE866"/>
                    </svg>
                </Link>
            </div>
            <div className="flex items-center justify-center gap-1.5">
                <XMarkIcon className={"size-6 text-text-secondary hover:text-text-primary stroke-current stroke-1 duration-150 cursor-pointer z-10" + " " + `
                    ${query.length > 0 ? "" : "translate-x-2 opacity-0 duration-150 pointer-events-none"}
                `} onMouseDown={() => clearSearch()}/>
                <div ref={searchRef} className={"flex items-center bg-tertiary gap-1 rounded-lg cursor-text duration-150" + " " + `
                    ${searchFocused ? "inset-shadow-accent" : "inset-shadow-secondary"}
                `}>
                    <div className="relative flex items-center justify-start sm:w-[30rem] pl-3 z-10">
                        <span className={"absolute font-semibold ease-in-out pointer-events-none w-max" + " " + `
                            ${search.length > 0 ? "opacity-0 -translate-x-1 duration-100" : "opacity-100 duration-150"}
                            ${searchFocused ? "text-text-primary" : "text-text-secondary"}
                        `}>Search or enter a URL</span>
                        <input ref={inputRef} type="search" className="size-full text-text-secondary font-medium focus:outline-none focus:ring-0 z-10"
                        onFocus={() => {
                            setSearchFocused(true);
                        }}
                        onBlur={() => {
                            setSearchFocused(false);
                        }}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setSearch(e.target.value);
                        }} value={search}
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === "Enter") {
                                searchHandler(search);
                            }
                        }} />
                    </div>
                    <div className="p-1.5">
                        <button className="group flex items-center justify-center p-2 rounded-lg bg-primary hover:bg-accent duration-75 cursor-pointer z-20"
                        onClick={() => searchHandler(search)}>
                            <MagnifyingGlassIcon className="size-5 text-text-tertiary group-hover:text-text-primary stroke-current stroke-1 duration-75 pointer-events-none" />
                        </button>
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-end gap-1.5">
                <div className="group relative flex justify-center items-center min-h-5 p-2 px-3 gap-1 rounded-full bg-primary cursor-pointer duration-150" onMouseDown={() => {
                    window.dispatchEvent(new CustomEvent("proxy-change", {
                        detail: {
                            proxy: proxy === "uv" ? "sj" : "uv"
                        }
                    }))
                }}>
                    <div className="flex items-center overflow-hidden h-5">
                        <div className={"flex flex-col items-start gap-2 h-4.5 duration-150" + " " + `
                            ${proxy === "uv" ? "" : "-translate-y-6.5 pointer-events-none"}
                        `}>
                            <div ref={uvRef} className={"flex items-center justify-center gap-2 duration-150"}>
                                <span className="text-text-secondary group-hover:text-text-primary font-bold text-lg duration-150">UV</span>
                                <span className="text-text-tertiary group-hover:text-text-secondary font-semibold duration-150">{uvVersion}</span>
                            </div>
                            <div ref={sjRef} className={"flex items-center justify-center gap-2 duration-150" + " " + `
                                ${proxy === "sj" ? "" : "absolute opacity-0 pointer-events-none"}
                            `}>
                                <span className="text-text-secondary group-hover:text-text-primary font-bold text-lg duration-150">Scramjet</span>
                                <span className="text-text-tertiary group-hover:text-text-secondary font-semibold duration-150">{sjVersion}</span>
                            </div>
                        </div>
                    </div>
                    <ChevronUpDownIcon className="size-5 text-text-tertiary group-hover:text-text-secondary stroke-current stroke-1 cursor-pointer duration-150" />
                </div>
                <button className="relative flex items-center justify-center text-text-secondary hover:text-text-primary size-7">
                    <ArrowsPointingInIcon className={"absolute size-full text-current stroke-current stroke-1 cursor-pointer duration-150" + " " + `
                        ${isFullscreen ? "" : "opacity-0 pointer-events-none"}
                    `} onMouseDown={() => {
                        setIsFullscreen(false);
                        if(document.fullscreenElement) {
                            document.exitFullscreen();
                        }
                    }}/>
                    <ArrowsPointingOutIcon className={"absolute size-full text-current stroke-current stroke-1 cursor-pointer duration-150" + " " + `
                        ${isFullscreen ? "opacity-0 pointer-events-none" : ""}
                    `} onMouseDown={() => {
                        setIsFullscreen(true);
                        if(document.body) {
                            document.body.requestFullscreen().catch((err) => {
                                console.error("Error attempting to enable full-screen mode:", err);
                            });
                        }
                    }}/>
                </button>
                <Bars3Icon className="size-7 text-text-secondary hover:text-text-primary stroke-current stroke-1 cursor-pointer duration-150" />
            </div>
        </div>
    );
}

export default Shell;