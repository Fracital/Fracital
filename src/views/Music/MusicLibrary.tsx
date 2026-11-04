import { useEffect, useRef, useState } from "react";
import { useMusicStore, useSettingsStore } from "../../store";
import { ArrowUpOnSquareIcon, BookmarkIcon, RectangleGroupIcon, PlusIcon, MusicalNoteIcon, XMarkIcon, MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { PlayIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/solid";
import { MusicPath, type Track } from "../../types";
import { parseBlob } from "music-metadata";
import { createId } from "@paralleldrive/cuid2";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import { LYRICS_ACCEPT, LYRICS_PROVIDER_NAMES, findOnlineLyrics, readLocalLyrics, saveLyrics, saveParsedLyrics, type Lyrics, type SongQuery } from "../../libs/lyrics";
import { TRACK_INFO_SOURCE_LABELS, audioDuration, fetchCoverDataUrl, findTrackInfo, guessFromFileName } from "../../libs/trackInfo";
import { lyricFormatOf } from "../../libs/lrc";
import { splitArtistCredit } from "../../libs/artistCredit";
import { PlayCount } from "../../components/PlayCount";
import { DigitalLibrary } from "../DigitalLibrary";
import { getPageFromUrl, updatePageTab } from "../../libs/aboutPages";
import { useTabsStore } from "../../store";
import { SignalIcon } from "@heroicons/react/24/solid";

type MusicSection = "digilib" | "library" | "upload";
const SECTIONS: MusicSection[] = ["digilib", "library", "upload"];

/** `about:music?digilib&artist=1` → section "digilib" + the Digital Library's own params. */
function parseMusicQuery(query: string | undefined): { section: MusicSection; sub: string | undefined } {
	const [key, ...rest] = (query ?? "").split("&");
	if (SECTIONS.includes(key as MusicSection)) return { section: key as MusicSection, sub: rest.join("&") || undefined };
	return { section: "digilib", sub: query || undefined };
}

interface MusicLibraryProps {
	query: string | undefined;
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

export interface AudioTags {
	title: string;
	artist: string;
	album: string;
	picture?: {
		data: Uint8Array;
		format: string;
	} | null;
	genre?: string | string[];
	year?: string | number;
}

export const readTags = async (file: File): Promise<AudioTags | false> => {
	try {
		const metadata = await parseBlob(file);
		const common = metadata.common;
		const hasAnyTag = common.title || common.artist || common.artists || common.album || (common.picture && common.picture.length > 0) || common.genre || common.year;
		console.log(common);
		console.log(hasAnyTag);

		if (!hasAnyTag) return false;

		// Handle multiple artists - check both 'artists' and 'artist' fields
		let artistString = "Unknown";
		if (common.artists && Array.isArray(common.artists)) {
			artistString = common.artists.join(", ");
		} else if (common.artist) {
			artistString = common.artist;
		}

		return {
			title: common.title ?? "Untitled",
			artist: artistString,
			album: common.album ?? "Unknown",
			picture: common.picture?.[0]
				? {
						data: common.picture[0].data,
						format: common.picture[0].format,
					}
				: null,
			genre: common.genre ?? "Unknown",
			year: common.year ?? "Unknown",
		};
	} catch (err) {
		console.error("Failed to read metadata:", err);
		return false;
	}
};

// Placeholder values written by tag readers and older uploads count as missing.
const isBlankTag = (value: unknown) => {
	const text = (Array.isArray(value) ? value.join(", ") : String(value ?? "")).trim();
	return !text || /^(unknown( (artist|album|genre|year))?|untitled|null|false)$/i.test(text);
};

const lyricsSummary = (lyrics: Lyrics) => `${lyrics.synced ? "synced" : "plain"} lyrics from ${LYRICS_PROVIDER_NAMES[lyrics.source] ?? lyrics.source}`;

const blobToDataUrl = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});

export const MusicLibrary = ({ query }: MusicLibraryProps) => {
	const settings = useSettingsStore(state => state.settings);
	const setCurrentTrack = useMusicStore(state => state.setCurrentTrack);
	const addTrack = useMusicStore(state => state.addTrack);
	const removeTrack = useMusicStore(state => state.removeTrack);
	const playNext = useMusicStore(state => state.playNext);

	const currentTrack = useMusicStore(state => state.currentTrack);
	const initial = parseMusicQuery(query);
	const [page, setPageState] = useState<MusicSection>(initial.section);
	/** The Digital Library's own params; kept while other sections are open so it doesn't reset. */
	const [digiQuery, setDigiQuery] = useState(initial.section === "digilib" ? initial.sub : undefined);
	// Follow the tab URL (back/forward, links from the player and artist pages).
	const [prevQuery, setPrevQuery] = useState(query);
	if (query !== prevQuery) {
		setPrevQuery(query);
		const next = parseMusicQuery(query);
		setPageState(next.section);
		if (next.section === "digilib") setDigiQuery(next.sub);
	}
	/** Switches section and reflects it in the tab URL. */
	const setpage = (section: string) => {
		const key = section as MusicSection;
		setPageState(key);
		const tab = useTabsStore.getState().tabs.find(t => t.current && getPageFromUrl(t.url) === "music");
		if (!tab) return;
		const q = key === "digilib" ? ["digilib", digiQuery].filter(Boolean).join("&") : key;
		updatePageTab(tab.id, "music", { query: q, title: key === "digilib" ? "Digital Library" : "Music" });
	};
	const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; visible: boolean; items: MenuItem[] }>(null);

	const [filename, setFileName] = useState<string>("");
	const albumCoverRef = useRef<HTMLImageElement>(null);
	const [albumCover, setAlbumCover] = useState<boolean | string>(false);
	const [audio, setAudio] = useState<boolean | null>(null);
	const [lyricsFile, setLyricsFile] = useState<File | null>(null);
	const lyricsRef = useRef<HTMLInputElement>(null);
	const [foundLyrics, setFoundLyrics] = useState<Lyrics | null>(null);
	const [lookup, setLookup] = useState<{ searching: boolean; message: string }>({ searching: false, message: "" });
	const lookupId = useRef(0);
	const durationRef = useRef<number | undefined>(undefined);

	const audioRef = useRef<HTMLInputElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
	const artistRef = useRef<HTMLInputElement>(null);
	const albumRef = useRef<HTMLInputElement>(null);
	const genreRef = useRef<HTMLInputElement>(null);
	const yearRef = useRef<HTMLInputElement>(null);

	const [library, setLibrary] = useState<Track[]>([]);

	useEffect(() => {
		let intervalId: number;

		const readLibrary = async () => {
			try {
				const folders = await window.fr.fs.promises.readdir(MusicPath);
				const songs: Track[] = [];

				for (const folderName of folders) {
					try {
						const folderPath = `${MusicPath}/${folderName}`;
						const entries = await window.fr.fs.promises.readdir(folderPath);

						const audioFileName = entries.find(name => /^audio\.(mp3|flac|wav|ogg|m4a)$/i.test(name));
						if (!audioFileName) continue;

						const audioPath = `${folderPath}/${audioFileName}`;
						const audioData = await window.fr.fs.promises.readFile(audioPath);
						const extension = audioFileName.split(".").pop()?.toLowerCase();
						const mimeType = extension === "mp3" ? "audio/mpeg" : extension === "wav" ? "audio/wav" : extension === "ogg" ? "audio/ogg" : extension === "m4a" ? "audio/mp4" : "application/octet-stream";

						const blob = new Blob([audioData], { type: mimeType });
						const blobUrl = URL.createObjectURL(blob);

						let tagsFromJson = {};
						if (entries.includes("tags.json")) {
							try {
								const tagsJsonData = await window.fr.fs.promises.readFile(`${folderPath}/tags.json`, "utf8");
								tagsFromJson = JSON.parse(tagsJsonData);
							} catch {}
						}

						const mergedTags = {
							id: createId(),
							folderName: folderName,
							// @ts-expect-error
							title: tagsFromJson.title || folderName,
							// @ts-expect-error
							artists: tagsFromJson.artists || "Unknown Artist",
							// @ts-expect-error
							album: tagsFromJson.album || "Unknown Album",
							// @ts-expect-error
							genre: tagsFromJson.genre || "Unknown Genre",
							// @ts-expect-error
							year: tagsFromJson.year || "Unknown Year",
							// @ts-expect-error
							cover: tagsFromJson.cover || null,
							explicit: false,
							src: blobUrl,
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

		// @ts-expect-error types
		var watcher = window.fr.fs.watch(MusicPath, { recursive: true }, () => {
			console.log("change");
			readLibrary();
			// @ts-expect-error types
			watcher.close();
			intervalId = window.setTimeout(() => {
				readLibrary();
				// @ts-expect-error types
				watcher = window.fr.fs.watch(MusicPath, { recursive: true }, () => {
					console.log("change");
					readLibrary();
					// @ts-expect-error types
					watcher.close();
				});
			}, 1000);
		});

		readLibrary();

		return () => {
			library.forEach(song => {
				if (song.src) URL.revokeObjectURL(song.src);
			});
		};
	}, []);

	const setCover = (dataUrl: string | false) => {
		if (albumCoverRef.current) albumCoverRef.current.src = dataUrl || "";
		setAlbumCover(dataUrl);
	};

	/** Fills empty upload fields, the cover and lyrics from online sources using the current title and artist. */
	const findOnline = async (hasCover: boolean, hasLyrics: boolean) => {
		const id = ++lookupId.current;
		const title = titleRef.current?.value.trim() ?? "";
		const artist = artistRef.current?.value.trim() ?? "";
		if (!title) {
			setLookup({ searching: false, message: "Enter a title to search online." });
			return;
		}
		setLookup({ searching: true, message: "Searching online for song info and lyrics…" });

		const songQuery: SongQuery = { title, artist: isBlankTag(artist) ? "" : artist, duration: durationRef.current };
		const [info, lyrics] = await Promise.all([findTrackInfo(songQuery), hasLyrics ? Promise.resolve(null) : findOnlineLyrics(songQuery)]);
		if (id !== lookupId.current) return;

		const filled: string[] = [];
		const fill = (ref: React.RefObject<HTMLInputElement | null>, value: string | undefined, label: string) => {
			if (ref.current && value && isBlankTag(ref.current.value)) {
				ref.current.value = value;
				filled.push(label);
			}
		};
		if (info) {
			fill(artistRef, info.artist, "artist");
			fill(albumRef, info.album, "album");
			fill(genreRef, info.genre, "genre");
			fill(yearRef, info.year, "year");
			if (info.coverUrl && !hasCover) {
				try {
					const dataUrl = await fetchCoverDataUrl(info.coverUrl);
					if (id !== lookupId.current) return;
					setCover(dataUrl);
					filled.push("cover");
				} catch (err) {
					console.warn("Failed to download cover:", err);
				}
			}
		}
		if (lyrics) setFoundLyrics(lyrics);

		const parts: string[] = [];
		if (info) parts.push(filled.length ? `Added ${filled.join(", ")} from ${TRACK_INFO_SOURCE_LABELS[info.source]}` : `Found on ${TRACK_INFO_SOURCE_LABELS[info.source]}, nothing new to add`);
		if (lyrics) parts.push(`found ${lyricsSummary(lyrics)}`);
		const message = parts.length ? `${parts.join("; ")}.` : "Nothing found online. Check the title and artist, then try again.";
		setLookup({ searching: false, message: message.charAt(0).toUpperCase() + message.slice(1) });
	};

	/** Library action: fills missing tags, cover art and lyrics for a song already in the library. */
	const findOnlineForSong = async (song: Track) => {
		setContextMenu(null);
		if (!song.folderName) {
			window.fr.dialog.alert({ title: "Error", message: "Cannot look up this song: folder information missing." });
			return;
		}
		const folderName = song.folderName;
		const folderPath = `${MusicPath}/${folderName}`;

		let tags: Record<string, unknown> = {};
		try {
			tags = JSON.parse(await window.fr.fs.promises.readFile(`${folderPath}/tags.json`, "utf8"));
		} catch {
			tags = {};
		}

		const guess = guessFromFileName(folderName);
		const title = isBlankTag(tags.title) ? guess.title : String(tags.title);
		const artist = isBlankTag(tags.artists) ? guess.artist : Array.isArray(tags.artists) ? tags.artists.join(", ") : String(tags.artists);
		const local = await readLocalLyrics(song);
		const songQuery: SongQuery = { title, artist, duration: local.duration };

		const [info, lyrics] = await Promise.all([findTrackInfo(songQuery), local.lyrics ? Promise.resolve(null) : findOnlineLyrics(songQuery)]);

		const filled: string[] = [];
		if (info) {
			const setTag = (key: string, value: unknown, label: string) => {
				if (value && isBlankTag(tags[key])) {
					tags[key] = value;
					filled.push(label);
				}
			};
			setTag("title", info.title, "title");
			setTag(
				"artists",
				splitArtistCredit(info.artist),
				"artist",
			);
			setTag("album", info.album, "album");
			setTag("genre", info.genre, "genre");
			setTag("year", info.year, "year");
			if (info.coverUrl && isBlankTag(tags.cover)) {
				try {
					tags.cover = await fetchCoverDataUrl(info.coverUrl);
					filled.push("cover");
				} catch (err) {
					console.warn("Failed to download cover:", err);
				}
			}
		}

		try {
			if (filled.length) await window.fr.fs.promises.writeFile(`${folderPath}/tags.json`, JSON.stringify(tags, null, 2));
			if (lyrics) await saveParsedLyrics(folderName, lyrics);
		} catch (err) {
			console.error("Failed to save song info:", err);
			window.fr.dialog.alert({ title: "Error", message: "Found info online but couldn't save it." });
			return;
		}

		if (filled.length) {
			const updated: Partial<Track> = {};
			if (filled.includes("title")) updated.title = String(tags.title);
			if (filled.includes("artist")) updated.artists = tags.artists as string[];
			if (filled.includes("album")) updated.album = String(tags.album);
			if (filled.includes("genre")) updated.genre = String(tags.genre);
			if (filled.includes("year")) updated.year = String(tags.year);
			if (filled.includes("cover")) updated.cover = String(tags.cover);
			setLibrary(prev => prev.map(s => (s.id === song.id ? { ...s, ...updated } : s)));
		}

		const parts: string[] = [];
		if (info) parts.push(filled.length ? `Added ${filled.join(", ")} from ${TRACK_INFO_SOURCE_LABELS[info.source]}.` : `Found "${song.title}" on ${TRACK_INFO_SOURCE_LABELS[info.source]}, but its info is already complete.`);
		if (lyrics) parts.push(`Saved ${lyricsSummary(lyrics)}.`);
		else if (local.lyrics) parts.push("It already has lyrics.");
		window.fr.dialog.alert({
			title: info || lyrics ? "Song Info Updated" : "Nothing Found",
			message: info || lyrics ? parts.join(" ") : `Couldn't find "${title}" online. Try setting the title and artist first.`,
		});
	};

	const pages = {
		digilib: <DigitalLibrary query={digiQuery} urlPage="music" urlPrefix="digilib" />,
		library: (
			<div className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold">My Music</h1>
				<div className="flex flex-wrap gap-2">
					{library.length === 0 ? (
						<span className="text-lg text-text-tertiary">No songs found.</span>
					) : (
						library.map((song, index) => (
							<div
								key={index}
								className={`group flex items-center gap-2 p-2.5 w-max rounded-xl ${settings.brightness === "dark" ? "bg-[#ffffff20] hover:bg-[#ffffff28]" : "bg-[#00000028] hover:bg-[#00000038]"} duration-150`}
								onClick={(e: React.MouseEvent<HTMLElement>) => {
									if ((e.target as HTMLElement).id === "options") return;
									if (currentTrack === song) return;
									setCurrentTrack(song);
								}}
							>
								{song.cover ? (
									<div className="relative flex items-center justify-center size-12 rounded-md overflow-hidden">
										<PlayIcon className="absolute size-6 scale-80 opacity-0 group-hover:opacity-100 group-hover:scale-100 duration-150" style={{ filter: "drop-shadow: 0 0 5px #000000" }} />
										<img src={song.cover} className="size-full object-cover" />
									</div>
								) : (
									<div className="relative size-12 rounded-md bg-(--primary) flex items-center justify-center text-(--text-tertiary) font-bold">
										<PlayIcon className="absolute size-6 text-(--text-primary) scale-80 opacity-0 group-hover:opacity-100 group-hover:scale-100 duration-150" style={{ filter: "drop-shadow: 0 0 5px #000000" }} />
										<MusicalNoteIcon className="size-6 text-current" />
									</div>
								)}
								<div className="flex flex-col gap-1 justify-center pr-2 pointer-events-none">
									<span className="text-xl font-medium">{song.title}</span>
									<span className="text-md">{Array.isArray(song.artists) ? song.artists.join(", ") : song.artists}</span>
									<PlayCount title={song.title} artist={song.artists} skeleton={false} className="text-xs text-(--text-tertiary)" />
								</div>
								<div
									id="options"
									title="Track options"
									className={`flex items-center justify-center p-2 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#0000 0018]"} rounded-full cursor-pointer duration-150`}
									onClick={e => {
										const rect = (e.target as HTMLElement).getBoundingClientRect();
										const x = rect.left;
										const y = rect.bottom;
										console.log(rect);

										const items: MenuItem[] = [
											{
												title: "Play",
												onClick: () => {
													setCurrentTrack(song);
												},
												icon: null,
											},
											{
												title: "Play next",
												onClick: () => {
													try {
														const store: any = useMusicStore;
														const state = store.getState();
														const existingQueue = Array.isArray(state.queue) ? state.queue : [];
														const filteredQueue = existingQueue.filter((t: any) => t.id !== song.id);
														const newQueue = [song, ...filteredQueue];
														store.setState({ queue: newQueue });
														setContextMenu(null);
													} catch (err) {
														console.error("Failed to add track to top of queue, falling back to append:", err);
														addTrack(song);
														setContextMenu(null);
													}
												},
												icon: null,
											},
											{
												title: "Add to Queue",
												onClick: () => {
													addTrack(song);
												},
												icon: null,
											},
											{
												title: "Add Album Art",
												onClick: () => {
													(async () => {
														try {
															if (!song.folderName) {
																window.fr.dialog.alert({ title: "Error", message: "Cannot add album art: folder information missing." });
																return;
															}

															const input = document.createElement("input");
															input.type = "file";
															input.accept = "image/*";
															input.onchange = async e => {
																const file = (e.target as HTMLInputElement).files?.[0];
																if (!file) return;

																const reader = new FileReader();
																reader.onload = async ev => {
																	const dataUrl = ev.target?.result as string;
																	const folderPath = `${MusicPath}/${song.folderName}`;

																	let tags: any = {};
																	try {
																		const existing = await window.fr.fs.promises.readFile(`${folderPath}/tags.json`, "utf8");
																		tags = JSON.parse(existing);
																	} catch {
																		tags = {};
																	}

																	tags.cover = dataUrl;

																	try {
																		await window.fr.fs.promises.writeFile(`${folderPath}/tags.json`, JSON.stringify(tags, null, 2));
																	} catch (err) {
																		console.error("Failed to write tags.json:", err);
																		window.fr.dialog.alert({ title: "Error", message: "Failed to save album art to disk." });
																		return;
																	}

																	setLibrary(prev => prev.map(s => (s.id === song.id ? { ...s, cover: dataUrl } : s)));

																	window.fr.dialog.alert({ title: "Album Art Added", message: `Album art added for "${song.title}".` });
																	setContextMenu(null);
																};
																reader.readAsDataURL(file);
															};
															input.click();
														} catch (err) {
															console.error("Add album art failed:", err);
															window.fr.dialog.alert({ title: "Error", message: "An error occurred while adding album art." });
														}
													})();
												},
												icon: null,
											},
											{
												title: "Find Info Online",
												onClick: () => {
													void findOnlineForSong(song);
												},
												icon: null,
											},
											{
												title: "Add Lyrics",
												onClick: () => {
													if (!song.folderName) {
														window.fr.dialog.alert({ title: "Error", message: "Cannot add lyrics: folder information missing." });
														return;
													}
													const folderName = song.folderName;
													const input = document.createElement("input");
													input.type = "file";
													input.accept = LYRICS_ACCEPT;
													input.onchange = async e => {
														const file = (e.target as HTMLInputElement).files?.[0];
														if (!file) return;
														try {
															await saveLyrics(folderName, file);
															window.fr.dialog.alert({ title: "Lyrics Added", message: `Lyrics added for "${song.title}".` });
														} catch (err) {
															console.error("Add lyrics failed:", err);
															window.fr.dialog.alert({ title: "Error", message: err instanceof Error ? err.message : "An error occurred while adding lyrics." });
														}
														setContextMenu(null);
													};
													input.click();
												},
												icon: null,
											},
											{
												title: "Remove from Library",
												onClick: async () => {
													try {
														if (!song.folderName) {
															window.fr.dialog.alert({
																title: "Error",
																message: "Cannot delete track: folder information missing.",
															});
															return;
														}

														const folderPath = `${MusicPath}/${song.folderName}`;
														try {
															await window.fr.fs.promises.readdir(folderPath);
														} catch {
															window.fr.dialog.alert({
																title: "Error",
																message: "Track folder not found. It may have already been deleted.",
															});
															setLibrary(prev => prev.filter(s => s.id !== song.id));
															return;
														}

														await window.fr.sh.promises.rm(folderPath, { recursive: true, force: true });
														if (song.src) {
															try {
																URL.revokeObjectURL(song.src);
															} catch {}
														}

														try {
															removeTrack(song.id);
														} catch {}

														setLibrary(prev => prev.filter(s => s.id !== song.id));
														window.fr.dialog.alert({
															title: "Track Removed",
															message: `"${song.title}" has been removed from your library.`,
														});

														if (currentTrack && currentTrack.id === song.id) {
															playNext();
														}
													} catch (err) {
														console.error("Failed to remove track:", err);
														window.fr.dialog.alert({
															title: "Error",
															message: "An error occurred while removing the track.",
														});
													}
												},
												icon: null,
											},
										];

										setContextMenu({ x, y, visible: true, items });
									}}
								>
									<EllipsisHorizontalIcon id="options" className="size-5 stroke-current stroke-1 pointer-events-none" />
								</div>
							</div>
						))
					)}
				</div>
			</div>
		),
		upload: (
			<div className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold">Upload</h1>
				<div className="flex flex-col gap-2 items-center">
					<div className="flex flex-col gap-2">
						<div className="flex gap-2 items-end">
							<div
								className={
									"group relative flex justify-center size-30 items-center rounded-xl overflow-hidden bg-(--primary) inset-shadow-(--inset-shadow-primary)" +
									" " +
									`
                                ${albumCover === false ? "cursor-pointer" : ""}
                            `
								}
								onMouseDown={() => {
									const input = document.createElement("input");
									input.type = "file";
									input.accept = "image/png, image/jpeg, image/jpg, image/webp, image/gif";
									input.onchange = e => {
										const file = (e.target as HTMLInputElement).files?.[0];
										if (file) {
											const reader = new FileReader();
											reader.onload = e => {
												if (albumCoverRef.current && typeof e.target?.result === "string") {
													albumCoverRef.current.src = e.target.result;
													setAlbumCover(e.target.result);
												}
											};
											reader.readAsDataURL(file);
										}
									};
									input.click();
								}}
							>
								<div
									className={
										"flex flex-col gap-1.5 justify-center items-center group-hover:opacity-80 duration-150 pointer-events-none" +
										" " +
										`
                                    ${albumCover !== false ? "absolute opacity-0" : ""}
                                `
									}
								>
									<PlusIcon className="size-5 stroke-current stroke-1" />
									<span className="text-sm font-semibold">Album Art</span>
								</div>
								<img
									ref={albumCoverRef}
									className={`
                                    ${albumCover !== false ? "" : "opacity-0"}
                                `}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<label className="relative flex  h-max cursor-pointer bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) p-4 hover:bg-(--primary-hover) transition-colors">
									<div className="relative flex gap-2 justify-center items-center">
										<span className="text-sm font-semibold">{filename ? filename : "Upload Audio file"}</span>
										<PlusIcon
											className={
												"size-4.5 stroke-current stroke-0.5" +
												" " +
												`
                                        ${filename ? "absolute opacity-0" : ""}
                                    `
											}
										/>
									</div>
									<input
										ref={audioRef}
										type="file"
										accept="audio/*"
										className="hidden"
										onChange={async e => {
											const file = e.target.files?.[0];
											if (file) {
												setAudio(true);
												setFoundLyrics(null);
												const tags = await readTags(file);

												setFileName(file.name);
												const { title, artist, album, genre, year, picture } = tags as AudioTags;
												if (titleRef.current && title) {
													titleRef.current.value = title;
												}
												if (artistRef.current && artist) {
													artistRef.current.value = artist;
												}
												if (albumRef.current && album) {
													albumRef.current.value = album;
												}
												if (genreRef.current && genre) {
													// @ts-expect-error you know it works buddy
													genreRef.current.value = genre;
												}
												if (yearRef.current && year) {
													// @ts-expect-error you know it works buddy
													yearRef.current.value = year;
												}
												let hasCover = albumCover !== false;
												if (picture && picture.data) {
													setCover(await blobToDataUrl(new Blob([Uint8Array.from(picture.data)], { type: picture.format })));
													hasCover = true;
												}

												// Files without tags are usually named "Artist - Title".
												const guess = guessFromFileName(file.name);
												if (titleRef.current && isBlankTag(titleRef.current.value)) titleRef.current.value = guess.title;
												if (artistRef.current && guess.artist && isBlankTag(artistRef.current.value)) artistRef.current.value = guess.artist;

												durationRef.current = await audioDuration(file);
												void findOnline(hasCover, !!lyricsFile);
											}
										}}
									/>
								</label>
								<label title="LRC, SRT or TXT lyrics" className="relative flex h-max cursor-pointer bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) p-4 hover:bg-(--primary-hover) transition-colors">
									<div className="relative flex gap-2 justify-center items-center">
										<span className="text-sm font-semibold">{lyricsFile ? lyricsFile.name : foundLyrics ? `Lyrics found online (${foundLyrics.synced ? "synced" : "plain"})` : "Add Lyrics (LRC, SRT, TXT)"}</span>
										{lyricsFile || foundLyrics ? (
											<XMarkIcon
												title="Remove lyrics"
												className="size-4.5 opacity-70 hover:opacity-100 duration-150"
												onClick={e => {
													e.preventDefault();
													if (lyricsFile) {
														setLyricsFile(null);
														if (lyricsRef.current) lyricsRef.current.value = "";
													} else {
														setFoundLyrics(null);
													}
												}}
											/>
										) : (
											<PlusIcon className="size-4.5 stroke-current stroke-0.5" />
										)}
									</div>
									<input
										ref={lyricsRef}
										type="file"
										accept={LYRICS_ACCEPT}
										className="hidden"
										onChange={e => {
											const file = e.target.files?.[0];
											if (!file) return;
											if (!lyricFormatOf(file.name)) {
												window.fr.dialog.alert({ title: "Unsupported Lyrics", message: "Please choose an LRC, SRT or TXT file." });
												e.target.value = "";
												return;
											}
											setLyricsFile(file);
										}}
									/>
								</label>
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<span className="text-lg font-semibold">Title</span>
							<input ref={titleRef} type="text" className="pl-3 p-2 bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) focus-within:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 duration-150" />
						</div>
						<div className="flex flex-col gap-1.5">
							<span className="text-lg font-semibold">Artist(s)</span>
							<input ref={artistRef} type="text" className="pl-3 p-2 bg-(--primary) rounded-lg inset-shadow-(--inset-shadow-primary) focus-within:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 duration-150" />
							<span className="text-md mb-2">seperate each artist by ","</span>
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
						{lookup.message && <span className={`text-sm text-(--text-secondary) max-w-md ${lookup.searching ? "animate-pulse" : ""}`}>{lookup.message}</span>}
						<div className="flex justify-between gap-2 w-full">
							<button
								title="Fill in empty fields, cover art and lyrics using the title and artist"
								disabled={lookup.searching}
								className="flex items-center gap-2 leading-none p-3 px-4 rounded-lg bg-(--primary) inset-shadow-(--inset-shadow-primary) hover:inset-shadow-(--inset-shadow-accent) focus-visible:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 cursor-pointer disabled:opacity-60 disabled:cursor-wait duration-150"
								onClick={() => void findOnline(albumCover !== false, !!lyricsFile)}
							>
								<MagnifyingGlassIcon className="size-4" />
								Find Info Online
							</button>
							<button
								className="leading-none p-3 px-4 rounded-lg bg-(--primary) inset-shadow-(--inset-shadow-primary) hover:inset-shadow-(--inset-shadow-accent) focus-visible:inset-shadow-(--inset-shadow-accent) focus-visible:outline-0 cursor-pointer duration-150"
								onClick={async () => {
									if (!audio) {
										window.fr.dialog.alert({
											title: "No Audio",
											message: "You haven't uploaded any audio files!",
										});
										return;
									}

									const file = audioRef.current?.files?.[0];
									if (!file) {
										window.fr.dialog.alert({
											title: "No File",
											message: "No audio file selected!",
										});
										return;
									}

									const arrayBuffer = await file.arrayBuffer();

									const baseName = file.name.replace(/\.[^/.]+$/, "");

									await window.fr.fs.promises.mkdir(`${MusicPath}/${baseName}`);

									const audioFileName = `audio${file.name.substring(file.name.lastIndexOf("."))}`;
									await window.fr.fs.promises.writeFile(`${MusicPath}/${baseName}/${audioFileName}`, window.fr.buffer.from(arrayBuffer));

									const artists = artistRef.current?.value.trim() || "";
									const artistsArray = artists.includes(",")
										? artists
												.split(",")
												.map(artist => artist.trim())
												.filter(Boolean)
										: artists
											? [artists]
											: [];

									const providedTags = {
										title: titleRef.current?.value || "",
										artists: artistsArray,
										album: albumRef.current?.value || "",
										genre: genreRef.current?.value || "",
										cover: albumCover,
										year: yearRef.current?.value || "",
									};
									await window.fr.fs.promises.writeFile(`${MusicPath}/${baseName}/tags.json`, JSON.stringify(providedTags, null, 2));

									let lyricsError: string | null = null;
									const hasLyrics = !!(lyricsFile || foundLyrics);
									if (hasLyrics) {
										try {
											if (lyricsFile) await saveLyrics(baseName, lyricsFile);
											else if (foundLyrics) await saveParsedLyrics(baseName, foundLyrics);
										} catch (err) {
											console.error("Failed to save lyrics:", err);
											lyricsError = err instanceof Error ? err.message : "Unknown error.";
										}
									}

									window.fr.dialog.alert({
										title: "Upload Successful",
										message: lyricsError ? `Your song and tags have been uploaded, but the lyrics couldn't be saved: ${lyricsError}` : hasLyrics ? "Your song, tags and lyrics have been uploaded!" : "Your song and tags have been uploaded!",
									});
									if (titleRef.current) {
										titleRef.current.value = "";
									}
									if (artistRef.current) {
										artistRef.current.value = "";
									}
									if (albumRef.current) {
										albumRef.current.value = "";
									}
									if (genreRef.current) {
										genreRef.current.value = "";
									}
									if (yearRef.current) {
										yearRef.current.value = "";
									}
									if (albumCoverRef.current) {
										albumCoverRef.current.src = "";
									}
									setFileName("");
									setLyricsFile(null);
									if (lyricsRef.current) lyricsRef.current.value = "";
									setFoundLyrics(null);
									lookupId.current++;
									setLookup({ searching: false, message: "" });
									durationRef.current = undefined;
									setAlbumCover(false);
									setAudio(null);
									setpage("library");
								}}
							>
								Upload
							</button>
						</div>
					</div>
				</div>
			</div>
		),
	};

	return (
		<div className="flex size-full gap-2 p-2">
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
					<TabItem currentPage={page} setPage={setpage} icon={<SignalIcon className="size-6 text-current duration-150" />} name="Digital Library" pageKey="digilib" />
					<TabItem currentPage={page} setPage={setpage} icon={<RectangleGroupIcon className="size-6 text-current duration-150" />} name="My Music" pageKey="library" />
					<TabItem currentPage={page} setPage={setpage} icon={<ArrowUpOnSquareIcon className="size-6 text-current duration-150" />} name="Upload" pageKey="upload" />
				</div>
			</div>
			<div className="relative overflow-y-auto sm:h-full h-[calc(100%-10rem)] w-full">
				{Object.entries(pages).map(([key, pageComponent], index) => (
					<div
						key={index}
						className={
							`inset-0 flex flex-col gap-2 ${key === "digilib" ? "" : "p-3.5"} rounded-lg duration-150 h-full w-full` +
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
			{contextMenu?.visible && <ContextMenu items={contextMenu.items} position={{ x: contextMenu.x, y: contextMenu.y }} onClose={() => setContextMenu(null)} />}
		</div>
	);
};
