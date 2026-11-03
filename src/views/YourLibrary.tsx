import { HeartIcon, PlayIcon, UserCircleIcon } from "@heroicons/react/24/solid";
import { faLastfm } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useState } from "react";
import { Shelf } from "../components/Shelf";
import { connectLastfm, getMe, type Me } from "../libs/auth";
import { songKey, useLastfmStore } from "../libs/lastfmState";
import { formatCount, library, type LastfmPeriod, type LibraryAlbum, type LibraryArtist, type LibraryTrack } from "../libs/music-service";
import { useTabsStore } from "../store";

const PERIODS: { id: LastfmPeriod; label: string }[] = [
	{ id: "1month", label: "4 weeks" },
	{ id: "6month", label: "6 months" },
	{ id: "12month", label: "12 months" },
	{ id: "overall", label: "All time" },
];

interface Props {
	dark: boolean;
	/** Plays `list[index]` and queues the rest of the list after it. */
	onPlayList: (list: LibraryTrack[], index: number) => void;
	onOpenArtist: (name: string) => void;
	onOpenAlbum: (title: string, artist: string) => void;
	onSongMenu: (e: React.MouseEvent, track: LibraryTrack) => void;
}

const timeAgo = (ms: number) => {
	const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
	if (s < 60) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
};

interface Data {
	loved?: { total: number; tracks: LibraryTrack[] };
	recent?: LibraryTrack[];
	topTracks?: LibraryTrack[];
	topArtists?: LibraryArtist[];
	topAlbums?: LibraryAlbum[];
	recs?: { artists: LibraryArtist[]; tracks: LibraryTrack[] };
	saved?: { id: string; name: string; picture: string }[];
}

