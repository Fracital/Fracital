import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { useMusicStore, useSettingsStore, useTabsStore } from "../store";
import { getPageFromUrl, updatePageTab } from "../libs/aboutPages";
import { MagnifyingGlassIcon, PlayIcon, PlusIcon, MusicalNoteIcon, ChartBarIcon, RadioIcon, AdjustmentsHorizontalIcon, EllipsisHorizontalIcon, UserIcon } from "@heroicons/react/24/solid";
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
	cleanAlbumTitle,
	splitArtistCredit,
	getMusicApiConfig,
	getArtistExtras,
	library,
	formatCount,
	type ArtistExtras,
	type ArtistLinkKind,
	type MusicTrack,
	type MusicAlbum,
	type MusicArtist,
	type AlbumDetail,
	type ArtistDetail,
} from "../libs/music-service";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { Shelf } from "../components/Shelf";
import { PlayCount } from "../components/PlayCount";
import { startRadio, useRadioStore } from "../libs/radio";
import { FONT_STACK, TEXT_STACK, getArtistProfile, loadArtistFont, loadTextFont, panel, type ArtistPick, type ArtistProfile } from "../libs/artistPanel";
import { getMe } from "../libs/auth";
import { YourLibrary } from "./YourLibrary";
import { ensureSavedLoaded, useSavedStore } from "../libs/savedLibrary";
import { CheckCircleIcon, PlusCircleIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { songKey, useLastfmStore } from "../libs/lastfmState";
import { CheckBadgeIcon, CheckIcon, GlobeAltIcon, HeartIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartOutlineIcon, SquaresPlusIcon } from "@heroicons/react/24/outline";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { portalTarget } from "../libs/cloak";
import { faApple, faBandcamp, faDeezer, faFacebook, faInstagram, faSoundcloud, faSpotify, faTidal, faTiktok, faXTwitter, faYoutube, type IconDefinition } from "@fortawesome/free-brands-svg-icons";

type Page = "home" | "search" | "album" | "artist";

const LINK_ICONS: Partial<Record<ArtistLinkKind, IconDefinition>> = {
	instagram: faInstagram,
	spotify: faSpotify,
	youtube: faYoutube,
	tidal: faTidal,
	apple: faApple,
	soundcloud: faSoundcloud,
	x: faXTwitter,
	tiktok: faTiktok,
	facebook: faFacebook,
	bandcamp: faBandcamp,
	deezer: faDeezer,
};

const LINK_LABELS: Record<ArtistLinkKind, string> = {
	instagram: "Instagram",
	spotify: "Spotify",
	youtube: "YouTube",
	tidal: "TIDAL",
	apple: "Apple Music",
	soundcloud: "SoundCloud",
	x: "X",
	tiktok: "TikTok",
	facebook: "Facebook",
	bandcamp: "Bandcamp",
	deezer: "Deezer",
	website: "Website",
};

const LinkIcon = ({ kind, small }: { kind: ArtistLinkKind; small?: boolean }) => {
	const icon = LINK_ICONS[kind];
	const size = small ? "size-4" : "size-6";
	return icon ? <FontAwesomeIcon icon={icon} className={size} /> : <GlobeAltIcon className={size} />;
};

/**
 * A one-line heading that shrinks its font size (max → min px) to fit its container, so wide
 * custom fonts and long names show in full; only truncates if it still overflows at min.
 */
const FitTitle = ({ children, className = "", style, max, min }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; max: number; min: number }) => {
	const ref = useRef<HTMLHeadingElement>(null);
	const [size, setSize] = useState(max);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const fit = () => {
			if (!el.clientWidth) return; // hidden tab — wait for a real layout
			let s = max;
			el.style.fontSize = `${s}px`;
			while (s > min && el.scrollWidth > el.clientWidth) {
				s -= 1;
				el.style.fontSize = `${s}px`;
			}
			setSize(s);
		};
		fit();
		const ro = new ResizeObserver(fit);
		if (el.parentElement) ro.observe(el.parentElement);
		// Re-fit when this exact font finishes loading (a swapped-in custom font changes the width).
		if (style?.fontFamily) void document.fonts.load(`${max}px ${style.fontFamily}`, String(children)).then(fit, () => {});
		void document.fonts.ready.then(fit);
		document.fonts.addEventListener?.("loadingdone", fit);
		return () => {
			ro.disconnect();
			document.fonts.removeEventListener?.("loadingdone", fit);
		};
	}, [children, max, min, style?.fontFamily]);
	return (
		<h1 ref={ref} className={`min-w-0 truncate ${className}`} style={{ ...style, fontSize: size }}>
			{children}
		</h1>
	);
};

type MediaItem = { src: string; label: string };

/**
 * Full-screen gallery of an artist's photos and release covers. Click a tile to enlarge;
 * ←/→ to step through, Esc to go back/close. Portaled to <body> so tab containers can't clip it.
 */
