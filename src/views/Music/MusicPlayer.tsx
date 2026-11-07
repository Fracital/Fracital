import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { AdjustmentsHorizontalIcon, ArrowPathRoundedSquareIcon, ArrowsPointingInIcon, BackspaceIcon, BackwardIcon, ChatBubbleBottomCenterTextIcon, FilmIcon, ForwardIcon, MusicalNoteIcon, PauseIcon, PhotoIcon, PlayIcon, QueueListIcon, SpeakerWaveIcon, SpeakerXMarkIcon } from "@heroicons/react/24/solid";
import { useMusicStore, usePlaybackStore, useSettingsStore, useTabsStore } from "../../store";
import type { Track } from "../../types";
import { AudvisVisualizer } from "../../components/AudvisVisualizer";
import { formatTime, getAudio, isPlayerUrl, next, nowPlayingTitle, parsePlayerMode, play, playerUrl, previous, seek, setPlaybackOwner, setVolume, toggleLoop, toggleMute, togglePlay, type PlaybackOwner, type PlayerMode } from "../../libs/playback";
import { LYRICS_CHANGED_EVENT, LYRICS_SOURCE_LABELS, loadLyrics, type Lyrics } from "../../libs/lyrics";
import { activeLineIndex } from "../../libs/lrc";
import { PlayCount } from "../../components/PlayCount";
import { RadioStatus } from "../../components/RadioStatus";
import { clearQueue } from "../../libs/radio";
import { UserGroupIcon } from "@heroicons/react/24/solid";
import { cleanAlbumTitle, getMusicVideo, getSongCredits, getSongInfo, type SongCredits } from "../../libs/music-service";
import { isLinkable, openArtistByName, openTrackAlbum, openTrackArtist, trackArtists } from "../../libs/trackLinks";

interface MusicPlayerProps {
	query?: string;
	className?: string;
	/** Embedded in about:music: closing returns to browsing instead of closing the tab. */
	onClose?: () => void;
}

const artistText = (track: Track | null) => (track ? (Array.isArray(track.artists) ? track.artists.join(", ") : track.artists) : "");

const Cover = ({ track, className, vt }: { track: Track | null; className?: string; vt?: string }) =>
	track?.cover ? (
		<img src={track.cover} alt={track.title} data-np={vt} className={`aspect-square object-cover ${className ?? ""}`} />
	) : (
		<div data-np={vt} className={`aspect-square flex justify-center items-center bg-(--primary) text-(--text-secondary) inset-shadow-(--inset-shadow-primary) ${className ?? ""}`}>
			<MusicalNoteIcon className="size-1/3 opacity-90" />
		</div>
	);

const SeekBar = ({ dark }: { dark: boolean }) => {
	const currentTime = usePlaybackStore(state => state.currentTime);
	const duration = usePlaybackStore(state => state.duration);
	const barRef = useRef<HTMLDivElement>(null);
	const [dragTime, setDragTime] = useState<number | null>(null);

	const timeAt = (clientX: number) => {
		const rect = barRef.current?.getBoundingClientRect();
		if (!rect || !duration) return 0;
		return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * duration;
	};

	const shown = dragTime ?? currentTime;
	const percent = duration ? (shown / duration) * 100 : 0;

	return (
		<div className="flex w-full items-center gap-2 @lg:gap-3 select-none">
			<span className="w-11 @lg:w-13 shrink-0 text-right text-sm @lg:text-lg font-semibold tabular-nums text-(--text-primary)">{formatTime(shown)}</span>
			<div
				ref={barRef}
				className={`group relative flex-1 h-2.5 rounded-full cursor-pointer touch-none ${dark ? "bg-[#ffffff4d]" : "bg-[#00000024]"}`}
				onPointerDown={e => {
					if (!duration) return;
					e.currentTarget.setPointerCapture(e.pointerId);
					setDragTime(timeAt(e.clientX));
				}}
				onPointerMove={e => {
					if (dragTime !== null) setDragTime(timeAt(e.clientX));
				}}
				onPointerUp={e => {
					if (dragTime === null) return;
					seek(timeAt(e.clientX));
					setDragTime(null);
				}}
				onPointerCancel={() => setDragTime(null)}
			>
				<div style={{ width: `${percent}%` }} className="h-full rounded-full bg-(--accent)" />
				<div style={{ left: `${percent}%` }} className={`absolute top-1/2 size-4 -translate-1/2 rounded-full bg-(--accent) shadow-[0_0_0_3px_#ffffff40,0_2px_8px_#00000060] opacity-0 group-hover:opacity-100 duration-150 ${dragTime !== null ? "opacity-100" : ""}`} />
			</div>
			<span className="w-11 @lg:w-13 shrink-0 text-sm @lg:text-lg font-semibold tabular-nums text-(--text-primary)">{formatTime(duration)}</span>
		</div>
	);
};

