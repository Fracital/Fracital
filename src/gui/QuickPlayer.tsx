import { createId } from "@paralleldrive/cuid2"
import { useEffect, useRef, useState } from "react"
import { QueueListIcon, MusicalNoteIcon, PlusIcon, HeartIcon, BookmarkIcon, MinusIcon, ArrowUturnLeftIcon, ShoppingBagIcon } from "@heroicons/react/24/solid"
import { HeartIcon as HeartOutline } from "@heroicons/react/24/outline"
import { PlayIcon, PauseIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/solid"
import { useMusicStore, useSettingsStore, useTabsStore } from "../store"
import { ContextMenu, type MenuItem } from "../components/ContextMenu"

interface QuickPlayerProps {
    panelsOpen: boolean
    className?: string
    onMouseDown?: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
}

export const QuickPlayer = ({ panelsOpen, className, onMouseDown }: QuickPlayerProps) => {
    const settings = useSettingsStore(state => state.settings)
    const currentTrack = useMusicStore(state => state.currentTrack)
    const queue = useMusicStore(state => state.queue)
    const setCurrentTrack = useMusicStore(state => state.setCurrentTrack)
    const addTrack = useMusicStore(state => state.addTrack)
    const removeTrack = useMusicStore(state => state.removeTrack)
    const newTab = useTabsStore(state => state.newTab)

    const [platform, setPlatform] = useState<string>("")
    const [mainHeight, setMainHeight] = useState<number | undefined>(document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height || 805)

    const [isPlaying, setIsPlaying] = useState<boolean>(false)
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    const musicRef = useRef<HTMLDivElement>(null)
    const audioRef = useRef<HTMLAudioElement>(null);
    const seekbarRef = useRef<HTMLSpanElement>(null)
    const playRef = useRef<HTMLDivElement>(null)

    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        visible: boolean;
        items: MenuItem[];
    } | null>(null);

    useEffect(() => {
        if (currentTrack?.src && audioRef.current) {
            audioRef.current.src = currentTrack.src;
            audioRef.current.play().catch(() => {
                // Optional: handle autoplay block or manual start
            });
            setIsPlaying(true);
        }
    }, [currentTrack]);

    useEffect(() => {
        let detectedPlatform = "";
        if ('userAgentData' in navigator && navigator.userAgentData) {
            // @ts-expect-error: userAgentData is not yet in TypeScript's Navigator type
            detectedPlatform = navigator.userAgentData.platform || "";
        } else if ('platform' in navigator) {
            detectedPlatform = navigator.platform || "";
        } else {
            const ua = (navigator as Navigator).userAgent;
            if (/Windows/i.test(ua)) detectedPlatform = "Windows";
            else if (/Macintosh|Mac OS X/i.test(ua)) detectedPlatform = "Mac";
            else if (/Linux/i.test(ua)) detectedPlatform = "Linux";
            else if (/Android/i.test(ua)) detectedPlatform = "Android";
            else if (/iPhone|iPad|iPod/i.test(ua)) detectedPlatform = "iOS";
            else detectedPlatform = "Unknown";
        }
        setPlatform(detectedPlatform);
    }, []);

    const formatTime = (time: number): string => {
        if (isNaN(time) || time === Infinity) return "0:00";

        const hours = Math.floor(time / 3600);
        const minutes = Math.floor((time % 3600) / 60);
        const seconds = Math.floor(time % 60);

        const paddedSeconds = seconds.toString().padStart(2, '0');
        const paddedMinutes = minutes.toString().padStart(2, '0');

        if (hours > 0) {
            return `${hours}:${paddedMinutes}:${paddedSeconds}`;
        } else {
            return `${minutes}:${paddedSeconds}`;
        }
    };

    useEffect(() => {
        const height = document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height
        setMainHeight(height)

        const handleWindowSize = () => {
            const height = document.querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height;
            setMainHeight(height);
        };
        window.addEventListener("resize", handleWindowSize);
        return () => window.removeEventListener("resize", handleWindowSize);
    }, [])

    useEffect(() => {
        const percent = duration ? (currentTime / duration) * 100 : 0;
        seekbarRef.current?.style.setProperty("--current", `${percent}%`)
    }, [currentTime, duration])

    useEffect(() => {
        if (currentTime === duration) {
            if (currentTime === duration) {
                if (queue && queue.length > 0) {
                    const next = queue[0];
                    setCurrentTrack(next);
                    removeTrack(next.id);
                } else {
                    setIsPlaying(false);
                }
            }
        }
    }, [currentTime, duration]);

    const handleSeek = (clientX: number) => {
        if (!audioRef.current || !duration) return;

        const rect = seekbarRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clickX = clientX - rect.left;
        const percent = Math.min(Math.max(clickX / rect.width, 0), 1);
        const newTime = percent * duration;

        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        handleSeek(e.clientX);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
    handleSeek(e.clientX);
    };

    const handleMouseUp = () => {
        if (isDragging) setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    return (
        <div className={className && (className + " ") + "relative flex flex-col duration-150" + " " + `
            ${
                settings["floating-tabs"] === true ? "w-full" :
                panelsOpen ? "w-78" : "w-10"
            }
        `}>
            <div className={"flex flex-col justify-center h-full duration-150" + " " + `
                ${
                    panelsOpen ? "w-full left-0" : "w-88 -left-77"
                }
            `}>
                <div ref={musicRef} className={"flex flex-col w-full bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-hidden duration-150" + " " + `
                    ${
                        panelsOpen ? "w-full" : "w-88"
                    }
                    ${
                        settings["floating-tabs"] && panelsOpen ? "rounded-lg" : "rounded-xl"
                    }
                    ${
                        settings["floating-tabs"] && "shadow-[0_0_16px_3px_#00000035]"
                    }
                `} onMouseDown={onMouseDown}>
                    <div style={{
                        height: `calc(${mainHeight}px - calc(var(--spacing) * 12))`
                    }} className={"relative flex w-full h-full overflow-auto gap-2 p-2 px-3 flex-col duration-200"}>
                        <div className="flex flex-col items-start">
                            {
                                currentTrack ?
                                <h1 className={"ml-1.5 mt-1.5 text-2xl font-bold" + " " + `
                                    ${
                                        settings.brightness === "dark" ? "text-[#ffffff]" : "text-[#000000]"
                                    }
                                `}>Currently playing</h1> :
                                <h1 className={"ml-1.5 mt-1.5 text-2xl font-bold" + " " + `
                                    ${
                                        settings.brightness === "dark" ? "text-[#ffffff97]" : "text-[#00000097]"
                                    }
                                `}>Nothing playing</h1>
                            }
                            {
                                currentTrack &&
                                <div className="flex items-center justify-between gap-2.5 p-1.5 w-full rounded-lg hover:bg-[#ffffff28] duration-150">
                                    <div className="flex items-center gap-2.5">
                                        {
                                            currentTrack.cover &&
                                            <img className="size-10 rounded-md" src={currentTrack.cover} alt={currentTrack.title} />
                                        }
                                        {
                                            !currentTrack.cover &&
                                            <div className={"size-10 rounded-md flex justify-center items-center bg-(--primary) text-(--text-secondary) font-bold" + " " + `
                                                ${
                                                    settings.brightness === "dark" ? "text-[#ffffff6a]" : "text-[#0000006a]"
                                                }
                                            `}>
                                                <MusicalNoteIcon className="size-6" />
                                            </div>
                                        }
                                        <div className="flex flex-col gap-1">
                                            <h1 title={currentTrack.title} className={"text-md font-semibold leading-none" + " " + `
                                                ${
                                                    settings.brightness === "dark" ? "text-[#ffffff]" : "text-[#000000]"
                                                }
                                            `}>{currentTrack.title.length > 22 ? currentTrack.title.slice(0, 22) + "..." : currentTrack.title}</h1>
                                            {
                                                Array.isArray(currentTrack.artists) && currentTrack.artists.length > 1 ? (
                                                    <div className="flex gap-1.5">
                                                        {
                                                            currentTrack.explicit && <span className="flex justify-center items-center size-5 text-xs font-bold rounded-sm bg-[#ffffff46]">E</span>
                                                        }
                                                        <div className="flex lg:flex-row flex-col gap-0.5">
                                                            {currentTrack.artists.map((artist, index) => (
                                                                <div key={index} className={"flex justify-center items-center w-max" + " " + `
                                                                    ${
                                                                        settings.brightness === "dark" ? "text-[#ffffff6a]" : "text-[#0000006a]"
                                                                    }
                                                                `}>
                                                                    <span className="text-xs leading-none duration-150" key={index}>
                                                                        {artist}
                                                                    </span>
                                                                    {index < currentTrack.artists.length - 1 && <span>,</span>}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : <h2 className={"text-sm leading-none cursor-pointer duration-150" + " " + `
                                                    ${
                                                        settings.brightness === "dark" ? "text-[#ffffff6a]" : "text-[#0000006a]"
                                                    }
                                                `}>{currentTrack.artists[0]}</h2>
                                            }
                                        </div>
                                    </div>
                                    <EllipsisHorizontalIcon className={"size-6 mr-2 stroke-current stroke-1.5 cursor-pointer duration-150" + " " + `
                                        ${
                                            settings.brightness === "dark" ? "text-[#ffffffac] hover:text-[#ffffff]" : "text-[#000000ac] hover:text-[#000000]"
                                        }
                                    `} onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();

                                        const items: MenuItem[] = [
                                            {
                                                title: "Add to queue",
                                                icon: <PlusIcon className="size-5 stroke-current stroke-1" />,
                                                onClick: () => {
                                                    addTrack(currentTrack);
                                                }
                                            },
                                            {
                                                title: "Restart track",
                                                icon: <ArrowUturnLeftIcon className="size-5 stroke-current stroke-1" />,
                                                onClick: () => {
                                                    setCurrentTime(0);
                                                    if (audioRef.current) {
                                                        audioRef.current.pause();
                                                        audioRef.current.currentTime = 0;
                                                    }
                                                }
                                            }
                                        ]

                                        if (queue.filter(track => track.id === currentTrack.id).length > 1) {
                                            items.push({
                                                title: "Remove instances from queue",
                                                icon: <MinusIcon className="size-5 stroke-current stroke-1" />,
                                                onClick: () => {
                                                    removeTrack(currentTrack.id);
                                                }
                                            });
                                        }

                                        setContextMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            visible: true,
                                            items: items,
                                        });
                                    }} />
                                </div>
                            }
                        </div>
                        {
                            queue &&
                            <div className="flex flex-col items-start">
                                {
                                    queue.length > 0 &&
                                    <h1 className={"ml-1.5 mt-1.5 text-2xl font-bold" + " " + `
                                        ${
                                            settings.brightness === "dark" ? "text-[#ffffff]" : "text-[#000000]"
                                        }
                                    `}>Queue</h1>
                                }
                                {
                                    queue.map((song, index) => (
                                        <div key={song.id} className="flex items-center justify-between gap-2.5 p-1.5 w-full rounded-lg hover:bg-[#ffffff28] duration-150" onClick={() => {
                                            setCurrentTrack(song);
                                            removeTrack(song.id);
                                        }}>
                                            <div className="flex items-center gap-2.5">
                                                {
                                                    song.cover &&
                                                    <img className="size-10 rounded-md" src={song.cover} alt={song.title} />
                                                }
                                                {
                                                    !song.cover &&
                                                    <div className={"size-10 rounded-md flex justify-center items-center bg-(--primary) text-(--text-secondary) font-bold" + " " + `
                                                        ${
                                                            settings.brightness === "dark" ? "text-[#ffffff6a]" : "text-[#0000006a]"
                                                        }
                                                    `}>
                                                        <MusicalNoteIcon className="size-6" />
                                                    </div>
                                                }
                                                <div className="flex flex-col gap-1">
                                                    <h1 title={song.title} className={"text-md font-semibold leading-none" + " " + `
                                                        ${
                                                            settings.brightness === "dark" ? "text-[#ffffff]" : "text-[#000000]"
                                                        }
                                                    `}>{song.title.length > 22 ? song.title.slice(0, 22) + "..." : song.title}</h1>
                                                    {
                                                        Array.isArray(song.artists) && song.artists.length > 1 ? (
                                                            <div className="flex gap-1.5">
                                                                {
                                                                    song.explicit && <span className="flex justify-center items-center size-5 text-xs font-bold rounded-sm bg-[#ffffff46]">E</span>
                                                                }
                                                                <div className="flex lg:flex-row flex-col gap-0.5">
                                                                    {song.artists.map((artist, index) => (
                                                                        <div key={index} className={"flex justify-center items-center w-max" + " " + `
                                                                            ${
                                                                                settings.brightness === "dark" ? "text-[#ffffff6a]" : "text-[#0000006a]"
                                                                            }
                                                                        `}>
                                                                            <span className="text-xs leading-none duration-150" key={index}>
                                                                                {artist}
                                                                            </span>
                                                                            {index < song.artists.length - 1 && <span>,</span>}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ) : <h2 className={"text-sm leading-none duration-150" + " " + `
                                                            ${
                                                                settings.brightness === "dark" ? "text-[#ffffff6a]" : "text-[#0000006a]"
                                                            }
                                                        `}>{song.artists[0]}</h2>
                                                    }
                                                </div>
                                            </div>
                                            <EllipsisHorizontalIcon className={"size-6 mr-2 stroke-current stroke-1.5 cursor-pointer duration-150" + " " + `
                                                ${
                                                    settings.brightness === "dark" ? "text-[#ffffffac] hover:text-[#ffffff]" : "text-[#000000ac] hover:text-[#000000]"
                                                }
                                            `} onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();

                                                const items: MenuItem[] = [
                                                    {
                                                        title: "Add to queue",
                                                        icon: null,
                                                        onClick: () => {
                                                            addTrack(song);
                                                        }
                                                    },
                                                    {
                                                        title: "Remove from queue",
                                                        icon: null,
                                                        onClick: () => {
                                                            removeTrack(song.id);
                                                        }
                                                    }
                                                ]

                                                setContextMenu({
                                                    x: e.clientX,
                                                    y: e.clientY,
                                                    visible: true,
                                                    items: items,
                                                });
                                            }} />
                                        </div>
                                    ))
                                }
                            </div>
                        }
                    </div>
                    <div>
                        <div className="relative flex justify-center items-center h-9">
                            <audio ref={audioRef} src={currentTrack?.src} className="hidden"
                            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
                            onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}/>
                            <div className={"absolute flex p-2.5 gap-2 w-full items-center" + " " + `
                                ${
                                    currentTrack ? "" : "-bottom-20"
                                }
                            `}>
                                <span className="font-medium">{formatTime(currentTime)}</span>
                                <span ref={seekbarRef} className="w-full h-2 bg-[#ffffff80] rounded-full overflow-hidden hover:h-2.5 cursor-pointer duration-150"
                                onMouseDown={handleMouseDown}
                                onClick={(e) => handleSeek(e.clientX)}>
                                    <span style={{ width: `var(--current, 0%)` }} className="flex h-full bg-white"></span>
                                </span>
                                <span className="font-medium">{formatTime(duration)}</span>
                            </div>
                        </div>
                        <div className={"flex min-max-1 w-full p-1.5 items-start justify-between gap-0.5" + " " + `
                            ${
                                settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"
                            }
                        `}>
                            <div className={"flex gap-0.5 duration-150" + " " + `
                                ${
                                    currentTrack ? "" : "opacity-0 translate-y-2 pointer-events-none"
                                }
                            `}>
                                <div className="flex gap-0.5">
                                    <div ref={playRef} title={platform.includes("Mac") ? "Play ⌃ + P" : "Play: Alt + S"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {
                                        if (audioRef.current?.paused) {
                                            audioRef.current?.play();
                                            setIsPlaying(true);
                                        } else {
                                            audioRef.current?.pause();
                                            setIsPlaying(false);
                                        }
                                    }}>
                                        {
                                            isPlaying === false ?
                                            <PlayIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" /> :
                                            <PauseIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" />
                                        }
                                    </div>
                                </div>
                                <div className="flex gap-0.5">
                                    <div title={platform.includes("Mac") ? "Play ⌃ + P" : "Play: Alt + S"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {
                                    }}>
                                        <HeartOutline className="size-5 text-current stroke-current stroke-3 pointer-events-none" />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-0.5">
                                <div title={platform.includes("Mac") ? "Add To Your Library ⌃ + T" : "New Tab: Alt + T"}className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-200"
                                onClick={() => {
                                    newTab({
                                        id: createId(),
                                        title: "Music Library",
                                        url: "about:music?upload",
                                        current: true,
                                        displayUrl: "about:music",
                                        icon: <MusicalNoteIcon className="size-5" />
                                    })
                                }}>
                                    <PlusIcon className="size-5 stroke-current stroke-1.5 duration-150" />
                                </div>
                                <div title={platform.includes("Mac") ? "Library ⌃ + T" : "New Tab: Alt + T"}className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-200"
                                onClick={() => {
                                    newTab({
                                        id: createId(),
                                        title: "Music Library",
                                        url: "about:music",
                                        current: true,
                                        displayUrl: "about:music",
                                        icon: <MusicalNoteIcon className="size-5" />
                                    })
                                }}>
                                    <MusicalNoteIcon className="size-5 duration-150" />
                                </div>
                                <div title={platform.includes("Mac") ? "Toggle Tracks ⌃ + S" : "Toggle Tabs: Alt + S"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {
                                }}>
                                    <QueueListIcon className="size-5 text-current pointer-events-none" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {contextMenu?.visible && (
                <ContextMenu
                    items={contextMenu.items}
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    )
}