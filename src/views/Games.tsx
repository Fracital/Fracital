import { useState, useEffect, useRef } from "react";
import { RufflePlayer } from "../components/RufflePlayer";
import { HTMLPlayer } from "../components/HTMLPlayer";
import { GameInstaller } from "../components/GameInstaller";
import { useSettingsStore, useTabsStore } from "../store";
import { updatePageTab } from "../libs/aboutPages";
import { PlusIcon, PlayIcon, XMarkIcon, PhotoIcon, TrashIcon, StarIcon, PencilIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, SpeakerWaveIcon, SpeakerXMarkIcon, FunnelIcon, ArchiveBoxIcon, FolderIcon, ChevronLeftIcon, ChevronRightIcon, ArrowDownTrayIcon } from "@heroicons/react/24/solid";
import { ClipboardIcon, StarIcon as StarOutlineIcon } from "@heroicons/react/24/outline";
import { GamesPath } from "../types";
import { createId } from "@paralleldrive/cuid2";

interface Game {
	id: string;
	title: string;
	url?: string;
	data?: ArrayBuffer;
	folderPath?: string;
	thumbnail?: string;
	type: "flash" | "html5";
	folderName: string;
	author?: string;
	version?: string;
	description?: string;
	tags?: string[];
	isFavorite?: boolean;
	createdAt?: string;
	modifiedAt?: string;
}

interface UploadModalData {
	file?: File;
	files?: FileList;
	arrayBuffer?: ArrayBuffer;
	title: string;
	thumbnail?: string;
	author: string;
	version: string;
	description: string;
	tags: string;
	type: "flash" | "html5";
	gameFile?: string;
}

interface EditModalData {
	game: Game;
	title: string;
	thumbnail?: string;
	author: string;
	version: string;
	description: string;
	tags: string;
}

interface GamesProps {
	query?: string;
	className?: string;
}

