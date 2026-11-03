import { useEffect, useState, useRef } from "react";
import { useMusicStore, useSettingsStore } from "../store";
import { MagnifyingGlassIcon, PlayIcon, PlusIcon, MusicalNoteIcon, ChartBarIcon } from "@heroicons/react/24/solid";
import { FireIcon } from "@heroicons/react/24/outline";
import { createId } from "@paralleldrive/cuid2";
import {
	searchTracks,
	getAlbum,
	getArtist,
	getCharts,
	warmStream,
	formatDuration,
	trackToFracital,
	artworkHighRes,
	getMusicApiConfig,
	type MusicTrack,
	type MusicAlbum,
	type AlbumDetail,
	type ArtistDetail,
} from "../libs/music-service";

type Page = "home" | "search" | "album" | "artist";

interface DigitalLibraryProps {
	query: string | undefined;
}

export const DigitalLibrary = ({ query: _query }: DigitalLibraryProps) => {
	const settings = useSettingsStore(state => state.settings);
	const brightness = settings.brightness as string;
	const playTrack = useMusicStore(state => state.playTrack);
	const addTrack = useMusicStore(state => state.addTrack);
	const configured = !!getMusicApiConfig()?.baseUrl;

	const [page, setPage] = useState<Page>("home");
	const [searchQuery, setSearchQuery] = useState("");
	const [tracks, setTracks] = useState<MusicTrack[]>([]);
	const [albums, setAlbums] = useState<MusicAlbum[]>([]);
	const [chartTracks, setChartTracks] = useState<MusicTrack[]>([]);
	const [chartAlbums, setChartAlbums] = useState<MusicAlbum[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [albumDetail, setAlbumDetail] = useState<AlbumDetail | null>(null);
	const [artistDetail, setArtistDetail] = useState<ArtistDetail | null>(null);

	const searchRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<number>(0);
	const searchAbort = useRef<AbortController | null>(null);

	// Load charts on mount
	useEffect(() => {
		if (!configured) return;
		getCharts(30)
			.then(res => {
				setChartTracks(res.tracks || []);
				setChartAlbums(res.albums || []);
			})
			.catch(() => {});
	}, [configured]);

	const doSearch = async (q: string) => {
		if (!q.trim()) { setTracks([]); setAlbums([]); setPage("home"); return; }
		searchAbort.current?.abort();
		const ctrl = new AbortController();
		searchAbort.current = ctrl;
		setLoading(true);
		setError(null);
		setPage("search");
		try {
			const res = await searchTracks(q, 30, ctrl.signal);
			setTracks(res.tracks || []);
			setAlbums(res.albums || []);
		} catch (err: any) {
			if (err?.name !== "AbortError") { console.error("Search error:", err); setError("Search failed — is the music server running?"); }
		} finally {
			setLoading(false);
		}
	};

	const handleSearchInput = (value: string) => {
		setSearchQuery(value);
		window.clearTimeout(debounceRef.current);
		debounceRef.current = window.setTimeout(() => doSearch(value), 400);
	};

	const openAlbum = async (id: string) => {
		setLoading(true);
		try {
			const detail = await getAlbum(id);
			setAlbumDetail(detail);
			setPage("album");
		} catch (err) {
			console.error("Failed to load album:", err);
		} finally {
			setLoading(false);
		}
	};

	const _openArtist = async (id: string) => {
		setLoading(true);
		try {
			const detail = await getArtist(id);
			setArtistDetail(detail);
			setPage("artist");
		} catch (err) {
			console.error("Failed to load artist:", err);
		} finally {
			setLoading(false);
		}
	};
	void _openArtist; // available for future artist click handling

	const handlePlay = (track: MusicTrack) => {
		const t = trackToFracital(track);
		playTrack({ ...t, id: createId() });
		// Warm the next track in the list
		const idx = tracks.indexOf(track);
		if (idx >= 0 && idx < tracks.length - 1) warmStream(tracks[idx + 1]);
	};

	const handleQueue = (track: MusicTrack) => {
		const t = trackToFracital(track);
		addTrack({ ...t, id: createId() });
	};

	const handlePlayAll = (trackList: MusicTrack[]) => {
		const playable = trackList.filter(t => t.streamUrl || t.previewUrl);
		if (playable.length === 0) return;
		handlePlay(playable[0]);
		playable.slice(1).forEach(t => handleQueue(t));
	};

	// --- Shared components ---

	const Spinner = () => (
		<div className="flex items-center justify-center py-12">
			<div className={`size-6 border-2 border-t-transparent rounded-full animate-spin ${brightness === "dark" ? "border-white" : "border-black"}`} />
		</div>
	);

	const EmptyState = ({ message }: { message: string }) => (
		<div className="flex flex-col items-center justify-center py-12 text-(--text-tertiary)">
			<MusicalNoteIcon className="size-12 opacity-30 mb-2" />
			<span>{message}</span>
		</div>
	);

	const TrackRow = ({ track, index }: { track: MusicTrack; index?: number }) => (
		<div
			className={`group flex items-center gap-3 p-2 px-3 rounded-lg cursor-pointer duration-150 ${brightness === "dark" ? "hover:bg-[#ffffff12]" : "hover:bg-[#00000008]"}`}
			onClick={() => handlePlay(track)}
		>
			{index !== undefined && <span className="w-6 text-right text-sm text-(--text-tertiary) group-hover:hidden">{index + 1}</span>}
			{index !== undefined && <PlayIcon className="hidden group-hover:block size-4 w-6 text-(--text-primary)" />}
			<img src={track.artwork} alt="" className="size-10 rounded object-cover bg-(--tertiary)" loading="lazy" />
			<div className="flex flex-col flex-1 min-w-0">
				<span className={`text-sm font-medium truncate ${track.explicit ? "flex items-center gap-1" : ""}`}>
					{track.title}
					{track.explicit && <span className="text-[10px] px-1 py-0.5 rounded bg-(--text-tertiary) text-(--secondary) font-bold leading-none">E</span>}
				</span>
				<span className="text-xs text-(--text-tertiary) truncate">{track.artist}</span>
			</div>
			{track.album && (
				<span
					className="text-xs text-(--text-tertiary) truncate max-w-32 cursor-pointer hover:underline hidden sm:block"
					onClick={e => { e.stopPropagation(); if (track.albumId) openAlbum(track.albumId); }}
				>
					{track.album}
				</span>
			)}
			<span className="text-xs text-(--text-tertiary) w-10 text-right">{formatDuration(track.duration)}</span>
			<button
				className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-[#ffffff20] duration-150"
				title="Add to queue"
				onClick={e => { e.stopPropagation(); handleQueue(track); }}
			>
				<PlusIcon className="size-4 text-(--text-secondary)" />
			</button>
		</div>
	);

	const AlbumCard = ({ album }: { album: MusicAlbum }) => (
		<div
			className={`flex flex-col gap-2 p-2 rounded-xl cursor-pointer duration-150 ${brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000008]"}`}
			onClick={() => openAlbum(album.id)}
		>
			<img src={artworkHighRes(album.artwork)} alt="" className="w-full aspect-square rounded-lg object-cover bg-(--tertiary)" loading="lazy" />
			<div className="flex flex-col min-w-0 px-0.5">
				<span className="text-sm font-medium truncate">{album.title}</span>
				<span className="text-xs text-(--text-tertiary) truncate">{album.artist}</span>
			</div>
		</div>
	);

	// --- Not configured state ---

	if (!configured) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-4 text-(--text-tertiary)">
				<MusicalNoteIcon className="size-16 opacity-20" />
				<h2 className="text-lg font-semibold text-(--text-primary)">Digital Library</h2>
				<p className="text-sm text-center max-w-sm">Music server not configured. Set the API URL in settings to enable search and streaming.</p>
			</div>
		);
	}

	// --- Pages ---

	const HomePage = () => (
		<div className="flex flex-col gap-6">
			{chartAlbums.length > 0 && (
				<div className="flex flex-col gap-2">
					<h2 className="text-lg font-bold px-1">Popular Albums</h2>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">
						{chartAlbums.slice(0, 8).map(album => <AlbumCard key={album.id} album={album} />)}
					</div>
				</div>
			)}
			{chartTracks.length > 0 && (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between px-1">
						<div className="flex items-center gap-2">
							<FireIcon className="size-5 text-(--text-secondary)" />
							<h2 className="text-lg font-bold">Trending Now</h2>
						</div>
						<button
							className={`text-xs px-3 py-1.5 rounded-lg duration-150 ${brightness === "dark" ? "bg-[#ffffff15] hover:bg-[#ffffff25]" : "bg-[#00000010] hover:bg-[#00000020]"}`}
							onClick={() => handlePlayAll(chartTracks)}
						>
							Play all
						</button>
					</div>
					<div className="flex flex-col">
						{chartTracks.slice(0, 25).map((track, i) => <TrackRow key={track.id} track={track} index={i} />)}
					</div>
				</div>
			)}
		</div>
	);

	const SearchPage = () => (
		<div className="flex flex-col gap-6">
			{loading && <Spinner />}
			{!loading && error && <EmptyState message={error} />}
			{!loading && !error && tracks.length === 0 && searchQuery.trim() && <EmptyState message="No results found" />}
			{albums.length > 0 && (
				<div className="flex flex-col gap-2">
					<h2 className="text-lg font-bold px-1">Albums</h2>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">
						{albums.slice(0, 6).map(album => <AlbumCard key={album.id} album={album} />)}
					</div>
				</div>
			)}
			{tracks.length > 0 && (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between px-1">
						<h2 className="text-lg font-bold">Songs</h2>
						<button
							className={`text-xs px-3 py-1.5 rounded-lg duration-150 ${brightness === "dark" ? "bg-[#ffffff15] hover:bg-[#ffffff25]" : "bg-[#00000010] hover:bg-[#00000020]"}`}
							onClick={() => handlePlayAll(tracks)}
						>
							Play all
						</button>
					</div>
					<div className="flex flex-col">
						{tracks.map((track, i) => <TrackRow key={track.id} track={track} index={i} />)}
					</div>
				</div>
			)}
		</div>
	);

	const AlbumPage = () => {
		if (!albumDetail) return null;
		const albumTracks = albumDetail.tracks || [];
		return (
			<div className="flex flex-col gap-4">
				<div className="flex gap-4 items-end">
					<img src={artworkHighRes(albumDetail.album.artwork)} alt="" className="size-36 rounded-xl object-cover bg-(--tertiary) shadow-lg" />
					<div className="flex flex-col gap-1 min-w-0">
						<span className="text-xs text-(--text-tertiary) uppercase font-medium">Album</span>
						<h1 className="text-2xl font-bold truncate">{albumDetail.album.title}</h1>
						<span className="text-sm text-(--text-secondary)">{albumDetail.album.artist}</span>
						{albumDetail.album.trackCount && <span className="text-xs text-(--text-tertiary)">{albumDetail.album.trackCount} tracks</span>}
					</div>
				</div>
				{albumTracks.length > 0 && (
					<>
						<button
							className={`w-max flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm duration-150 ${brightness === "dark" ? "bg-white text-black hover:bg-[#ffffffdd]" : "bg-black text-white hover:bg-[#000000dd]"}`}
							onClick={() => handlePlayAll(albumTracks)}
						>
							<PlayIcon className="size-4" /> Play
						</button>
						<div className="flex flex-col">{albumTracks.map((t, i) => <TrackRow key={t.id} track={t} index={i} />)}</div>
					</>
				)}
			</div>
		);
	};

	const ArtistPage = () => {
		if (!artistDetail) return null;
		const { artist, albums: artistAlbums, tracks: artistTracks } = artistDetail;
		return (
			<div className="flex flex-col gap-6">
				<div className="flex gap-4 items-center">
					{artist.picture && <img src={artist.picture} alt="" className="size-28 rounded-full object-cover bg-(--tertiary) shadow-lg" />}
					<div className="flex flex-col gap-1">
						<span className="text-xs text-(--text-tertiary) uppercase font-medium">Artist</span>
						<h1 className="text-2xl font-bold">{artist.name}</h1>
					</div>
				</div>
				{artistTracks.length > 0 && (
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between px-1">
							<h2 className="text-lg font-bold">Top Tracks</h2>
							<button
								className={`text-xs px-3 py-1.5 rounded-lg duration-150 ${brightness === "dark" ? "bg-[#ffffff15] hover:bg-[#ffffff25]" : "bg-[#00000010] hover:bg-[#00000020]"}`}
								onClick={() => handlePlayAll(artistTracks)}
							>
								Play all
							</button>
						</div>
						<div className="flex flex-col">{artistTracks.map((t, i) => <TrackRow key={t.id} track={t} index={i} />)}</div>
					</div>
				)}
				{artistAlbums.length > 0 && (
					<div className="flex flex-col gap-2">
						<h2 className="text-lg font-bold px-1">Albums</h2>
						<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">
							{artistAlbums.map(a => <AlbumCard key={a.id} album={a} />)}
						</div>
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="flex flex-col h-full w-full overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-3 p-4 pb-2">
				<div className="flex items-center gap-2">
					{page !== "home" && (
						<button
							className={`p-1.5 rounded-lg duration-150 ${brightness === "dark" ? "hover:bg-[#ffffff15]" : "hover:bg-[#00000010]"}`}
							onClick={() => { setPage("home"); setAlbumDetail(null); setArtistDetail(null); }}
						>
							<ChartBarIcon className="size-5 text-(--text-secondary)" />
						</button>
					)}
					<h1 className="text-xl font-bold">Digital Library</h1>
				</div>
				<div className={`flex items-center gap-2 flex-1 max-w-md px-3 py-2 rounded-xl duration-150 ${brightness === "dark" ? "bg-[#ffffff12] focus-within:bg-[#ffffff18]" : "bg-[#00000008] focus-within:bg-[#00000012]"}`}>
					<MagnifyingGlassIcon className="size-4 text-(--text-tertiary) shrink-0" />
					<input
						ref={searchRef}
						type="text"
						placeholder="Search songs, albums, artists..."
						className="flex-1 bg-transparent outline-none text-sm text-(--text-primary) placeholder:text-(--text-tertiary)"
						value={searchQuery}
						onChange={e => handleSearchInput(e.target.value)}
						onKeyDown={e => { if (e.key === "Enter") doSearch(searchQuery); }}
					/>
					{searchQuery && (
						<button className="text-(--text-tertiary) hover:text-(--text-primary) duration-150" onClick={() => { setSearchQuery(""); setTracks([]); setAlbums([]); setPage("home"); searchRef.current?.focus(); }}>✕</button>
					)}
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-auto px-4 pb-4">
				{page === "home" && <HomePage />}
				{page === "search" && <SearchPage />}
				{page === "album" && <AlbumPage />}
				{page === "artist" && <ArtistPage />}
			</div>
		</div>
	);
};
