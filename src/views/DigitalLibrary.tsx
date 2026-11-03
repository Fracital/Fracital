import { useEffect, useState, useRef } from "react";
import { useMusicStore, useSettingsStore, useTabsStore } from "../store";
import { updatePageTab } from "../libs/aboutPages";
import { MagnifyingGlassIcon, PlayIcon, PlusIcon, MusicalNoteIcon, ChartBarIcon, RadioIcon, AdjustmentsHorizontalIcon } from "@heroicons/react/24/solid";
import { FireIcon } from "@heroicons/react/24/outline";
import { createId } from "@paralleldrive/cuid2";
import {
	searchTracks,
	getAlbum,
	getArtist,
	getCharts,
	getRadio,
	warmStream,
	formatDuration,
	trackToFracital,
	artworkHighRes,
	cleanAlbumTitle,
	splitArtistCredit,
	getMusicApiConfig,
	type MusicTrack,
	type MusicAlbum,
	type MusicArtist,
	type AlbumDetail,
	type ArtistDetail,
} from "../libs/music-service";

type Page = "home" | "search" | "album" | "artist";

interface DigitalLibraryProps {
	query: string | undefined;
}

export const DigitalLibrary = ({ query }: DigitalLibraryProps) => {
	const settings = useSettingsStore(state => state.settings);
	const brightness = settings.brightness as string;
	const playTrack = useMusicStore(state => state.playTrack);
	const addTrack = useMusicStore(state => state.addTrack);
	const configured = !!getMusicApiConfig()?.baseUrl;

	const [page, setPage] = useState<Page>("home");
	const [searchQuery, setSearchQuery] = useState("");
	const [tracks, setTracks] = useState<MusicTrack[]>([]);
	const [albums, setAlbums] = useState<MusicAlbum[]>([]);
	const [artists, setArtists] = useState<MusicArtist[]>([]);
	const [chartTracks, setChartTracks] = useState<MusicTrack[]>([]);
	const [chartAlbums, setChartAlbums] = useState<MusicAlbum[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [albumDetail, setAlbumDetail] = useState<AlbumDetail | null>(null);
	const [artistDetail, setArtistDetail] = useState<ArtistDetail | null>(null);

	// Radio controls
	const [radioVariety, setRadioVariety] = useState<number>(() => Number(localStorage.getItem("fracital:radio-variety")) || 40);
	const [radioLength, setRadioLength] = useState<number>(() => Number(localStorage.getItem("fracital:radio-length")) || 25);
	const [showRadioSettings, setShowRadioSettings] = useState(false);
	const [radioLoading, setRadioLoading] = useState(false);

	const searchRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<number>(0);
	const searchAbort = useRef<AbortController | null>(null);

	const saveRadioPrefs = (variety: number, length: number) => {
		setRadioVariety(variety);
		setRadioLength(length);
		localStorage.setItem("fracital:radio-variety", String(variety));
		localStorage.setItem("fracital:radio-length", String(length));
	};

	/** Builds a station from an artist (and optional seed track) and plays it. */
	const startRadio = async (artist: string, title?: string) => {
		if (radioLoading) return;
		setRadioLoading(true);
		try {
			const mix = await getRadio({ artist, title, variety: radioVariety, limit: radioLength });
			const playable = (mix.tracks || []).filter(t => t.streamUrl || t.previewUrl);
			if (playable.length === 0) return;
			playTrack({ ...trackToFracital(playable[0]), id: createId() });
			playable.slice(1).forEach(t => addTrack({ ...trackToFracital(t), id: createId() }));
		} catch (err) {
			console.error("Failed to start radio:", err);
		} finally {
			setRadioLoading(false);
		}
	};

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

	/** Query string of the view this component itself last pushed, so tab-history
	 * navigation (back/forward) can be told apart from our own URL updates. */
	const lastSyncedQuery = useRef<string | undefined>(undefined);

	/** Reflects the current view in the tab URL so refreshes and back/forward restore it. */
	const syncUrl = (params?: string, title?: string) => {
		const tab = useTabsStore.getState().tabs.find(t => t.current && t.url.includes("about:library"));
		if (!tab) return;
		lastSyncedQuery.current = params;
		updatePageTab(tab.id, "library", params ? { query: params, title: title || "Digital Library" } : undefined);
	};

	const doSearch = async (q: string, sync = true) => {
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
			setArtists(res.artists || []);
			if (sync) syncUrl(`q=${encodeURIComponent(q)}`, `${q} — Library`);
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

	const openAlbum = async (id: string, sync = true) => {
		setLoading(true);
		try {
			const detail = await getAlbum(id);
			setAlbumDetail(detail);
			setPage("album");
			if (sync) syncUrl(`album=${encodeURIComponent(id)}`, cleanAlbumTitle(detail.album.title));
		} catch (err) {
			console.error("Failed to load album:", err);
		} finally {
			setLoading(false);
		}
	};

	const openArtist = async (id: string, sync = true) => {
		setLoading(true);
		try {
			const detail = await getArtist(id);
			setArtistDetail(detail);
			setPage("artist");
			if (sync) syncUrl(`artist=${encodeURIComponent(id)}`, detail.artist.name);
		} catch (err) {
			console.error("Failed to load artist:", err);
		} finally {
			setLoading(false);
		}
	};

	/** Opens an artist page from a bare name (for collab credits without an id) by resolving it through search. */
	const openArtistByName = async (name: string) => {
		setLoading(true);
		try {
			const res = await searchTracks(name, 5);
			const hit = res.artists?.find(a => a.name.toLowerCase() === name.toLowerCase()) ?? res.artists?.[0];
			if (hit) await openArtist(hit.id);
		} catch (err) {
			console.error("Failed to resolve artist:", err);
		} finally {
			setLoading(false);
		}
	};

	// Follow the tab URL: restores the view after refreshes AND reacts to tab
	// history navigation (back/forward), without re-pushing our own updates.
	useEffect(() => {
		if (!configured) return;
		if (query === lastSyncedQuery.current) return; // our own syncUrl push
		lastSyncedQuery.current = query;
		const params = new URLSearchParams(query || "");
		const artist = params.get("artist");
		const album = params.get("album");
		const q = params.get("q");
		if (artist) openArtist(artist, false);
		else if (album) openAlbum(album, false);
		else if (q) { setSearchQuery(q); doSearch(q, false); }
		else { setPage("home"); setAlbumDetail(null); setArtistDetail(null); }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, configured]);

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
				<span title={track.title} className={`text-sm font-medium truncate ${track.explicit ? "flex items-center gap-1" : ""}`}>
					{track.title}
					{track.explicit && <span className="text-[10px] px-1 py-0.5 rounded bg-(--text-tertiary) text-(--secondary) font-bold leading-none">E</span>}
				</span>
				<span className="text-xs text-(--text-tertiary) truncate">
					{splitArtistCredit(track.artist).map((name, i, all) => (
						<span key={`${name}-${i}`}>
							<span
								title={name}
								className="cursor-pointer hover:underline hover:text-(--text-secondary)"
								onClick={e => {
									e.stopPropagation();
									// The primary credit can use the known id; collaborators resolve by name.
									if (i === 0 && track.artistId && all.length === 1) openArtist(track.artistId);
									else openArtistByName(name);
								}}
							>
								{name}
							</span>
							{i < all.length - 1 && <span>, </span>}
						</span>
					))}
				</span>
			</div>
			{track.album && (
				<span
					title={track.album}
					className="text-xs text-(--text-tertiary) truncate max-w-32 cursor-pointer hover:underline hidden sm:block"
					onClick={e => { e.stopPropagation(); if (track.albumId) openAlbum(track.albumId); }}
				>
					{track.album}
				</span>
			)}
			<span className="text-xs text-(--text-tertiary) w-10 text-right">{formatDuration(track.duration)}</span>
			<button
				className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-[#ffffff20] duration-150"
				title="Start radio from this song"
				onClick={e => { e.stopPropagation(); startRadio(track.artist, track.title); }}
			>
				<RadioIcon className="size-4 text-(--text-secondary)" />
			</button>
			<button
				className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-[#ffffff20] duration-150"
				title="Add to queue"
				onClick={e => { e.stopPropagation(); handleQueue(track); }}
			>
				<PlusIcon className="size-4 text-(--text-secondary)" />
			</button>
		</div>
	);

	const AlbumCard = ({ album, showMeta }: { album: MusicAlbum; showMeta?: boolean }) => {
		const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : null;
		const kind = album.type === "single" ? "Single" : album.type === "ep" ? "EP" : "Album";
		return (
			<div
				className={`flex flex-col gap-2 p-2 rounded-xl cursor-pointer duration-150 ${brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000008]"}`}
				onClick={() => openAlbum(album.id)}
			>
				<img src={artworkHighRes(album.artwork)} alt="" className="w-full aspect-square rounded-lg object-cover bg-(--tertiary)" loading="lazy" />
				<div className="flex flex-col min-w-0 px-0.5">
					<span title={cleanAlbumTitle(album.title)} className="text-sm font-medium truncate">{cleanAlbumTitle(album.title)}</span>
					<span title={showMeta ? undefined : album.artist} className="text-xs text-(--text-tertiary) truncate">{showMeta ? [year, kind].filter(Boolean).join(" · ") : album.artist}</span>
				</div>
			</div>
		);
	};

	/** A discography shelf: a single collapsed row with a "Show all" toggle. */
	const ReleaseSection = ({ title, releases }: { title: string; releases: MusicAlbum[] }) => {
		const [expanded, setExpanded] = useState(false);
		const PREVIEW = 6;
		if (releases.length === 0) return null;
		const visible = expanded ? releases : releases.slice(0, PREVIEW);
		return (
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between px-1">
					<div className="flex items-baseline gap-2">
						<h2 className="text-lg font-bold">{title}</h2>
						<span className="text-xs text-(--text-tertiary)">{releases.length}</span>
					</div>
					{releases.length > PREVIEW && (
						<button
							className={`text-xs px-3 py-1.5 rounded-lg duration-150 ${brightness === "dark" ? "bg-[#ffffff15] hover:bg-[#ffffff25]" : "bg-[#00000010] hover:bg-[#00000020]"}`}
							onClick={() => setExpanded(e => !e)}
						>
							{expanded ? "Show less" : `Show all (${releases.length})`}
						</button>
					)}
				</div>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">
					{visible.map(a => <AlbumCard key={a.id} album={a} showMeta />)}
				</div>
			</div>
		);
	};

	const ArtistCard = ({ artist }: { artist: MusicArtist }) => (
		<div
			className={`flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer duration-150 ${brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000008]"}`}
			onClick={() => openArtist(artist.id)}
		>
			{artist.picture ? (
				<img src={artist.picture} alt={artist.name} title={artist.name} className="size-20 rounded-full object-cover bg-(--tertiary)" loading="lazy" />
			) : (
				<div title={artist.name} className={`flex items-center justify-center size-20 rounded-full text-2xl font-bold ${brightness === "dark" ? "bg-[#ffffff15] text-(--text-secondary)" : "bg-[#00000012] text-(--text-secondary)"}`}>
					{artist.name.charAt(0).toUpperCase()}
				</div>
			)}
			<span title={artist.name} className="text-sm font-medium truncate w-full text-center">{artist.name}</span>
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
			{!loading && !error && tracks.length === 0 && albums.length === 0 && artists.length === 0 && searchQuery.trim() && <EmptyState message="No results found" />}
			{artists.length > 0 && (
				<div className="flex flex-col gap-2">
					<h2 className="text-lg font-bold px-1">Artists</h2>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1">
						{artists.slice(0, 6).map(artist => <ArtistCard key={artist.id} artist={artist} />)}
					</div>
				</div>
			)}
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
						<span className="text-xs text-(--text-tertiary) uppercase font-medium">{albumDetail.album.type === "single" ? "Single" : albumDetail.album.type === "ep" ? "EP" : "Album"}</span>
						<h1 className="text-2xl font-bold truncate">{cleanAlbumTitle(albumDetail.album.title)}</h1>
						<span className="text-sm text-(--text-secondary)">
							{splitArtistCredit(albumDetail.album.artist).map((name, i, all) => (
								<span key={`${name}-${i}`}>
									<span
										className="cursor-pointer hover:underline"
										onClick={() => (i === 0 && albumDetail.album.artistId && all.length === 1 ? openArtist(albumDetail.album.artistId!) : openArtistByName(name))}
									>
										{name}
									</span>
									{i < all.length - 1 && <span>, </span>}
								</span>
							))}
						</span>
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
		const banner = artist.banner || artist.picture;
		return (
			<div className="flex flex-col gap-6">
				{/* Hero banner — no overflow-hidden so the radio settings popover isn't clipped; rounding lives on each layer. */}
				<div className="relative w-full h-52 sm:h-64 rounded-2xl bg-(--tertiary)">
					{banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover object-[center_25%] rounded-2xl" />}
					<div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/20 to-transparent rounded-2xl" />
					<div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 p-5">
						<div className="flex flex-col gap-1 min-w-0">
							<span className="text-xs uppercase font-medium text-white/70">Artist</span>
							<h1 className="text-3xl sm:text-4xl font-bold text-white truncate">{artist.name}</h1>
						</div>
						<div className="relative flex items-center gap-2 shrink-0">
							<button
								className="flex items-center gap-1.5 px-4 py-2 rounded-full font-medium text-sm bg-white text-black hover:bg-white/90 duration-150 disabled:opacity-60"
								disabled={radioLoading}
								onClick={() => startRadio(artist.name)}
								title="Start a station seeded by this artist"
							>
								<RadioIcon className="size-4" />
								{radioLoading ? "Tuning..." : "Start Radio"}
							</button>
							<button
								className="flex items-center justify-center p-2 rounded-full bg-white/20 text-white hover:bg-white/30 duration-150"
								title="Radio settings"
								onClick={() => setShowRadioSettings(s => !s)}
							>
								<AdjustmentsHorizontalIcon className="size-4" />
							</button>
							{showRadioSettings && (
								<div className={`absolute right-0 top-12 z-20 flex flex-col gap-3 w-64 p-4 rounded-xl shadow-xl ${brightness === "dark" ? "bg-[#222227]" : "bg-white"}`}>
									<div className="flex flex-col gap-1">
										<div className="flex justify-between text-xs">
											<span className="font-medium">Variety</span>
											<span className="text-(--text-tertiary)">{radioVariety < 25 ? "This artist" : radioVariety < 60 ? "Balanced mix" : "Discover similar"}</span>
										</div>
										<input type="range" min={0} max={100} value={radioVariety} onChange={e => saveRadioPrefs(Number(e.target.value), radioLength)} className="w-full accent-(--accent,white)" />
										<div className="flex justify-between text-[10px] text-(--text-tertiary)">
											<span>Only {artist.name}</span>
											<span>Similar artists</span>
										</div>
									</div>
									<div className="flex flex-col gap-1">
										<div className="flex justify-between text-xs">
											<span className="font-medium">Station length</span>
											<span className="text-(--text-tertiary)">{radioLength} tracks</span>
										</div>
										<input type="range" min={10} max={50} step={5} value={radioLength} onChange={e => saveRadioPrefs(radioVariety, Number(e.target.value))} className="w-full accent-(--accent,white)" />
									</div>
								</div>
							)}
						</div>
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
				<ReleaseSection title="Albums & EPs" releases={artistAlbums.filter(a => (a.type ?? "album") === "album" || a.type === "ep")} />
				<ReleaseSection title="Singles" releases={artistAlbums.filter(a => a.type === "single")} />
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
							onClick={() => { setPage("home"); setAlbumDetail(null); setArtistDetail(null); syncUrl(); }}
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
						<button className="text-(--text-tertiary) hover:text-(--text-primary) duration-150" onClick={() => { setSearchQuery(""); setTracks([]); setAlbums([]); setArtists([]); setPage("home"); searchRef.current?.focus(); }}>✕</button>
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
