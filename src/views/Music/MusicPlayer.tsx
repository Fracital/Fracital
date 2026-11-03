import { useEffect, useRef, useState } from "react";
import { createId } from "@paralleldrive/cuid2";
import { ArrowPathRoundedSquareIcon, ArrowsPointingInIcon, BackspaceIcon, BackwardIcon, ChatBubbleBottomCenterTextIcon, ForwardIcon, MusicalNoteIcon, PauseIcon, PhotoIcon, PlayIcon, QueueListIcon, SpeakerWaveIcon, SpeakerXMarkIcon } from "@heroicons/react/24/solid";
import { useMusicStore, usePlaybackStore, useSettingsStore, useTabsStore } from "../../store";
import type { Track } from "../../types";
import { AudvisVisualizer } from "../../components/AudvisVisualizer";
import { formatTime, next, parsePlayerMode, play, playerUrl, previous, seek, setVolume, toggleLoop, toggleMute, togglePlay, type PlayerMode } from "../../libs/playback";
import { LYRICS_CHANGED_EVENT, LYRICS_SOURCE_LABELS, loadLyrics, type Lyrics } from "../../libs/lyrics";
import { activeLineIndex } from "../../libs/lrc";
import { PlayCount } from "../../components/PlayCount";

interface MusicPlayerProps {
	query?: string;
	className?: string;
}

const artistText = (track: Track | null) => (track ? (Array.isArray(track.artists) ? track.artists.join(", ") : track.artists) : "");