const MediaModal = ({ title, titleFont, photos, covers, index, onIndex, onClose }: { title: string; titleFont?: string; photos: MediaItem[]; covers: MediaItem[]; index: number | null; onIndex: (i: number | null) => void; onClose: () => void }) => {
	const all = [...photos, ...covers];
	const current = index !== null ? all[index] : null;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				if (index !== null) onIndex(null);
				else onClose();
			} else if (index !== null && e.key === "ArrowRight") onIndex((index + 1) % all.length);
			else if (index !== null && e.key === "ArrowLeft") onIndex((index - 1 + all.length) % all.length);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [index, all.length, onIndex, onClose]);

	const tile = (item: MediaItem, i: number) => (
		<button key={item.src} className="group relative aspect-square overflow-hidden rounded-xl bg-[#ffffff10] cursor-zoom-in" onClick={() => onIndex(i)} title={item.label || undefined}>
			<img src={item.src} alt={item.label} loading="lazy" className="size-full object-cover duration-300 group-hover:scale-105" />
			{item.label && <span className="absolute inset-x-0 bottom-0 p-2 pt-6 text-left text-xs font-semibold text-white truncate bg-linear-to-t from-black/80 to-transparent">{item.label}</span>}
		</button>
	);

	return createPortal(
		<div className="fixed inset-0 z-[1000] flex flex-col bg-black/85 backdrop-blur-sm text-white" onMouseDown={e => e.target === e.currentTarget && (index !== null ? onIndex(null) : onClose())}>
			<div className="flex items-center gap-3 px-5 py-4 shrink-0">
				{current && (
					<button className="p-2 rounded-full hover:bg-white/10 cursor-pointer" title="Back to all media" onClick={() => onIndex(null)}>
						<ChevronLeftIcon className="size-5" />
					</button>
				)}
				<div className="flex flex-col min-w-0">
					<span className="text-2xl leading-tight truncate" style={{ fontFamily: titleFont }}>
						{title}
					</span>
					<span className="text-xs text-white/60">
						{current ? `${index! + 1} of ${all.length}${current.label ? ` · ${current.label}` : ""}` : `${photos.length} photo${photos.length === 1 ? "" : "s"} · ${covers.length} release${covers.length === 1 ? "" : "s"}`}
					</span>
				</div>
				<button className="ml-auto p-2 rounded-full hover:bg-white/10 cursor-pointer" title="Close (Esc)" onClick={onClose}>
					<XMarkIcon className="size-6" />
				</button>
			</div>

			{current ? (
				<div className="relative flex-1 min-h-0 flex items-center justify-center px-16 pb-6" onMouseDown={e => e.target === e.currentTarget && onIndex(null)}>
					<img src={current.src} alt={current.label} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
					{all.length > 1 && (
						<>
							<button className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer" title="Previous (←)" onClick={() => onIndex((index! - 1 + all.length) % all.length)}>
								<ChevronLeftIcon className="size-6" />
							</button>
							<button className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer" title="Next (→)" onClick={() => onIndex((index! + 1) % all.length)}>
								<ChevronRightIcon className="size-6" />
							</button>
						</>
					)}
				</div>
			) : (
				<div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8">
					<div className="flex flex-col gap-6 max-w-6xl mx-auto">
						{photos.length > 0 && (
							<section className="flex flex-col gap-2.5">
								<h3 className="font-bold">Photos</h3>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">{photos.map((p, i) => tile(p, i))}</div>
							</section>
						)}
						{covers.length > 0 && (
							<section className="flex flex-col gap-2.5">
								<h3 className="font-bold">Releases</h3>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">{covers.map((c, i) => tile(c, photos.length + i))}</div>
							</section>
						)}
					</div>
				</div>
			)}
		</div>,
		portalTarget(),
	);
};

interface DigitalLibraryProps {
	query: string | undefined;
	/** The about: page hosting this view and the query key in front of its own params
	 * (about:music uses `digilib`, giving about:music?digilib&artist=…). */
	urlPage?: string;
	urlPrefix?: string;
}