/** "Your Library" on the Digital Library home: the user's Last.fm listening, made playable. */
export const YourLibrary = ({ dark, onPlayList, onOpenArtist, onOpenAlbum, onSongMenu }: Props) => {
	const username = useLastfmStore(s => s.username);
	const loved = useLastfmStore(s => s.loved);
	const markLoved = useLastfmStore(s => s.markLoved);
	const [me, setMe] = useState<Me | null | undefined>(undefined);
	const [period, setPeriod] = useState<LastfmPeriod>(() => (localStorage.getItem("fracital:lastfm-period") as LastfmPeriod) || "6month");
	const [data, setData] = useState<Data>({});
	const [connecting, setConnecting] = useState(false);
	const [error, setError] = useState("");
	const newTab = useTabsStore(s => s.newTab);

	useEffect(() => {
		void useLastfmStore.getState().refresh();
		const load = () => void getMe().then(setMe);
		load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, []);

	// Sections that don't depend on the period.
	useEffect(() => {
		if (!username) return;
		let alive = true;
		const put = (patch: Data) => alive && setData(d => ({ ...d, ...patch }));
		library.recent().then(r => put({ recent: r.tracks })).catch(() => {});
		library
			.loved()
			.then(r => {
				put({ loved: r });
				markLoved(r.tracks.map(t => songKey(t.title, t.artist)));
			})
			.catch(() => {});
		library.recommendations().then(r => put({ recs: r })).catch(() => {});
		library.savedArtists().then(r => put({ saved: r.artists })).catch(() => {});
		return () => {
			alive = false;
		};
	}, [username, markLoved]);

	useEffect(() => {
		if (!username) return;
		let alive = true;
		const put = (patch: Data) => alive && setData(d => ({ ...d, ...patch }));
		library.topTracks(period).then(r => put({ topTracks: r.tracks })).catch(() => {});
		library.topArtists(period).then(r => put({ topArtists: r.artists })).catch(() => {});
		library.topAlbums(period).then(r => put({ topAlbums: r.albums })).catch(() => {});
		return () => {
			alive = false;
		};
	}, [username, period]);

	const chip = (active: boolean) => `text-[11px] font-semibold px-2.5 py-1 rounded-full duration-150 ${active ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-[#ffffff1f] hover:bg-[#ffffff33]" : "bg-[#00000012] hover:bg-[#00000022]"}`;
	const hover = dark ? "hover:bg-[#ffffff10]" : "hover:bg-[#00000008]";

	if (username === undefined || me === undefined) return null;

	// Not connected: invite the user to sign in / connect.
	if (!username) {
		const connect = async () => {
			setError("");
			if (!me) {
				newTab({ id: createId(), url: "about:account", displayUrl: "about:account", title: "Fracital Account", icon: null, current: true });
				return;
			}
			setConnecting(true);
			try {
				await connectLastfm("link");
			} catch (err) {
				setError(err instanceof Error ? err.message : "Couldn't connect Last.fm");
			} finally {
				setConnecting(false);
			}
		};
		return (
			<div className={`flex items-center gap-4 p-4 rounded-2xl ${dark ? "bg-[#ffffff0d]" : "bg-[#00000008]"}`}>
				<div className="flex items-center justify-center size-12 shrink-0 rounded-full text-white bg-[#d51007]">
					<FontAwesomeIcon icon={faLastfm} className="size-6" />
				</div>
				<div className="flex flex-col flex-1 min-w-0">
					<span className="font-bold">Build your library from Last.fm</span>
					<span className="text-sm text-(--text-tertiary)">{error || "Your liked songs, top artists, recent plays and picks made for you, plus scrobbling as you listen."}</span>
				</div>
				<button className="shrink-0 px-4 py-2 rounded-full font-semibold text-sm text-white bg-[#d51007] hover:brightness-110 disabled:opacity-60 duration-150" disabled={connecting} onClick={connect}>
					{connecting ? "Waiting…" : me ? "Connect Last.fm" : "Sign in"}
				</button>
			</div>
		);
	}

	const TrackTile = ({ track, list, index, meta }: { track: LibraryTrack; list: LibraryTrack[]; index: number; meta?: React.ReactNode }) => (
		<div
			className={`group flex flex-col gap-1.5 w-32 shrink-0 p-1.5 rounded-lg cursor-pointer duration-150 ${hover}`}
			onClick={() => onPlayList(list, index)}
			onContextMenu={e => {
				e.preventDefault();
				onSongMenu(e, track);
			}}
		>
			<div className="relative">
				{track.artwork ? <img src={track.artwork} alt="" className="w-full aspect-square rounded-md object-cover bg-(--tertiary)" loading="lazy" /> : <div className="w-full aspect-square rounded-md bg-(--tertiary)" />}
				<div className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-md bg-black/40">
					<PlayIcon className="size-7 text-white" />
				</div>
				{loved[songKey(track.title, track.artist)] && <HeartIcon className="absolute top-1.5 right-1.5 size-4 text-[#ff3b5c] drop-shadow" />}
			</div>
			<div className="flex flex-col min-w-0 leading-tight">
				<span title={track.title} className="text-xs font-semibold truncate">
					{track.title}
				</span>
				<span
					title={track.artist}
					className="text-[11px] text-(--text-tertiary) truncate hover:underline"
					onClick={e => {
						e.stopPropagation();
						onOpenArtist(track.artist);
					}}
				>
					{track.artist}
				</span>
				{meta && <span className="text-[10px] text-(--text-tertiary) truncate">{meta}</span>}
			</div>
		</div>
	);

	const ArtistTile = ({ artist, meta }: { artist: LibraryArtist; meta?: React.ReactNode }) => (
		<div className={`flex flex-col items-center gap-1.5 w-28 shrink-0 p-2 rounded-xl cursor-pointer duration-150 ${hover}`} onClick={() => onOpenArtist(artist.name)}>
			{artist.picture ? (
				<img src={artist.picture} alt={artist.name} title={artist.name} className="size-24 rounded-full object-cover bg-(--tertiary)" loading="lazy" />
			) : (
				<div className="flex items-center justify-center size-24 rounded-full bg-(--tertiary)">
					<UserCircleIcon className="size-12 text-(--text-tertiary)" />
				</div>
			)}
			<div className="flex flex-col items-center w-full leading-tight">
				<span title={artist.name} className="text-xs font-semibold text-center truncate w-full">
					{artist.name}
				</span>
				{meta && <span className="text-[10px] text-(--text-tertiary) truncate w-full text-center">{meta}</span>}
			</div>
		</div>
	);

	const top = data.topTracks ?? [];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-2 px-1">
				<div className="flex items-center gap-2">
					<h2 className="text-xl font-bold">Your Library</h2>
					<span className="flex items-center gap-1 text-xs text-(--text-tertiary)">
						<FontAwesomeIcon icon={faLastfm} className="size-3 text-[#d51007]" />@{username}
					</span>
				</div>
				<div className="flex items-center gap-1">
					{PERIODS.map(p => (
						<button
							key={p.id}
							className={chip(period === p.id)}
							onClick={() => {
								setPeriod(p.id);
								localStorage.setItem("fracital:lastfm-period", p.id);
							}}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			<Shelf title="Recently Played" dark={dark}>
				{(data.recent ?? []).map((t, i, list) => (
					<TrackTile key={`${t.id}-${i}`} track={t} list={list} index={i} meta={t.nowPlaying ? <span className="text-[#ff3b5c] font-semibold">● Scrobbling now</span> : t.playedAt ? timeAgo(t.playedAt) : undefined} />
				))}
			</Shelf>

			<Shelf title="Liked Songs" count={data.loved ? formatCount(data.loved.total) : undefined} dark={dark}>
				{(data.loved?.tracks ?? []).map((t, i, list) => (
					<TrackTile key={`${t.id}-${i}`} track={t} list={list} index={i} />
				))}
			</Shelf>

			{top.length > 0 && (
				<section className="flex flex-col gap-2">
					<div className="flex items-center justify-between px-1">
						<h2 className="text-base font-bold">Your Top Songs</h2>
						<button className={chip(false)} onClick={() => onPlayList(top, 0)}>
							Play All
						</button>
					</div>
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-x-3 gap-y-1">
						{top.slice(0, 10).map((t, i) => (
							<div
								key={`${t.id}-${i}`}
								className={`group flex items-center gap-3 p-2 rounded-lg cursor-pointer duration-150 ${hover}`}
								onClick={() => onPlayList(top, i)}
								onContextMenu={e => {
									e.preventDefault();
									onSongMenu(e, t);
								}}
							>
								<span className="w-5 text-right text-sm font-semibold text-(--text-tertiary) tabular-nums">{i + 1}</span>
								{t.artwork ? <img src={t.artwork} alt="" className="size-10 rounded object-cover bg-(--tertiary)" loading="lazy" /> : <div className="size-10 rounded bg-(--tertiary)" />}
								<div className="flex flex-col flex-1 min-w-0 leading-tight">
									<span className="text-sm font-semibold truncate">{t.title}</span>
									<span className="text-xs text-(--text-tertiary) truncate">{t.artist}</span>
								</div>
								{!!t.userPlays && <span className="text-xs font-semibold text-(--text-secondary) tabular-nums">{formatCount(t.userPlays)} plays</span>}
							</div>
						))}
					</div>
				</section>
			)}

			<Shelf title="Your Top Artists" dark={dark} gridMin={112}>
				{(data.topArtists ?? []).map(a => (
					<ArtistTile key={a.name} artist={a} meta={a.userPlays ? `${formatCount(a.userPlays)} plays` : undefined} />
				))}
			</Shelf>

			<Shelf title="Your Top Albums" dark={dark}>
				{(data.topAlbums ?? []).map(a => (
					<div key={`${a.artist}|${a.title}`} className={`flex flex-col gap-1.5 w-32 shrink-0 p-1.5 rounded-lg cursor-pointer duration-150 ${hover}`} onClick={() => onOpenAlbum(a.title, a.artist)}>
						{a.artwork ? <img src={a.artwork} alt="" className="w-full aspect-square rounded-md object-cover bg-(--tertiary)" loading="lazy" /> : <div className="w-full aspect-square rounded-md bg-(--tertiary)" />}
						<div className="flex flex-col min-w-0 leading-tight">
							<span title={a.title} className="text-xs font-semibold line-clamp-2">
								{a.title}
							</span>
							<span className="text-[11px] text-(--text-tertiary) truncate">{a.artist}</span>
							{!!a.userPlays && <span className="text-[10px] text-(--text-tertiary)">{formatCount(a.userPlays)} plays</span>}
						</div>
					</div>
				))}
			</Shelf>

			<Shelf title="Saved Artists" count={data.saved?.length} dark={dark} gridMin={112}>
				{(data.saved ?? []).map(a => (
					<ArtistTile key={a.id} artist={{ name: a.name, picture: a.picture }} />
				))}
			</Shelf>

			<Shelf title="Artists For You" dark={dark} gridMin={112}>
				{(data.recs?.artists ?? []).map(a => (
					<ArtistTile key={a.name} artist={a} meta={a.because ? `Because you like ${a.because}` : undefined} />
				))}
			</Shelf>

			<Shelf title="Songs You Might Like" dark={dark}>
				{(data.recs?.tracks ?? []).map((t, i, list) => (
					<TrackTile key={`${t.id}-${i}`} track={t} list={list} index={i} />
				))}
			</Shelf>
		</div>
	);
};