const VolumeControl = ({ dark, buttonClassName }: { dark: boolean; buttonClassName: string }) => {
	const volume = usePlaybackStore(state => state.volume);
	const muted = usePlaybackStore(state => state.muted);
	const [dragging, setDragging] = useState(false);
	const trackRef = useRef<HTMLDivElement>(null);
	const shown = muted ? 0 : volume;

	const currentVolume = () => {
		const state = usePlaybackStore.getState();
		return state.muted ? 0 : state.volume;
	};

	const setFromPointer = (clientY: number) => {
		const rect = trackRef.current?.getBoundingClientRect();
		if (rect) setVolume((rect.bottom - clientY) / rect.height);
	};

	const open = dragging
		? "opacity-100 pointer-events-auto translate-y-0"
		: "opacity-0 pointer-events-none translate-y-1 group-hover/volume:opacity-100 group-hover/volume:pointer-events-auto group-hover/volume:translate-y-0 group-focus-within/volume:opacity-100 group-focus-within/volume:pointer-events-auto group-focus-within/volume:translate-y-0";

	return (
		<div className="group/volume relative flex">
			<div className={`absolute bottom-full left-1/2 -translate-x-1/2 pb-2 z-10 duration-150 ${open}`}>
				<div className={`p-1.5 rounded-full backdrop-blur-md shadow-[0_6px_24px_#00000050] ${dark ? "hover:bg-[#ffffff20] bg-[#ffffff12]" : "bg-[#00000020]"}`}>
					<div
						ref={trackRef}
						role="slider"
						tabIndex={0}
						aria-label="Volume"
						aria-orientation="vertical"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(shown * 100)}
						title={`Volume ${Math.round(shown * 100)}%`}
						className={`relative w-4 h-32 p-0.5 rounded-full border cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-(--accent) ${dark ? "border-[#ffffff70]" : "border-[#00000040]"}`}
						onPointerDown={e => {
							e.currentTarget.setPointerCapture(e.pointerId);
							setDragging(true);
							setFromPointer(e.clientY);
						}}
						onPointerMove={e => {
							if (dragging) setFromPointer(e.clientY);
						}}
						onPointerUp={() => setDragging(false)}
						onPointerCancel={() => setDragging(false)}
						onLostPointerCapture={() => setDragging(false)}
						onWheel={e => setVolume(currentVolume() - Math.sign(e.deltaY) * 0.05)}
						onKeyDown={e => {
							const steps: Record<string, number> = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.1, PageDown: -0.1 };
							if (e.key in steps) setVolume(currentVolume() + steps[e.key]);
							else if (e.key === "Home") setVolume(0);
							else if (e.key === "End") setVolume(1);
							else return;
							e.preventDefault();
						}}
					>
						<div className="relative size-full">
							<div style={{ height: `${shown * 100}%` }} className={`absolute inset-x-0 bottom-0 rounded-full ${dark ? "bg-white" : "bg-black"} ${dragging ? "" : "duration-100"}`} />
						</div>
					</div>
				</div>
			</div>
			<button title={muted ? "Unmute" : "Mute"} className={buttonClassName} onClick={toggleMute}>
				{muted || volume === 0 ? <SpeakerXMarkIcon className="size-7" /> : <SpeakerWaveIcon className="size-7" />}
			</button>
		</div>
	);
};

const EQ_BANDS = [
	{ key: "eqBass", set: "setEqBass", label: "Bass" },
	{ key: "eqMid", set: "setEqMid", label: "Mid" },
	{ key: "eqTreble", set: "setEqTreble", label: "Treble" },
] as const;

