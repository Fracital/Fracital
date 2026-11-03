import { createId } from "@paralleldrive/cuid2";
import { useEffect, useRef, useState } from "react";
import { QueueListIcon, MusicalNoteIcon, PlusIcon, MinusIcon, ArrowUturnLeftIcon, BackwardIcon, ForwardIcon, RectangleGroupIcon, ArrowPathRoundedSquareIcon, SpeakerWaveIcon, SpeakerXMarkIcon, BarsArrowUpIcon, BackspaceIcon, AdjustmentsHorizontalIcon } from "@heroicons/react/24/solid";
import { PlayIcon, PauseIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/solid";
import { ArrowsPointingOutIcon, ChatBubbleBottomCenterTextIcon } from "@heroicons/react/24/solid";
import { useMusicStore, usePlaybackStore, useSettingsStore, useTabsStore } from "../store";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { AudvisVisualizer } from "../components/AudvisVisualizer";
import { openMusicPlayer, registerAudio } from "../libs/playback";

interface QuickPlayerProps {
	panelsOpen: boolean;
	className?: string;
	onMouseDown?: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}

export const QuickPlayer = ({ panelsOpen, className, onMouseDown }: QuickPlayerProps) => {
	const settings = useSettingsStore(state => state.settings);
	const currentTrack = useMusicStore(state => state.currentTrack);
	const queue = useMusicStore(state => state.queue);
	const setCurrentTrack = useMusicStore(state => state.setCurrentTrack);
	const addTrack = useMusicStore(state => state.addTrack);
	const removeTrack = useMusicStore(state => state.removeTrack);
	const playNext = useMusicStore(state => state.playNext);
	const playPrev = useMusicStore(state => state.playPrev);
	const reorderQueue = useMusicStore(state => state.reorderQueue);
	const newTab = useTabsStore(state => state.newTab);
	const playerView = useMusicStore(state => state.playerView);
	const changeView = useMusicStore(state => state.changeView);

	const [platform, setPlatform] = useState<string>("");
	const [brightness, setBrightness] = useState<"dark" | "light">("dark");

	const [draggedTrack, setDraggedTrack] = useState<string | null>(null);
	const [dragOverTrack, setDragOverTrack] = useState<string | null>(null);
	const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);

	const isPlaying = usePlaybackStore(state => state.isPlaying);
	const setIsPlaying = usePlaybackStore(state => state.setIsPlaying);
	const currentTime = usePlaybackStore(state => state.currentTime);
	const setCurrentTime = usePlaybackStore(state => state.setCurrentTime);
	const duration = usePlaybackStore(state => state.duration);
	const setDuration = usePlaybackStore(state => state.setDuration);
	const [isDragging, setIsDragging] = useState(false);
	const loop = usePlaybackStore(state => state.loop);
	const setLoop = usePlaybackStore(state => state.setLoop);

	const musicRef = useRef<HTMLDivElement>(null);
	const audioRef = useRef<HTMLAudioElement>(null);
	const seekbarRef = useRef<HTMLSpanElement>(null);
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
	const [eqBass, setEqBass] = useState(0);
	const [eqMid, setEqMid] = useState(0);
	const [eqTreble, setEqTreble] = useState(0);
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

	useEffect(() => {
		if (currentTrack?.src && audioRef.current) {
			audioRef.current.src = currentTrack.src;
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

	const resumeAndPlay = async () => {
		if (!audioRef.current) return;
		if (audioContextRef.current?.state === "suspended") {
			await audioContextRef.current.resume();
		}
		await audioRef.current.play();
		setIsPlaying(true);
	};

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
		seekbarRef.current?.style.setProperty("--current", `${percent}%`);
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
		if (currentTime === duration) {
			if (currentTime === duration) {
				if (queue && queue.length > 0) {
					const next = queue[0];
					setCurrentTrack(next);
					removeTrack(next.id);
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

		audioRef.current.currentTime = newTime;
		setCurrentTime(newTime);
	};

	const handleMouseDown = (e: React.MouseEvent) => {
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

	const handleDragStart = (e: React.DragEvent, trackId: string) => {
		setDraggedTrack(trackId);
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", trackId);
	};

	const handleDragOver = (e: React.DragEvent, trackId: string) => {
		e.preventDefault();
		if (!draggedTrack || draggedTrack === trackId) return;

		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midPoint = rect.top + rect.height / 2;
		const position = e.clientY < midPoint ? "before" : "after";

		setDragOverTrack(trackId);
		setDropPosition(position);
	};

	const handleDragLeave = () => {
		setDragOverTrack(null);
		setDropPosition(null);
	};

	const handleDrop = (e: React.DragEvent, targetId: string) => {
		e.preventDefault();
		if (!draggedTrack || draggedTrack === targetId) return;

		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midPoint = rect.top + rect.height / 2;
		const placeBefore = e.clientY < midPoint;

		reorderQueue(draggedTrack, targetId, placeBefore);

		setDraggedTrack(null);
		setDragOverTrack(null);
		setDropPosition(null);
	};

	const handleDragEnd = () => {
		setDraggedTrack(null);
		setDragOverTrack(null);
		setDropPosition(null);
	};

	return (
		<div
			className={
				className &&
				className +
					" " +
					"relative flex flex-col duration-150 min-h-0" +
					" " +
					`
            ${settings["floating-tabs"] === true ? "w-full" : panelsOpen ? "w-78" : "w-10"}
        `
			}
		>
			<div className={`flex flex-col justify-center h-full duration-150 min-h-0 ${panelsOpen ? "w-full left-0" : "w-88 -left-77"}`}>
				<div
					ref={musicRef}
					className={`flex flex-col w-full h-full min-h-0 bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-hidden duration-150 ${panelsOpen ? "w-full" : "w-88"}
                    ${settings["floating-tabs"] && panelsOpen ? "rounded-xl" : "rounded-2xl"}
                    ${settings["floating-tabs"] && "shadow-[0_0_16px_3px_#00000035]"}`}
					onMouseDown={onMouseDown}
				>
					{playerView === "tracks" || !currentTrack ? (
						<>
							<div className={"relative flex w-full flex-1 min-h-0 overflow-auto gap-2 p-2 px-3 flex-col duration-200"}>
								<div className="flex flex-col items-start">
									{currentTrack ? <h1 className={`ml-1.5 mt-1.5 text-2xl font-bold`}>Currently playing</h1> :
										<>
											<h1 className={`ml-1.5 mt-1.5 text-2xl font-bold`}>Nothing playing</h1>
											<button className="flex items-center justify-center gap-2 px-4 py-2 bg-(--tertiary) text-(--text-primary) rounded-md hover:bg-(--accent) duration-150"
												onClick={() => {
													newTab({
														id: createId(),
														title: "Music Library",
														icon: <MusicalNoteIcon className="size-5" />,
														url: "about:music",
														displayUrl: "about:music",
													});
												}}
											>
												<span className="text-xs w-max">Open Library</span>
												<MusicalNoteIcon className="size-3" />
											</button>
										</>
									}
									{currentTrack && (
										<div className="flex items-center justify-between gap-2.5 p-1.5 w-full rounded-lg hover:bg-[#ffffff28] duration-150">
											<div className="flex items-center gap-2.5">
												{currentTrack.cover && <img className="size-10 rounded-md" src={currentTrack.cover} alt={currentTrack.title} />}
												{!currentTrack.cover && (
													<div className={`size-10 rounded-md flex justify-center items-center bg-(--primary) text-(--text-secondary) inset-shadow-(--inset-shadow-primary) font-bold`}>
														<MusicalNoteIcon className="size-6" />
													</div>
												)}
												<div className="flex flex-col gap-1">
													<h1 title={currentTrack.title} className={`text-md font-semibold leading-none`}>
														{currentTrack.title.length > 22 ? currentTrack.title.slice(0, 22) + "..." : currentTrack.title}
													</h1>
													{Array.isArray(currentTrack.artists) && currentTrack.artists.length > 1 ? (
														<div className="flex gap-1.5">
															{currentTrack.explicit && <span className="flex justify-center items-center size-5 text-xs font-bold rounded-sm bg-[#ffffff46]">E</span>}
															<div className="flex lg:flex-row flex-col gap-0.5">
																{currentTrack.artists.map((artist, index) => (
																	<div key={index} className={`flex justify-center items-center w-max`}>
																		<span className="text-xs leading-none duration-150" key={index}>
																			{artist}
																		</span>
																		{index < currentTrack.artists.length - 1 && <span>,</span>}
																	</div>
																))}
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
														</div>
													) : (
														<h2 className={`text-sm leading-none cursor-pointer duration-150`}>{Array.isArray(currentTrack.artists) ? currentTrack.artists[0] : currentTrack.artists}</h2>
													)}
												</div>
											</div>
											<EllipsisHorizontalIcon
												className={`size-6 mr-2 stroke-current stroke-1.5 cursor-pointer duration-150`}
												onClick={e => {
													e.preventDefault();
													e.stopPropagation();

													const items: MenuItem[] = [
														{
															title: "Add to queue",
															onClick: () => {
																addTrack(currentTrack);
															},
															icon: <PlusIcon className="size-5" />,
														},
														{
															title: "Play next",
															onClick: () => {
																try {
																	const store: any = useMusicStore;
																	const state = store.getState();
																	const existingQueue = Array.isArray(state.queue) ? state.queue : [];
																	const filteredQueue = existingQueue.filter((t: any) => t.id !== currentTrack.id);
																	const newQueue = [currentTrack, ...filteredQueue];
																	store.setState({ queue: newQueue });
																	setContextMenu(null);
																} catch (err) {
																	console.error("Failed to add track to top of queue, falling back to append:", err);
																	addTrack(currentTrack);
																	setContextMenu(null);
																}
															},
															icon: <BarsArrowUpIcon className="size-5" />,
														},
														{
															title: "Restart track",
															onClick: () => {
																setCurrentTime(0);
																if (audioRef.current) {
																	audioRef.current.pause();
																	audioRef.current.currentTime = 0;
																}
															},
															icon: <ArrowUturnLeftIcon className="size-5" />,
														},
														{
															title: "Open full player",
															onClick: () => openMusicPlayer("cover"),
															icon: <ArrowsPointingOutIcon className="size-5" />,
														},
													];

													setContextMenu({
														x: e.clientX,
														y: e.clientY,
														visible: true,
														items: items,
													});
												}}
											/>
										</div>
									)}
								</div>
								{queue && (
									<div className="flex flex-col items-start">
										{queue.length > 0 && <h1 className={`ml-1.5 mt-1.5 text-2xl font-bold`}>Queue</h1>}
										{queue.map(song => (
											<div
												key={song.id}
												draggable
												onDragStart={e => handleDragStart(e, song.id)}
												onDragOver={e => handleDragOver(e, song.id)}
												onDragLeave={handleDragLeave}
												onDrop={e => handleDrop(e, song.id)}
												onDragEnd={handleDragEnd}
												className={`flex items-center justify-between gap-2.5 p-1.5 w-full rounded-lg cursor-move duration-150 ${draggedTrack === song.id ? "opacity-50" : "hover:bg-[#ffffff28]"} ${
													dragOverTrack === song.id && dropPosition === "before" ? "border-t-2 border-(--accent)" : dragOverTrack === song.id && dropPosition === "after" ? "border-b-2 border-(--accent)" : ""
												}`}
												onClick={() => {
													setCurrentTrack(song);
													removeTrack(song.id);
												}}
											>
												<div className="flex items-center gap-2.5">
													{song.cover && <img className="size-10 rounded-md" src={song.cover} alt={song.title} />}
													{!song.cover && (
														<div className={`size-10 rounded-md flex justify-center items-center bg-(--primary) text-(--text-secondary) inset-shadow-(--inset-shadow-primary) font-bold`}>
															<MusicalNoteIcon className="size-6" />
														</div>
													)}
													<div className="flex flex-col gap-1">
														<h1 title={song.title} className={`text-md font-semibold leading-none`}>
															{song.title.length > 22 ? song.title.slice(0, 22) + "..." : song.title}
														</h1>
														{Array.isArray(song.artists) && song.artists.length > 1 ? (
															<div className="flex gap-1.5">
																{song.explicit && <span className="flex justify-center items-center size-5 text-xs font-bold rounded-sm bg-[#ffffff46]">E</span>}
																<div className="flex lg:flex-row flex-col gap-0.5">
																	{song.artists.map((artist, index) => (
																		<div key={index} className={`flex justify-center items-center w-max`}>
																			<span className="text-xs leading-none duration-150" key={index}>
																				{artist}
																			</span>
																			{index < song.artists.length - 1 && <span>,</span>}
																		</div>
																	))}
																</div>
															</div>
														) : (
															<h2 className={`text-sm leading-none duration-150`}>{Array.isArray(song.artists) ? song.artists[0] : song.artists}</h2>
														)}
													</div>
												</div>
												<EllipsisHorizontalIcon
													className={`size-6 mr-2 stroke-current stroke-1.5 cursor-pointer duration-150`}
													onClick={e => {
														e.preventDefault();
														e.stopPropagation();

														const items: MenuItem[] = [
															{
																title: "Add to queue",
																onClick: () => {
																	addTrack(song);
																},
																icon: <PlusIcon className="size-5" />,
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
																icon: <BarsArrowUpIcon className="size-5" />,
															},
															{
																title: "Remove from queue",
																onClick: () => {
																	removeTrack(song.id);
																},
																icon: <BackspaceIcon className="size-5" />,
															},
														];

														setContextMenu({
															x: e.clientX,
															y: e.clientY,
															visible: true,
															items: items,
														});
													}}
												/>
											</div>
										))}
									</div>
								)}
							</div>
							<div>
								{currentTrack && showVisualizer && settings["tracks-visualizer"] === true && settings["disable-visualizers"] !== true && (
									<div className="flex justify-center items-center h-12 px-4 overflow-hidden">
										<AudvisVisualizer analyser={analyser} isPlaying={isPlaying} width={250} height={20} color={brightness === "dark" ? "#FFFFFF" : "#000000"} opacity={0.6} scale={1} />
									</div>
								)}
								<div className="relative flex justify-center items-center h-9">
									<div ref={controlsRef} className={`absolute flex p-2.5 gap-2 w-full items-center transition-[bottom] duration-200 ${currentTrack ? "" : "-bottom-22"}`}>
										<span className="font-medium">{formatTime(currentTime)}</span>
										<span ref={seekbarRef} className="w-full h-2 bg-(--text-tertiary) rounded-full overflow-hidden hover:h-2.5 cursor-pointer duration-150" onMouseDown={handleMouseDown} onClick={e => handleSeek(e.clientX)}>
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
								<div
									className={`flex min-max-1 w-(calc(100%-1rem)) m-2 p-1 rounded-xl overflow-x-auto overflow-y-hidden items-start justify-between gap-0.5 transition-[padding] duration-200 ${brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}`}
									onScroll={e => {
										const el = e.currentTarget as HTMLDivElement & { _scrollTimeout?: number };
										if (el.scrollWidth <= el.clientWidth) return;
										el.style.paddingBottom = "0.75rem";
										window.clearTimeout(el._scrollTimeout);
										el._scrollTimeout = window.setTimeout(() => {
											el.style.paddingBottom = "";
										}, 1000);
									}}
								>
									<div className={`flex gap-0.5 duration-150`}>
										<div className="flex gap-1">
											<button
												ref={playRef}
												title={platform.includes("Mac") ? "Play ⌃ + P" : "Play: Alt + S"}
												className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150"
												onClick={async () => {
													if (audioRef.current?.paused) {
														await resumeAndPlay();
													} else {
														audioRef.current?.pause();
														setIsPlaying(false);
													}
												}}
											>
												{isPlaying === false ? <PlayIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" /> : <PauseIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" />}
											</button>
											<button
												title={platform.includes("Mac") ? "Previous Track ⌃ + ," : "Previous Track: Alt + ,"}
												className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150"
												onClick={() => {
													if (!audioRef.current) return;
													if (audioRef.current.currentTime > 2.5) {
														audioRef.current.currentTime = 0;
														setCurrentTime(0);
														return;
													}
													const didGoBack = playPrev();
													if (!didGoBack) {
														audioRef.current.currentTime = 0;
														setCurrentTime(0);
													}
												}}
											>
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
										<button
											title="Lyrics"
											className={`flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150 ${currentTrack ? "" : "opacity-0 translate-y-2 pointer-events-none"}`}
											onClick={() => openMusicPlayer("lyrics")}
										>
											<ChatBubbleBottomCenterTextIcon className="size-5 text-current pointer-events-none" />
										</button>
										<button
											title="Open Full Player"
											className={`flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-lg cursor-pointer duration-150 ${currentTrack ? "" : "opacity-0 translate-y-2 pointer-events-none"}`}
											onClick={() => openMusicPlayer("cover")}
										>
											<ArrowsPointingOutIcon className="size-5 text-current pointer-events-none stroke-0.5 stroke-(--text-secondary) hover:stroke-(--text-primary)" />
										</button>
									</div>
								</div>
							</div>
						</>
					) : (
						<div className={"relative flex flex-col w-full items-center flex-1 min-h-0 overflow-auto gap-2 p-2.5 px-2.5 duration-200"}>
							<div className="flex flex-col items-center justify-evenly h-full w-full">
								<div
									className="group relative flex items-center justify-center w-4/5 cursor-pointer"
									onMouseEnter={() => setIsHoveringCover(true)}
									onMouseLeave={() => setIsHoveringCover(false)}
									onClick={async () => {
										if (audioRef.current?.paused) {
											await resumeAndPlay();
										} else {
											audioRef.current?.pause();
											setIsPlaying(false);
										}
									}}
								>
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
									<div className="absolute group flex gap-3 opacity-0 group-hover:opacity-100 duration-150 z-10">
										<button
											className="opacity-80 hover:opacity-100 cursor-pointer duration-150"
											style={{ filter: "drop-shadow(0px 0px 10px #000)" }}
											onClick={e => {
												e.stopPropagation();
												if (!audioRef.current) return;
												if (audioRef.current.currentTime > 2.5) {
													audioRef.current.currentTime = 0;
													setCurrentTime(0);
													return;
												}
												const didGoBack = playPrev();
												if (!didGoBack) {
													audioRef.current.currentTime = 0;
													setCurrentTime(0);
												}
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
										<h1 className="font-bold text-2xl leading-none">{currentTrack?.title}</h1>
										<h2 className="font-semibold text-lg text-center leading-none mt-0.5">{Array.isArray(currentTrack?.artists) ? currentTrack.artists.join(", ") : (currentTrack?.artists ?? "")}</h2>
									</div>
									<div className="flex w-full">
										<div className="relative flex justify-center items-center w-full h-9">
											<div className={"flex p-2.5 gap-2 w-full items-center"}>
												<span className="font-medium">{formatTime(currentTime)}</span>
												<span ref={seekbarRef} className="w-full h-2 bg-(--text-tertiary) rounded-full overflow-hidden hover:h-2.5 cursor-pointer duration-150" onMouseDown={handleMouseDown} onClick={e => handleSeek(e.clientX)}>
													<span style={{ width: `var(--current, 0%)` }} className={`flex h-full ${brightness === "dark" ? "bg-white" : "bg-black"}`}></span>
												</span>
												<span className="font-medium">{formatTime(duration)}</span>
											</div>
										</div>
									</div>
									<div className="relative flex gap-2 items-center justify-center">
										<button
											title="Options"
											className={`opacity-50 hover:opacity-100 cursor-pointer duration-150`}
											onClick={(e: React.MouseEvent) => {
												e.preventDefault();
												e.stopPropagation();

												if (!currentTrack) return;

												const items: MenuItem[] = [
													{
														title: "Add to queue",
														icon: <PlusIcon className="size-5 stroke-current stroke-1" />,
														onClick: () => {
															addTrack(currentTrack);
														},
													},
													{
														title: "Play next",
														onClick: () => {
															try {
																const store: any = useMusicStore;
																const state = store.getState();
																const existingQueue = Array.isArray(state.queue) ? state.queue : [];
																const filteredQueue = existingQueue.filter((t: any) => t.id !== currentTrack.id);
																const newQueue = [currentTrack, ...filteredQueue];
																store.setState({ queue: newQueue });
																setContextMenu(null);
															} catch (err) {
																console.error("Failed to add track to top of queue, falling back to append:", err);
																addTrack(currentTrack);
																setContextMenu(null);
															}
														},
														icon: null,
													},
													{
														title: "Restart track",
														icon: <ArrowUturnLeftIcon className="size-5 stroke-current stroke-1" />,
														onClick: () => {
															setCurrentTime(0);
															if (audioRef.current) {
																audioRef.current.pause();
																audioRef.current.currentTime = 0;
															}
														},
													},
												];

												if (queue.filter(track => track.id === currentTrack.id).length > 1) {
													items.push({
														title: "Remove instances from queue",
														icon: <MinusIcon className="size-5 stroke-current stroke-1" />,
														onClick: () => {
															removeTrack(currentTrack.id);
														},
													});
												}

												setContextMenu({
													x: e.clientX,
													y: e.clientY,
													visible: true,
													items,
												});
											}}
										>
											<EllipsisHorizontalIcon className="size-8 stroke-0.5 stroke-current" />
										</button>
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
											title="Queue"
											className={`cursor-pointer opacity-50 hover:opacity-100 duration-150`}
											onClick={() => {
												if (playerView === "bigplayer") {
													changeView("tracks");
												}
											}}
										>
											<QueueListIcon className="size-7 stroke-0.5 stroke-current" />
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
						</div>
					)}
					<audio
						ref={audioRef}
						src={currentTrack?.src}
						loop={loop}
						autoPlay={false}
						className="hidden pointer-events-none"
						onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
						onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
						onPlay={() => setIsPlaying(true)}
						onPause={() => setIsPlaying(false)}
						onEnded={() => {
							setIsPlaying(false);
							if (!loop) {
								playNext();
							}
						}}
					/>
				</div>
			</div>
			{contextMenu?.visible && <ContextMenu items={contextMenu.items} position={{ x: contextMenu.x, y: contextMenu.y }} onClose={() => setContextMenu(null)} />}
		</div>
	);
};