const Cover = ({ track, className }: { track: Track | null; className?: string }) =>
	track?.cover ? (
		<img src={track.cover} alt={track.title} className={`aspect-square object-cover ${className ?? ""}`} />
	) : (
		<div className={`aspect-square flex justify-center items-center bg-(--primary) text-(--text-secondary) inset-shadow-(--inset-shadow-primary) ${className ?? ""}`}>
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
		<div className="flex w-full items-center gap-3 select-none">
			<span className="w-12 text-right text-sm font-medium tabular-nums text-(--text-secondary)">{formatTime(shown)}</span>
			<div
				ref={barRef}
				className="group relative flex-1 h-2 rounded-full overflow-hidden bg-(--text-tertiary) cursor-pointer"
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
				<div style={{ width: `${percent}%` }} className={`h-full rounded-full ${dark ? "bg-white" : "bg-black"}`} />
				<div style={{ left: `${percent}%` }} className={`absolute top-1/2 size-3.5 -translate-1/2 rounded-full shadow opacity-0 group-hover:opacity-100 duration-150 ${dark ? "bg-white" : "bg-black"} ${dragTime !== null ? "opacity-100" : ""}`} />
			</div>
			<span className="w-12 text-sm font-medium tabular-nums text-(--text-secondary)">{formatTime(duration)}</span>
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
				{muted || volume === 0 ? <SpeakerXMarkIcon className="size-6" /> : <SpeakerWaveIcon className="size-6" />}
			</button>
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
							className={`text-left text-2xl lg:text-3xl font-bold leading-snug origin-left cursor-pointer duration-300 ${line.breakBefore ? "mt-8" : ""} ${
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

const QueuePanel = () => {
	const queue = useMusicStore(state => state.queue);
	const setCurrentTrack = useMusicStore(state => state.setCurrentTrack);
	const removeTrack = useMusicStore(state => state.removeTrack);

	if (queue.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 text-(--text-secondary)">
				<QueueListIcon className="size-10 opacity-60" />
				<span className="text-lg font-semibold text-(--text-primary)">Queue is empty</span>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col gap-1 overflow-y-auto p-4">
			<h2 className="px-2 pb-2 text-2xl font-bold">Up next</h2>
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

export const MusicPlayer = ({ query, className }: MusicPlayerProps) => {
	const settings = useSettingsStore(state => state.settings);
	const currentTrack = useMusicStore(state => state.currentTrack);
	const isPlaying = usePlaybackStore(state => state.isPlaying);
	const loop = usePlaybackStore(state => state.loop);
	const analyser = usePlaybackStore(state => state.analyser);
	const dark = settings.brightness !== "light";

	const [mode, setMode] = useState<PlayerMode>(parsePlayerMode(query));
	const [lastQuery, setLastQuery] = useState(query);
	if (query !== lastQuery) {
		setLastQuery(query);
		setMode(parsePlayerMode(query));
	}

	const changeMode = (nextMode: PlayerMode) => {
		const target = nextMode === mode ? "cover" : nextMode;
		setMode(target);
		const { tabs, updateTab } = useTabsStore.getState();
		const tab = tabs.find(t => t.current);
		if (tab) updateTab(tab.id, { url: playerUrl(target), displayUrl: playerUrl(target) });
	};

	const closePlayer = () => {
		const { tabs, closeTab } = useTabsStore.getState();
		const tab = tabs.find(t => t.current);
		if (tab) closeTab(tab.id);
	};

	const showVisualizer = settings["big-player-visualizer"] === true && settings["disable-visualizers"] !== true;
	const sidePanel = mode !== "cover";
	const iconButton = "flex items-center justify-center p-2.5 rounded-full text-(--text-secondary) hover:text-(--text-primary) hover:bg-[#ffffff15] cursor-pointer duration-150";
	const toggledButton = (on: boolean) => `${iconButton} ${on ? "text-(--text-primary) bg-[#ffffff20]" : ""}`;

	return (
		<div className={`${className ?? ""} overflow-hidden`}>
			{currentTrack?.cover && <img src={currentTrack.cover} alt="" aria-hidden className="absolute inset-0 size-full object-cover scale-125 blur-3xl opacity-50 saturate-150 pointer-events-none" />}
			<div className={`absolute inset-0 pointer-events-none ${dark ? "bg-[#00000060]" : "bg-[#ffffff60]"}`} />

			<div className="relative flex h-full w-full flex-col">
				<div className="flex items-center justify-end gap-1 p-3">
					<button title="Queue" className={toggledButton(mode === "queue")} onClick={() => changeMode("queue")}>
						<QueueListIcon className="size-5" />
					</button>
					<button title="Lyrics" className={toggledButton(mode === "lyrics")} onClick={() => changeMode("lyrics")}>
						<ChatBubbleBottomCenterTextIcon className="size-5" />
					</button>
					<button title="Cover only" className={toggledButton(mode === "cover")} onClick={() => changeMode("cover")}>
						<PhotoIcon className="size-5" />
					</button>
					<button title="Close player (back to side panel)" className={iconButton} onClick={closePlayer}>
						<ArrowsPointingInIcon className="size-5" />
					</button>
				</div>

				{!currentTrack ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-4 text-(--text-secondary)">
						<MusicalNoteIcon className="size-16 opacity-60" />
						<span className="text-2xl font-bold text-(--text-primary)">Nothing playing</span>
						<button
							className="flex items-center gap-2 px-4 py-2 rounded-md bg-(--tertiary) text-(--text-primary) hover:bg-(--accent) duration-150"
							onClick={() =>
								useTabsStore.getState().newTab({
									id: createId(),
									title: "Music Library",
									icon: <MusicalNoteIcon className="size-5" />,
									url: "about:music",
									displayUrl: "about:music",
								})
							}
						>
							Open Library
							<MusicalNoteIcon className="size-4" />
						</button>
					</div>
				) : (
					<div className={`flex flex-1 min-h-0 gap-8 px-8 pb-8 ${sidePanel ? "flex-col md:flex-row" : "flex-col"}`}>
						<div className={`flex min-h-0 flex-col items-center justify-center gap-6 ${sidePanel ? "md:w-[42%] shrink-0" : "flex-1"}`}>
							<div className="relative w-full flex justify-center items-center">
								<Cover track={currentTrack} className={`rounded-2xl shadow-[0_10px_40px_0px_#00000090] duration-300 ${isPlaying ? "scale-100" : "scale-95"} ${sidePanel ? "w-full max-w-[min(100%,48vh)]" : "w-[min(70%,56vh)]"}`} />
								{showVisualizer && (
									<div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none drop-shadow-xl">
										<AudvisVisualizer analyser={analyser} isPlaying={isPlaying} width={220} height={40} color={dark ? "#FFFFFF" : "#000000"} opacity={0.85} />
									</div>
								)}
							</div>

							<div className={`flex w-full flex-col items-center gap-1 text-center ${sidePanel ? "" : "max-w-2xl"}`}>
								<h1 className="text-3xl font-bold leading-tight line-clamp-2" title={currentTrack.title}>
									{currentTrack.title}
								</h1>
								<h2 className="text-lg font-semibold text-(--text-secondary)">{artistText(currentTrack)}</h2>
								{currentTrack.album && !/^unknown/i.test(currentTrack.album) && <span className="text-sm text-(--text-tertiary)">{currentTrack.album}</span>}
								<PlayCount title={currentTrack.title} artist={currentTrack.artists} skeleton={false} className="text-sm font-medium text-(--text-tertiary)" />
							</div>

							<div className={`flex w-full flex-col items-center gap-4 ${sidePanel ? "" : "max-w-2xl"}`}>
								<SeekBar dark={dark} />
								<div className="flex w-full items-center">
									<div className="flex flex-1 basis-0 justify-start">
										<button title="Repeat" className={toggledButton(loop)} onClick={toggleLoop}>
											<ArrowPathRoundedSquareIcon className="size-6" />
										</button>
									</div>
									<div className="flex shrink-0 items-center gap-4">
										<button title="Previous" className={iconButton} onClick={previous}>
											<BackwardIcon className="size-8" />
										</button>
										<button title={isPlaying ? "Pause" : "Play"} className={`flex items-center justify-center size-16 rounded-full shadow-lg cursor-pointer hover:scale-105 active:scale-95 duration-150 ${dark ? "bg-white text-black" : "bg-black text-white"}`} onClick={() => void togglePlay()}>
											{isPlaying ? <PauseIcon className="size-8" /> : <PlayIcon className="size-8 translate-x-0.5" />}
										</button>
										<button title="Next" className={iconButton} onClick={next}>
											<ForwardIcon className="size-8" />
										</button>
									</div>
									<div className="flex flex-1 basis-0 justify-end">
										<VolumeControl dark={dark} buttonClassName={iconButton} />
									</div>
								</div>
							</div>
						</div>

						{sidePanel && <div className={`flex-1 min-h-0 rounded-3xl ${dark ? "bg-[#00000030]" : "bg-[#ffffff40]"}`}>{mode === "lyrics" ? <LyricsPanel track={currentTrack} /> : <QueuePanel />}</div>}
					</div>
				)}
			</div>
		</div>
	);
};