/** Bass/mid/treble popover; shares its gains with the side panel player's equalizer. */
const EqControl = ({ dark, buttonClassName }: { dark: boolean; buttonClassName: string }) => {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const eq = usePlaybackStore(useShallow(state => ({ eqBass: state.eqBass, eqMid: state.eqMid, eqTreble: state.eqTreble })));
	const adjusted = eq.eqBass !== 0 || eq.eqMid !== 0 || eq.eqTreble !== 0;

	useEffect(() => {
		if (!open) return;
		const onPointer = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const rest = dark ? "#ffffff30" : "#00000020";
	return (
		<div ref={ref} className="relative flex">
			<button title="Equalizer" aria-haspopup="dialog" aria-expanded={open} className={`${buttonClassName} ${open || adjusted ? "text-(--accent)!" : ""}`} onClick={() => setOpen(o => !o)}>
				<AdjustmentsHorizontalIcon className="size-5" />
			</button>
			{open && (
				<div
					role="dialog"
					aria-label="Equalizer"
					className={`absolute top-full right-0 z-30 mt-2 flex w-64 max-w-[calc(100cqw-1.5rem)] flex-col gap-4 rounded-2xl p-4 backdrop-blur-xl shadow-[0_10px_40px_#00000060] ${dark ? "bg-[#1a1a1ad0] border border-[#ffffff26]" : "bg-[#ffffffd8] border border-[#00000014]"}`}
				>
					<h3 className="text-sm font-semibold text-(--text-primary)">Equalizer</h3>
					{EQ_BANDS.map(band => {
						const value = eq[band.key];
						const pos = ((value + 12) / 24) * 100;
						const [lo, hi] = [Math.min(50, pos), Math.max(50, pos)];
						return (
							<label key={band.key} className="flex flex-col gap-1.5">
								<span className="flex justify-between text-xs text-(--text-secondary)">
									{band.label}
									<span className="font-mono tabular-nums">
										{value > 0 ? "+" : ""}
										{value.toFixed(1)} dB
									</span>
								</span>
								{/* The fill grows out from 0 dB in the middle. */}
								<input
									type="range"
									min={-12}
									max={12}
									step={0.5}
									value={value}
									onChange={e => usePlaybackStore.getState()[band.set](parseFloat(e.target.value))}
									onDoubleClick={() => usePlaybackStore.getState()[band.set](0)}
									className="eq-slider w-full"
									style={{ background: `linear-gradient(to right, ${rest} ${lo}%, var(--accent) ${lo}%, var(--accent) ${hi}%, ${rest} ${hi}%)` }}
								/>
							</label>
						);
					})}
					<button
						disabled={!adjusted}
						className={`self-end px-3 py-1 rounded-full text-xs font-semibold duration-150 enabled:cursor-pointer disabled:opacity-40 ${dark ? "bg-[#ffffff1f] enabled:hover:bg-[#ffffff33]" : "bg-[#00000012] enabled:hover:bg-[#00000022]"}`}
						onClick={() => {
							const { setEqBass, setEqMid, setEqTreble } = usePlaybackStore.getState();
							setEqBass(0);
							setEqMid(0);
							setEqTreble(0);
						}}
					>
						Reset
					</button>
				</div>
			)}
		</div>
	);
};

const LyricsPanel = ({ track }: { track: Track }) => {
	const currentTime = usePlaybackStore(state => state.currentTime);
	const duration = usePlaybackStore(state => state.duration);
	const [result, setResult] = useState<{ key: Track; lyrics: Lyrics | null } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const userScrollUntil = useRef(0);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		const onChange = (e: Event) => {
			if ((e as CustomEvent<{ folderName: string }>).detail?.folderName === track.folderName) setReloadKey(k => k + 1);
		};
		window.addEventListener(LYRICS_CHANGED_EVENT, onChange);
		return () => window.removeEventListener(LYRICS_CHANGED_EVENT, onChange);
	}, [track]);

	useEffect(() => {
		let cancelled = false;
		loadLyrics(track, duration || undefined).then(lyrics => {
			if (!cancelled) setResult({ key: track, lyrics });
		});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [track, reloadKey]);

	const lyrics = result?.key === track ? result.lyrics : undefined;
	const active = lyrics?.synced ? activeLineIndex(lyrics.lines, currentTime + 0.15) : -1;

	useEffect(() => {
		const container = containerRef.current;
		const line = lineRefs.current[Math.max(active, 0)];
		if (!container || !line || Date.now() < userScrollUntil.current) return;
		container.scrollTo({ top: line.offsetTop - container.clientHeight / 2 + line.offsetHeight / 2, behavior: document.hidden ? "instant" : "smooth" });
	}, [active, lyrics]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		// Fade an edge only when there are more lyrics past it; the fade grows with the hidden distance.
		// The top fade waits until the first line has scrolled out so it never dims the first line at rest.
		// Set as CSS variables so scrolling doesn't re-render every line.
		const updateFade = () => {
			const maxFade = container.clientHeight * 0.15;
			const firstLine = container.firstElementChild?.firstElementChild as HTMLElement | null | undefined;
			const firstLineBottom = firstLine ? firstLine.offsetTop + firstLine.offsetHeight : 0;
			const above = container.scrollTop - firstLineBottom;
			const below = container.scrollHeight - container.clientHeight - container.scrollTop;
			container.style.setProperty("--fade-top", `${Math.min(Math.max(above, 0), maxFade)}px`);
			container.style.setProperty("--fade-bottom", `${Math.min(Math.max(below, 0), maxFade)}px`);
		};
		updateFade();
		container.addEventListener("scroll", updateFade, { passive: true });
		const observer = new ResizeObserver(updateFade);
		observer.observe(container);
		if (container.firstElementChild) observer.observe(container.firstElementChild);
		return () => {
			container.removeEventListener("scroll", updateFade);
			observer.disconnect();
		};
	}, [lyrics]);

	if (lyrics === undefined) {
		return <div className="flex h-full items-center justify-center text-(--text-secondary) animate-pulse">Looking for lyrics…</div>;
	}

	if (lyrics === null) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-(--text-secondary)">
				<ChatBubbleBottomCenterTextIcon className="size-10 opacity-60" />
				<span className="text-lg font-semibold text-(--text-primary)">No lyrics found</span>
				<span className="text-sm max-w-72">
					Use <span className="font-semibold">Add Lyrics</span> in the library&apos;s track menu to add an LRC, SRT or TXT file.
				</span>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className="relative h-full overflow-y-auto p-6"
			style={{ maskImage: "linear-gradient(to bottom, transparent, black var(--fade-top, 0px), black calc(100% - var(--fade-bottom, 0px)), transparent)" }}
			onWheel={() => (userScrollUntil.current = Date.now() + 3000)}
			onTouchMove={() => (userScrollUntil.current = Date.now() + 3000)}
		>
			<div className="flex flex-col gap-3">
				{lyrics.lines.map((line, i) =>
					lyrics.synced ? (
						<button
							key={i}
							ref={el => {
								lineRefs.current[i] = el;
							}}
							className={`text-left text-xl @lg:text-2xl @4xl:text-3xl font-bold leading-snug origin-left cursor-pointer duration-300 ${line.breakBefore ? "mt-8" : ""} ${
								i === active ? "text-(--text-primary) scale-100" : i < active ? "text-(--text-tertiary) opacity-70 hover:opacity-100 scale-95" : "text-(--text-secondary) opacity-60 hover:opacity-100 scale-95"
							}`}
							onClick={() => {
								userScrollUntil.current = 0;
								seek(line.time ?? 0);
								void play();
							}}
						>
							{line.text || "♪"}
						</button>
					) : (
						<p key={i} className={`text-xl font-semibold leading-snug text-(--text-primary) ${line.breakBefore ? "mt-6" : ""}`}>
							{line.text}
						</p>
					),
				)}
			</div>
			<p className="mt-8 text-xs text-(--text-tertiary)">{LYRICS_SOURCE_LABELS[lyrics.source]}</p>
		</div>
	);
};

const songKey = (track: Track) => `${track.title}|${artistText(track)}|${track.albumId ?? ""}`;

/** The release year: from the file's tags for uploads, otherwise looked up from the album or single. */
const useReleaseYear = (track: Track | null) => {
	const raw = track?.year instanceof Date ? String(track.year.getFullYear()) : String(track?.year ?? "");
	const local = /^\d{4}/.test(raw) ? raw.slice(0, 4) : null;
	const key = track ? songKey(track) : "";
	const [fetched, setFetched] = useState<{ key: string; year: string | null } | null>(null);
	useEffect(() => {
		if (!track || local || !isLinkable(track)) return;
		let alive = true;
		getSongInfo(track.title, trackArtists(track)[0], track.albumId)
			.then(r => alive && setFetched({ key, year: r.releaseDate ? r.releaseDate.slice(0, 4) : null }))
			.catch(() => {});
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, local]);
	return local ?? (fetched?.key === key ? fetched.year : null);
};