export const DigitalLibrary = ({ query, urlPage = "library", urlPrefix }: DigitalLibraryProps) => {
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
	// Artist page UI state lives here (not in ArtistPage) so it survives re-renders.
	const [bioExpanded, setBioExpanded] = useState(false);
	const [topSongsExpanded, setTopSongsExpanded] = useState(false);
	const [songMenu, setSongMenu] = useState<{ items: MenuItem[]; position: { x: number; y: number } } | null>(null);
	const [extras, setExtras] = useState<ArtistExtras | null>(null);
	/** The artist's own customizations from Fracital for Artists (null when unclaimed). */
	const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
	const [canManage, setCanManage] = useState(false);
	// Saved songs / albums / followed artists (Fracital account).
	const savedTracks = useSavedStore(s => s.tracks);
	const savedAlbums = useSavedStore(s => s.albums);
	const savedArtists = useSavedStore(s => s.artists);
	const { toggleTrack, toggleAlbum, toggleArtist } = useSavedStore.getState();
	const isTrackSaved = (id: string) => savedTracks.some(t => t.id === id);
	const [showMoreLinks, setShowMoreLinks] = useState(false);
	/** Artist media modal: open/closed, and which item is enlarged (null = grid). */
	const [mediaOpen, setMediaOpen] = useState(false);
	const [mediaIndex, setMediaIndex] = useState<number | null>(null);

	// The user's Last.fm (loved songs + personal play counts) — empty when not connected.
	const lastfmUser = useLastfmStore(s => s.username);
	const lovedSongs = useLastfmStore(s => s.loved);
	const myPlays = useLastfmStore(s => s.userPlays);
	const toggleLove = useLastfmStore(s => s.toggleLove);
	useEffect(() => {
		void useLastfmStore.getState().refresh();
	}, []);
	useEffect(() => {
		if (!artistDetail || !lastfmUser) return;
		void useLastfmStore.getState().loadStats(artistDetail.tracks.slice(0, 20));
		const name = artistDetail.artist.name;
		library
			.artistStats(name)
			.then(r => r.userPlays && useLastfmStore.setState(s => ({ userPlays: { ...s.userPlays, [`artist:${name.toLowerCase()}`]: r.userPlays! } })))
			.catch(() => {});
	}, [artistDetail, lastfmUser]);

	// Artist customizations, and whether the signed-in user manages this page.
	useEffect(() => {
		if (!artistDetail) return;
		let alive = true;
		const id = artistDetail.artist.id;
		loadTextFont();
		getArtistProfile(id, true).then(p => {
			if (!alive) return;
			setArtistProfile(p);
			loadArtistFont(p?.font);
		});
		getMe()
			.then(me => (me ? panel.page(id) : Promise.reject(new Error("signed out"))))
			.then(() => alive && setCanManage(true))
			.catch(() => alive && setCanManage(false));
		return () => {
			alive = false;
		};
	}, [artistDetail]);

	// Social links + gallery photos for the artist hero.
	useEffect(() => {
		if (!artistDetail) return;
		let alive = true;
		getArtistExtras(artistDetail.artist.name).then(x => alive && setExtras(x));
		return () => {
			alive = false;
		};
	}, [artistDetail]);

	useEffect(() => {
		ensureSavedLoaded();
	}, []);

	// Radio (shared with the player — re-tunes on every song change while on).
	const radioVariety = useRadioStore(s => s.variety);
	const radioLength = useRadioStore(s => s.length);
	const radioLoading = useRadioStore(s => s.loading);
	const [showRadioSettings, setShowRadioSettings] = useState(false);

	const searchRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<number>(0);
	const searchAbort = useRef<AbortController | null>(null);

	const saveRadioPrefs = (variety: number, length: number) => {
		useRadioStore.getState().setVariety(variety);
		useRadioStore.getState().setLength(length);
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
		const tab = useTabsStore.getState().tabs.find(t => t.current && getPageFromUrl(t.url) === urlPage);
		if (!tab) return;
		lastSyncedQuery.current = params;
		const full = urlPrefix ? [urlPrefix, params].filter(Boolean).join("&") : params;
		updatePageTab(tab.id, urlPage, full ? { query: full, title: (params && title) || "Digital Library" } : undefined);
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
			setExtras(null);
			setArtistProfile(null);
			setCanManage(false);
			setShowMoreLinks(false);
			setMediaOpen(false);
			setMediaIndex(null);
			setArtistDetail(detail);
			setBioExpanded(false);
			setTopSongsExpanded(false);
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

	/** Opens the album/single a song belongs to when only its title and artist are known. */
	const openAlbumForTrack = async (title: string, artist: string) => {
		setLoading(true);
		try {
			const res = await searchTracks(`${title} ${artist}`, 10);
			const norm = (s: string) => s.toLowerCase().trim();
			const candidates = (res.tracks || []).filter(t => t.albumId);
			const hit = candidates.find(t => norm(t.title) === norm(title) && norm(t.artist).includes(norm(artist))) ?? candidates.find(t => norm(t.title) === norm(title)) ?? candidates[0];
			if (hit?.albumId) await openAlbum(hit.albumId);
		} catch (err) {
			console.error("Failed to resolve album:", err);
		} finally {
			setLoading(false);
		}
	};

	/** Opens an album known only by title + artist (Last.fm top albums). */
	const openAlbumByName = async (title: string, artist: string) => {
		setLoading(true);
		try {
			const res = await searchTracks(`${title} ${artist}`, 5);
			const norm = (s: string) => cleanAlbumTitle(s).toLowerCase().trim();
			const hit = (res.albums || []).find(a => norm(a.title) === norm(title)) ?? res.albums?.[0];
			if (hit) await openAlbum(hit.id);
			else await openAlbumForTrack(title, artist);
		} catch (err) {
			console.error("Failed to resolve album:", err);
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
		const artistName = params.get("artistName");
		const trackTitle = params.get("track");
		if (artist) openArtist(artist, false);
		else if (album) openAlbum(album, false);
		// Name-based links (e.g. from the quick player) resolve to an id, then rewrite the URL.
		else if (artistName) openArtistByName(artistName);
		else if (trackTitle) openAlbumForTrack(trackTitle, params.get("by") || "");
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
			<PlayCount title={track.title} artist={track.artist} className="text-xs font-medium text-(--text-secondary) w-20 text-right shrink-0 hidden sm:block" />
			<span className="text-xs text-(--text-tertiary) w-10 text-right">{formatDuration(track.duration)}</span>
			<button
				className={`${isTrackSaved(track.id) ? "" : "opacity-0 group-hover:opacity-100"} p-1 rounded-full hover:bg-[#ffffff20] duration-150`}
				title={isTrackSaved(track.id) ? "Remove from Library" : "Add to Library"}
				onClick={e => { e.stopPropagation(); toggleTrack(track); }}
			>
				{isTrackSaved(track.id) ? <CheckCircleIcon className="size-4 text-[#3d91ff]" /> : <PlusCircleIcon className="size-4 text-(--text-secondary)" />}
			</button>
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

	/** A compact release tile for artist shelves: artwork, title, then an "E" badge and year. */
	const ReleaseTile = ({ album }: { album: MusicAlbum }) => {
		const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : null;
		return (
			<div
				className={`flex flex-col gap-1.5 w-32 shrink-0 p-1.5 rounded-lg cursor-pointer duration-150 ${brightness === "dark" ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000008]"}`}
				onClick={() => openAlbum(album.id)}
			>
				<img src={artworkHighRes(album.artwork)} alt="" className="w-full aspect-square rounded-md object-cover bg-(--tertiary)" loading="lazy" />
				<div className="flex flex-col min-w-0 gap-0.5">
					<span title={cleanAlbumTitle(album.title)} className="text-xs font-semibold leading-tight line-clamp-2">{cleanAlbumTitle(album.title)}</span>
					<span className="flex items-center gap-1 text-[10px] text-(--text-tertiary) leading-none">
						{album.explicit && <span className="px-[3px] py-px rounded-[3px] bg-(--text-tertiary) text-(--secondary) font-bold">E</span>}
						{year}
					</span>
				</div>
			</div>
		);
	};

	/** Opens the "⋯" menu for a song card. */
	const openSongMenu = (e: React.MouseEvent, track: MusicTrack) => {
		e.stopPropagation();
		const isLoved = lovedSongs[songKey(track.title, track.artist)];
		const items: MenuItem[] = [
			{ title: "Play", onClick: () => handlePlay(track), icon: <PlayIcon className="size-5" /> },
			{ title: "Add to queue", onClick: () => handleQueue(track), icon: <PlusIcon className="size-5" /> },
			isTrackSaved(track.id)
				? { title: "Remove from Library", onClick: () => toggleTrack(track), icon: <CheckCircleIcon className="size-5" /> }
				: { title: "Add to Library", onClick: () => toggleTrack(track), icon: <PlusCircleIcon className="size-5" /> },
			...(lastfmUser ? [{ title: isLoved ? "Remove from Liked Songs" : "Add to Liked Songs", onClick: () => void toggleLove(track.title, track.artist), icon: isLoved ? <HeartIcon className="size-5 text-[#ff3b5c]" /> : <HeartOutlineIcon className="size-5" /> }] : []),
			{ title: "Start radio", onClick: () => startRadio(track.artist, track.title), icon: <RadioIcon className="size-5" /> },
			{
				title: "Go to album",
				onClick: () => (track.albumId ? openAlbum(track.albumId) : openAlbumForTrack(track.title, track.artist)),
				icon: <MusicalNoteIcon className="size-5" />,
			},
			{ title: "Go to artist", onClick: () => openArtistByName(splitArtistCredit(track.artist)[0] || track.artist), icon: <UserIcon className="size-5" /> },
		];
		setSongMenu({ items, position: { x: e.clientX, y: e.clientY } });
	};

	/** Plays a list from `index`, queueing the rest after it (Your Library shelves). */
	const playListFrom = (list: MusicTrack[], index: number) => {
		const ordered = [...list.slice(index), ...list.slice(0, index)];
		handlePlayAll(ordered);
	};

	/** A top song as its own full-width card: artwork, title/artist, play count, and a "⋯" menu. */
	const TopSongCard = ({ track }: { track: MusicTrack }) => {
		const key = songKey(track.title, track.artist);
		const isLoved = !!lovedSongs[key];
		const mine = myPlays[key];
		const inLibrary = isTrackSaved(track.id);
		return (
			<div
				className={`group grid ${lastfmUser ? "grid-cols-[minmax(0,1.7fr)_minmax(6rem,1fr)_6.5rem]" : "grid-cols-[minmax(0,1.7fr)_minmax(6rem,1fr)_4.25rem]"} items-center gap-3 h-15 px-4 rounded-xl cursor-pointer duration-150 ${brightness === "dark" ? "bg-[#ffffff14] hover:bg-[#ffffff21]" : "bg-[#0000000a] hover:bg-[#00000014]"}`}
				onClick={() => handlePlay(track)}
				onContextMenu={e => { e.preventDefault(); openSongMenu(e, track); }}
			>
				<div className="flex items-center gap-3 min-w-0">
					<div className="relative shrink-0">
						<img src={track.artwork} alt="" className="size-9 rounded-md object-cover bg-(--tertiary)" loading="lazy" />
						<div className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-md bg-black/45">
							<PlayIcon className="size-4 text-white" />
						</div>
					</div>
					<div className="flex flex-col min-w-0">
						<span title={track.title} className="flex items-center gap-1.5 text-sm font-semibold leading-tight truncate">
							<span className="truncate">{track.title}</span>
							{track.explicit && <span className="shrink-0 text-[9px] px-1 py-0.5 rounded-[3px] bg-(--text-tertiary) text-(--secondary) font-bold leading-none">E</span>}
						</span>
						<span className="text-xs text-(--text-tertiary) leading-tight truncate">{track.artist}</span>
					</div>
				</div>
				<span className="text-sm font-semibold text-(--text-secondary)">
					<PlayCount title={track.title} artist={track.artist} />
					{!!mine && <span className="block text-[11px] font-medium text-(--text-tertiary)">You: {formatCount(mine)}</span>}
				</span>
				<div className="flex items-center justify-end gap-0.5">
					<button
						className={`flex items-center justify-center size-8 rounded-full duration-150 ${inLibrary ? "" : "opacity-0 group-hover:opacity-100"} ${brightness === "dark" ? "hover:bg-[#ffffff1f]" : "hover:bg-[#00000012]"}`}
						title={inLibrary ? "Remove from Library" : "Add to Library"}
						onClick={e => {
							e.stopPropagation();
							toggleTrack(track);
						}}
					>
						{inLibrary ? <CheckCircleIcon className="size-5 text-[#3d91ff]" /> : <PlusCircleIcon className="size-5" />}
					</button>
					{lastfmUser && (
						<button
							className={`flex items-center justify-center size-8 rounded-full duration-150 ${isLoved ? "" : "opacity-0 group-hover:opacity-100"} ${brightness === "dark" ? "hover:bg-[#ffffff1f]" : "hover:bg-[#00000012]"}`}
							title={isLoved ? "Remove from Liked Songs" : "Add to Liked Songs"}
							onClick={e => {
								e.stopPropagation();
								void toggleLove(track.title, track.artist);
							}}
						>
							{isLoved ? <HeartIcon className="size-5 text-[#ff3b5c]" /> : <HeartOutlineIcon className="size-5" />}
						</button>
					)}
					<button
						className={`flex items-center justify-center size-8 rounded-full duration-150 ${brightness === "dark" ? "hover:bg-[#ffffff1f]" : "hover:bg-[#00000012]"}`}
						title="More"
						onClick={e => openSongMenu(e, track)}
					>
						<EllipsisHorizontalIcon className="size-6" />
					</button>
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
			<YourLibrary dark={brightness === "dark"} onPlayList={playListFrom} onOpenArtist={openArtistByName} onOpenAlbum={openAlbumByName} onSongMenu={openSongMenu} />
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
		const albumSaved = savedAlbums.some(a => a.id === albumDetail.album.id);
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
						<div className="flex items-center gap-2">
							<button
								className={`w-max flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm duration-150 ${brightness === "dark" ? "bg-white text-black hover:bg-[#ffffffdd]" : "bg-black text-white hover:bg-[#000000dd]"}`}
								onClick={() => handlePlayAll(albumTracks)}
							>
								<PlayIcon className="size-4" /> Play
							</button>
							<button
								className={`w-max flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm duration-150 ${albumSaved ? "bg-[#3d91ff] text-white hover:brightness-110" : brightness === "dark" ? "bg-[#ffffff1f] hover:bg-[#ffffff33]" : "bg-[#00000012] hover:bg-[#00000022]"}`}
								onClick={() => toggleAlbum(albumDetail.album)}
								title={albumSaved ? "Remove from Your Library" : `Add this ${albumDetail.album.type === "single" ? "single" : albumDetail.album.type === "ep" ? "EP" : "album"} to Your Library`}
							>
								{albumSaved ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
								{albumSaved ? "In Library" : "Add to Library"}
							</button>
						</div>
						<div className="flex flex-col">{albumTracks.map((t, i) => <TrackRow key={t.id} track={t} index={i} />)}</div>
					</>
				)}
			</div>
		);
	};

	const openTab = (url: string, title: string) => useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title, icon: null, current: true });

	/** Plays the Artist Pick: from the loaded top songs if it's there, else via search. */
	const playPick = async (pick: ArtistPick) => {
		const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
		const local = artistDetail?.tracks.find(t => (pick.trackId && t.id === pick.trackId) || norm(t.title) === norm(pick.title));
		if (local) return handlePlay(local);
		const res = await searchTracks(`${pick.artist} ${pick.title}`, 5).catch(() => null);
		const hit = res?.tracks.find(t => norm(t.title) === norm(pick.title)) ?? res?.tracks[0];
		if (hit) handlePlay(hit);
	};

	const ArtistPage = () => {
		if (!artistDetail) return null;
		const { albums: artistAlbums, tracks: artistTracks, similar } = artistDetail;
		const custom = artistProfile;
		const artist = { ...artistDetail.artist, bio: custom?.bio || artistDetail.artist.bio };
		const dark = brightness === "dark";
		const banner = custom?.banner || artist.banner || artist.picture;
		const artistFont = FONT_STACK(custom?.font);
		const links = custom?.links?.length ? custom.links : (extras?.links ?? []);
		const chip = `text-[11px] font-semibold px-2.5 py-1 rounded-full duration-150 ${dark ? "bg-[#ffffff1f] hover:bg-[#ffffff33]" : "bg-[#00000012] hover:bg-[#00000022]"}`;
		const TOP_SONGS_MIN = 10;
		const TOP_SONGS_MAX = 20;
		const rankedSongs = artistTracks.slice(0, TOP_SONGS_MAX);
		const topSongs = topSongsExpanded ? rankedSongs : rankedSongs.slice(0, TOP_SONGS_MIN);
		// iTunes lists clean and explicit editions separately; keep one per title, preferring explicit.
		const dedupe = (list: MusicAlbum[]) => {
			const byTitle = new Map<string, MusicAlbum>();
			for (const a of list) {
				const key = cleanAlbumTitle(a.title).toLowerCase().trim();
				const seen = byTitle.get(key);
				if (!seen || (a.explicit && !seen.explicit)) byTitle.set(key, a);
			}
			return list.filter(a => byTitle.get(cleanAlbumTitle(a.title).toLowerCase().trim()) === a);
		};
		const albumsAndEps = dedupe(artistAlbums.filter(a => (a.type ?? "album") === "album" || a.type === "ep"));
		const singles = dedupe(artistAlbums.filter(a => a.type === "single"));
		const hasLongBio = !!artist.bio && artist.bio.length > 110;
		const myArtistPlays = myPlays[`artist:${artist.name.toLowerCase()}`];

		// Collage photos: extra artist photos first, then album covers to fill any gaps.
		// Everything for the "all photos" modal: artist photos first, then release covers.
		const mediaPhotos = [...new Set([...(custom?.photos ?? []), banner, ...(extras?.images ?? [])].filter((u): u is string => !!u && !u.includes("/images/artist//")))].map(src => ({ src, label: "" }));
		const mediaCovers = [...albumsAndEps, ...singles]
			.filter(a => a.artwork)
			.map(a => ({ src: artworkHighRes(a.artwork), label: cleanAlbumTitle(a.title) }))
			.filter((m, i, all) => all.findIndex(x => x.src === m.src) === i && !mediaPhotos.some(p => p.src === m.src));
		const media = [...mediaPhotos, ...mediaCovers];
		const gallery = [...new Set([...(custom?.photos ?? []), ...(extras?.images ?? []).filter(u => u !== banner), ...albumsAndEps.map(a => artworkHighRes(a.artwork)), ...singles.map(a => artworkHighRes(a.artwork))])].slice(0, 4);

		const following = savedArtists.some(a => a.id === artist.id);

		const openLink = (url: string, title: string) => useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title, icon: null, current: true });

		const radioControls = () => (
			<div className="relative flex items-center gap-2">
				<button
					className={`flex items-center gap-1.5 whitespace-nowrap shrink-0 px-3.5 py-2 rounded-full font-semibold text-sm duration-150 ${following ? "bg-[#3d91ff] text-white hover:brightness-110" : "bg-white/15 text-white ring-1 ring-white/40 hover:bg-white/25 backdrop-blur"}`}
					onClick={() => toggleArtist({ id: artist.id, name: artist.name, picture: artist.picture })}
					title={following ? "Unfollow — remove from Your Library" : "Follow — add to Your Library"}
				>
					{following ? <CheckIcon className="size-4" /> : <UserPlusIcon className="size-4" />}
					{following ? "Following" : "Follow"}
				</button>
				<button
					className="flex items-center gap-1.5 whitespace-nowrap shrink-0 px-3.5 py-2 rounded-full font-semibold text-sm bg-white text-black hover:bg-white/90 duration-150 disabled:opacity-60"
					disabled={radioLoading}
					onClick={() => startRadio(artist.name)}
					title="Start a station seeded by this artist"
				>
					<RadioIcon className="size-4" />
					{radioLoading ? "Tuning..." : "Start Radio"}
				</button>
				<button className="flex items-center justify-center size-9 rounded-full bg-white text-black hover:bg-white/90 duration-150" title="Radio settings" onClick={() => setShowRadioSettings(s => !s)}>
					<AdjustmentsHorizontalIcon className="size-4" />
				</button>
				{showRadioSettings && (
					<div className={`absolute right-0 bottom-12 z-20 flex flex-col gap-3 w-64 p-4 rounded-xl shadow-xl ${dark ? "bg-[#222227]" : "bg-white"}`}>
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
		);

		return (
			<div className="flex flex-col gap-3">
				{/* Hero — a name/bio panel plus a photo collage (collapses to the panel on narrow widths).
				    No overflow-hidden so the radio settings popover isn't clipped; rounding lives on each layer. */}
				<div className={`@container relative p-1.5 rounded-[1.4rem] ${dark ? "bg-[#ffffff0a] ring-1 ring-[#ffffff14]" : "bg-[#00000006] ring-1 ring-[#00000010]"}`}>
					<div className="flex gap-1.5 h-60 @3xl:h-64">
						{/* Name, bio, stats, social links */}
						<div className="relative flex flex-col flex-[1.9] min-w-0 rounded-2xl bg-(--tertiary)">
							{banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover object-[center_25%] rounded-2xl" />}
							<div className={`absolute inset-0 rounded-2xl duration-300 ${bioExpanded ? "bg-black/75" : "bg-linear-to-b from-black/75 via-black/30 to-black/60"}`} />
							<div className="relative flex flex-col gap-1 p-4 pb-0 min-h-0">
								{/* The name always shows, in the artist's own font; their logo sits beside it. */}
								<div className="flex items-center gap-2.5 min-w-0">
									{custom?.logo && <img src={custom.logo} alt="" className="h-11 @3xl:h-13 w-auto max-w-32 shrink-0 object-contain drop-shadow" />}
									<FitTitle className={`tracking-tight leading-none text-white/90 ${custom?.font ? "font-normal" : "font-extrabold"}`} style={{ fontFamily: artistFont }} max={48} min={22}>
										{artist.name}
									</FitTitle>
									{custom?.verified && (
										<span title="Verified artist" className="shrink-0">
											<CheckBadgeIcon className="size-7 text-[#3d91ff] drop-shadow" />
										</span>
									)}
								</div>
								{custom?.announcement && (
									<p className="text-sm font-bold text-white leading-snug line-clamp-2" style={{ fontFamily: TEXT_STACK }}>
										{custom.announcement}
									</p>
								)}
								{artist.bio && (
									<p className={`text-sm font-semibold text-white/75 leading-snug ${bioExpanded ? "max-h-28 overflow-y-auto pr-1" : custom?.announcement ? "line-clamp-1" : "line-clamp-2"}`} style={{ fontFamily: TEXT_STACK }}>
										{artist.bio}
									</p>
								)}
								<div className="flex items-center justify-between gap-2">
									{artist.listeners ? (
										<span className="text-xs font-medium text-white/60" title="Last.fm listeners">
											{formatCount(artist.listeners)} listeners
											{!!myArtistPlays && ` · you: ${formatCount(myArtistPlays)}`}
										</span>
									) : (
										<span className="text-xs font-medium text-white/60">{artist.fans ? `${formatCount(artist.fans)} fans` : ""}</span>
									)}
									{hasLongBio && (
										<button className="shrink-0 text-sm font-semibold text-white/80 hover:text-white duration-150" onClick={() => setBioExpanded(b => !b)}>
											{bioExpanded ? "show less" : "read more"}
										</button>
									)}
								</div>
							</div>
							<div className="relative mt-auto flex items-end justify-between gap-2 p-3">
								{/* Official links: the first four as icons, the rest behind "+" */}
								<div className="relative flex items-center gap-2.5">
									{links.slice(0, 4).map(l => (
										<button key={l.kind} className="text-white/90 hover:text-white hover:scale-110 duration-150" title={LINK_LABELS[l.kind]} onClick={() => openLink(l.url, LINK_LABELS[l.kind])}>
											<LinkIcon kind={l.kind} />
										</button>
									))}
									{links.length > 4 && (
										<button className="text-white/90 hover:text-white hover:scale-110 duration-150" title="More links" onClick={() => setShowMoreLinks(s => !s)}>
											<PlusIcon className="size-6" />
										</button>
									)}
									{showMoreLinks && (
										<div className={`absolute left-0 bottom-9 z-20 flex flex-col p-1.5 min-w-44 rounded-xl shadow-xl ${dark ? "bg-[#222227]" : "bg-white"}`}>
											{links.slice(4).map(l => (
												<button
													key={l.kind}
													className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-left duration-150 ${dark ? "hover:bg-[#ffffff12]" : "hover:bg-[#00000010]"}`}
													onClick={() => {
														setShowMoreLinks(false);
														openLink(l.url, LINK_LABELS[l.kind]);
													}}
												>
													<LinkIcon kind={l.kind} small />
													{LINK_LABELS[l.kind]}
												</button>
											))}
										</div>
									)}
								</div>
								{/* Narrow layout: radio controls live on this panel instead of the big tile. */}
								<div className="@3xl:hidden">{radioControls()}</div>
							</div>
						</div>

						{/* Photo collage */}
						<div className="hidden @3xl:block relative flex-[0.85] min-w-0 rounded-2xl overflow-hidden bg-(--tertiary)">
							{gallery[0] ? <img src={gallery[0]} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full animate-pulse" />}
						</div>
						<div className="hidden @3xl:flex flex-col gap-1.5 flex-[0.5] min-w-0">
							<div className="flex-1 min-h-0 rounded-2xl overflow-hidden bg-(--tertiary)">{gallery[1] ? <img src={gallery[1]} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full animate-pulse" />}</div>
							<div className="w-full aspect-square shrink-0 rounded-full overflow-hidden bg-(--tertiary)">{gallery[2] ? <img src={gallery[2]} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full animate-pulse" />}</div>
						</div>
						<div className="hidden @3xl:block relative flex-[1.35] min-w-0 rounded-2xl bg-(--tertiary)">
							{gallery[3] ? <img src={gallery[3]} alt="" className="absolute inset-0 w-full h-full object-cover rounded-2xl" loading="lazy" /> : <div className="absolute inset-0 rounded-2xl animate-pulse" />}
							<div className="absolute inset-0 rounded-2xl bg-linear-to-t from-black/45 via-transparent to-transparent" />
							<div className="absolute bottom-3 right-3">{radioControls()}</div>
						</div>

						{/* All photos & media */}
						<div className="flex flex-col items-center justify-center gap-1 w-11 shrink-0">
							<button
								className={`flex items-center justify-center size-10 rounded-full duration-150 disabled:opacity-40 ${dark ? "bg-[#ffffff1f] hover:bg-[#ffffff33]" : "bg-[#00000012] hover:bg-[#00000022]"}`}
								title={`See all photos & media (${media.length})`}
								disabled={!media.length}
								onClick={() => {
									setMediaIndex(null);
									setMediaOpen(true);
								}}
							>
								<SquaresPlusIcon className="size-5.5" />
							</button>
							{media.length > 4 && <span className="text-[10px] font-semibold text-(--text-tertiary)">+{media.length - 4}</span>}
						</div>
					</div>
				</div>

				{custom?.pick && (
					<button
						className={`group flex items-center gap-4 p-3 rounded-2xl text-left cursor-pointer duration-150 ${dark ? "bg-[#3d91ff14] hover:bg-[#3d91ff22] ring-1 ring-[#3d91ff33]" : "bg-[#3d91ff10] hover:bg-[#3d91ff1c]"}`}
						onClick={() => playPick(custom.pick!)}
					>
						<div className="relative shrink-0">
							{custom.pick.artwork ? <img src={custom.pick.artwork} alt="" className="size-16 rounded-xl object-cover" /> : <div className="size-16 rounded-xl bg-(--tertiary)" />}
							<div className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-xl bg-black/45">
								<PlayIcon className="size-6 text-white" />
							</div>
						</div>
						<div className="flex flex-col min-w-0">
							<span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#6aaaff]">
								<CheckBadgeIcon className="size-3.5" /> Artist Pick
							</span>
							<span className="font-bold truncate">{custom.pick.title}</span>
							{custom.pick.note && (
								<span className="text-sm text-(--text-secondary) line-clamp-1" style={{ fontFamily: TEXT_STACK }}>
									{custom.pick.note}
								</span>
							)}
						</div>
					</button>
				)}

				{rankedSongs.length > 0 && (
					<div className="flex flex-col gap-2.5">
						{topSongs.map(t => <TopSongCard key={t.id} track={t} />)}
						<div className="flex items-center justify-center gap-1.5">
							<button className={chip} onClick={() => handlePlayAll(rankedSongs)}>Play All</button>
							{rankedSongs.length > TOP_SONGS_MIN && (
								<button className={chip} onClick={() => setTopSongsExpanded(e => !e)}>{topSongsExpanded ? "Show Less" : `Show All ${rankedSongs.length}`}</button>
							)}
						</div>
					</div>
				)}

				<div className="flex flex-col gap-4 mt-1">
					<Shelf title="Albums" count={albumsAndEps.length} dark={dark}>
						{albumsAndEps.map(a => <ReleaseTile key={a.id} album={a} />)}
					</Shelf>
					<Shelf title="Singles" count={singles.length} dark={dark}>
						{singles.map(a => <ReleaseTile key={a.id} album={a} />)}
					</Shelf>
					<Shelf title="Fans might also like" dark={dark} gridMin={112}>
						{(similar ?? []).map(s => (
							<div
								key={s.name}
								className={`flex flex-col items-center gap-1.5 w-28 shrink-0 p-2 rounded-xl cursor-pointer duration-150 ${dark ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000008]"}`}
								onClick={() => openArtistByName(s.name)}
							>
								{s.picture ? (
									<img src={s.picture} alt={s.name} title={s.name} className="size-24 rounded-full object-cover bg-(--tertiary)" loading="lazy" />
								) : (
									<div title={s.name} className={`flex items-center justify-center size-24 rounded-full text-2xl font-bold ${dark ? "bg-[#ffffff15]" : "bg-[#00000012]"} text-(--text-secondary)`}>
										{s.name.charAt(0).toUpperCase()}
									</div>
								)}
								<div className="flex flex-col items-center w-full leading-tight">
									<span title={s.name} className="text-xs font-semibold text-center truncate w-full">{s.name}</span>
									{s.listeners ? (
										<span className="text-[10px] text-(--text-tertiary)">{formatCount(s.listeners)} listeners</span>
									) : (
										!!s.fans && <span className="text-[10px] text-(--text-tertiary)">{formatCount(s.fans)} fans</span>
									)}
								</div>
							</div>
						))}
					</Shelf>
				</div>

				<div className="flex items-center justify-center gap-2 py-2 text-xs text-(--text-tertiary)">
					{canManage ? (
						<button className={chip} onClick={() => openTab(`about:artists?page=${encodeURIComponent(artist.id)}`, artist.name)}>
							Manage this page
						</button>
					) : (
						!custom?.verified && (
							<>
								<span>Is this you?</span>
								<button className={chip} onClick={() => openTab(`about:artists?claim=${encodeURIComponent(artist.id)}&name=${encodeURIComponent(artist.name)}`, "Claim your page")}>
									Claim this page
								</button>
							</>
						)
					)}
				</div>

				{mediaOpen && (
					<MediaModal
						title={artist.name}
						titleFont={artistFont}
						photos={mediaPhotos}
						covers={mediaCovers}
						index={mediaIndex}
						onIndex={setMediaIndex}
						onClose={() => {
							setMediaOpen(false);
							setMediaIndex(null);
						}}
					/>
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
				{/* Called (not <HomePage />) so Your Library keeps its state across re-renders. */}
				{page === "home" && HomePage()}
				{page === "search" && <SearchPage />}
				{page === "album" && <AlbumPage />}
				{/* Called, not mounted as <ArtistPage />: a fresh component identity each render would remount it as play counts stream in. */}
				{page === "artist" && ArtistPage()}
			</div>
			{songMenu && <ContextMenu items={songMenu.items} position={songMenu.position} onClose={() => setSongMenu(null)} />}
		</div>
	);
};
