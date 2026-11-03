import { useState, useEffect } from "react";
import { XMarkIcon, CheckIcon, ArrowDownTrayIcon, MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { GamesPath } from "../types";
import { useSettingsStore } from "../store";
import { createId } from "@paralleldrive/cuid2";

interface StoreGame {
	id: string;
	title: string;
	description: string;
	type: "flash" | "html5";
	thumbnail?: string;
	author?: string;
	tags?: string[];
	swfUrl?: string;
	filesUrl?: string;
	gameFile?: string;
	source: "base" | "store";
	storeName?: string;
	installed?: boolean;
}

interface GameStore {
	name: string;
	url: string;
	description?: string;
}

interface GameInstallerProps {
	onComplete: () => void;
}

const GAME_STORES: GameStore[] = [
	{
		name: "Official Store",
		url: "https://raw.githubusercontent.com/NovaAppsInc/fracital-games/main/store.json",
		description: "Official Fracital game store",
	},
];

const discoverBaseGames = async (): Promise<StoreGame[]> => {
	const games: StoreGame[] = [];

	const gameMetadata = import.meta.glob("../assets/games/**/*.json", { eager: true });
	const gameAssets = import.meta.glob("../assets/games/**/*.swf", { eager: true, query: "?url", import: "default" });
	const gameThumbnails = import.meta.glob("../assets/games/**/*.{png,jpg,jpeg}", { eager: true, query: "?url", import: "default" });

	for (const [path, metadata] of Object.entries(gameMetadata)) {
		const data = metadata as any;
		if (!data.title) continue;

		const pathParts = path.split("/");
		const gameId = pathParts[pathParts.length - 2];

		let swfUrl: string | undefined;
		for (const [assetPath, assetUrl] of Object.entries(gameAssets)) {
			if (assetPath.includes(`/${gameId}/`)) {
				swfUrl = assetUrl as string;
				break;
			}
		}

		let thumbnail: string | undefined;
		for (const [assetPath, assetUrl] of Object.entries(gameThumbnails)) {
			if (assetPath.includes(`/${gameId}/`) && assetPath.includes("index.")) {
				thumbnail = assetUrl as string;
				break;
			}
		}

		games.push({
			id: gameId,
			title: data.title,
			description: data.description,
			type: data.type || "flash",
			author: data.author,
			tags: data.tags || [],
			swfUrl,
			thumbnail,
			source: "base",
		});
	}

	return games;
};

export const GameInstaller = ({ onComplete }: GameInstallerProps) => {
	const settings = useSettingsStore(state => state.settings);
	const [availableGames, setAvailableGames] = useState<StoreGame[]>([]);
	const [installing, setInstalling] = useState(false);
	const [currentGame, setCurrentGame] = useState<string | null>(null);
	const [progress, setProgress] = useState<{ [key: string]: number }>({});
	const [completed, setCompleted] = useState<Set<string>>(new Set());
	const [errors, setErrors] = useState<{ [key: string]: string }>({});
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedStore, setSelectedStore] = useState<string>("all");

	useEffect(() => {
		const loadGames = async () => {
			setLoading(true);
			try {
				const installedGameTitles = new Set<string>();
				try {
					const folders = await window.fr.fs.promises.readdir(GamesPath);
					for (const folder of folders) {
						try {
							const metadataPath = `${GamesPath}/${folder}/index.json`;
							const metadataContent = await window.fr.fs.promises.readFile(metadataPath, "utf8");
							const metadata = JSON.parse(metadataContent);
							if (metadata.title) {
								installedGameTitles.add(metadata.title);
							}
						} catch (err) {
						}
					}
				} catch (err) {
					console.log("Games folder not found, will be created on first install");
				}

				const baseGames = await discoverBaseGames();
				const allGames = [...baseGames];

				for (const store of GAME_STORES) {
					try {
						const response = await fetch(store.url);
						if (response.ok) {
							const storeData = await response.json();
							const storeGames = (storeData.games || []).map((game: any) => ({
								...game,
								source: "store",
								storeName: store.name,
							}));
							allGames.push(...storeGames);
						}
					} catch (err) {
						console.error(`Failed to load store ${store.name}:`, err);
					}
				}

				const gamesWithStatus = allGames.map(game => ({
					...game,
					installed: installedGameTitles.has(game.title),
				}));

				setAvailableGames(gamesWithStatus);
			} catch (err) {
				console.error("Failed to load games:", err);
			} finally {
				setLoading(false);
			}
		};
		loadGames();
	}, []);

	const installGame = async (game: StoreGame) => {
		setCurrentGame(game.id);
		setProgress(prev => ({ ...prev, [game.id]: 0 }));

		try {
			const folderName = createId();
			const folderPath = `${GamesPath}/${folderName}`;

			await window.fr.fs.promises.mkdir(folderPath);

			if (game.type === "flash" && game.swfUrl) {
				const response = await fetch(game.swfUrl);
				if (!response.ok) throw new Error(`Failed to fetch ${game.title}`);

				const reader = response.body?.getReader();
				const contentLength = parseInt(response.headers.get("Content-Length") || "0");
				let receivedLength = 0;
				const chunks: Uint8Array[] = [];

				if (reader) {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						chunks.push(value);
						receivedLength += value.length;
						const percent = contentLength > 0 ? (receivedLength / contentLength) * 100 : 50;
						setProgress(prev => ({ ...prev, [game.id]: Math.min(percent, 95) }));
					}
				}

				const allChunks = new Uint8Array(receivedLength);
				let position = 0;
				for (const chunk of chunks) {
					allChunks.set(chunk, position);
					position += chunk.length;
				}

				await window.fr.fs.promises.writeFile(`${folderPath}/game.swf`, window.fr.buffer.from(allChunks.buffer));
			} else if (game.type === "html5" && game.filesUrl) {
				const response = await fetch(game.filesUrl);
				if (!response.ok) throw new Error(`Failed to fetch ${game.title}`);

				const blob = await response.blob();
				setProgress(prev => ({ ...prev, [game.id]: 50 }));

				const JSZip = (await import("jszip")).default;
				const zip = await JSZip.loadAsync(blob);

				const files = Object.keys(zip.files);
				let processed = 0;

				for (const filename of files) {
					const file = zip.files[filename];
					if (!file.dir) {
						const content = await file.async("uint8array");
						await window.fr.fs.promises.writeFile(`${folderPath}/${filename}`, window.fr.buffer.from(content.buffer));
					}
					processed++;
					setProgress(prev => ({ ...prev, [game.id]: 50 + (processed / files.length) * 45 }));
				}
			}

			const now = new Date().toISOString();
			const metadata = {
				title: game.title,
				description: game.description,
				type: game.type,
				author: game.author,
				tags: game.tags,
				thumbnail: game.thumbnail,
				gameFile: game.gameFile || "index.html",
				createdAt: now,
				modifiedAt: now,
			};

			await window.fr.fs.promises.writeFile(`${folderPath}/index.json`, JSON.stringify(metadata, null, 2));

		setProgress(prev => ({ ...prev, [game.id]: 100 }));
		setCompleted(prev => new Set([...prev, game.id]));
		setCurrentGame(null);
		setInstalling(false);
		onComplete();
	} catch (err) {
		console.error(`Failed to install ${game.title}:`, err);
		setErrors(prev => ({ ...prev, [game.id]: err instanceof Error ? err.message : "Installation failed" }));
		setCurrentGame(null);
		setInstalling(false);
	}
};
	const filteredGames = availableGames.filter(game => {
		const matchesSearch = !searchQuery ||
			game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
			game.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
			game.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
		const matchesStore = selectedStore === "all" || 
			(selectedStore === "base" && game.source === "base") ||
			(game.storeName === selectedStore);
		return matchesSearch && matchesStore;
	});

	const stores = ["all", "base", ...Array.from(new Set(availableGames.filter(g => g.storeName).map(g => g.storeName)))];

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="mb-6">
				<div className="flex items-center justify-between mb-4">
					<div>
						<h2 className="text-2xl font-bold">Game Store</h2>
						<p className="text-sm opacity-70 mt-1">Browse and install games from various sources</p>
					</div>
				</div>

				{/* Search and Filters */}
				<div className="flex gap-3">
					<div className="relative flex-1">
						<MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-5 opacity-50" />
						<input
							type="text"
							placeholder="Search games..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="w-full pl-10 pr-4 py-2 bg-(--hover) rounded-lg border border-(--border) focus:border-(--accent) outline-none duration-150"
						/>
					</div>
					<select
						value={selectedStore}
						onChange={(e) => setSelectedStore(e.target.value)}
						className="px-4 py-2 bg-(--hover) rounded-lg border border-(--border) focus:border-(--accent) outline-none cursor-pointer"
					>
						{stores.map(store => (
							<option key={store} value={store}>
								{store === "all" ? "All Sources" : store === "base" ? "Base Games" : store}
							</option>
						))}
					</select>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto">
				{loading ? (
					<div className="flex flex-col items-center justify-center py-20 gap-4">
						<div className="size-12 border-4 border-(--accent) border-t-transparent rounded-full animate-spin" />
						<span className="text-lg font-semibold">Loading games...</span>
					</div>
				) : availableGames.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-20 gap-4">
						<CheckIcon className="size-16 text-green-500" />
						<div className="text-center">
							<h3 className="text-2xl font-bold mb-2">All Games Installed!</h3>
							<p className="text-sm opacity-70">You've already installed all available games.</p>
							<p className="text-sm opacity-70 mt-1">Check back later for new releases!</p>
						</div>
					</div>
				) : !installing ? (
					filteredGames.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-20 gap-4">
							<MagnifyingGlassIcon className="size-16 opacity-30" />
							<div className="text-center">
								<h3 className="text-xl font-bold mb-2">No games found</h3>
								<p className="text-sm opacity-70">Try adjusting your search or filter</p>
							</div>
						</div>
					) : (
						<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 auto-rows-min gap-3 md:gap-4">
						{filteredGames.map(game => {
							const isInstalling = currentGame === game.id;
							const isCompleted = completed.has(game.id) || game.installed;
							const hasError = errors[game.id];
							const gameProgress = progress[game.id] || 0;								return (
									<div
										key={game.id}
										className={`group flex flex-col gap-3 p-3 md:p-4 rounded-xl md:rounded-2xl duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#00000018]"}`}
									>
										{/* Thumbnail */}
										<div className="relative aspect-video bg-(--primary) rounded-lg overflow-hidden shrink-0">
											{/* Source Badge */}
											<span className={`absolute top-2 right-2 text-xs text-(--text-tertiary) p-1 px-2 md:p-1.5 md:px-2 leading-none rounded-md z-10 bg-(--tertiary) capitalize ${game.source === "base" ? "text-blue-400" : "text-purple-400"}`}>
												{game.source === "base" ? "Base" : game.storeName || "Store"}
											</span>
											{game.thumbnail ? (
												<div className="relative w-full h-full bg-(--primary) flex items-center justify-center">
													<img src={game.thumbnail} alt={game.title} className="w-full h-full object-cover" />
												</div>
											) : (
												<div className="flex items-center justify-center w-full h-full">
													<ArrowDownTrayIcon className="size-10 md:size-12 text-(--text-tertiary) group-hover:text-(--text-primary) duration-150" />
												</div>
											)}
										</div>

										{/* Info */}
										<div className="flex flex-col gap-1.5 md:gap-1 flex-1 min-h-0">
											<div className="flex items-start gap-2">
												<h3 className="text-base md:text-lg font-bold line-clamp-2 flex-1 min-w-0">{game.title}</h3>
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

										{/* Download Button */}
										<div className="flex items-center justify-between gap-1.5 md:gap-2 pt-1 mt-auto">
											{isCompleted ? (
												<button
													disabled
													className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-500/20 text-green-400 rounded-md text-sm font-semibold cursor-not-allowed"
												>
													<CheckIcon className="size-4" />
													<span className="hidden sm:inline">Installed</span>
												</button>
											) : hasError ? (
												<div className="flex-1">
													<button
														onClick={() => {
															setErrors(prev => {
																const newErrors = { ...prev };
																delete newErrors[game.id];
																return newErrors;
															});
															installGame(game);
														}}
														className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-md text-sm font-semibold transition-colors"
													>
														<XMarkIcon className="size-4" />
														<span className="hidden sm:inline">Retry</span>
													</button>
												</div>
											) : isInstalling ? (
												<div className="flex-1">
													<div className="flex items-center justify-between mb-1">
														<span className="text-xs font-medium">Installing...</span>
														<span className="text-xs opacity-70">{Math.round(gameProgress)}%</span>
													</div>
													<div className="w-full h-1.5 bg-(--tertiary) rounded-full overflow-hidden">
														<div className="h-full bg-(--accent) transition-all duration-300" style={{ width: `${gameProgress}%` }} />
													</div>
												</div>
										) : (
											<button
												onClick={() => installGame(game)}
												disabled={installing || game.installed}
												className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-semibold duration-150 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18] text-(--text-primary)" : "bg-[#00000010] hover:bg-[#00000018] text-(--text-primary)"} disabled:opacity-50 disabled:cursor-not-allowed`}
												>
													<ArrowDownTrayIcon className="size-4" />
													<span className="hidden sm:inline">Download</span>
												</button>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)
				) : null}
			</div>
		</div>
	);
};
