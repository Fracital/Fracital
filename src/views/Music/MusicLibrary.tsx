import { useEffect, useRef, useState } from "react"
import { useSettingsStore } from "../../store";
import { ArrowUpOnSquareIcon, BookmarkIcon, RectangleGroupIcon, PlusIcon } from "@heroicons/react/24/solid";
import { PlayIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/solid";
import type { SongProps } from "../../types"
import { parseBlob } from 'music-metadata';

interface MusicLibraryProps {
    query: string | undefined
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
            <span className="leading-none text-xl font-[650] text-current">{name}</span>
        </div>
    )
}

export interface AudioTags {
    title: string;
    artist: string;
    album: string;
    picture?: {
        data: Uint8Array;
        format: string;
    } | null;
    genre?: string | string[]
    year?: string | number
}

export const readTags = async (file: File): Promise<AudioTags | false> => {
    try {
        const metadata = await parseBlob(file);
        const common = metadata.common;
        const hasAnyTag = common.title || common.artist || common.album || (common.picture && common.picture.length > 0) || common.genre || common.year;

        if (!hasAnyTag) return false;

        return {
            title: common.title ?? "Untitled",
            artist: common.artist ?? "Unknown",
            album: common.album ?? "Unknown",
            picture: common.picture?.[0]
                ? {
                    data: common.picture[0].data,
                    format: common.picture[0].format,
                }
                : null,
            genre: common.genre ?? "Unknown",
            year: common.year ?? "Unknown"
        };
    } catch (err) {
        console.error('Failed to read metadata:', err);
        return false;
    }
};