/** Who wrote, produced, engineered and played on the song (MusicBrainz), shown beside the cover. */
const CreditsPanel = ({ track }: { track: Track }) => {
	const key = songKey(track);
	const [result, setResult] = useState<{ key: string; data: SongCredits | null } | null>(null);
	useEffect(() => {
		let alive = true;
		getSongCredits(track.title, trackArtists(track)[0])
			.then(data => alive && setResult({ key, data }))
			.catch(() => alive && setResult({ key, data: null }));
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);

	const loading = result?.key !== key;
	const data = loading ? null : result.data;
	const found = !!data?.sections.length;
	// Without catalogued credits, still show who performs it.
	const sections = found ? data!.sections : [{ title: "Performed by", credits: trackArtists(track).map(name => ({ name, roles: [] as string[] })) }];
	const linkable = isLinkable(track);

	return (
		<div className="flex h-full flex-col gap-5 overflow-y-auto px-5 pt-5 pb-14 @lg:px-6 text-base @lg:text-lg font-semibold leading-snug" style={{ maskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)" }}>
			<h2 className="-mb-4 text-(--text-primary)">Credits</h2>
			{loading ? (
				<div className="flex flex-col gap-5">
					{[0, 1, 2].map(i => (
						<div key={i} className="flex flex-col gap-2">
							<div className="h-4 w-28 rounded bg-[#ffffff26] animate-pulse" />
							<div className="h-4 w-64 max-w-full rounded bg-[#ffffff1c] animate-pulse" />
							<div className="h-4 w-48 max-w-full rounded bg-[#ffffff14] animate-pulse" />
						</div>
					))}
				</div>
			) : (
				<>
					{sections.map(section => (
						<section key={section.title} className="flex flex-col">
							<h3 className="text-(--text-primary)">
								{section.title} <span className="text-(--text-secondary)">({section.credits.length})</span>
							</h3>
							{section.credits.map(c => (
								<p key={c.name} className="text-(--text-secondary)">
									{linkable ? (
										<button className="text-left hover:underline hover:text-(--text-primary) cursor-pointer" title={`Go to ${c.name}`} onClick={() => (section.title === "Performed by" && trackArtists(track).includes(c.name) ? openTrackArtist(track, c.name) : openArtistByName(c.name))}>
											{c.name}
										</button>
									) : (
										<span>{c.name}</span>
									)}
									{c.roles.length > 0 && <span className="text-(--text-tertiary)"> · {c.roles.join(", ")}</span>}
								</p>
							))}
						</section>
					))}
					{!found && <p className="text-sm text-(--text-tertiary)">No detailed credits for this song yet.</p>}
					{data?.url && (
						<button className="w-max text-xs text-(--text-tertiary) hover:text-(--text-secondary) hover:underline cursor-pointer" onClick={() => useTabsStore.getState().newTab({ id: crypto.randomUUID(), url: data.url!, displayUrl: data.url!, title: "MusicBrainz", icon: null, current: true })}>
							Source: MusicBrainz
						</button>
					)}
				</>
			)}
		</div>
	);
};

const QueuePanel = () => {
	const queue = useMusicStore(state => state.queue);
	const setCurrentTrack = useMusicStore(state => state.setCurrentTrack);
	const removeTrack = useMusicStore(state => state.removeTrack);

	if (queue.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 text-(--text-secondary)">
				<QueueListIcon className="size-10 opacity-60" />
				<span className="text-lg font-semibold text-(--text-primary)">Queue is empty</span>
				<RadioStatus className="mt-2" />
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col gap-1 overflow-y-auto p-4">
			<RadioStatus className="mb-2" />
			<div className="flex items-center justify-between gap-2 px-2 pb-2">
				<h2 className="text-lg font-semibold">Up next</h2>
				<button className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) bg-[#ffffff18] hover:bg-[#ffffff28] cursor-pointer duration-150" title={`Remove all ${queue.length} songs from the queue`} onClick={clearQueue}>
					Clear queue
				</button>
			</div>
			{queue.map(song => (
				<div
					key={song.id}
					className="group flex items-center justify-between gap-3 rounded-lg p-2 hover:bg-[#ffffff18] cursor-pointer duration-150"
					onClick={() => {
						setCurrentTrack(song);
						removeTrack(song.id);
					}}
				>
					<div className="flex min-w-0 items-center gap-3">
						<Cover track={song} className="size-12 shrink-0 rounded-md" />
						<div className="flex min-w-0 flex-col gap-1">
							<span className="truncate font-semibold leading-none">{song.title}</span>
							<span className="truncate text-sm leading-none text-(--text-secondary)">
								{artistText(song)}
								<PlayCount title={song.title} artist={song.artists} skeleton={false} prefix=" · " className="text-(--text-tertiary)" />
							</span>
						</div>
					</div>
					<button
						title="Remove from queue"
						className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-[#ffffff18] text-(--text-secondary) hover:text-(--text-primary) duration-150"
						onClick={e => {
							e.stopPropagation();
							removeTrack(song.id);
						}}
					>
						<BackspaceIcon className="size-5" />
					</button>
				</div>
			))}
		</div>
	);
};

const YT_ORIGIN = "https://www.youtube-nocookie.com";
/** Music videos that wouldn't play here (embedding disabled, removed): their songs fall back to the cover. */
const unplayableVideos = new Set<string>();

/** The song's music video, once looked up. `videoId` is null when it has none, or it can't play here. */
const useMusicVideo = (track: Track | null) => {
	const key = track ? songKey(track) : "";
	const [found, setFound] = useState<{ key: string; videoId: string | null; seconds: number | null } | null>(null);
	const [, setUnplayableCount] = useState(0);
	useEffect(() => {
		if (!track) return;
		let alive = true;
		getMusicVideo(track.title, trackArtists(track)[0]).then(r => alive && setFound({ key, ...r }));
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);
	const result = found?.key === key ? found : null;
	return {
		loading: !!track && !result,
		videoId: result?.videoId && !unplayableVideos.has(result.videoId) ? result.videoId : null,
		seconds: result?.seconds ?? null,
		markUnplayable: (videoId: string) => {
			unplayableVideos.add(videoId);
			setUnplayableCount(n => n + 1);
		},
	};
};

type YouTubeInfo = { currentTime?: number; duration?: number; playerState?: number };

/**
 * The song's music video: a YouTube embed driven over its postMessage API. A cut the same length as the
 * song plays muted, in step with it. A different cut (intro, skit, outro) plays its own audio and takes
 * over the transport; when Video mode closes, the song carries on from the matching point.
 */
const MusicVideo = ({ track, videoId, seconds, onUnplayable, className }: { track: Track; videoId: string; seconds: number | null; onUnplayable: () => void; className?: string }) => {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const [started, setStarted] = useState(false);
	const onUnplayableRef = useRef(onUnplayable);
	const trackId = track.id;

	useEffect(() => {
		onUnplayableRef.current = onUnplayable;
	});

	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		const audio = getAudio();
		const store = usePlaybackStore;
		const send = (func: string, ...args: unknown[]) => frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), YT_ORIGIN);
		const songLength = () => (audio && Number.isFinite(audio.duration) ? audio.duration : 0);
		const isOn = (state: number) => state === 1 || state === 3; // playing or buffering

		let role: "follow" | "own" | null = null;
		let ready = false;
		let state = -1;
		let time = 0;
		let timeAt = 0;
		let length = seconds ?? 0;
		let lastSeek = -Infinity;
		let lastToggle = -Infinity;
		let seekedAt = 0;
		// How far ahead to seek so the video lands in step once it has buffered (learned from each seek).
		let lead = 1;
		let rate = 1;

		const setRate = (next: number) => {
			if (next === rate) return;
			rate = next;
			send("setPlaybackRate", next);
		};

		// Same cut as the song: keep to its position and play state. Small drift is evened out by
		// speeding the (muted) video up or down; seeking makes it buffer, so that's left for big jumps.
		const follow = (jumped = false) => {
			if (role !== "follow" || !audio) return;
			const now = performance.now();
			const playing = state === 1;
			const at = playing ? time + ((now - timeAt) / 1000) * rate : time;
			const drift = at - audio.currentTime;
			if (jumped || (Math.abs(drift) > 3 && now - lastSeek > 4000)) {
				lastSeek = seekedAt = now;
				time = Math.max(0, audio.currentTime + (audio.paused ? 0 : lead));
				timeAt = now;
				setRate(1);
				send("seekTo", time, true);
			} else if (playing && !audio.paused) setRate(drift < -0.25 ? 1.25 : drift > 0.25 ? 0.75 : 1);
			// Re-sent until the video reports the change, in case a state message went missing.
			const wantOn = !audio.paused;
			if (wantOn !== isOn(state) && now - lastToggle > 1500) {
				lastToggle = now;
				send(wantOn ? "playVideo" : "pauseVideo");
			}
		};

		const applyVolume = () => {
			const { volume, muted } = store.getState();
			if (muted) return send("mute");
			send("unMute");
			send("setVolume", Math.round(volume * 100));
		};

		const owner: PlaybackOwner = {
			play: () => send("playVideo"),
			pause: () => send("pauseVideo"),
			seek: to => {
				time = length ? Math.min(to, length) : to;
				send("seekTo", time, true);
				store.getState().setCurrentTime(time);
			},
			time: () => time,
			paused: () => !isOn(state),
		};

		// A different cut: its own audio plays the song from here, starting at the same point.
		const takeOver = () => {
			const wasPlaying = !!audio && !audio.paused;
			time = audio && songLength() ? (audio.currentTime / songLength()) * length : 0;
			audio?.pause();
			setPlaybackOwner(owner);
			applyVolume();
			send("seekTo", time, true);
			store.setState({ duration: length, currentTime: time });
			if (wasPlaying) send("playVideo");
		};

		const decide = () => {
			if (role || !ready || !length) return;
			const failed = store.getState().failedTrackId === trackId;
			if (!songLength() && !failed) return;
			role = !failed && Math.abs(length - songLength()) <= 3 ? "follow" : "own";
			if (role === "own") takeOver();
			else follow(true);
		};

		const onState = (value: number) => {
			if (value === state) return;
			if (value === 1 && seekedAt) {
				lead = Math.min(3, Math.max(0.3, (performance.now() - seekedAt) / 1000));
				seekedAt = 0;
			}
			state = value;
			lastToggle = -Infinity;
			if (isOn(value)) setStarted(true);
			if (role !== "own") return;
			if (value === 0) {
				if (!store.getState().loop) return next();
				owner.seek(0);
				owner.play();
			} else if (value === 1 || value === 2) store.getState().setIsPlaying(value === 1);
		};

		const onMessage = (e: MessageEvent) => {
			if (e.source !== frame.contentWindow || e.origin !== YT_ORIGIN) return;
			let data: { event?: string; info?: unknown };
			try {
				data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
			} catch {
				return;
			}
			if (!ready) {
				ready = true;
				window.clearInterval(greeting);
				// Like YouTube's own API: state changes and errors are only reported once asked for.
				send("addEventListener", "onStateChange");
				send("addEventListener", "onError");
			}
			if (data.event === "onError") return onUnplayableRef.current();
			if (data.event === "onStateChange" && typeof data.info === "number") onState(data.info);
			if ((data.event === "infoDelivery" || data.event === "initialDelivery") && data.info && typeof data.info === "object") {
				const info = data.info as YouTubeInfo;
				if (typeof info.duration === "number" && info.duration > 0) {
					length = info.duration;
					if (role === "own" && store.getState().duration !== length) store.getState().setDuration(length);
				}
				if (typeof info.currentTime === "number") {
					time = info.currentTime;
					timeAt = performance.now();
					if (role === "own") store.getState().setCurrentTime(time);
				}
				if (typeof info.playerState === "number") onState(info.playerState);
			}
			decide();
			follow();
		};

		// The embed only reports to a page that says it's listening; repeat until it answers.
		let greeting = 0;
		const greet = () => frame.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT_ORIGIN);
		const onLoad = () => {
			window.clearInterval(greeting);
			greet();
			greeting = window.setInterval(greet, 250);
		};
		// Something started the song itself (a retry, media keys): the video still has the floor.
		const onSongPlay = () => {
			if (role !== "own") return follow();
			audio?.pause();
			owner.play();
		};
		const onSongSeeked = () => follow(true);
		const onSongPause = () => follow();
		// The embed goes quiet while paused: keep checking the two stay together.
		const watch = window.setInterval(follow, 500);
		frame.addEventListener("load", onLoad);
		window.addEventListener("message", onMessage);
		audio?.addEventListener("play", onSongPlay);
		audio?.addEventListener("pause", onSongPause);
		audio?.addEventListener("seeked", onSongSeeked);
		audio?.addEventListener("loadedmetadata", decide);
		const unsubscribe = store.subscribe((now, before) => {
			if (role === "own" && (now.volume !== before.volume || now.muted !== before.muted)) applyVolume();
		});

		return () => {
			window.clearInterval(greeting);
			window.clearInterval(watch);
			frame.removeEventListener("load", onLoad);
			window.removeEventListener("message", onMessage);
			audio?.removeEventListener("play", onSongPlay);
			audio?.removeEventListener("pause", onSongPause);
			audio?.removeEventListener("seeked", onSongSeeked);
			audio?.removeEventListener("loadedmetadata", decide);
			unsubscribe();
			if (role !== "own") return;
			setPlaybackOwner(null);
			// On to another song: it starts by itself.
			if (!audio || useMusicStore.getState().currentTrack?.id !== trackId) return;
			const total = songLength();
			if (total && length) audio.currentTime = Math.max(0, Math.min((time / length) * total, total - 1));
			store.setState({ duration: total || store.getState().duration, currentTime: audio.currentTime });
			if (isOn(state)) void play();
		};
	}, [trackId, videoId, seconds]);

	const params = new URLSearchParams({ enablejsapi: "1", origin: location.origin, controls: "0", disablekb: "1", fs: "0", iv_load_policy: "3", playsinline: "1", rel: "0", mute: "1" });
	return (
		<div data-np="cover" className={`relative overflow-hidden rounded-3xl bg-black shadow-[0_10px_40px_0px_#00000090] ${className ?? ""}`}>
			<iframe
				ref={frameRef}
				src={`${YT_ORIGIN}/embed/${videoId}?${params}`}
				title={`${track.title} music video`}
				allow="autoplay; encrypted-media; picture-in-picture"
				// YouTube refuses to play embeds that send no referrer.
				referrerPolicy="strict-origin-when-cross-origin"
				tabIndex={-1}
				className="absolute inset-0 size-full pointer-events-none"
			/>
			<VideoPoster track={track} className={`duration-700 ${started ? "opacity-0" : "opacity-100"}`} />
		</div>
	);
};

