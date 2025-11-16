import { createId } from "@paralleldrive/cuid2";
import { useEffect, useRef, useState } from "react";
import { QueueListIcon, MusicalNoteIcon, PlusIcon, MinusIcon, ArrowUturnLeftIcon, BackwardIcon, ForwardIcon, RectangleGroupIcon, ArrowPathRoundedSquareIcon, SpeakerWaveIcon, SpeakerXMarkIcon, BarsArrowUpIcon, BackspaceIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartOutline } from "@heroicons/react/24/outline";
import { PlayIcon, PauseIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/solid";
import { useMusicStore, useSettingsStore, useTabsStore } from "../store";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { AudvisVisualizer } from "../components/AudvisVisualizer";

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
	const newTab = useTabsStore(state => state.newTab);
	const playerView = useMusicStore(state => state.playerView);
	const changeView = useMusicStore(state => state.changeView);

	const [platform, setPlatform] = useState<string>("");
	const [brightness, setBrightness] = useState<"dark" | "light">("dark");

	const [isPlaying, setIsPlaying] = useState<boolean>(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const [loop, setLoop] = useState(false);

	const musicRef = useRef<HTMLDivElement>(null);
	const audioRef = useRef<HTMLAudioElement>(null);
	const seekbarRef = useRef<HTMLSpanElement>(null);
	const playRef = useRef<HTMLButtonElement>(null);

	const [volume, setVolume] = useState<number>(1);
	const [isVolumeDragging, setIsVolumeDragging] = useState<boolean>(false);
	const [showVolumeSlider, setShowVolumeSlider] = useState<boolean>(false);
	const [volumeSlide, setVolumeSlide] = useState<boolean>(false);
	const [muted, setMuted] = useState<boolean>(false);
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

	useEffect(() => {
		if (settings.brightness) {
			setBrightness(settings.brightness);
		}
	}, [settings.brightness]);

	useEffect(() => {
		if (currentTrack?.src && audioRef.current) {
			audioRef.current.src = currentTrack.src;
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
			<div
				className={`flex flex-col justify-center h-full duration-150 min-h-0 ${panelsOpen ? "w-full left-0" : "w-88 -left-77"}`}
			>
				<div
					ref={musicRef}
					className={`flex flex-col w-full h-full min-h-0 bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-hidden duration-150 ${panelsOpen ? "w-full" : "w-88"}
                    ${settings["floating-tabs"] && panelsOpen ? "rounded-lg" : "rounded-xl"}
                    ${settings["floating-tabs"] && "shadow-[0_0_16px_3px_#00000035]"}`}
					onMouseDown={onMouseDown}
				>
					{
						playerView === "tracks" || !currentTrack ? (
							<>
								<div className={"relative flex w-full flex-1 min-h-0 overflow-auto gap-2 p-2 px-3 flex-col duration-200"}>
									<div className="flex flex-col items-start">
										{currentTrack ? (
											<h1 className={`ml-1.5 mt-1.5 text-2xl font-bold`}>
												Currently playing
											</h1>
										) : (
											<h1 className={`ml-1.5 mt-1.5 text-2xl font-bold`}>
												Nothing playing
											</h1>
										)}
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
													<h1 title={currentTrack.title}className={`text-md font-semibold leading-none`}>
														{currentTrack.title.length > 22 ? currentTrack.title.slice(0, 22) + "..." : currentTrack.title}
													</h1>
														{Array.isArray(currentTrack.artists) && currentTrack.artists.length > 1 ? (
															<div className="flex gap-1.5">
																{currentTrack.explicit && <span className="flex justify-center items-center size-5 text-xs font-bold rounded-sm bg-[#ffffff46]">E</span>}
																<div className="flex lg:flex-row flex-col gap-0.5">
																	{currentTrack.artists.map((artist, index) => (
																	<div
																		key={index}
																		className={`flex justify-center items-center w-max`}
																	>
																			<span className="text-xs leading-none duration-150" key={index}>
																				{artist}
																			</span>
																			{index < currentTrack.artists.length - 1 && <span>,</span>}
																		</div>
																	))}
																</div>
																{isVolumeDragging && showVolumeSlider && volumeSliderPos && (
																	<div className="fixed z-50 select-none pointer-events-none"style={{ left: volumeSliderPos.x - 80, top: volumeSliderPos.y - 48 }}>
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
															<h2 className={`text-sm leading-none cursor-pointer duration-150`}>
																{currentTrack.artists[0]}
															</h2>
														)}
													</div>
												</div>
												<EllipsisHorizontalIcon className={`size-6 mr-2 stroke-current stroke-1.5 cursor-pointer duration-150`} onClick={e => {
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
															icon: <BarsArrowUpIcon className="size-5" />
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
													];

													setContextMenu({
														x: e.clientX,
														y: e.clientY,
														visible: true,
														items: items,
													});
												}} />
											</div>
										)}
									</div>
									{queue && (
										<div className="flex flex-col items-start">
											{queue.length > 0 && (
												<h1 className={`ml-1.5 mt-1.5 text-2xl font-bold`}>
													Queue
												</h1>
											)}
											{queue.map((song) => (
												<div key={song.id} className="flex items-center justify-between gap-2.5 p-1.5 w-full rounded-lg hover:bg-[#ffffff28] duration-150" onClick={() => {
													setCurrentTrack(song);
													removeTrack(song.id);
												}}>
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
																			<div key={index}className={`flex justify-center items-center w-max`}>
																				<span className="text-xs leading-none duration-150" key={index}>
																					{artist}
																				</span>
																				{index < song.artists.length - 1 && <span>,</span>}
																			</div>
																		))}
																	</div>
																</div>
															) : (
																<h2 className={`text-sm leading-none duration-150`}>
																	{song.artists[0]}
																</h2>
															)}
														</div>
													</div>
													<EllipsisHorizontalIcon className={`size-6 mr-2 stroke-current stroke-1.5 cursor-pointer duration-150`} onClick={e => {
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
																icon: <BarsArrowUpIcon className="size-5" />
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
													}} />
												</div>
											))}
										</div>
									)}
								</div>
								<div>
									{currentTrack && showVisualizer && settings["tracks-visualizer"] === true && settings["disable-visualizers"] !== true && (
										<div className="flex justify-center items-center h-12 px-4 overflow-hidden">
											<AudvisVisualizer
												audioRef={audioRef}
												isPlaying={isPlaying}
												width={250}
												height={20}
												color={brightness === "dark" ? "#FFFFFF" : "#000000"}
												opacity={0.6}
												scale={1}
											/>
										</div>
									)}
									<div className="relative flex justify-center items-center h-9">
										<div className={`absolute flex p-2.5 gap-2 w-full items-center ${currentTrack ? "" : "-bottom-20"}`}>
											<span className="font-medium">{formatTime(currentTime)}</span>
											<span ref={seekbarRef} className="w-full h-2 bg-(--text-tertiary) rounded-full overflow-hidden hover:h-2.5 cursor-pointer duration-150" onMouseDown={handleMouseDown} onClick={e => handleSeek(e.clientX)}>
												<span style={{ width: `var(--current, 0%)` }} className={`flex h-full ${brightness === "dark" ? "bg-white" : "bg-black"}`}></span>
											</span>
											<span className="font-medium">{formatTime(duration)}</span>
										</div>
									</div>
									<div className={`flex min-max-1 w-full p-1.5 items-start justify-between gap-0.5 ${brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}`}>
										<div className={`flex gap-0.5 duration-150 ${currentTrack ? "" : "opacity-0 translate-y-2 pointer-events-none"}`}>
											<div className="flex gap-0.5">
												<button ref={playRef} title={platform.includes("Mac") ? "Play ⌃ + P" : "Play: Alt + S"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {
													if (audioRef.current?.paused) {
														audioRef.current?.play();
														setIsPlaying(true);
													} else {
														audioRef.current?.pause();
														setIsPlaying(false);
													}
												}}>
													{isPlaying === false ? <PlayIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" /> : <PauseIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" />}
												</button>
												<button title={platform.includes("Mac") ? "Previous Track ⌃ + ," : "Previous Track: Alt + ,"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {
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
												}}>
													<BackwardIcon className="size-5 text-current pointer-events-none" />
												</button>
												<button title={platform.includes("Mac") ? "Next Track ⌃ + ." : "Next Track: Alt + ."} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {
													playNext();
												}}>
													<ForwardIcon className="size-5 text-current pointer-events-none" />
												</button>
											</div>
											<button title={platform.includes("Mac") ? "Loop ⌃ + L" : "Loop: Alt + L"} className={`flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150 ${loop ? "text-(--text-primary)" : ""}`} onClick={() => {
												if (audioRef.current) {
													audioRef.current.loop = !loop;
												}
												setLoop(!loop);
											}}>
												<ArrowPathRoundedSquareIcon className="size-5 stroke-0.5 stroke-current text-current pointer-events-none" />
											</button>
											<button title="Drag left/right to change volume" className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-ew-resize duration-150" onMouseDown={handleVolumeMouseDown} onClick={toggleMute}>
												{muted || volume === 0 ? <SpeakerXMarkIcon className="size-5 text-current pointer-events-none" /> : <SpeakerWaveIcon className="size-5 text-current pointer-events-none" />}
											</button>
										</div>
										<div className="flex gap-0.5">
											<div title={platform.includes("Mac") ? "Library ⌃ + T" : "New Tab: Alt + T"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-200" onClick={() => {
												newTab({
													id: createId(),
													title: "Music Library",
													url: "about:music",
													current: true,
													displayUrl: "about:music",
													icon: <MusicalNoteIcon className="size-5" />,
												});
											}}>
												<MusicalNoteIcon className="size-5 duration-150" />
											</div>
											<div title={platform.includes("Mac") ? "Toggle Big Player" : "Toggle Big Player"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {
												if (playerView === "tracks") {
													changeView("bigplayer");
												} else {
													changeView("tracks");
												}
											}}>
												<RectangleGroupIcon className="size-5 text-current pointer-events-none" />
											</div>
										</div>
									</div>
								</div>
							</>
						) : (
							<div className={"relative flex flex-col w-full items-center flex-1 min-h-0 overflow-auto gap-2 p-2 px-2.5 duration-200"}>
								<div className="flex flex-col items-center justify-evenly h-full">
									<div className="group relative flex items-center justify-center w-4/5 cursor-pointer" onMouseEnter={() => setIsHoveringCover(true)} onMouseLeave={() => setIsHoveringCover(false)} onClick={() => {
										if (audioRef.current?.paused) {
											audioRef.current?.play();
											setIsPlaying(true);
										} else {
											audioRef.current?.pause();
											setIsPlaying(false);
										}
									}}>
										{currentTrack?.cover ? (
											<img src={currentTrack.cover} alt={currentTrack.title} className="w-full aspect-square object-cover rounded-xl shadow-[0_0_20px_0px_#00000080]" />
										) : (
											<div className="w-full aspect-square rounded-2xl flex justify-center items-center bg-(--primary) text-(--text-secondary) inset-shadow-(--inset-shadow-primary) shadow-[0_0_20px_0px_#00000080]">
												<MusicalNoteIcon className="size-24 opacity-90" />
											</div>
										)}
										{
											settings["big-player-visualizer"] === true && settings["disable-visualizers"] !== true && showVisualizer && (
												<div className={`absolute rounded-xl overflow-hidden duration-300 ${isHoveringCover === false ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
													<AudvisVisualizer
														audioRef={audioRef}
														isPlaying={isPlaying}
														width={140}
														height={30}
														color={brightness === "dark" ? "#FFFFFF" : "#000000"}
														opacity={visualizerOpacity}
														scale={visualizerScale}
													/>
												</div>
											)
										}
										<div className="absolute group flex gap-3 opacity-0 group-hover:opacity-100 duration-150 z-10">
											<button className="opacity-50 hover:opacity-100 cursor-pointer duration-150" onClick={(e) => {
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
											}}>
												<BackwardIcon className="size-12" />
											</button>
											{isPlaying === false ? <PlayIcon className="size-12 text-current stroke-current stroke-0.5 pointer-events-none" /> : <PauseIcon className="size-12 text-current stroke-current stroke-1 pointer-events-none" />}
											<button className="opacity-50 hover:opacity-100 cursor-pointer duration-150" onClick={(e) => {
												e.stopPropagation();
												playNext();
											}}>
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
											<h2 className="font-semibold text-lg text-center leading-none mt-0.5">
												{Array.isArray(currentTrack?.artists) ? currentTrack.artists.join(", ") : currentTrack?.artists ?? ""}
											</h2>
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
											<button title="Options" className={`opacity-50 hover:opacity-100 cursor-pointer duration-150`} onClick={(e: React.MouseEvent) => {
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
											}}>
												<EllipsisHorizontalIcon className="size-8 stroke-0.5 stroke-current" />
											</button>
											<button title="Volume" className={`cursor-pointer opacity-50 hover:opacity-100 duration-150`} onMouseDown={handleVolumeMouseDown} onClick={toggleMute}>
												{muted || volume === 0 ? <SpeakerXMarkIcon className="size-8 stroke-0.5 stroke-current" /> : <SpeakerWaveIcon className="size-8 stroke-0.5 stroke-current" />}
											</button>
											<button
												title="Repeat"
												className={`cursor-pointer duration-150 ${loop ? "opacity-100 hover:opacity-50" : "opacity-50 hover:opacity-100"}`}
												onClick={() => {
													setLoop((prev) => !prev);
												}}
											>
												<ArrowPathRoundedSquareIcon className="size-8 stroke-0.5 stroke-current" />
											</button>
											<button title="Queue" className={`cursor-pointer opacity-50 hover:opacity-100 duration-150`} onClick={() => {
												if (playerView === "bigplayer") {
													changeView("tracks");
												}
											}}
										>
											<QueueListIcon className="size-7 stroke-0.5 stroke-current" />
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
