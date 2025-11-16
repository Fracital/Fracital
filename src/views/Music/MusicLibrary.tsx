import { useEffect, useRef, useState } from "react";
import { useMusicStore, useSettingsStore } from "../../store";
import { ArrowUpOnSquareIcon, BookmarkIcon, RectangleGroupIcon, PlusIcon, MusicalNoteIcon } from "@heroicons/react/24/solid";
import { PlayIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/solid";
import { MusicPath, type Track } from "../../types";
import { parseBlob } from "music-metadata";
import { createId } from "@paralleldrive/cuid2";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";

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

export const MusicLibrary = ({ query }: MusicLibraryProps) => {
	const settings = useSettingsStore(state => state.settings);
	const setCurrentTrack = useMusicStore(state => state.setCurrentTrack);
	const addTrack = useMusicStore(state => state.addTrack);
	const removeTrack = useMusicStore(state => state.removeTrack);
	const playNext = useMusicStore(state => state.playNext);

	const currentTrack = useMusicStore(state => state.currentTrack);
	const [page, setpage] = useState<string | "library" | "upload" | "saves">(query ? query : "library");
	const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; visible: boolean; items: MenuItem[] }>(null);

	const [filename, setFileName] = useState<string>("");
	const albumCoverRef = useRef<HTMLImageElement>(null);
	const [albumCover, setAlbumCover] = useState<boolean | string>(false);
	const [audio, setAudio] = useState<boolean | null>(null);

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

	const pages = {
		library: (
			<div className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold">Library</h1>
				<div className="flex flex-wrap gap-2">
					{library.length === 0 ? (
						<span className="text-lg text-text-tertiary">No songs found.</span>
					) : (
						library.map((song, index) => (
							<div key={index} className={`flex items-center gap-2 p-2.5 w-max rounded-xl ${settings.brightness === "dark" ? "bg-[#ffffff20] hover:bg-[#ffffff28]" : "bg-[#00000028] hover:bg-[#00000038]"} duration-150`} onClick={(e: React.MouseEvent<HTMLElement>) => {
								if ((e.target as HTMLElement).id === "options") return;
								if (currentTrack === song) return;
								setCurrentTrack(song);
							}}>
								{song.cover ? (
									<img src={song.cover} className="size-12 rounded-md object-cover" />
								) : (
									<div className="size-12 rounded-md bg-(--primary) flex items-center justify-center text-(--text-tertiary) font-bold">
										<MusicalNoteIcon className="size-6 text-current" />
									</div>
								)}
								<div className="flex flex-col gap-1 justify-center pr-2 pointer-events-none">
									<span className="text-xl font-medium">{song.title}</span>
									<span className="text-md">{Array.isArray(song.artists) ? song.artists.join(", ") : song.artists}</span>
								</div>
								<div id="play" title="Play track" className={`flex items-center justify-center p-2 rounded-full ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#0000 0018]"} cursor-pointer duration-150`}>
									<PlayIcon id="play" className="size-5 pointer-events-none" />
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
											const tags = await readTags(file);

											setFileName(file.name);
											const { title, artist, album, genre, year, picture } = tags as AudioTags;
											console.log(artist);
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
											if (albumCoverRef.current && picture && picture.data) {
												const uint8 = Uint8Array.from(picture.data);
												const blob = new Blob([uint8], { type: picture.format });
												const reader = new FileReader();
												reader.onload = e => {
													const dataUrl = e.target?.result as string;
													if (albumCoverRef.current) albumCoverRef.current.src = dataUrl;
													setAlbumCover(dataUrl);
												};
												reader.readAsDataURL(blob);
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
						<div className="flex justify-end w-full">
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

									window.fr.dialog.alert({
										title: "Upload Successful",
										message: "Your song and tags have been uploaded!",
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
					<TabItem currentPage={page} setPage={setpage} icon={<RectangleGroupIcon className="size-6 text-current duration-150" />} name="Library" pageKey="library" />
					<TabItem currentPage={page} setPage={setpage} icon={<ArrowUpOnSquareIcon className="size-6 text-current duration-150" />} name="Upload" pageKey="upload" />
				</div>
			</div>
			<div className="relative overflow-y-auto sm:h-full h-[calc(100%-10rem)] w-full">
				{Object.entries(pages).map(([key, pageComponent], index) => (
					<div
						key={index}
						className={
							"inset-0 flex flex-col gap-2 p-3.5 rounded-lg duration-150 h-full w-full" +
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