const Games = ({ query, className }: GamesProps) => {
	const settings = useSettingsStore(state => state.settings);
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const [selectedGame, setSelectedGame] = useState<Game | null>(null);
	const [games, setGames] = useState<Game[]>([]);
	const [loading, setLoading] = useState(true);
	const [deleting, setDeleting] = useState(false);
	const [uploadModal, setUploadModal] = useState<UploadModalData | null>(null);
	const [editModal, setEditModal] = useState<EditModalData | null>(null);
	const [activeTab, setActiveTab] = useState<"all" | "favorites" | "download">("all");
	const [selectedTag, setSelectedTag] = useState<string>("all");
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isMuted, setIsMuted] = useState(false);
	const [showUploadTypeModal, setShowUploadTypeModal] = useState(false);

	const playerContainerRef = useRef<HTMLDivElement>(null);
	const rufflePlayerRef = useRef<any>(null);
	const [detailsCollapsed, setDetailsCollapsed] = useState<boolean>(() => {
		try {
			return localStorage.getItem("gamesDetailsCollapsed") === "1";
		} catch {
			return false;
		}
	});

	useEffect(() => {
		try {
			localStorage.setItem("gamesDetailsCollapsed", detailsCollapsed ? "1" : "0");
		} catch {}
	}, [detailsCollapsed]);

	const readGames = async () => {
		setLoading(true);
		try {
			const folders = await window.fr.fs.promises.readdir(GamesPath);
			const gamesList: Game[] = [];
			const favoriteGames = JSON.parse(localStorage.getItem("favoriteGames") || "[]");

			for (const folderName of folders) {
				try {
					const folderPath = `${GamesPath}/${folderName}`;
					const entries = await window.fr.fs.promises.readdir(folderPath);
					const metadataPath = `${folderPath}/index.json`;

					let metadata: any = {};
					try {
						if (entries.includes("index.json")) {
							const metadataContent = await window.fr.fs.promises.readFile(metadataPath, "utf8");
							metadata = JSON.parse(metadataContent);
						}
					} catch (err) {
						console.warn(`No metadata for ${folderName}:`, err);
					}

					if (!metadata.thumbnail) {
						const thumbnailName = ["index.png", "icon.png", "thumbnail.png"].find(name => entries.includes(name));
						if (thumbnailName) {
							try {
								const imageData = await window.fr.fs.promises.readFile(`${folderPath}/${thumbnailName}`);
								metadata.thumbnail = `data:image/png;base64,${window.fr.buffer.from(imageData).toString("base64")}`;
							} catch (err) {
								console.warn(`Could not read thumbnail for ${folderName}:`, err);
							}
						}
					}

					const gameType = metadata.type || "flash";
					if (gameType === "flash") {
						const swfFileName = entries.find(name => name.toLowerCase().endsWith(".swf"));
						if (!swfFileName) continue;

						const swfPath = `${folderPath}/${swfFileName}`;
						const swfData = await window.fr.fs.promises.readFile(swfPath);

						let uint8Array: Uint8Array;
						if (swfData instanceof Uint8Array) {
							uint8Array = swfData;
						} else if (swfData.buffer && swfData.buffer instanceof ArrayBuffer) {
							uint8Array = new Uint8Array(swfData.buffer, swfData.byteOffset, swfData.byteLength);
						} else {
							uint8Array = new Uint8Array(swfData);
						}

						gamesList.push({
							id: folderName,
							folderName: folderName,
							title: metadata.title || folderName,
							data: uint8Array.buffer as ArrayBuffer,
							thumbnail: metadata.thumbnail,
							author: metadata.author,
							version: metadata.version,
							description: metadata.description,
							tags: metadata.tags,
							type: "flash",
							isFavorite: favoriteGames.includes(folderName),
							createdAt: metadata.createdAt,
							modifiedAt: metadata.modifiedAt,
						});
					} else if (gameType === "html5") {
						const gameFile = metadata.gameFile || "index.html";

						if (!entries.includes(gameFile)) continue;

						const game = {
							id: folderName,
							folderName: folderName,
							title: metadata.title || folderName,
							folderPath: folderPath,
							thumbnail: metadata.thumbnail,
							author: metadata.author,
							version: metadata.version,
							description: metadata.description,
							tags: metadata.tags,
							type: "html5" as const,
							isFavorite: favoriteGames.includes(folderName),
							createdAt: metadata.createdAt,
							modifiedAt: metadata.modifiedAt,
						};
						console.log("[readGames] Adding HTML5 game:", game);
						gamesList.push(game);
					}
				} catch (err) {
					console.error(`Error reading game folder ${folderName}:`, err);
				}
			}

			setGames(gamesList);
		} catch (err) {
			console.error("Failed to read games directory:", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		readGames();

		// @ts-expect-error types
		const watcher = window.fr.fs.watch(GamesPath, { recursive: true }, () => {
			readGames();
		});

		return () => {
			// @ts-expect-error types
			if (watcher) watcher.close();
		};
	}, []);

	useEffect(() => {
		if (games.length === 0) return;

		if (query) {
			const params = new URLSearchParams(query.includes("=") ? query : `g=${query}`);

			const gameId = params.get("g") || params.get("id");
			if (gameId) {
				const game = games.find(g => g.id === gameId);
				if (game && selectedGame?.id !== game.id) {
					setSelectedGame(game);
					return;
				}
			}

			const tagFilter = params.get("tag");
			if (tagFilter) {
				setSelectedTag(tagFilter);
			}

			const typeFilter = params.get("type");
			if (typeFilter && (typeFilter === "flash" || typeFilter === "html5")) {
			}
		} else {
			if (selectedGame !== null) {
				setSelectedGame(null);
			}
		}
	}, [query, games]);

	useEffect(() => {
		if (!currentTab) return;

		if (selectedGame) {
			updatePageTab(currentTab.id, "games", {
				title: selectedGame.title,
				query: `g=${selectedGame.id}`,
			});
		} else if (selectedGame === null && currentTab.url.includes("about:games") && currentTab.url !== "about:games" && games.length > 0) {
			updatePageTab(currentTab.id, "games");
		}
	}, [selectedGame, games.length]);

	useEffect(() => {
		const handleFullscreenChange = () => {
			setIsFullscreen(Boolean(document.fullscreenElement));
		};

		document.addEventListener("fullscreenchange", handleFullscreenChange);
		return () => {
			document.removeEventListener("fullscreenchange", handleFullscreenChange);
		};
	}, []);

	const deleteGame = async (game: Game) => {
		if (!confirm(`Delete ${game.title}? This will remove the game folder from your library.`)) return;
		setDeleting(true);
		try {
			const folderPath = `${GamesPath}/${game.folderName}`;
			const entries = await window.fr.fs.promises.readdir(folderPath);

			for (const fileName of entries) {
				await window.fr.fs.promises.unlink(`${folderPath}/${fileName}`);
			}

			await window.fr.fs.promises.rmdir(folderPath);
			if (selectedGame?.folderName === game.folderName) {
				setSelectedGame(null);
			}
			await readGames();
		} catch (err) {
			console.error("Failed to delete game:", err);
			alert("Failed to delete game");
		} finally {
			setDeleting(false);
		}
	};

	const toggleFavorite = (game: Game) => {
		const favoriteGames = JSON.parse(localStorage.getItem("favoriteGames") || "[]");
		const isFavorited = favoriteGames.includes(game.folderName);

		if (isFavorited) {
			const updated = favoriteGames.filter((name: string) => name !== game.folderName);
			localStorage.setItem("favoriteGames", JSON.stringify(updated));
		} else {
			favoriteGames.push(game.folderName);
			localStorage.setItem("favoriteGames", JSON.stringify(favoriteGames));
		}

		setGames(games.map(g => (g.folderName === game.folderName ? { ...g, isFavorite: !isFavorited } : g)));
	};

	const handleFolderUpload = async (files: FileList) => {
		try {
			console.log(`Processing folder with ${files.length} files`);

			const firstFile = files[0];
			const pathParts = firstFile.webkitRelativePath.split("/");
			const folderName = pathParts[0];

			console.log("Folder name:", folderName);

			let metadataFile: File | null = null;
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const fileName = file.name;
				if (fileName === "metadata.json" || fileName === "index.json") {
					metadataFile = file;
					console.log("Found metadata file:", file.webkitRelativePath);
					break;
				}
			}

			let metadata: any = null;
			if (metadataFile) {
				const metadataText = await metadataFile.text();
				console.log("Metadata content:", metadataText);
				metadata = JSON.parse(metadataText);
				console.log("Parsed metadata:", metadata);
			} else {
				console.log("No metadata.json or index.json found in folder");
			}

			let gameFile: string | null = null;
			let gameType: "flash" | "html5" = "html5";

			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				if (file.name.endsWith(".swf")) {
					gameFile = file.name;
					gameType = "flash";
					console.log("Found Flash game:", file.webkitRelativePath);
					break;
				} else if (file.name === "index.html") {
					gameFile = file.name;
					gameType = "html5";
					console.log("Found HTML5 game:", file.webkitRelativePath);
					break;
				}
			}

			if (!gameFile) {
				alert("No valid game file found in folder (looking for .swf or index.html)");
				return;
			}

			let thumbnailUrl = metadata?.thumbnail;
			if (!thumbnailUrl) {
				for (let i = 0; i < files.length; i++) {
					const file = files[i];
					const fileName = file.name.toLowerCase();
					if (fileName === "index.png" || fileName === "icon.png" || fileName === "thumbnail.png") {
						console.log("Found thumbnail image:", file.webkitRelativePath);
						const reader = new FileReader();
						thumbnailUrl = await new Promise<string>(resolve => {
							reader.onload = () => resolve(reader.result as string);
							reader.readAsDataURL(file);
						});
						break;
					}
				}
			}

			setUploadModal({
				files,
				title: metadata?.title || folderName,
				author: metadata?.author || "",
				version: metadata?.version || "1.0",
				description: metadata?.description || "",
				tags: metadata?.tags ? (Array.isArray(metadata.tags) ? metadata.tags.join(", ") : metadata.tags) : "",
				type: gameType,
				gameFile,
				thumbnail: thumbnailUrl,
			});
		} catch (err) {
			console.error("Failed to process folder:", err);
			alert("Failed to process folder");
		}
	};

	const handleZipUpload = async (zipFile: File) => {
		try {
			const JSZip = (await import("jszip")).default;
			const zip = await JSZip.loadAsync(zipFile);

			console.log("Files in ZIP:");
			const allFiles: string[] = [];
			zip.forEach((relativePath, file) => {
				console.log(`  ${file.dir ? "[DIR]" : "[FILE]"} ${relativePath}`);
				if (!file.dir) {
					allFiles.push(relativePath);
				}
			});

			let metadataFile = null;
			for (const filePath of allFiles) {
				const fileName = filePath.split("/").pop() || "";
				if (fileName === "metadata.json" || fileName === "index.json") {
					metadataFile = zip.file(filePath);
					break;
				}
			}

			let metadata: any = null;
			if (metadataFile) {
				console.log("Found metadata file:", metadataFile.name);
				const metadataText = await metadataFile.async("text");
				console.log("Metadata content:", metadataText);
				metadata = JSON.parse(metadataText);
				console.log("Parsed metadata:", metadata);
			} else {
				console.log("No metadata.json or index.json found in ZIP");
			}

			let gameFile: string | null = null;
			let gameType: "flash" | "html5" = "html5";

			for (const filePath of allFiles) {
				const fileName = filePath.split("/").pop() || "";
				if (filePath.endsWith(".swf")) {
					gameFile = fileName;
					gameType = "flash";
					console.log("Found Flash game:", filePath);
					break;
				} else if (fileName === "index.html") {
					gameFile = fileName;
					gameType = "html5";
					console.log("Found HTML5 game:", filePath);
					break;
				}
			}

			if (!gameFile) {
				alert("No valid game file found in ZIP (looking for .swf or index.html)");
				return;
			}

			let thumbnailUrl = metadata?.thumbnail;
			if (!thumbnailUrl) {
				for (const filePath of allFiles) {
					const fileName = filePath.split("/").pop()?.toLowerCase() || "";
					if (fileName === "index.png" || fileName === "icon.png" || fileName === "thumbnail.png") {
						const thumbnailFile = zip.file(filePath);
						if (thumbnailFile) {
							const thumbnailData = await thumbnailFile.async("base64");
							thumbnailUrl = `data:image/png;base64,${thumbnailData}`;
							console.log("Found thumbnail image:", fileName);
							break;
						}
					}
				}
			}

			setUploadModal({
				file: zipFile,
				title: metadata?.title || zipFile.name.replace(".zip", ""),
				author: metadata?.author || "",
				version: metadata?.version || "1.0",
				description: metadata?.description || "",
				tags: metadata?.tags ? (Array.isArray(metadata.tags) ? metadata.tags.join(", ") : metadata.tags) : "",
				type: gameType,
				gameFile,
				thumbnail: thumbnailUrl,
			});
		} catch (err) {
			console.error("Failed to process ZIP file:", err);
			alert("Failed to process ZIP file");
		}
	};

	const allTags = Array.from(new Set(games.flatMap(game => game.tags || [])));

	const getTypeFilter = (): "flash" | "html5" | null => {
		if (!query) return null;
		const params = new URLSearchParams(query.includes("=") ? query : `id=${query}`);
		const typeFilter = params.get("type");
		if (typeFilter === "flash" || typeFilter === "html5") {
			return typeFilter;
		}
		return null;
	};

	const typeFilter = getTypeFilter();

	const displayedGames = games.filter(game => activeTab === "all" || game.isFavorite).filter(game => selectedTag === "all" || game.tags?.includes(selectedTag));

	return (
		<div className={"flex flex-col size-full p-4 gap-4" + " " + (className || "")}>
			{!selectedGame ? (
				<>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-4">
							<h1 className="text-4xl font-bold">Games</h1>
							<div className="flex items-center gap-2">
								<button
									className={`px-4 py-2 rounded-lg font-semibold cursor-pointer duration-150 ${
										activeTab === "all" ? "bg-(--accent) text-white" : settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"
									}`}
									onClick={() => setActiveTab("all")}
								>
									All Games
								</button>
								<button
									className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold cursor-pointer duration-150 ${
										activeTab === "favorites" ? "bg-(--accent) text-white" : settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"
									}`}
									onClick={() => setActiveTab("favorites")}
								>
									<StarIcon className="size-4" />
									Favorites
								</button>
								<button
									className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold cursor-pointer duration-150 ${
										activeTab === "download" ? "bg-(--accent) text-white" : settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"
									}`}
									onClick={() => setActiveTab("download")}
								>
									<ArrowDownTrayIcon className="size-4" />
									Download
								</button>
							</div>
						</div>
						{activeTab !== "download" && (
							<div className="flex items-center gap-2">
								<div className="relative">
									<label className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold cursor-pointer duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}>
										<FunnelIcon className="size-5" />
										<span>Filter: {selectedTag === "all" ? "All" : selectedTag}</span>
										<select className="absolute inset-0 opacity-0 cursor-pointer" value={selectedTag} onChange={e => setSelectedTag(e.target.value)}>
											<option value="all">All</option>
											{allTags.map(tag => (
												<option key={tag} value={tag}>
													{tag}
												</option>
											))}
										</select>
									</label>
								</div>
								<button
									className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold cursor-pointer duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}
									onClick={() => setShowUploadTypeModal(true)}
								>
									<PlusIcon className="size-5 stroke-1 stroke-current" />
									<span>Add Game</span>
								</button>
							</div>
						)}
					</div>
					{activeTab === "download" ? (
						<GameInstaller onComplete={() => readGames()} />
					) : (
						<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 auto-rows-min gap-3 md:gap-4">
							{loading ? (
							<div className="col-span-full flex flex-col items-center justify-center py-20 gap-4">
								<div className={`size-12 border-4 border-(--accent) border-t-transparent rounded-full animate-spin`}></div>
								<span className="text-lg font-semibold text-(--text-secondary)">Loading games...</span>
							</div>
						) : displayedGames.length > 0 ? (
							displayedGames.map(game => (
								<div key={game.id} className={`group flex flex-col gap-3 p-3 md:p-4 rounded-xl md:rounded-2xl cursor-pointer duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#00000018]"}`} onClick={() => setSelectedGame(game)}>
									<div className="relative aspect-video bg-(--primary) rounded-lg overflow-hidden shrink-0">
										<span className="absolute top-2 right-2 text-xs md:text-sm text-(--text-tertiary) p-1 px-2 md:p-1.5 md:px-2 leading-none rounded-md z-10 bg-(--tertiary) capitalize">{game.type === "html5" ? "HTML" : game.type}</span>
										{game.thumbnail ? (
											<div className="relative w-full h-full bg-(--primary) flex items-center justify-center">
												<PlayIcon className="absolute size-10 md:size-12 text-(--text-tertiary) group-hover:text-(--text-primary) duration-150" />
												<img src={game.thumbnail} alt={game.title} className="w-full h-full object-cover" />
											</div>
										) : (
											<div className="flex items-center justify-center w-full h-full">
												<PlayIcon className="size-10 md:size-12 text-(--text-tertiary) group-hover:text-(--text-primary) duration-150" />
											</div>
										)}
									</div>
									<div className="flex flex-col gap-1.5 md:gap-1 flex-1 min-h-0">
										<div className="flex items-start gap-2">
											<h3 className="text-base md:text-lg font-bold line-clamp-2 flex-1 min-w-0">{game.title}</h3>
											<span className="shrink-0 p-1 px-1.5 md:p-1.5 md:px-2 leading-none text-xs md:text-sm font-semibold text-(--text-tertiary) bg-(--tertiary) rounded-md">v{game.version || "1.0"}</span>
										</div>
										<span className="text-xs md:text-sm text-(--text-tertiary) truncate">{game.author || "Unknown"}</span>
										<div className="flex flex-wrap gap-1 min-h-6">
											{game.tags && game.tags.length > 0 ? (
												<>
													{game.tags.slice(0, 3).map((tag, index) => (
														<span key={index} className="p-1.5 md:p-2 text-xs font-semibold leading-none text-(--text-tertiary) bg-(--tertiary) rounded-md">
															{tag}
														</span>
													))}
													{game.tags.length > 3 && <span className="p-1.5 md:p-2 text-xs font-semibold leading-none text-(--text-tertiary) bg-(--tertiary) rounded-md">+{game.tags.length - 3}</span>}
												</>
											) : null}
										</div>
									</div>
									<div className="flex items-center justify-between gap-1.5 md:gap-2 pt-1 mt-auto">
										<div className="flex items-center gap-1.5">
											<button
												className={`p-2 md:px-3 md:py-1.5 text-sm rounded-md font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}
												onClick={e => {
													e.stopPropagation();
													toggleFavorite(game);
												}}
												title={game.isFavorite ? "Remove from favorites" : "Add to favorites"}
											>
												{game.isFavorite ? <StarIcon className="size-3.5 md:size-4 text-yellow-400" /> : <StarOutlineIcon className="size-3.5 md:size-4 stroke-2 stroke-current" />}
											</button>
											<button
												className={`p-2 md:px-3 md:py-1.5 text-sm rounded-md font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}
												onClick={e => {
													e.stopPropagation();
													setEditModal({
														game,
														title: game.title,
														thumbnail: game.thumbnail,
														author: game.author || "",
														version: game.version || "1.0",
														description: game.description || "",
														tags: game.tags?.join(", ") || "",
													});
												}}
											>
												<PencilIcon className="size-3.5 md:size-4" />
											</button>
										</div>
										<button
											className={`p-2 md:px-3 md:py-1.5 text-sm rounded-md font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}
											onClick={e => {
												e.stopPropagation();
												if (deleting) return;
												deleteGame(game);
											}}
										>
											<TrashIcon className="size-3.5 md:size-4" />
										</button>
									</div>
								</div>
							))
						) : (
							<div className="col-span-full flex flex-col items-center justify-center h-full py-20 gap-4">
								{activeTab === "favorites" ? (
									<>
										<StarIcon className="size-16 text-(--text-tertiary)" />
										<div className="flex flex-col items-center gap-2">
											<h2 className="text-2xl font-bold text-(--text-secondary)">No favorites yet</h2>
											<p className="text-(--text-tertiary)">Star games to add them to your favorites</p>
										</div>
									</>
								) : (
									<>
										<PlayIcon className="size-16 text-(--text-tertiary)" />
										<div className="flex flex-col items-center gap-2">
											<h2 className="text-2xl font-bold text-(--text-secondary)">No games yet</h2>
											<p className="text-(--text-tertiary)">Add some games to get started or go to the Download tab to install base games</p>
										</div>
									</>
								)}
							</div>
						)}
					</div>
				)}
				</>
			) : (
				<>
					<div className="flex items-center justify-between">
						<button className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`} onClick={() => setSelectedGame(null)}>
							<XMarkIcon className="size-5" />
							Back to Games
						</button>

						<button
							className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}
							onClick={() => setDetailsCollapsed(v => !v)}
							aria-expanded={!detailsCollapsed}
							aria-controls="game-details-panel"
							title={detailsCollapsed ? "Show details" : "Hide details"}
						>
							{detailsCollapsed ? <ChevronLeftIcon className="size-5" /> : <ChevronRightIcon className="size-5" />}
							<span className="hidden sm:inline">{detailsCollapsed ? "Show Details" : "Hide Details"}</span>
						</button>
					</div>

					<div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
						<div className="flex-1 flex flex-col gap-4 min-h-0">
							<div ref={playerContainerRef} className="relative flex-1 rounded-xl overflow-hidden bg-black">
								{selectedGame.type === "flash" ? (
									<RufflePlayer
										data={selectedGame.data}
										className="w-full h-full"
										autoplay={true}
										quality="high"
										scale="showAll"
										backgroundColor="#000000"
										volume={isMuted ? 0 : 1}
										onPlayerReady={player => {
											rufflePlayerRef.current = player;
										}}
									/>
								) : (
									<HTMLPlayer folderPath={selectedGame.folderPath} gameFile="index.html" className="w-full h-full" />
								)}
								<button
									onClick={async () => {
										if (!playerContainerRef.current) return;

										if (!document.fullscreenElement) {
											await playerContainerRef.current.requestFullscreen();
											setIsFullscreen(true);
										} else {
											await document.exitFullscreen();
											setIsFullscreen(false);
										}
									}}
									className={`absolute bottom-4 right-4 p-3 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-black/70 hover:bg-black/90 text-white" : "bg-white/70 hover:bg-white/90 text-black"}`}
									title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
								>
									{isFullscreen ? <ArrowsPointingInIcon className="size-5" /> : <ArrowsPointingOutIcon className="size-5" />}
								</button>

								{selectedGame.type === "flash" && (
									<button
										onClick={() => {
											const newMutedState = !isMuted;
											setIsMuted(newMutedState);
											if (rufflePlayerRef.current && rufflePlayerRef.current.volume !== undefined) {
												rufflePlayerRef.current.volume = newMutedState ? 0 : 1;
											}
										}}
										className={`absolute bottom-4 right-20 p-3 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-black/70 hover:bg-black/90 text-white" : "bg-white/70 hover:bg-white/90 text-black"}`}
										title={isMuted ? "Unmute" : "Mute"}
									>
										{isMuted ? <SpeakerXMarkIcon className="size-5" /> : <SpeakerWaveIcon className="size-5" />}
									</button>
								)}
							</div>
							<div className={`flex items-center justify-between gap-4 p-4 rounded-xl ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000010]"}`}>
								<div className="flex items-center gap-3">
									<button
										onClick={() => {
											const fav = selectedGame.isFavorite;
											toggleFavorite(selectedGame);
											setSelectedGame({ ...selectedGame, isFavorite: !fav });
										}}
										className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}
										title={selectedGame.isFavorite ? "Remove from favorites" : "Add to favorites"}
									>
										{selectedGame.isFavorite ? (
											<>
												<StarIcon className="size-5 text-yellow-400" />
												<span className="hidden sm:inline">Favorited</span>
											</>
										) : (
											<>
												<StarOutlineIcon className="size-5" />
												<span className="hidden sm:inline">Favorite</span>
											</>
										)}
									</button>
									<button
										onClick={() => {
											setEditModal({
												game: selectedGame,
												title: selectedGame.title,
												thumbnail: selectedGame.thumbnail,
												author: selectedGame.author || "",
												version: selectedGame.version || "1.0",
												description: selectedGame.description || "",
												tags: selectedGame.tags?.join(", ") || "",
											});
										}}
										className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}
									>
										<PencilIcon className="size-5" />
										<span className="hidden sm:inline">Edit</span>
									</button>
								</div>

								<button
									onClick={() => {
										if (deleting) return;
										deleteGame(selectedGame);
										setSelectedGame(null);
									}}
									className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-red-500/20 hover:bg-red-500/30 text-red-400" : "bg-red-500/20 hover:bg-red-500/30 text-red-600"}`}
								>
									<TrashIcon className="size-5" />
									<span className="hidden sm:inline">Delete</span>
								</button>
							</div>
						</div>

						<div
							id="game-details-panel"
							className={`${detailsCollapsed ? "w-0 lg:w-0 p-0 opacity-0 pointer-events-none" : "w-full lg:w-80 xl:w-96 p-6 opacity-100"} transition-all duration-200 flex flex-col gap-4 rounded-xl overflow-y-auto ${settings.brightness === "dark" ? "bg-[#ffffff08]" : "bg-[#00000008]"}`}
						>
							{!detailsCollapsed && (
								<>
									{selectedGame.thumbnail && (
										<div className="aspect-video rounded-lg overflow-hidden">
											<img src={selectedGame.thumbnail} alt={selectedGame.title} className="w-full h-full object-cover" />
										</div>
									)}

									<div>
										<h2 className="text-3xl font-bold mb-2">{selectedGame.title}</h2>
										{selectedGame.author && <p className="text-lg text-(--text-secondary)">by {selectedGame.author}</p>}
									</div>

									<div className="flex gap-2">
										{selectedGame.version && <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${settings.brightness === "dark" ? "bg-[#ffffff10] text-(--text-secondary)" : "bg-[#00000010] text-(--text-secondary)"}`}>v{selectedGame.version}</span>}
										<span className={`px-3 py-1 rounded-lg text-sm font-semibold capitalize ${settings.brightness === "dark" ? "bg-[#ffffff10] text-(--text-secondary)" : "bg-[#00000010] text-(--text-secondary)"}`}>{selectedGame.type === "html5" ? "HTML" : selectedGame.type}</span>
									</div>

									{selectedGame.description && (
										<div>
											<h3 className="text-lg font-semibold mb-2 text-(--text-secondary)">Description</h3>
											<p className="text-(--text-primary) leading-relaxed whitespace-pre-wrap">{selectedGame.description}</p>
										</div>
									)}

									{selectedGame.tags && selectedGame.tags.length > 0 && (
										<>
											<h3 className="text-lg font-semibold mb-2 text-(--text-secondary)">Tags</h3>
											<div className="flex flex-wrap gap-2">
												{selectedGame.tags.map((tag, index) => (
													<span key={index} className={`px-3 py-1 rounded-full text-sm font-medium ${settings.brightness === "dark" ? "bg-[#ffffff15] text-(--text-primary)" : "bg-[#00000015] text-(--text-primary)"}`}>
														{tag}
													</span>
												))}
											</div>
										</>
									)}

									{/* Game Info */}
									<div className={`mt-auto pt-4 border-t ${settings.brightness === "dark" ? "border-[#ffffff10]" : "border-[#00000010]"}`}>
										<h3 className="text-sm font-semibold mb-2 text-(--text-tertiary)">Game Information</h3>
										<div className="flex flex-col gap-1 text-sm text-(--text-secondary)">
											<div className="flex items-center gap-2">
												<p className="leading-none">ID:</p>
												<button
													className="group flex items-center gap-0.5 opacity-80 hover:opacity-100 leading-none cursor-pointer duration-150"
													onClick={() => {
														navigator.clipboard.writeText(selectedGame.folderName);
														alert("Game ID Copied to clipboard");
													}}
												>
													{selectedGame.folderName} <ClipboardIcon className="inline-block size-3.5 opacity-0 group-hover:opacity-100 duration-150" />{" "}
												</button>
											</div>
											{selectedGame.data && <p>Size: {(selectedGame.data.byteLength / 1024 / 1024).toFixed(2)} MB</p>}
											{selectedGame.createdAt && <p>Added: {new Date(selectedGame.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
											{selectedGame.modifiedAt && <p>Modified: {new Date(selectedGame.modifiedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
										</div>
									</div>
								</>
							)}
						</div>
					</div>
				</>
			)}

			{/* Upload Modal */}
			{uploadModal && (
				<div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
					<div className={`w-full max-w-md sm:max-w-lg md:max-w-xl lg:max-w-2xl mx-2 sm:mx-6 rounded-2xl p-4 sm:p-6 bg-(--primary) max-h-[85vh] overflow-y-auto`}>
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-2xl font-bold">Add Game</h2>
							<button onClick={() => setUploadModal(null)} className={`p-2 rounded-lg duration-150 ${settings.brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000010]"}`}>
								<XMarkIcon className="size-6" />
							</button>
						</div>

						<div className="flex flex-col gap-4">
							{/* Thumbnail Preview/Upload */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Thumbnail</label>
								<div
									className={`relative aspect-video rounded-lg overflow-hidden cursor-pointer max-h-[40vh] ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#00000018]"}`}
									onClick={() => {
										const input = document.createElement("input");
										input.type = "file";
										input.accept = "image/*";
										input.onchange = async e => {
											const file = (e.target as HTMLInputElement).files?.[0];
											if (!file) return;
											const reader = new FileReader();
											reader.onload = e => {
												setUploadModal(prev => (prev ? { ...prev, thumbnail: e.target?.result as string } : null));
											};
											reader.readAsDataURL(file);
										};
										input.click();
									}}
								>
									{uploadModal.thumbnail ? (
										<img src={uploadModal.thumbnail} alt="Thumbnail" className="w-full h-full object-cover" />
									) : (
										<div className="flex flex-col items-center justify-center h-full gap-2">
											<PhotoIcon className="size-12 text-(--text-tertiary)" />
											<span className="text-sm text-(--text-tertiary)">Click to upload thumbnail</span>
										</div>
									)}
								</div>
							</div>

							{/* Title Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Title</label>
								<input
									type="text"
									value={uploadModal.title}
									onChange={e => setUploadModal(prev => (prev ? { ...prev, title: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="Game title"
								/>
							</div>

							{/* Author Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Author</label>
								<input
									type="text"
									value={uploadModal.author}
									onChange={e => setUploadModal(prev => (prev ? { ...prev, author: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="Author name"
								/>
							</div>

							{/* Version Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Version</label>
								<input
									type="text"
									value={uploadModal.version}
									onChange={e => setUploadModal(prev => (prev ? { ...prev, version: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="1.0"
								/>
							</div>

							{/* Description Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Description</label>
								<textarea
									value={uploadModal.description}
									onChange={e => setUploadModal(prev => (prev ? { ...prev, description: e.target.value } : null))}
									rows={3}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 resize-none ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="Game description"
								/>
							</div>

							{/* Tags Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Tags (comma separated)</label>
								<input
									type="text"
									value={uploadModal.tags}
									onChange={e => setUploadModal(prev => (prev ? { ...prev, tags: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="action, adventure, multiplayer"
								/>
							</div>

							{/* File Name Display */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">File</label>
								<div className={`px-4 py-2 rounded-lg text-sm ${settings.brightness === "dark" ? "bg-[#ffffff10] text-(--text-tertiary)" : "bg-[#00000010] text-(--text-tertiary)"}`}>{uploadModal.file?.name || "Game files"}</div>
							</div>

							{/* Action Buttons */}
							<div className="flex gap-3 mt-2">
								<button onClick={() => setUploadModal(null)} className={`flex-1 px-4 py-2 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}>
									Cancel
								</button>
								<button
									onClick={async () => {
										try {
											const folderName = createId();
											const folderPath = `${GamesPath}/${folderName}`;

											await window.fr.fs.promises.mkdir(folderPath);

											if (uploadModal.files) {
												const filePromises: Promise<void>[] = [];
												for (let i = 0; i < uploadModal.files.length; i++) {
													const file = uploadModal.files[i];
													const fileName = file.name;
													filePromises.push(
														file.arrayBuffer().then(async data => {
															const filePath = `${folderPath}/${fileName}`;
															await window.fr.fs.promises.writeFile(filePath, window.fr.buffer.from(data));
														}),
													);
												}
												await Promise.all(filePromises);
											} else if (uploadModal.file?.name.endsWith(".zip")) {
												const JSZip = (await import("jszip")).default;
												const zip = await JSZip.loadAsync(uploadModal.file);

												const filePromises: Promise<void>[] = [];
												zip.forEach((relativePath, file) => {
													if (!file.dir) {
														const fileName = relativePath.split("/").pop() || relativePath;
														filePromises.push(
															file.async("uint8array").then(async data => {
																const filePath = `${folderPath}/${fileName}`;
																await window.fr.fs.promises.writeFile(filePath, window.fr.buffer.from(data));
															}),
														);
													}
												});

												await Promise.all(filePromises);
											} else if (uploadModal.arrayBuffer) {
												await window.fr.fs.promises.writeFile(`${folderPath}/${uploadModal.gameFile || "game.swf"}`, window.fr.buffer.from(uploadModal.arrayBuffer));
											}

											const now = new Date().toISOString();
											const metadata = {
												title: uploadModal.title,
												type: uploadModal.type,
												thumbnail: uploadModal.thumbnail,
												author: uploadModal.author || undefined,
												version: uploadModal.version || undefined,
												description: uploadModal.description || undefined,
												tags: uploadModal.tags
													? uploadModal.tags
															.split(",")
															.map(t => t.trim())
															.filter(Boolean)
													: undefined,
												gameFile: uploadModal.gameFile,
												createdAt: now,
												modifiedAt: now,
											};
											await window.fr.fs.promises.writeFile(`${folderPath}/index.json`, JSON.stringify(metadata, null, 2));

											setUploadModal(null);
											await readGames();
										} catch (err) {
											console.error("Failed to upload game:", err);
											alert("Failed to upload game");
										}
									}}
									className={`flex-1 px-4 py-2 rounded-lg font-semibold duration-150 bg-(--accent) hover:opacity-80 text-white`}
								>
									Add Game
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Edit Modal */}
			{editModal && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditModal(null)}>
					<div className={`w-full max-w-2xl rounded-xl p-6 ${settings.brightness === "dark" ? "bg-(--secondary)" : "bg-(--secondary)"}`} onClick={e => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-2xl font-bold">Edit Game</h2>
							<button onClick={() => setEditModal(null)} className={`p-2 rounded-lg duration-150 ${settings.brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000010]"}`}>
								<XMarkIcon className="size-6" />
							</button>
						</div>

						<div className="flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
							{/* Thumbnail */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Thumbnail</label>
								<div
									className={`relative aspect-video rounded-lg overflow-hidden cursor-pointer max-h-[40vh] ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#00000018]"}`}
									onClick={() => {
										const input = document.createElement("input");
										input.type = "file";
										input.accept = "image/*";
										input.onchange = async e => {
											const file = (e.target as HTMLInputElement).files?.[0];
											if (!file) return;
											const reader = new FileReader();
											reader.onload = e => {
												setEditModal(prev => (prev ? { ...prev, thumbnail: e.target?.result as string } : null));
											};
											reader.readAsDataURL(file);
										};
										input.click();
									}}
								>
									{editModal.thumbnail ? (
										<img src={editModal.thumbnail} alt="Thumbnail" className="w-full h-full object-cover" />
									) : (
										<div className="flex flex-col items-center justify-center h-full gap-2">
											<PhotoIcon className="size-12 text-(--text-tertiary)" />
											<span className="text-sm text-(--text-tertiary)">Click to upload thumbnail</span>
										</div>
									)}
								</div>
							</div>

							{/* Title Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Title</label>
								<input
									type="text"
									value={editModal.title}
									onChange={e => setEditModal(prev => (prev ? { ...prev, title: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="Game title"
								/>
							</div>

							{/* Author Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Author</label>
								<input
									type="text"
									value={editModal.author}
									onChange={e => setEditModal(prev => (prev ? { ...prev, author: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="Author name"
								/>
							</div>

							{/* Version Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Version</label>
								<input
									type="text"
									value={editModal.version}
									onChange={e => setEditModal(prev => (prev ? { ...prev, version: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="1.0"
								/>
							</div>

							{/* Description Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Description</label>
								<textarea
									value={editModal.description}
									onChange={e => setEditModal(prev => (prev ? { ...prev, description: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 resize-none ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="Game description"
									rows={4}
								/>
							</div>

							{/* Tags Input */}
							<div>
								<label className="block text-sm font-semibold mb-2 text-(--text-secondary)">Tags (comma separated)</label>
								<input
									type="text"
									value={editModal.tags}
									onChange={e => setEditModal(prev => (prev ? { ...prev, tags: e.target.value } : null))}
									className={`w-full px-4 py-2 rounded-lg outline-none duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] focus:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] focus:bg-[#00000018] text-(--text-primary)"}`}
									placeholder="action, adventure, retro"
								/>
							</div>

							{/* Action Buttons */}
							<div className="flex gap-3 mt-2">
								<button onClick={() => setEditModal(null)} className={`flex-1 px-4 py-2 rounded-lg font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"}`}>
									Cancel
								</button>
								<button
									onClick={async () => {
										try {
											const metadataPath = `${GamesPath}/${editModal.game.folderName}/index.json`;

											let existingMetadata: any = {};
											try {
												const existingContent = await window.fr.fs.promises.readFile(metadataPath, "utf8");
												existingMetadata = JSON.parse(existingContent);
											} catch (err) {}

											const metadata = {
												title: editModal.title,
												type: "flash",
												thumbnail: editModal.thumbnail,
												author: editModal.author || undefined,
												version: editModal.version || undefined,
												description: editModal.description || undefined,
												tags: editModal.tags
													? editModal.tags
															.split(",")
															.map(t => t.trim())
															.filter(Boolean)
													: undefined,
												createdAt: existingMetadata.createdAt || new Date().toISOString(),
												modifiedAt: new Date().toISOString(),
											};
											await window.fr.fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
											setEditModal(null);
											await readGames();
										} catch (err) {
											console.error("Failed to update game:", err);
											alert("Failed to update game");
										}
									}}
									className={`flex-1 px-4 py-2 rounded-lg font-semibold duration-150 bg-(--accent) hover:opacity-80 text-white`}
								>
									Save Changes
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Upload Type Selection Modal */}
			{showUploadTypeModal && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowUploadTypeModal(false)}>
					<div className={`w-full max-w-2xl rounded-xl p-6 ${settings.brightness === "dark" ? "bg-(--secondary)" : "bg-(--secondary)"}`} onClick={e => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-2xl font-bold">Add Game</h2>
							<button onClick={() => setShowUploadTypeModal(false)} className={`p-2 rounded-lg duration-150 ${settings.brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000010]"}`}>
								<XMarkIcon className="size-6" />
							</button>
						</div>

						<p className="text-(--text-secondary) mb-6">Choose how you want to add your game:</p>

						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							{/* SWF File Option */}
							<button
								onClick={() => {
									setShowUploadTypeModal(false);
									const input = document.createElement("input");
									input.type = "file";
									input.accept = ".swf";
									input.onchange = async e => {
										const file = (e.target as HTMLInputElement).files?.[0];
										if (!file) return;
										try {
											const arrayBuffer = await file.arrayBuffer();
											setUploadModal({
												file,
												arrayBuffer,
												title: file.name.replace(".swf", ""),
												author: "",
												version: "1.0",
												description: "",
												tags: "",
												type: "flash",
												gameFile: file.name,
											});
										} catch (err) {
											console.error("Failed to read SWF file:", err);
											alert("Failed to read SWF file");
										}
									};
									input.click();
								}}
								className={`flex flex-col items-center gap-4 p-6 rounded-xl duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#00000018]"}`}
							>
								<div className="size-16 flex items-center justify-center rounded-full bg-(--accent) text-white">
									<PlayIcon className="size-8" />
								</div>
								<div className="flex flex-col gap-1 text-center">
									<h3 className="text-lg font-bold">SWF File</h3>
									<p className="text-sm text-(--text-tertiary)">Upload a single Flash game file</p>
								</div>
							</button>

							{/* ZIP File Option */}
							<button
								onClick={() => {
									setShowUploadTypeModal(false);
									const input = document.createElement("input");
									input.type = "file";
									input.accept = ".zip";
									input.onchange = async e => {
										const file = (e.target as HTMLInputElement).files?.[0];
										if (!file) return;
										try {
											await handleZipUpload(file);
										} catch (err) {
											console.error("Failed to read ZIP file:", err);
											alert("Failed to read ZIP file");
										}
									};
									input.click();
								}}
								className={`flex flex-col items-center gap-4 p-6 rounded-xl duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#00000018]"}`}
							>
								<div className="size-16 flex items-center justify-center rounded-full bg-(--accent) text-white">
									<ArchiveBoxIcon className="size-8" />
								</div>
								<div className="flex flex-col gap-1 text-center">
									<h3 className="text-lg font-bold">ZIP Archive</h3>
									<p className="text-sm text-(--text-tertiary)">Upload a compressed game archive</p>
								</div>
							</button>

							{/* Folder Option */}
							<button
								onClick={() => {
									setShowUploadTypeModal(false);
									const input = document.createElement("input");
									input.type = "file";
									input.webkitdirectory = true;
									input.onchange = async e => {
										const files = (e.target as HTMLInputElement).files;
										if (!files || files.length === 0) return;
										try {
											await handleFolderUpload(files);
										} catch (err) {
											console.error("Failed to read folder:", err);
											alert("Failed to read folder");
										}
									};
									input.click();
								}}
								className={`flex flex-col items-center gap-4 p-6 rounded-xl duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#00000018]"}`}
							>
								<div className="size-16 flex items-center justify-center rounded-full bg-(--accent) text-white">
									<FolderIcon className="size-8" />
								</div>
								<div className="flex flex-col gap-1 text-center">
									<h3 className="text-lg font-bold">Folder</h3>
									<p className="text-sm text-(--text-tertiary)">Select a folder with game files</p>
								</div>
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default Games;
