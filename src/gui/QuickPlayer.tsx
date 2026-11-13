import { useEffect, useRef, useState } from "react";
import { QueueListIcon, MusicalNoteIcon, PlusIcon, MinusIcon, ArrowUturnLeftIcon, BackwardIcon, ForwardIcon, RectangleGroupIcon, ArrowPathRoundedSquareIcon, SpeakerWaveIcon, SpeakerXMarkIcon, AdjustmentsHorizontalIcon } from "@heroicons/react/24/solid";
import { PlayIcon, PauseIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/solid";
import { ArrowsPointingOutIcon, ChatBubbleBottomCenterTextIcon } from "@heroicons/react/24/solid";
import { MusicComments } from "../components/MusicComments";
import { useMusicStore, usePlaybackStore, useSettingsStore } from "../store";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { AudvisVisualizer } from "../components/AudvisVisualizer";
import { openMusicPlayer, previous, registerAudio, seek, togglePlay } from "../libs/playback";
import { adBreakDue, useMusicAds, watchForAdFree } from "../libs/music-ads";
import { useRewardedAd } from "../libs/rewarded-ad";
import { isLinkable, openTrackAlbum, openTrackArtist, trackArtists } from "../libs/trackLinks";
import { PlayCount } from "../components/PlayCount";
import { SongFeedback } from "../components/SongFeedback";
import { QueueList } from "../components/QueueList";
import { usePlaylistMenu } from "../components/PlaylistMenu";
import { trackFromPlayer } from "../libs/playlists";
import { ensureSavedLoaded, libraryTrackFromPlayer, useSavedStore } from "../libs/savedLibrary";
import { CheckCircleIcon, PlusCircleIcon } from "@heroicons/react/24/outline";
import { BarsArrowUpIcon, GiftIcon, RadioIcon, UserIcon } from "@heroicons/react/24/solid";
import { HolyText } from "../components/common/HolyText";
import { useHolyAttr } from "../libs/holy-attr";
import { startRadio } from "../libs/radio";
import type { Track } from "../types";

/** A round control on the collapsed player's rail; it acts in place instead of opening the panels. */
const RailButton = ({ onClick, dark, strong, children }: { onClick: () => void; dark: boolean; strong?: boolean; children: React.ReactNode }) => (
	<button
		data-rail-control
		className={`flex size-8 shrink-0 items-center justify-center rounded-full cursor-pointer duration-150 ${strong ? `${dark ? "bg-[#ffffff1f] hover:bg-[#ffffff30]" : "bg-[#00000014] hover:bg-[#00000024]"} text-(--text-primary)` : `text-(--text-secondary) hover:text-(--text-primary) ${dark ? "hover:bg-[#ffffff14]" : "hover:bg-[#00000010]"}`}`}
		onClick={e => {
			e.stopPropagation();
			onClick();
		}}
	>
		{children}
	</button>
);

/** How much of the queue shows under the big player: its handle, heading and the top of the first song. */
const QUEUE_SLIVER = "5.5rem";

interface QuickPlayerProps {
	panelsOpen: boolean;
	className?: string;
	/** Opens the side panels; runs alongside whatever item was clicked while they were collapsed. */
	onOpenPanels?: () => void;
}

export const QuickPlayer = ({ panelsOpen, className, onOpenPanels }: QuickPlayerProps) => {
	const settings = useSettingsStore(state => state.settings);
	const currentTrack = useMusicStore(state => state.currentTrack);
	const currentLibraryTrack = currentTrack ? libraryTrackFromPlayer(currentTrack) : null;
	const currentSaved = useSavedStore(s => !!currentLibraryTrack && s.tracks.some(t => t.id === currentLibraryTrack.id));
	useEffect(() => {
		ensureSavedLoaded();
	}, []);
	const queue = useMusicStore(state => state.queue);
	const playlistMenu = usePlaylistMenu();
	const { ref: moreRef, placeholder: moreAttrs } = useHolyAttr({ title: "More options", "aria-label": "More options" });
	/** The big player's "⋯" menu: everything its button row doesn't already show (save, like, volume, repeat, lyrics, full player). */
	const moreOptions = (track: Track): MenuItem[] => {
		const music = useMusicStore.getState();
		const items: MenuItem[] = [
			{ title: <HolyText text="Show queue" />, icon: <QueueListIcon className="size-5" />, onClick: () => changeView("tracks") },
			{ title: <HolyText text="Play next" />, icon: <BarsArrowUpIcon className="size-5" />, onClick: () => music.queueNext([track]) },
			{ title: <HolyText text="Add to queue" />, icon: <PlusIcon className="size-5" />, onClick: () => music.addTrack(track) },
			{ title: <HolyText text="Restart song" />, icon: <ArrowUturnLeftIcon className="size-5" />, onClick: () => seek(0) },
		];
		const { ready } = useRewardedAd.getState();
		if (ready && useMusicAds.getState().adFreeUntil <= Date.now()) {
			const label = useMusicAds.getState().rewardAds > 0 ? "Watch one more ad for 1 hour without ad breaks" : "Watch an ad for 1 hour without ad breaks";
			items.push({ title: <HolyText text={label} />, icon: <GiftIcon className="size-5" />, onClick: () => void watchForAdFree() });
		}
		if (music.queue.some(t => t.id === track.id)) items.push({ title: <HolyText text="Remove copies from queue" />, icon: <MinusIcon className="size-5" />, onClick: () => removeTrack(track.id) });
		items.push(playlistMenu(trackFromPlayer(track)));
		if (isLinkable(track)) {
			items.push(
				{ title: <HolyText text="Start radio" />, icon: <RadioIcon className="size-5" />, onClick: () => void startRadio(trackArtists(track)[0], track.title) },
				{ title: <HolyText text="Go to album" />, icon: <MusicalNoteIcon className="size-5" />, onClick: () => openTrackAlbum(track) },
				{ title: <HolyText text="Go to artist" />, icon: <UserIcon className="size-5" />, onClick: () => openTrackArtist(track, trackArtists(track)[0]) },
			);
		}
		return items;
	};
	const removeTrack = useMusicStore(state => state.removeTrack);
	const playNext = useMusicStore(state => state.playNext);
	const playerView = useMusicStore(state => state.playerView);
	const changeView = useMusicStore(state => state.changeView);
	const queueUp = playerView === "tracks";
	const bigPlayerRef = useRef<HTMLDivElement>(null);
	/** The stack's offset in px while the queue is being dragged, else null (it rests where queueUp puts it). */
	const [queueDrag, setQueueDrag] = useState<number | null>(null);
	const queueDragStart = useRef<{ y: number; from: number; travel: number; moved: boolean } | null>(null);
	const startQueueDrag = (e: React.PointerEvent<HTMLElement>) => {
		if (e.button !== 0) return;
		// The stack travels the big player's height: from the sliver showing to the queue filling the panel.
		const travel = bigPlayerRef.current?.offsetHeight ?? 0;
		e.currentTarget.setPointerCapture(e.pointerId);
		queueDragStart.current = { y: e.clientY, from: queueUp ? -travel : 0, travel, moved: false };
	};
	const moveQueueDrag = (e: React.PointerEvent<HTMLElement>) => {
		const drag = queueDragStart.current;
		if (!drag) return;
		const dy = e.clientY - drag.y;
		if (!drag.moved && Math.abs(dy) < 4) return;
		drag.moved = true;
		setQueueDrag(Math.min(0, Math.max(-drag.travel, drag.from + dy)));
	};
	const endQueueDrag = (e: React.PointerEvent<HTMLElement>) => {
		const drag = queueDragStart.current;
		queueDragStart.current = null;
		if (!drag) return;
		const dy = e.clientY - drag.y;
		// A tap toggles; a drag settles on the side it was pulled past a quarter of the way.
		const open = !drag.moved ? !queueUp : queueUp ? dy < drag.travel / 4 : -dy > drag.travel / 4;
		setQueueDrag(null);
		changeView(open ? "tracks" : "bigplayer");
	};

	const [platform, setPlatform] = useState<string>("");
	const [brightness, setBrightness] = useState<"dark" | "light">("dark");

	const isPlaying = usePlaybackStore(state => state.isPlaying);
	const setIsPlaying = usePlaybackStore(state => state.setIsPlaying);
	const buffering = usePlaybackStore(state => state.buffering);
	const setBuffering = usePlaybackStore(state => state.setBuffering);
	/** Playback was asked for but no sound yet (the full song is still being fetched). */
	const loadingSong = isPlaying && buffering;
	const rail = !panelsOpen && settings["compact-tabs"] === true;
	const peek = !panelsOpen && settings["compact-tabs"] !== true;
	const currentTime = usePlaybackStore(state => state.currentTime);
	const setCurrentTime = usePlaybackStore(state => state.setCurrentTime);
	const duration = usePlaybackStore(state => state.duration);
	const setDuration = usePlaybackStore(state => state.setDuration);
	const [isDragging, setIsDragging] = useState(false);
	const loop = usePlaybackStore(state => state.loop);
	const setLoop = usePlaybackStore(state => state.setLoop);

	const musicRef = useRef<HTMLDivElement>(null);
	const audioRef = useRef<HTMLAudioElement>(null);
	/** The seek bar last pressed (the big player and the queue each show one). */
	const seekbarRef = useRef<HTMLElement | null>(null);
	const playRef = useRef<HTMLButtonElement>(null);

	const volume = usePlaybackStore(state => state.volume);
	const setVolume = usePlaybackStore(state => state.setVolume);
	const [isVolumeDragging, setIsVolumeDragging] = useState<boolean>(false);
	const [showVolumeSlider, setShowVolumeSlider] = useState<boolean>(false);
	const [volumeSlide, setVolumeSlide] = useState<boolean>(false);
	const muted = usePlaybackStore(state => state.muted);
	const setMuted = usePlaybackStore(state => state.setMuted);
	const analyser = usePlaybackStore(state => state.analyser);
	const setAnalyser = usePlaybackStore(state => state.setAnalyser);
	const volumeStartRef = useRef<{ x: number; vol: number } | null>(null);
	const [volumeSliderPos, setVolumeSliderPos] = useState<{ x: number; y: number } | null>(null);
	const prevVolRef = useRef<number>(1);

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		visible: boolean;
		items: MenuItem[];
	} | null>(null);
	const volumeDragTriggeredRef = useRef<boolean>(false);

	const [isHoveringCover, setIsHoveringCover] = useState(false);
	const [showVisualizer] = useState(true);
	const [visualizerScale] = useState(1);
	const [visualizerOpacity] = useState(1);

	// Audio EQ state
	const [showEQ, setShowEQ] = useState(false);
	const eqBass = usePlaybackStore(state => state.eqBass);
	const eqMid = usePlaybackStore(state => state.eqMid);
	const eqTreble = usePlaybackStore(state => state.eqTreble);
	const setEqBass = usePlaybackStore(state => state.setEqBass);
	const setEqMid = usePlaybackStore(state => state.setEqMid);
	const setEqTreble = usePlaybackStore(state => state.setEqTreble);
	const controlsRef = useRef<HTMLDivElement>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
	const bassFilterRef = useRef<BiquadFilterNode | null>(null);
	const midFilterRef = useRef<BiquadFilterNode | null>(null);
	const trebleFilterRef = useRef<BiquadFilterNode | null>(null);
	const audioInitializedRef = useRef<boolean>(false);

	useEffect(() => {
		if (settings.brightness) {
			setBrightness(settings.brightness);
		}
	}, [settings.brightness]);

	useEffect(() => {
		registerAudio(audioRef.current);
		return () => registerAudio(null, null);
	}, []);

	const retriedRef = useRef<string | null>(null);
	const failedTrackId = usePlaybackStore(state => state.failedTrackId);
	const failed = !!currentTrack && failedTrackId === currentTrack.id;

	/** The song's audio didn't load: retry once (stream links can expire), then say so and move on. */
	const handleAudioError = () => {
		const track = useMusicStore.getState().currentTrack;
		const audio = audioRef.current;
		if (!track?.src || !audio) return;
		// A load cancelled by switching songs (or leaving the page) isn't a failure.
		if (audio.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
		if (retriedRef.current !== track.id) {
			retriedRef.current = track.id;
			audio.src = `${track.src}${track.src.includes("?") ? "&" : "?"}retry=${Date.now()}`;
			void audio.play().catch(() => {});
			return;
		}
		usePlaybackStore.setState({ failedTrackId: track.id, isPlaying: false });
		window.setTimeout(() => {
			const { currentTrack: now, queue: upcoming } = useMusicStore.getState();
			if (now?.id === track.id && upcoming.length > 0) playNext();
		}, 2000);
	};

	useEffect(() => {
		usePlaybackStore.setState({ failedTrackId: null });
		// A track with nothing to stream can't play at all.
		if (currentTrack && !currentTrack.src) usePlaybackStore.setState({ failedTrackId: currentTrack.id, isPlaying: false });
		if (currentTrack?.src && audioRef.current) {
			audioRef.current.src = currentTrack.src;
			// An ad break is due: the song waits, and the break plays it when it ends.
			if (adBreakDue()) return;
			if (audioContextRef.current?.state === "suspended") {
				audioContextRef.current.resume().then(() => {
					const playPromise = audioRef.current?.play();
					if (playPromise && typeof (playPromise as Promise<void>).then === "function") {
						(playPromise as Promise<void>)
							.then(() => {})
							.catch(() => {
								setIsPlaying(false);
							});
					} else {
						setIsPlaying(!audioRef.current || audioRef.current.paused);
					}
				});
			} else {
				const playPromise = audioRef.current.play();
				if (playPromise && typeof (playPromise as Promise<void>).then === "function") {
					(playPromise as Promise<void>)
						.then(() => {})
						.catch(() => {
							setIsPlaying(false);
						});
				} else {
					setIsPlaying(!audioRef.current.paused);
				}
			}
		}
	}, [currentTrack]);

	useEffect(() => {
		let detectedPlatform = "";
		if ("userAgentData" in navigator && navigator.userAgentData) {
			// @ts-expect-error: userAgentData is not yet in TypeScript's Navigator type
			detectedPlatform = navigator.userAgentData.platform || "";
		} else if ("platform" in navigator) {
			detectedPlatform = navigator.platform || "";
		} else {
			const ua = (navigator as Navigator).userAgent;
			if (/Windows/i.test(ua)) detectedPlatform = "Windows";
			else if (/Macintosh|Mac OS X/i.test(ua)) detectedPlatform = "Mac";
			else if (/Linux/i.test(ua)) detectedPlatform = "Linux";
			else if (/Android/i.test(ua)) detectedPlatform = "Android";
			else if (/iPhone|iPad|iPod/i.test(ua)) detectedPlatform = "iOS";
			else detectedPlatform = "Unknown";
		}
		setPlatform(detectedPlatform);
	}, []);

	const formatTime = (time: number): string => {
		if (isNaN(time) || time === Infinity) return "0:00";

		const hours = Math.floor(time / 3600);
		const minutes = Math.floor((time % 3600) / 60);
		const seconds = Math.floor(time % 60);

		const paddedSeconds = seconds.toString().padStart(2, "0");
		const paddedMinutes = minutes.toString().padStart(2, "0");

		if (hours > 0) {
			return `${hours}:${paddedMinutes}:${paddedSeconds}`;
		} else {
			return `${minutes}:${paddedSeconds}`;
		}
	};

	useEffect(() => {
		const percent = duration ? (currentTime / duration) * 100 : 0;
		musicRef.current?.style.setProperty("--current", `${percent}%`);
	}, [currentTime, duration]);

	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.volume = volume;
		}
	}, [volume]);

	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.muted = muted;
		}
	}, [muted]);

	useEffect(() => {
		if (!audioRef.current || audioInitializedRef.current) return;

		try {
			const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			const source = audioContext.createMediaElementSource(audioRef.current);

			const bassFilter = audioContext.createBiquadFilter();
			bassFilter.type = "lowshelf";
			bassFilter.frequency.value = 200;
			bassFilter.gain.value = eqBass;

			const midFilter = audioContext.createBiquadFilter();
			midFilter.type = "peaking";
			midFilter.frequency.value = 1000;
			midFilter.Q.value = 1;
			midFilter.gain.value = eqMid;

			const trebleFilter = audioContext.createBiquadFilter();
			trebleFilter.type = "highshelf";
			trebleFilter.frequency.value = 3000;
			trebleFilter.gain.value = eqTreble;

			// Create analyser for visualizer
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 2048;
			analyser.smoothingTimeConstant = 0.8;

			// Connect the audio graph
			source.connect(bassFilter);
			bassFilter.connect(midFilter);
			midFilter.connect(trebleFilter);
			trebleFilter.connect(analyser);
			analyser.connect(audioContext.destination);

			audioContextRef.current = audioContext;
			sourceNodeRef.current = source;
			bassFilterRef.current = bassFilter;
			midFilterRef.current = midFilter;
			trebleFilterRef.current = trebleFilter;
			setAnalyser(analyser);
			registerAudio(audioRef.current, audioContext);
			audioInitializedRef.current = true;
		} catch (error) {
			console.error("Failed to initialize audio context:", error);
		}
	}, [currentTrack]);

	useEffect(() => {
		if (bassFilterRef.current) {
			bassFilterRef.current.gain.value = eqBass;
		}
	}, [eqBass]);

	useEffect(() => {
		if (midFilterRef.current) {
			midFilterRef.current.gain.value = eqMid;
		}
	}, [eqMid]);

	useEffect(() => {
		if (trebleFilterRef.current) {
			trebleFilterRef.current.gain.value = eqTreble;
		}
	}, [eqTreble]);

	useEffect(() => {
		if (duration > 0 && currentTime === duration) {
			if (currentTime === duration) {
				if (queue && queue.length > 0) {
					// The next song keeps its place in the mix (radio doesn't re-tune on it).
					useMusicStore.getState().playFromQueue(queue[0].id);
				} else {
					setIsPlaying(false);
				}
			}
		}
	}, [currentTime, duration]);

	const handleSeek = (clientX: number) => {
		if (!audioRef.current || !duration) return;

		const rect = seekbarRef.current?.getBoundingClientRect();
		if (!rect) return;

		const clickX = clientX - rect.left;
		const percent = Math.min(Math.max(clickX / rect.width, 0), 1);
		const newTime = percent * duration;

		seek(newTime);
	};

	const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
		seekbarRef.current = e.currentTarget;
		setIsDragging(true);
		handleSeek(e.clientX);
	};

	const handleMouseMove = (e: MouseEvent) => {
		if (!isDragging) return;
		handleSeek(e.clientX);
	};

	const handleMouseUp = () => {
		if (isDragging) setIsDragging(false);
	};

	const handleVolumeMouseDown = (e: React.MouseEvent) => {
		if (!audioRef.current) return;
		e.preventDefault();
		e.stopPropagation();
		setIsVolumeDragging(true);
		const curr = audioRef.current.volume;
		volumeStartRef.current = { x: e.clientX, vol: isNaN(curr) ? volume : curr };
		setShowVolumeSlider(false);
	};

	const handleVolumeMouseMove = (e: MouseEvent) => {
		if (!isVolumeDragging || !volumeStartRef.current) return;
		setVolumeSlide(true);
		const sensitivity = 0.0035;
		const deltaPx = e.clientX - volumeStartRef.current.x;

		if (!showVolumeSlider && Math.abs(deltaPx) >= 2) {
			setShowVolumeSlider(true);
			setVolumeSliderPos({ x: e.clientX, y: (volumeSliderPos?.y ?? e.clientY) - 40 });
			volumeDragTriggeredRef.current = true;
			if (muted) setMuted(false);
		}
		let next = volumeStartRef.current.vol + deltaPx * sensitivity;
		next = Math.max(0, Math.min(1, next));
		if (audioRef.current) audioRef.current.volume = next;
		setVolume(next);
		setVolumeSliderPos(pos => (pos ? { x: e.clientX, y: pos.y } : { x: e.clientX, y: e.clientY - 40 }));
	};

	const handleVolumeMouseUp = () => {
		if (isVolumeDragging) setIsVolumeDragging(false);
		setVolumeSlide(false);
		volumeStartRef.current = null;
		setVolumeSliderPos(null);
		setShowVolumeSlider(false);
	};

	const toggleMute = () => {
		if (!audioRef.current) return;
		if (volumeDragTriggeredRef.current) {
			volumeDragTriggeredRef.current = false;
			return;
		}
		if (!muted) {
			const curr = audioRef.current.volume;
			if (curr > 0) prevVolRef.current = curr;
			setMuted(true);
		} else {
			setMuted(false);
			const restore = prevVolRef.current > 0 ? prevVolRef.current : volume > 0 ? volume : 0.5;
			if (audioRef.current) audioRef.current.volume = restore;
			setVolume(restore);
		}
	};

	useEffect(() => {
		if (isDragging) {
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		} else {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		}

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [isDragging]);

	useEffect(() => {
		if (isVolumeDragging) {
			window.addEventListener("mousemove", handleVolumeMouseMove);
			window.addEventListener("mouseup", handleVolumeMouseUp);
		} else {
			window.removeEventListener("mousemove", handleVolumeMouseMove);
			window.removeEventListener("mouseup", handleVolumeMouseUp);
		}

		return () => {
			window.removeEventListener("mousemove", handleVolumeMouseMove);
			window.removeEventListener("mouseup", handleVolumeMouseUp);
		};
	}, [isVolumeDragging]);

	/** The queue with its seek bar and button row: the whole player when nothing plays, else what slides up under the big player. */
	const queueView = (
		<>
			<div className={"relative flex w-full flex-1 min-h-0 overflow-auto gap-2 p-2 px-3 flex-col duration-200"}>
				{failed && currentTrack && queueUp && <span className="ml-1.5 mt-1 text-xs font-semibold text-[#ff6b6b]">Couldn't play this song{queue.length ? " — skipping" : ""}</span>}
				<div className="flex flex-col items-start w-full mt-1.5">
					<QueueList dark={brightness === "dark"} variant="compact" />
				</div>
			</div>
			<div>
				{/* It only draws while music plays: paused or stopped it would be a blank band over the queue, so it folds away. */}
				{currentTrack && analyser && showVisualizer && settings["tracks-visualizer"] === true && settings["disable-visualizers"] !== true && (
					<div className={`flex justify-center items-center px-4 overflow-hidden transition-[height] duration-300 ${isPlaying && !loadingSong ? "h-12" : "h-0"}`}>
						<AudvisVisualizer analyser={analyser} isPlaying={isPlaying} width={250} height={20} color={brightness === "dark" ? "#FFFFFF" : "#000000"} opacity={0.6} scale={1} />
					</div>
				)}
				<div className="relative flex justify-center items-center h-9">
					<div ref={controlsRef} className={`absolute flex p-2.5 gap-2 w-full items-center transition-[bottom,opacity,visibility] duration-200 ${currentTrack ? "" : "-bottom-22 opacity-0 invisible pointer-events-none"}`}>
						<span className="font-medium">{formatTime(currentTime)}</span>
						<span className="w-full h-2 bg-(--text-tertiary) rounded-full overflow-hidden hover:h-2.5 cursor-pointer duration-150" onMouseDown={handleMouseDown} onClick={e => handleSeek(e.clientX)}>
							<span style={{ width: `var(--current, 0%)` }} className={`flex h-full ${brightness === "dark" ? "bg-white" : "bg-black"}`}></span>
						</span>
						<span className="font-medium">{formatTime(duration)}</span>
					</div>
				</div>
				{/* Audio Equalizer Panel */}
				{showEQ && (
					<div className="flex flex-col gap-3 p-4 bg-(--tertiary) rounded-lg mx-2 mt-2 mb-2">
						<h3 className="text-sm font-semibold text-(--text-primary)">Equalizer</h3>
						<div className="flex flex-col gap-4">
							{/* Bass Control */}
							<div className="flex flex-col gap-1.5">
								<div className="flex justify-between items-center">
									<label className="text-xs text-(--text-secondary)">Bass</label>
									<span className="text-xs font-mono text-(--text-secondary)">
										{eqBass > 0 ? "+" : ""}
										{eqBass.toFixed(1)} dB
									</span>
								</div>
								<div className="relative flex items-center">
									<div className="absolute inset-0 flex justify-between items-center pointer-events-none px-0.5 z-0">
										{Array.from({ length: 13 }).map((_, i) => (
											<div key={i} className={`w-0.5 h-2 rounded-full ${i === 12 ? "bg-(--accent)" : "bg-(--text-tertiary) opacity-30"}`}></div>
										))}
									</div>
									<input
										type="range"
										min="-12"
										max="12"
										step="0.5"
										value={eqBass}
										onChange={e => setEqBass(parseFloat(e.target.value))}
										className="eq-slider w-full relative z-10"
										style={{
											background: `linear-gradient(to right, 
								var(--accent) 0%, 
								var(--accent) ${((eqBass + 12) / 24) * 100}%, 
								var(--secondary) ${((eqBass + 12) / 24) * 100}%, 
								var(--secondary) 100%)`,
										}}
									/>
								</div>
							</div>

							{/* Mid Control */}
							<div className="flex flex-col gap-1.5">
								<div className="flex justify-between items-center">
									<label className="text-xs text-(--text-secondary)">Mid</label>
									<span className="text-xs font-mono text-(--text-secondary)">
										{eqMid > 0 ? "+" : ""}
										{eqMid.toFixed(1)} dB
									</span>
								</div>
								<div className="relative flex items-center">
									<div className="absolute inset-0 flex justify-between items-center pointer-events-none px-0.5 z-0">
										{Array.from({ length: 13 }).map((_, i) => (
											<div key={i} className={`w-0.5 h-2 rounded-full ${i === 12 ? "bg-(--accent)" : "bg-(--text-tertiary) opacity-30"}`}></div>
										))}
									</div>
									<input
										type="range"
										min="-12"
										max="12"
										step="0.5"
										value={eqMid}
										onChange={e => setEqMid(parseFloat(e.target.value))}
										className="eq-slider w-full relative z-10"
										style={{
											background: `linear-gradient(to right, 
								var(--accent) 0%, 
								var(--accent) ${((eqMid + 12) / 24) * 100}%, 
								var(--secondary) ${((eqMid + 12) / 24) * 100}%, 
								var(--secondary) 100%)`,
										}}
									/>
								</div>
							</div>

							{/* Treble Control */}
							<div className="flex flex-col gap-1.5">
								<div className="flex justify-between items-center">
									<label className="text-xs text-(--text-secondary)">Treble</label>
									<span className="text-xs font-mono text-(--text-secondary)">
										{eqTreble > 0 ? "+" : ""}
										{eqTreble.toFixed(1)} dB
									</span>
								</div>
								<div className="relative flex items-center">
									<div className="absolute inset-0 flex justify-between items-center pointer-events-none px-0.5 z-0">
										{Array.from({ length: 13 }).map((_, i) => (
											<div key={i} className={`w-0.5 h-2 rounded-full ${i === 12 ? "bg-(--accent)" : "bg-(--text-tertiary) opacity-30"}`}></div>
										))}
									</div>
									<input
										type="range"
										min="-12"
										max="12"
										step="0.5"
										value={eqTreble}
										onChange={e => setEqTreble(parseFloat(e.target.value))}
										className="eq-slider w-full relative z-10"
										style={{
											background: `linear-gradient(to right, 
								var(--accent) 0%, 
								var(--accent) ${((eqTreble + 12) / 24) * 100}%, 
								var(--secondary) ${((eqTreble + 12) / 24) * 100}%, 
								var(--secondary) 100%)`,
										}}
									/>
								</div>
							</div>

							{/* Reset Button */}
							<button
								onClick={() => {
									setEqBass(0);
									setEqMid(0);
									setEqTreble(0);
								}}
								className="text-xs text-(--text-secondary) hover:text-(--text-primary) bg-(--secondary) hover:bg-[#ffffff10] px-3 py-1.5 rounded-md duration-150"
							>
								Reset EQ
							</button>
						</div>
					</div>
				)}
				<div className={`flex min-max-1 w-(calc(100%-1rem)) m-2 p-1 rounded-xl overflow-x-auto overflow-y-hidden [scrollbar-width:none] items-start justify-between gap-0.5 ${brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}`}>
					<div className={`flex gap-0.5 duration-150`}>
						<div className="flex gap-1">
							<button ref={playRef} title={platform.includes("Mac") ? "Play ⌃ + P" : "Play: Alt + S"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150" onClick={() => void togglePlay()}>
								{isPlaying === false ? (
									<PlayIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" />
								) : loadingSong ? (
									<span aria-hidden className="block size-5 p-0.5 pointer-events-none">
										<span className="block size-full rounded-full border-2 border-current border-t-transparent animate-spin" />
									</span>
								) : (
									<PauseIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" />
								)}
							</button>
							<button title={platform.includes("Mac") ? "Previous Track ⌃ + ," : "Previous Track: Alt + ,"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150" onClick={previous}>
								<BackwardIcon className="size-5 text-current pointer-events-none" />
							</button>
							<button
								title={platform.includes("Mac") ? "Next Track ⌃ + ." : "Next Track: Alt + ."}
								className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150"
								onClick={() => {
									playNext();
								}}
							>
								<ForwardIcon className="size-5 text-current pointer-events-none" />
							</button>
						</div>
						<button
							title={platform.includes("Mac") ? "Loop ⌃ + L" : "Loop: Alt + L"}
							className={`flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150 ${loop ? "text-(--text-primary)" : ""}`}
							onClick={() => {
								if (audioRef.current) {
									audioRef.current.loop = !loop;
								}
								setLoop(!loop);
							}}
						>
							<ArrowPathRoundedSquareIcon className="size-5 stroke-0.5 stroke-current text-current pointer-events-none" />
						</button>
						<SongFeedback track={currentTrack} buttonClassName="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150" iconClassName="size-5 pointer-events-none" />
						<button title="Drag left/right to change volume" className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-ew-resize duration-150" onMouseDown={handleVolumeMouseDown} onClick={toggleMute}>
							{muted || volume === 0 ? <SpeakerXMarkIcon className="size-5 text-current pointer-events-none" /> : <SpeakerWaveIcon className="size-5 text-current pointer-events-none" />}
						</button>
						<button title="Audio Equalizer" className={`flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150 ${showEQ ? "text-(--text-primary)" : ""}`} onClick={() => setShowEQ(!showEQ)}>
							<AdjustmentsHorizontalIcon className="size-5 text-current pointer-events-none" />
						</button>
					</div>
					<div className="flex gap-0.5">
						<div
							title={platform.includes("Mac") ? "Toggle Big Player" : "Toggle Big Player"}
							className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150"
							onClick={() => {
								if (playerView === "tracks") {
									changeView("bigplayer");
								} else {
									changeView("tracks");
								}
							}}
						>
							<RectangleGroupIcon className="size-5 text-current pointer-events-none" />
						</div>
						<button title="Lyrics" className={`flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150 ${currentTrack ? "" : "hidden"}`} onClick={() => openMusicPlayer("lyrics")}>
							<ChatBubbleBottomCenterTextIcon className="size-5 text-current pointer-events-none" />
						</button>
						<button title="Open Full Player" className={`flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150 ${currentTrack ? "" : "hidden"}`} onClick={() => openMusicPlayer("cover")}>
							<ArrowsPointingOutIcon className="size-5 text-current pointer-events-none stroke-0.5 stroke-(--text-secondary) hover:stroke-(--text-primary)" />
						</button>
					</div>
				</div>
			</div>
		</>
	);

	return (
		<div
			className={
				className &&
				className +
					" " +
					"relative flex flex-col duration-150 min-h-0" +
					" " +
					`
            ${panelsOpen ? "w-78" : "w-10"}
        `
			}
		>
			<div className={`flex flex-col justify-center duration-150 min-h-0 ${rail ? "" : "h-full"} ${peek ? `w-88 ${settings["tabs-position"] === "left" ? "self-end" : ""}` : "w-full"}`}>
				<div
					ref={musicRef}
					// Default panels collapse to a rail tile that hugs its controls. The full layout stays mounted (it owns the
					// <audio>, which keeps playing under display:none) but takes no space.
					className={`relative flex flex-col w-full min-h-0 bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-hidden duration-150 ${rail ? "[&>*:not([data-rail])]:hidden rounded-3xl" : "h-full rounded-2xl"}`}
					// Rail controls act in place; anything else on the collapsed player opens the panels.
					onClickCapture={e => {
						if ((e.target as Element).closest?.("[data-rail-control]")) return;
						onOpenPanels?.();
					}}
				>
					{rail && (
						<div data-rail className="flex flex-col items-center gap-1 py-1">
							{currentTrack?.cover ? (
								<img src={currentTrack.cover} alt="" className="size-8 rounded-full object-cover shadow-[0_2px_8px_#00000060]" />
							) : (
								<span className="flex size-8 items-center justify-center rounded-full bg-(--primary)">
									<MusicalNoteIcon className="size-4 text-(--text-secondary)" />
								</span>
							)}
							<RailButton onClick={previous} dark={brightness === "dark"}>
								<BackwardIcon className="size-4" />
							</RailButton>
							<RailButton onClick={() => void togglePlay()} dark={brightness === "dark"} strong>
								{loadingSong ? <span className="block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : isPlaying ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4 translate-x-px" />}
							</RailButton>
							<RailButton onClick={() => playNext()} dark={brightness === "dark"}>
								<ForwardIcon className="size-4" />
							</RailButton>
							<RailButton onClick={toggleMute} dark={brightness === "dark"}>
								{muted || volume === 0 ? <SpeakerXMarkIcon className="size-4" /> : <SpeakerWaveIcon className="size-4" />}
							</RailButton>
						</div>
					)}
					{currentTrack ? (
						<div className="relative flex-1 min-h-0 overflow-hidden">
							{/* The big player sits over the queue, whose top shows below it. Opening the queue slides both up
							    until the player is out of view; the sliver (or the handle once open) can be dragged too. */}
							<div className={`absolute inset-0 ${queueDrag === null ? "transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]" : ""}`} style={{ transform: queueDrag === null ? (queueUp ? `translateY(calc(-100% + ${QUEUE_SLIVER}))` : "none") : `translateY(${queueDrag}px)` }}>
								<div ref={bigPlayerRef} inert={queueUp} className="absolute inset-x-0 top-0" style={{ height: `calc(100% - ${QUEUE_SLIVER})` }}>
									<div className="relative flex flex-col w-full items-center h-full min-h-0 overflow-auto p-2.5 duration-200">
										{/* The player at the top, its song's and album's comments filling the space below (scrolling with it). */}
										<div className="flex flex-col items-center gap-4 w-full">
											<div className="group relative flex items-center justify-center w-full cursor-pointer" onMouseEnter={() => setIsHoveringCover(true)} onMouseLeave={() => setIsHoveringCover(false)} onClick={() => void togglePlay()}>
												{currentTrack?.cover ? (
													<img src={currentTrack.cover} alt={currentTrack.title} className="w-full aspect-square object-cover rounded-xl shadow-[0_0_20px_0px_#00000080]" />
												) : (
													<div className="w-full aspect-square rounded-2xl flex justify-center items-center bg-(--primary) text-(--text-secondary) inset-shadow-(--inset-shadow-primary) shadow-[0_0_20px_0px_#00000080]">
														<MusicalNoteIcon className="size-24 opacity-90" />
													</div>
												)}
												{settings["big-player-visualizer"] === true && settings["disable-visualizers"] !== true && showVisualizer && (
													<div className={`absolute rounded-xl overflow-hidden duration-300 drop-shadow-xl ${isHoveringCover === false ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
														<AudvisVisualizer analyser={analyser} isPlaying={isPlaying} width={140} height={30} color={brightness === "dark" ? "#FFFFFF" : "#000000"} opacity={visualizerOpacity} scale={visualizerScale} />
													</div>
												)}
												{loadingSong && <div aria-hidden className="absolute size-12 rounded-full border-4 border-white border-t-transparent animate-spin drop-shadow-[0_0_10px_#000] pointer-events-none group-hover:opacity-0 duration-150" />}
												<div className="absolute group flex gap-3 opacity-0 group-hover:opacity-100 duration-150 z-10">
													<button
														className="opacity-80 hover:opacity-100 cursor-pointer duration-150"
														style={{ filter: "drop-shadow(0px 0px 10px #000)" }}
														onClick={e => {
															e.stopPropagation();
															previous();
														}}
													>
														<BackwardIcon className="size-12" />
													</button>
													{isPlaying === false ? (
														<PlayIcon style={{ filter: "drop-shadow(0px 0px 10px #000)" }} className="size-12 text-current stroke-current stroke-0.5 pointer-events-none" />
													) : (
														<PauseIcon style={{ filter: "drop-shadow(0px 0px 10px #000)" }} className="size-12 text-current stroke-current stroke-1 pointer-events-none" />
													)}
													<button
														className="opacity-80 hover:opacity-100 cursor-pointer duration-150"
														style={{ filter: "drop-shadow(0px 0px 10px #000)" }}
														onClick={e => {
															e.stopPropagation();
															playNext();
														}}
													>
														<ForwardIcon className="size-12" />
													</button>
												</div>
												<div className={`absolute flex flex-col items-center w-4/5 gap-3 z-10 text-white duration-150 pointer-events-none ${volumeSlide ? "" : "opacity-0 pointer-events-none"}`}>
													<span className="font-semibold text-2xl">{Math.round(volume * 100)}%</span>
													<span className={"flex w-full h-2 bg-[#ffffff40] rounded-full"}>
														<span style={{ width: `${Math.round(volume * 100)}%` }} className="h-full bg-white rounded-full"></span>
													</span>
												</div>
											</div>
											<div className="flex flex-col items-center justify-center w-full gap-2">
												<div className="flex flex-col items-center gap-1.5">
													<h1 className={`font-bold text-2xl leading-tight text-center ${isLinkable(currentTrack) ? "cursor-pointer hover:underline" : ""}`} onClick={isLinkable(currentTrack) ? () => openTrackAlbum(currentTrack!) : undefined}>
														{currentTrack?.title}
													</h1>
													<h2 className="font-semibold text-lg text-center leading-none mt-0.5">
														{(Array.isArray(currentTrack?.artists) ? currentTrack.artists : currentTrack?.artists ? [currentTrack.artists] : []).map((artist, i, all) => (
															<span key={`${artist}-${i}`}>
																<span className={isLinkable(currentTrack) ? "cursor-pointer hover:underline" : ""} onClick={isLinkable(currentTrack) ? () => openTrackArtist(currentTrack!, artist) : undefined}>
																	{artist}
																</span>
																{i < all.length - 1 && ", "}
															</span>
														))}
													</h2>
													{currentTrack &&
														(failed ? (
															<span className="text-xs font-semibold text-[#ff6b6b]">Couldn't play this song{queue.length ? " — skipping" : ""}</span>
														) : (
															<PlayCount title={currentTrack.title} artist={currentTrack.artists} skeleton={false} className="text-xs font-medium opacity-60" />
														))}
												</div>
												<div className="flex w-full">
													<div className="relative flex justify-center items-center w-full h-9">
														<div className={"flex p-2.5 gap-2 w-full items-center"}>
															<span className="font-medium">{formatTime(currentTime)}</span>
															<span className="w-full h-2 bg-(--text-tertiary) rounded-full overflow-hidden hover:h-2.5 cursor-pointer duration-150" onMouseDown={handleMouseDown} onClick={e => handleSeek(e.clientX)}>
																<span style={{ width: `var(--current, 0%)` }} className={`flex h-full ${brightness === "dark" ? "bg-white" : "bg-black"}`}></span>
															</span>
															<span className="font-medium">{formatTime(duration)}</span>
														</div>
													</div>
												</div>
												<div className="relative flex flex-wrap gap-x-1.5 gap-y-1 items-center justify-center">
													{currentLibraryTrack && (
														<button
															title={currentSaved ? "Remove from Library" : "Add to Library"}
															className={`${currentSaved ? "opacity-100" : "opacity-50 hover:opacity-100"} cursor-pointer duration-150`}
															onClick={e => {
																e.stopPropagation();
																useSavedStore.getState().toggleTrack(currentLibraryTrack);
															}}
														>
															{currentSaved ? <CheckCircleIcon className="size-5 text-[#3d91ff]" /> : <PlusCircleIcon className="size-5" />}
														</button>
													)}
													<SongFeedback track={currentTrack} buttonClassName="cursor-pointer opacity-50 hover:opacity-100 duration-150" iconClassName="size-6" />
													<button title="Volume" className={`cursor-pointer opacity-50 hover:opacity-100 duration-150`} onMouseDown={handleVolumeMouseDown} onClick={toggleMute}>
														{muted || volume === 0 ? <SpeakerXMarkIcon className="size-8 stroke-0.5 stroke-current" /> : <SpeakerWaveIcon className="size-8 stroke-0.5 stroke-current" />}
													</button>
													<button
														title="Repeat"
														className={`cursor-pointer duration-150 ${loop ? "opacity-100 hover:opacity-50" : "opacity-50 hover:opacity-100"}`}
														onClick={() => {
															setLoop(prev => !prev);
														}}
													>
														<ArrowPathRoundedSquareIcon className="size-8 stroke-0.5 stroke-current" />
													</button>
													<button
														ref={moreRef}
														{...moreAttrs}
														aria-haspopup="menu"
														className="cursor-pointer opacity-50 hover:opacity-100 duration-150"
														onClick={e => {
															e.preventDefault();
															e.stopPropagation();
															if (!currentTrack) return;
															const rect = e.currentTarget.getBoundingClientRect();
															setContextMenu({ x: rect.left, y: rect.bottom + 6, visible: true, items: moreOptions(currentTrack) });
														}}
													>
														<EllipsisHorizontalIcon className="size-8 stroke-0.5 stroke-current" />
													</button>
													<button title="Lyrics" className="cursor-pointer opacity-50 hover:opacity-100 duration-150" onClick={() => openMusicPlayer("lyrics")}>
														<ChatBubbleBottomCenterTextIcon className="size-7 stroke-0.5 stroke-current" />
													</button>
													<button title="Open Full Player" className="cursor-pointer opacity-50 hover:opacity-100 duration-150" onClick={() => openMusicPlayer("cover")}>
														<ArrowsPointingOutIcon className="size-7 stroke-0.5 stroke-current" />
													</button>
												</div>
											</div>
										</div>
										<div className="w-full mt-5 px-1 pb-2">
											<MusicComments track={currentTrack} dark={brightness === "dark"} />
										</div>
									</div>
								</div>
								<div className="absolute inset-x-0 flex flex-col h-full" style={{ top: `calc(100% - ${QUEUE_SLIVER})` }}>
									<div className="flex shrink-0 justify-center pt-2 pb-0.5 cursor-grab active:cursor-grabbing touch-none" onPointerDown={startQueueDrag} onPointerMove={moveQueueDrag} onPointerUp={endQueueDrag} onPointerCancel={endQueueDrag}>
										<span className="h-1 w-9 rounded-full bg-(--text-tertiary)" />
									</div>
									<div inert={!queueUp} className="flex flex-col flex-1 min-h-0">
										{queueView}
									</div>
									{/* Closed, the whole sliver opens the queue (tap or drag up). Outside the inert queue, which takes no pointer events. */}
									{!queueUp && <div className="absolute inset-0 cursor-grab touch-none" onPointerDown={startQueueDrag} onPointerMove={moveQueueDrag} onPointerUp={endQueueDrag} onPointerCancel={endQueueDrag} />}
								</div>
							</div>
						</div>
					) : (
						queueView
					)}
					<audio
						ref={audioRef}
						src={currentTrack?.src}
						loop={loop}
						autoPlay={false}
						className="hidden pointer-events-none"
						onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
						onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
						onLoadStart={() => setBuffering(!!audioRef.current?.getAttribute("src"))}
						onWaiting={() => setBuffering(true)}
						onPlaying={() => setBuffering(false)}
						onCanPlay={() => audioRef.current?.paused && setBuffering(false)}
						onEmptied={() => setBuffering(false)}
						onPlay={() => setIsPlaying(true)}
						onError={() => {
							setBuffering(false);
							handleAudioError();
						}}
						onPause={() => {
							setIsPlaying(false);
							setBuffering(false);
						}}
						onEnded={() => {
							setBuffering(false);
							setIsPlaying(false);
							if (!loop) {
								playNext();
							}
						}}
					/>
				</div>
			</div>
			{isVolumeDragging && showVolumeSlider && volumeSliderPos && (
				<div className="fixed z-50 select-none pointer-events-none" style={{ left: volumeSliderPos.x - 80, top: volumeSliderPos.y - 48 }}>
					<div className="px-3 py-2 rounded-lg shadow-[0_6px_24px_#00000050] bg-(--secondary) inset-shadow-(--inset-shadow-primary)">
						<div className="w-40 h-2 rounded-full bg-(--text-tertiary) overflow-hidden">
							<div style={{ width: `${Math.round(volume * 100)}%` }} className="h-full bg-white"></div>
						</div>
						<div className="mt-1 text-xs text-(--text-secondary) text-center font-medium">{Math.round(volume * 100)}%</div>
					</div>
				</div>
			)}
			{contextMenu?.visible && <ContextMenu items={contextMenu.items} position={{ x: contextMenu.x, y: contextMenu.y }} onClose={() => setContextMenu(null)} />}
		</div>
	);
};