/** Shown over the video until it starts (and while the lookup runs): the blurred cover with a spinner. */
const VideoPoster = ({ track, className }: { track: Track; className?: string }) => (
	<div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${className ?? ""}`}>
		{track.cover && <img src={track.cover} alt="" className="absolute inset-0 size-full object-cover scale-110 blur-2xl opacity-80" />}
		<div className="relative size-9 rounded-full border-3 border-[#ffffff40] border-t-white animate-spin" />
	</div>
);

/** The Now Playing tab's icon: the song's cover. */
export const NowPlayingTabIcon = ({ cover }: { cover: string }) => <img src={cover} alt="" className="size-5 shrink-0 rounded object-cover" />;

export const MusicPlayer = ({ query, className, onClose }: MusicPlayerProps) => {
	const settings = useSettingsStore(state => state.settings);
	const currentTrack = useMusicStore(state => state.currentTrack);
	const isPlaying = usePlaybackStore(state => state.isPlaying);
	const loop = usePlaybackStore(state => state.loop);
	const analyser = usePlaybackStore(state => state.analyser);
	const dark = settings.brightness !== "light";
	const releaseYear = useReleaseYear(currentTrack);
	const failed = usePlaybackStore(state => !!currentTrack && state.failedTrackId === currentTrack.id);
	const video = useMusicVideo(currentTrack);

	const [mode, setMode] = useState<PlayerMode>(parsePlayerMode(query));
	const rootRef = useRef<HTMLDivElement>(null);
	const transitionId = useRef(0);
	const [lastQuery, setLastQuery] = useState(query);
	if (query !== lastQuery) {
		setLastQuery(query);
		setMode(parsePlayerMode(query));
	}

	const changeMode = (nextMode: PlayerMode) => {
		const target = nextMode === mode ? "cover" : nextMode;
		const apply = () => {
			setMode(target);
			const { tabs, updateTab } = useTabsStore.getState();
			const tab = tabs.find(t => t.current);
			if (tab) updateTab(tab.id, { url: playerUrl(target), displayUrl: playerUrl(target) });
		};
		const root = rootRef.current;
		if (!root || target === mode || !document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
		// The transition names live behind .np-vt (see index.css) so only this player animates, even with others mounted.
		const id = ++transitionId.current;
		root.classList.add("np-vt");
		const transition = document.startViewTransition(() => flushSync(apply));
		// Skipped transitions (another view switch, a hidden tab) reject these; the view still changes.
		transition.ready.catch(() => {});
		transition.finished.finally(() => {
			if (transitionId.current === id) root.classList.remove("np-vt");
		});
	};

	// The Now Playing tab shows the song: its title and cover.
	useEffect(() => {
		const { tabs, updateTab } = useTabsStore.getState();
		const icon = currentTrack?.cover ? <NowPlayingTabIcon cover={currentTrack.cover} /> : <MusicalNoteIcon className="size-5" />;
		for (const tab of tabs) if (isPlayerUrl(tab.url)) updateTab(tab.id, { title: nowPlayingTitle(), icon });
	}, [currentTrack?.title, currentTrack?.cover]);

	const closePlayer = () => {
		if (onClose) return onClose();
		const { tabs, closeTab } = useTabsStore.getState();
		const tab = tabs.find(t => t.current);
		if (tab) closeTab(tab.id);
	};

	const showVisualizer = settings["big-player-visualizer"] === true && settings["disable-visualizers"] !== true;
	// Video mode shows the cover for songs without a music video.
	const shown: PlayerMode = mode === "video" && !video.videoId && !video.loading ? "cover" : mode;
	const sidePanel = shown !== "cover" && shown !== "video";
	const glass = dark ? "bg-[#ffffff1f] backdrop-blur-xl" : "bg-[#0000000f] backdrop-blur-xl";
	const iconButton = "flex items-center justify-center p-2 rounded-full text-(--text-primary) opacity-85 hover:opacity-100 hover:bg-[#ffffff15] cursor-pointer duration-150";
	const transportButton = "flex items-center justify-center text-(--accent) drop-shadow-[0_2px_10px_#00000040] cursor-pointer hover:scale-110 active:scale-95 duration-150";
	const segment = (on: boolean) =>
		`flex items-center justify-center size-9 @lg:size-10 rounded-full cursor-pointer duration-150 disabled:opacity-35 disabled:cursor-default ${
			on ? `text-(--text-primary) ${dark ? "bg-[#ffffff2b] shadow-[inset_0_0_0_1px_#ffffff4d,0_2px_8px_#00000030]" : "bg-[#ffffffb0] shadow-[inset_0_0_0_1px_#00000014,0_2px_8px_#00000018]"}` : "text-(--text-secondary) enabled:hover:text-(--text-primary)"
		}`;
	const roundButton = `flex items-center justify-center size-9 rounded-full text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-150 ${glass}`;
	const linkable = isLinkable(currentTrack);
	const openLibrary = () => (onClose ? onClose() : void import("../../libs/aboutPages").then(m => m.openLibraryPage("")));

	const trackInfo = (track: Track, align: "center" | "left") => {
		const album = track.album && !/^unknown/i.test(track.album) ? cleanAlbumTitle(track.album) : null;
		return (
			<div data-np="info" className={`flex w-fit max-w-full min-w-0 flex-col ${align === "center" ? "mx-auto items-center text-center" : "items-start text-left"}`}>
				<h1 className={`max-w-full text-3xl @lg:text-4xl font-bold leading-tight line-clamp-2 ${linkable ? "cursor-pointer hover:underline" : ""}`} title={linkable ? `Go to ${track.album || "album"}` : track.title} onClick={linkable ? () => openTrackAlbum(track) : undefined}>
					{track.title}
				</h1>
				<h2 className="max-w-full truncate text-lg @lg:text-xl font-semibold leading-snug text-(--text-secondary)">
					{trackArtists(track).map((name, i, all) => (
						<span key={`${name}-${i}`}>
							<span className={linkable ? "cursor-pointer hover:underline hover:text-(--text-primary)" : ""} onClick={linkable ? () => openTrackArtist(track, name) : undefined}>
								{name}
							</span>
							{i < all.length - 1 && ", "}
						</span>
					))}
				</h2>
				{(album || releaseYear) && (
					<span className="max-w-full truncate text-base @lg:text-lg font-medium leading-snug text-(--text-tertiary)">
						{album && (
							<span className={linkable ? "cursor-pointer hover:underline hover:text-(--text-secondary)" : ""} onClick={linkable ? () => openTrackAlbum(track) : undefined}>
								{album}
							</span>
						)}
						{album && releaseYear && " · "}
						{releaseYear}
					</span>
				)}
				<div className="mt-1 flex flex-wrap items-center gap-2">
					{failed ? <span className="text-sm @lg:text-base font-semibold text-[#ff6b6b]">Couldn't play this song</span> : <PlayCount title={track.title} artist={track.artists} skeleton={false} className="text-sm @lg:text-base font-semibold text-(--text-primary)" />}
					<button
						className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold cursor-pointer duration-150 ${mode === "credits" ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-[#ffffff33] hover:bg-[#ffffff4d]" : "bg-[#00000014] hover:bg-[#00000024]"}`}
						title={mode === "credits" ? "Hide credits" : "Show song credits"}
						onClick={() => changeMode("credits")}
					>
						<UserGroupIcon className="size-4" />
						Credits
					</button>
				</div>
			</div>
		);
	};

	return (
		<div ref={rootRef} className={`${className ?? ""} @container overflow-hidden`}>
			{currentTrack?.cover && <img src={currentTrack.cover} alt="" aria-hidden className="absolute inset-0 size-full object-cover scale-125 blur-3xl opacity-50 saturate-150 pointer-events-none" />}
			<div className={`absolute inset-0 pointer-events-none ${dark ? "bg-[#00000060]" : "bg-[#ffffff60]"}`} />

			<div className="relative flex h-full w-full flex-col">
				<div className="flex items-center gap-3 px-3 pt-3 pb-2 @lg:px-6 @lg:pt-4">
					<button title="Browse music" className="shrink-0 p-1 rounded-xl text-(--accent) drop-shadow-[0_2px_8px_#00000050] cursor-pointer hover:scale-105 active:scale-95 duration-150" onClick={openLibrary}>
						<MusicalNoteIcon className="size-8 @lg:size-9" />
					</button>
					<nav className="hidden @3xl:flex min-w-0 items-center gap-1" aria-label="Artist">
						{["Merch", "Playlists", "Videos", "Tours"].map(label => (
							<button key={label} aria-disabled title={`${label} — coming soon`} className="shrink-0 px-2 py-1 rounded-lg text-lg @4xl:text-xl font-semibold text-(--text-primary) opacity-85 cursor-default">
								{label}
							</button>
						))}
					</nav>
					<div className="ml-auto flex shrink-0 items-center gap-2 @lg:gap-3">
						<div className={`flex items-center gap-0.5 p-1 rounded-full ${glass}`} role="group" aria-label="Player view">
							<button title={video.videoId ? "Music video" : video.loading ? "Looking for a music video…" : "No music video for this song"} aria-pressed={shown === "video"} disabled={!video.videoId && shown !== "video"} className={segment(shown === "video")} onClick={() => changeMode("video")}>
								<FilmIcon className="size-5" />
							</button>
							<button title="Cover only" aria-pressed={shown === "cover"} className={segment(shown === "cover")} onClick={() => changeMode("cover")}>
								<PhotoIcon className="size-5" />
							</button>
							<button title="Queue" aria-pressed={shown === "queue"} className={segment(shown === "queue")} onClick={() => changeMode("queue")}>
								<QueueListIcon className="size-5" />
							</button>
							<button title="Lyrics" aria-pressed={shown === "lyrics"} className={segment(shown === "lyrics")} onClick={() => changeMode("lyrics")}>
								<ChatBubbleBottomCenterTextIcon className="size-5" />
							</button>
						</div>
						<EqControl dark={dark} buttonClassName={roundButton} />
						<button title={onClose ? "Back to browsing (side panel player)" : "Close player (back to side panel)"} className={roundButton} onClick={closePlayer}>
							<ArrowsPointingInIcon className="size-5" />
						</button>
					</div>
				</div>

				{!currentTrack ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-4 text-(--text-secondary)">
						<MusicalNoteIcon className="size-16 opacity-60" />
						<span className="text-2xl font-bold text-(--text-primary)">Nothing playing</span>
						<button className="flex items-center gap-2 px-4 py-2 rounded-md bg-(--tertiary) text-(--text-primary) hover:bg-(--accent) duration-150" onClick={openLibrary}>
							Browse music
							<MusicalNoteIcon className="size-4" />
						</button>
					</div>
				) : (
					<>
						{sidePanel ? (
							<div className="flex flex-1 min-h-0 flex-col @3xl:flex-row gap-4 @3xl:gap-8 overflow-y-auto px-4 @lg:px-8 @3xl:px-12 pt-2 @3xl:pt-4">
								<div className="flex shrink-0 items-center gap-4 @3xl:min-h-0 @3xl:w-[min(34%,22rem)] @3xl:flex-col @3xl:items-stretch @3xl:gap-5">
									{/* Sized to the free space (container query units) so the cover stays square and the info below always fits. */}
									<div className="@container-size relative shrink-0 size-24 @lg:size-28 @3xl:h-auto @3xl:w-full @3xl:flex-1 @3xl:min-h-24 @3xl:max-h-[min(calc(0.34*(100cqw_-_6rem)),22rem)]">
										<Cover track={currentTrack} vt="cover" className={`size-[min(100cqw,100cqh)] rounded-xl @3xl:rounded-3xl shadow-[0_10px_40px_0px_#00000090] duration-300 ${isPlaying ? "scale-100" : "scale-95"}`} />
										{showVisualizer && (
											<div className="hidden @3xl:block absolute top-[calc(min(100cqw,100cqh)-3.5rem)] left-[min(50cqw,50cqh)] -translate-x-1/2 pointer-events-none drop-shadow-xl">
												<AudvisVisualizer analyser={analyser} isPlaying={isPlaying} width={180} height={36} color={dark ? "#FFFFFF" : "#000000"} opacity={0.85} />
											</div>
										)}
									</div>
									{trackInfo(currentTrack, "left")}
								</div>
								<div data-np="panel" className={`flex-1 min-h-72 @3xl:min-h-0 rounded-3xl border ${dark ? "border-[#ffffff40] bg-[#ffffff12]" : "border-[#00000020] bg-[#ffffff40]"} backdrop-blur-sm overflow-hidden`}>
									{mode === "lyrics" ? <LyricsPanel track={currentTrack} /> : mode === "credits" ? <CreditsPanel track={currentTrack} /> : <QueuePanel />}
								</div>
							</div>
						) : (
							<div className="flex flex-1 min-h-0 flex-col items-center justify-center-safe gap-4 @lg:gap-5 overflow-y-auto px-4 @lg:px-8 pt-4">
								{/* The cover (or video) shrinks with the free height so the info and controls always fit. */}
								<div className="@container-size relative flex w-full flex-1 min-h-40 max-h-[30rem] items-end justify-center">
									{shown === "video" ? (
										video.videoId ? (
											<MusicVideo key={`${currentTrack.id}:${video.videoId}`} track={currentTrack} videoId={video.videoId} seconds={video.seconds} onUnplayable={() => video.videoId && video.markUnplayable(video.videoId)} className="aspect-video w-[min(100cqw,calc(100cqh*16/9))]" />
										) : (
											<div data-np="cover" className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden rounded-3xl bg-black shadow-[0_10px_40px_0px_#00000090]">
												<VideoPoster track={currentTrack} />
											</div>
										)
									) : (
										<Cover track={currentTrack} vt="cover" className={`size-[min(85cqw,100cqh)] rounded-3xl shadow-[0_10px_40px_0px_#00000090] duration-300 ${isPlaying ? "scale-100" : "scale-95"}`} />
									)}
									{showVisualizer && shown !== "video" && (
										<div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none drop-shadow-xl">
											<AudvisVisualizer analyser={analyser} isPlaying={isPlaying} width={220} height={40} color={dark ? "#FFFFFF" : "#000000"} opacity={0.85} />
										</div>
									)}
								</div>
								<div className="w-full max-w-2xl">{trackInfo(currentTrack, "center")}</div>
							</div>
						)}

						<div className={`flex shrink-0 flex-col gap-2 @lg:gap-3 px-4 @lg:px-8 @3xl:px-12 pt-4 ${onClose ? "pb-4" : "pb-5 @lg:pb-7"}`}>
							<div className={`mx-auto flex w-full flex-col gap-2 @lg:gap-3 ${sidePanel ? "" : "max-w-4xl"}`}>
								<SeekBar dark={dark} />
								<div className="flex w-full items-center">
									<div className="flex flex-1 basis-0 justify-start">
										<button title={loop ? "Repeat: on" : "Repeat: off"} aria-pressed={loop} className={`${iconButton} ${loop ? "text-(--accent)! opacity-100 bg-[#ffffff1a]" : ""}`} onClick={toggleLoop}>
											<ArrowPathRoundedSquareIcon className="size-7" />
										</button>
									</div>
									<div className="flex shrink-0 items-center gap-5 @lg:gap-7">
										<button title="Previous" className={transportButton} onClick={previous}>
											<BackwardIcon className="size-9 @lg:size-10" />
										</button>
										<button title={isPlaying ? "Pause" : "Play"} className={transportButton} onClick={() => void togglePlay()}>
											{isPlaying ? <PauseIcon className="size-11 @lg:size-13 overflow-visible stroke-current stroke-2 [stroke-linejoin:round] [&_path]:[vector-effect:non-scaling-stroke]" /> : <PlayIcon className="size-11 @lg:size-13 translate-x-0.5" />}
										</button>
										<button title="Next" className={transportButton} onClick={next}>
											<ForwardIcon className="size-9 @lg:size-10" />
										</button>
									</div>
									<div className="flex flex-1 basis-0 justify-end">
										<VolumeControl dark={dark} buttonClassName={iconButton} />
									</div>
								</div>
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
};