export const MusicLibrary = ({ query }: MusicLibraryProps) => {
    const settings = useSettingsStore(state => state.settings)
    const [page, setpage] = useState<string | "library" | "upload" | "saves">(query ? query : "library")

    const [filename, setFileName] = useState<string>("")
    const albumCoverRef = useRef<HTMLImageElement>(null)
    const [albumCover, setAlbumCover] = useState<boolean | string>(false)
    const [audio, setAudio] = useState<boolean | null>(null)

    const audioRef = useRef<HTMLInputElement>(null)
    const titleRef = useRef<HTMLInputElement>(null)
    const artistRef = useRef<HTMLInputElement>(null)
    const albumRef = useRef<HTMLInputElement>(null)
    const genreRef = useRef<HTMLInputElement>(null)
    const yearRef = useRef<HTMLInputElement>(null)

    const [library, setLibrary] = useState<SongProps[]>([])

    useEffect(() => {
        let intervalId: number;

        const readLibrary = async () => {
            try {
                const folders = await Filer.fs.promises.readdir("/music");
                const songs: SongProps[] = [];

                for (const folderName of folders) {
                    try {
                        const folderPath = `/music/${folderName}`;
                        const entries = await Filer.fs.promises.readdir(folderPath);

                        const audioFileName = entries.find(name =>
                            /^audio\.(mp3|flac|wav|ogg|m4a)$/i.test(name)
                        );
                        if (!audioFileName) continue;

                        const audioPath = `${folderPath}/${audioFileName}`;
                        const audioData = await Filer.fs.promises.readFile(audioPath);
                        const blob = new Blob([audioData], { type: "audio/mpeg" });
                        const file = new File([blob], audioFileName, { type: "audio/mpeg" });

                        const tagsFromAudio = await readTags(file);

                        let tagsFromJson = {};
                        if (entries.includes("tags.json")) {
                            try {
                                const tagsJsonData = await Filer.fs.promises.readFile(`${folderPath}/tags.json`, "utf8");
                                tagsFromJson = JSON.parse(tagsJsonData);
                            } catch { }
                        }

                        const mergedTags = {
                            // @ts-expect-error
                            title: tagsFromJson.title || folderName,
                            // @ts-expect-error
                            artist: tagsFromJson.artist || "Unknown Artist",
                            // @ts-expect-error
                            album: tagsFromJson.album || "Unknown Album",
                            // @ts-expect-error
                            genre: tagsFromJson.genre || "Unknown Genre",
                            // @ts-expect-error
                            year: tagsFromJson.year || "Unknown Year",
                            // @ts-expect-error
                            cover: tagsFromJson.cover || "https://i.imgur.com/kf0Mavx.jpeg",
                            src: URL.createObjectURL(blob),
                        };

                        songs.push(mergedTags);
                    } catch (err) {
                        console.error("Error reading folder:", folderName, err);
                    }
                }

                setLibrary(prevLibrary => {
                    const newJson = JSON.stringify(songs);
                    const prevJson = JSON.stringify(prevLibrary);
                    return newJson !== prevJson ? songs : prevLibrary;
                });
            } catch (err) {
                console.error("Failed to read music directory:", err);
            }
        };

        readLibrary();
    });

    const pages = {
        "library": (
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold">Library</h1>
                {
                    library && library.map((song, index) => (
                        <div className="flex items-center gap-2 p-2.5 w-max rounded-xl bg-[#ffffff10] hover:bg-[#ffffff18] duration-150">
                            <img src={song.cover} alt={song.title} className="size-15 rounded-lg" />
                            <div className="flex flex-col gap-1 justify-center pr-2">
                                <span className="text-xl font-medium">{song.title}</span>
                                <span className="text-md text-[#ffffff88]">{song.artist}</span>
                            </div>
                            <PlayIcon className="size-9 p-2 rounded-full bg-[#ffffff10] hover:bg-[#ffffff18] cursor-pointer duration-150" title="Play track" />
                            <EllipsisHorizontalIcon className="size-9 stroke-current stroke-1 p-2 rounded-full bg-[#ffffff10] hover:bg-[#ffffff18] cursor-pointer duration-150" title="Track options" />
                        </div>
                    ))
                }
            </div>
        ),
        "saves": (
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold">Saves</h1>
                <div className="flex gap-2">
                </div>
            </div>
        ),
        "upload": (
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold">Upload</h1>
                <div className="flex flex-col gap-2 items-center">
                    <div className="flex flex-col gap-2">
                        <div className="flex gap-2 items-end">
                            <div className={"group relative flex justify-center size-30 items-center rounded-xl overflow-hidden bg-(--primary) inset-shadow-(--inset-shadow-primary)" + " " + `
                                ${
                                    albumCover === false ? "cursor-pointer" : ""
                                }
                            `} onMouseDown={() => {
                                const input = document.createElement("input")
                                input.type = "file"
                                input.accept = "image/png, image/jpeg, image/jpg, image/webp, image/gif"
                                input.onchange = (e) => {
                                    const file = (e.target as HTMLInputElement).files?.[0];
                                    if (file) {
                                        const reader = new FileReader();
                                        reader.onload = (e) => {
                                            if (albumCoverRef.current && typeof e.target?.result === "string") {
                                                albumCoverRef.current.src = e.target.result;
                                                setAlbumCover(e.target.result);
                                            }
                                        };
                                        reader.readAsDataURL(file);
                                    }
                                }
                                input.click()
                            }}>
                                <div className={"flex flex-col gap-1.5 justify-center items-center group-hover:text-[#ffffffac] text-[#ffffff68] duration-150 pointer-events-none" + " " + `
                                    ${
                                        albumCover !== false ? "absolute opacity-0" : ""
                                    }
                                `}>
                                    <PlusIcon className="size-5 stroke-current stroke-1"/>
                                    <span className="text-sm font-semibold">Album Art</span>
                                </div>
                                <img ref={albumCoverRef} className={`
                                    ${
                                        albumCover !== false ? "" : "opacity-0"
                                    }
                                `} />
                            </div>
                            <label className="relative flex  h-max cursor-pointer bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) p-4 hover:bg-(--primary-hover) text-[#ffffff88] transition-colors">
                                <div className="relative flex gap-2 justify-center items-center">
                                    <span className="text-sm font-semibold">{ filename ? filename : "Upload Audio file"}</span>
                                    <PlusIcon className={"size-4.5 stroke-current stroke-0.5" + " " + `
                                        ${
                                            filename ? "absolute opacity-0" : ""
                                        }
                                    `} />
                                </div>
                                <input
                                    ref={audioRef}
                                    type="file"
                                    accept="audio/*"
                                    className="hidden"
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            setAudio(true)
                                            const tags = await readTags(file);

                                            setFileName(file.name);
                                            const { title, artist, album, genre, year } = tags as any;
                                            if (titleRef.current && title) {
                                                titleRef.current.value = title;
                                            }
                                            if (artistRef.current && artist) {
                                                artistRef.current.value = artist
                                            }
                                            if (albumRef.current && album) {
                                                albumRef.current.value = album
                                            }
                                            if (genreRef.current && genre) {
                                                genreRef.current.value = genre
                                            }
                                            if (yearRef.current && year) {
                                                yearRef.current.value = year
                                            }
                                        }
                                    }}
                                />
                            </label>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-lg font-semibold">Title</span>
                            <input ref={titleRef} type="text" className="pl-3 p-2 bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) focus-within:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 duration-150" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-lg font-semibold">Artist(s)</span>
                            <input ref={artistRef} type="text" className="pl-3 p-2 bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) focus-within:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 duration-150" />
                            <span className="text-md text-[#ffffff88] mb-2">seperate each artist by ","</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-lg font-semibold">Album</span>
                            <input ref={albumRef} type="text" className="pl-3 p-2 bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) focus-within:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 duration-150" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-lg font-semibold">Genre(s)</span>
                            <input ref={genreRef} type="text" className="pl-3 p-2 bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) focus-within:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 duration-150" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-lg font-semibold">Year</span>
                            <input ref={yearRef} type="text" className="pl-3 p-2 bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) focus-within:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 duration-150" />
                        </div>
                        <div className="flex justify-end w-full">
                            <button className="leading-none p-3 px-4 rounded-lg bg-(--primary) inset-shadow-(--inset-shadow-primary) hover:inset-shadow-(--inset-shadow-accent) focus-visible:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 cursor-pointer duration-150" onClick={async () => {
                                if (!audio) {
                                    alert("You haven't uploaded any audio files!");
                                    return;
                                }

                                const file = audioRef.current?.files?.[0];
                                if (!file) {
                                    alert("No audio file selected!");
                                    return;
                                }

                                const buffer = new Uint8Array(await file.arrayBuffer());
                                const { ID3Writer: Writer } = await import("browser-id3-writer");
                                const writer = new Writer(buffer);

                                writer.addTag();
                                const taggedBlob = writer.getBlob();
                                const taggedArrayBuffer = await taggedBlob.arrayBuffer();
                                const taggedUint8Array = new Uint8Array(taggedArrayBuffer);

                                const baseName = file.name.replace(/\.[^/.]+$/, "");

                                await Filer.fs.promises.mkdir(`/music/${baseName}`);

                                const audioFileName = `audio${file.name.substring(file.name.lastIndexOf("."))}`;
                                await Filer.fs.promises.writeFile(`/music/${baseName}/${audioFileName}`, taggedUint8Array);

                                const providedTags = {
                                    title: titleRef.current?.value || "",
                                    artist: artistRef.current?.value || "",
                                    album: albumRef.current?.value || "",
                                    genre: genreRef.current?.value || "",
                                    cover: albumCover,
                                    year: yearRef.current?.value || "",
                                };
                                await Filer.fs.promises.writeFile(`/music/${baseName}/tags.json`, JSON.stringify(providedTags, null, 2));

                                alert("Your song and tags have been uploaded!");
                            }}>Upload</button>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex size-full gap-2 p-2">
            <div className="flex flex-col gap-2">
                <div className={"flex flex-col w-max py-2.5 pb-3 px-3.5 gap-2 inset-shadow-[0_0_0_1.5px_#ffffff10] rounded-lg" + " " + `
                    ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}
                `}>
                    <TabItem
                        currentPage={page}
                        setPage={setpage}
                        icon={<RectangleGroupIcon className="size-6 text-current duration-150" />}
                        name="Library"
                        pageKey="library"
                    />
                    <TabItem
                        currentPage={page}
                        setPage={setpage}
                        icon={<BookmarkIcon className="size-6 text-current duration-150" />}
                        name="Saves"
                        pageKey="saves"
                    />
                    <TabItem
                        currentPage={page}
                        setPage={setpage}
                        icon={<ArrowUpOnSquareIcon className="size-6 text-current duration-150" />}
                        name="Upload"
                        pageKey="upload"
                    />
                </div>
            </div>
            <div className="relative overflow-y-auto sm:h-full h-[calc(100%-10rem)] w-full">
                {
                    Object.entries(pages).map(([key, pageComponent], index) => (
                        <div key={index} className={"inset-0 flex flex-col gap-2 p-3.5 rounded-lg duration-150 h-full w-full" + " " + `
                            ${page === key ? "" : "absolute -translate-y-2.5 opacity-0 pointer-events-none"}
                        `}>
                            {pageComponent}
                        </div>
                    ))
                }
            </div>
        </div>
    )
}