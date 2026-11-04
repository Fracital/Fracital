import { createId } from "@paralleldrive/cuid2";
import { useEffect, useRef, useState } from "react";
import { QueueListIcon, MusicalNoteIcon, PlusIcon, HeartIcon, BookmarkIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartOutline } from "@heroicons/react/24/outline";
import { PlayIcon } from "@heroicons/react/24/solid";
import { useMusicStore, usePanelsStore, useSettingsStore, useTabsStore } from "../store";
import { PlayCount } from "../components/PlayCount";
import { appRoot } from "../libs/cloak";

interface QuickPlayerProps {
	tabsOpen: boolean;
	className?: string;
}

export const QuickPlayer = ({ tabsOpen, className }: QuickPlayerProps) => {
	const settings = useSettingsStore(state => state.settings);
	const currentTrack = useMusicStore(state => state.currentTrack);
	const queue = useMusicStore(state => state.queue);
	const tracks = queue;
	const addTrack = useMusicStore(state => state.addTrack);
	const removeTrack = useMusicStore(state => state.removeTrack);
	const newTab = useTabsStore(state => state.newTab);

	const setPanelsOpen = usePanelsStore(state => state.setPanelsOpen);
	const [platform, setPlatform] = useState<string>("");
	const [mainHeight, setMainHeight] = useState<number | undefined>(appRoot().querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height || 805);

	const musicRef = useRef<HTMLDivElement>(null);

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

	useEffect(() => {
		const height = appRoot().querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height;
		setMainHeight(height);

		const handleWindowSize = () => {
			const height = appRoot().querySelector<HTMLDivElement>("#main")?.getBoundingClientRect().height;
			setMainHeight(height);
		};
		window.addEventListener("resize", handleWindowSize);
		return () => window.removeEventListener("resize", handleWindowSize);
	}, []);

	return (
		<div
			className={
				className &&
				className +
					" " +
					"relative flex flex-col duration-150" +
					" " +
					`
            ${tabsOpen ? "w-78" : "w-10"}
        `
			}
		>
			<div
				className={
					"flex flex-col justify-center h-full duration-150" +
					" " +
					`
                ${tabsOpen ? "w-full left-0" : "w-88 -left-77"}
            `
				}
			>
				<div
					ref={musicRef}
					className={
						(settings["floating-tabs"] && "h-[calc(100%-12px)]") +
						" " +
						"flex flex-col w-full bg-(--secondary) inset-shadow-(--inset-shadow-primary) overflow-hidden duration-150" +
						" " +
						`
                    ${tabsOpen ? "w-full" : "w-88"}
                    ${settings["floating-tabs"] && tabsOpen ? "rounded-lg" : "rounded-xl"}
                    ${settings["floating-tabs"] && "shadow-[0_0_16px_3px_#00000035]"}
                `
					}
					onMouseDown={() => {
						setPanelsOpen(true);
					}}
				>
					<div
						style={{
							height: `calc(${mainHeight}px - calc(var(--spacing) * 12))`,
						}}
						className={"relative flex w-full h-full overflow-auto gap-2 p-2 px-3 flex-col duration-200"}
					>
						<div className="flex">
							{Object.keys(tracks).length === 0 || !currentTrack ? (
								<h1 className="text-2xl font-bold text-[#ffffff97]">Nothing playing</h1>
							) : (
								<div className="flex flex-col gap-2.5">
									<div className="flex items-center justify-center gap-2.5">
										<img className="size-11 rounded-lg" src={currentTrack.cover} alt={currentTrack.title} />
										<div>
											<h1 className="text-xl font-semibold cursor-pointer hover:underline">{currentTrack.title}</h1>
											{Array.isArray(currentTrack.artists) && currentTrack.artists.length > 1 ? (
												<div className="flex gap-1.5">
													{currentTrack.explicit && <span className="flex justify-center items-center size-5 text-xs font-bold rounded-sm bg-[#ffffff46]">E</span>}
													<div className="flex lg:flex-row flex-col gap-0.5">
														{currentTrack.artists.map((artist: string, index: number) => (
															<div className="flex justify-center items-center text-[#ffffff8c] w-max">
																<span className="text-sm hover:text-[#ffffffc4] cursor-pointer duration-150" key={index}>
																	{artist}
																</span>
																{index < currentTrack.artists.length - 1 && <span>,</span>}
															</div>
														))}
													</div>
												</div>
											) : (
												<h2>{currentTrack.artists}</h2>
											)}
											<PlayCount title={currentTrack.title} artist={currentTrack.artists} skeleton={false} className="text-xs text-[#ffffff8c]" />
										</div>
									</div>
								</div>
							)}
						</div>
					</div>
					<div>
						<div className="relative flex justify-center items-center h-9">
							<div
								className={
									"absolute flex p-2.5 gap-2 w-full items-center" +
									" " +
									`
                                ${Object.keys(tracks).length === 0 ? "-bottom-20" : ""}
                            `
								}
							>
								<span className="font-medium">0:00</span>
								<span className="w-full h-2 bg-[#ffffff80] rounded-full hover:h-2.5 duration-150">
									<span></span>
								</span>
								<span className="font-medium">0:00</span>
							</div>
						</div>
						<div
							className={
								"flex min-max-1 w-full p-1.5 items-start justify-between gap-0.5" +
								" " +
								`
                            ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}
                        `
							}
						>
							<div className="flex gap-0.5">
								<div className="flex gap-0.5">
									<div
										title={platform.includes("Mac") ? "Play ⌃ + P" : "Play: Alt + S"}
										className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150"
										onClick={() => {
											newTab({
												id: createId(),
												title: "Music Library",
												url: "fr://music",
												current: true,
												displayUrl: "fr://music",
											});
										}}
									>
										<PlayIcon className="size-5 text-current stroke-current stroke-0.5 pointer-events-none" />
									</div>
								</div>
								<div className="flex gap-0.5">
									<div title={platform.includes("Mac") ? "Play ⌃ + P" : "Play: Alt + S"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {}}>
										<HeartOutline className="size-5 text-current stroke-current stroke-3 pointer-events-none" />
									</div>
								</div>
							</div>
							<div className="flex gap-0.5">
								<div
									title={platform.includes("Mac") ? "Add To Your Library ⌃ + T" : "New Tab: Alt + T"}
									className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-200"
									onClick={() => {
										newTab({
											id: createId(),
											title: "Music Library",
											url: "fr://music?upload",
											current: true,
											displayUrl: "fr://music",
											icon: <MusicalNoteIcon className="size-5" />,
										});
									}}
								>
									<PlusIcon className="size-5 stroke-current stroke-1.5 duration-150" />
								</div>
								<div
									title={platform.includes("Mac") ? "Library ⌃ + T" : "New Tab: Alt + T"}
									className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-200"
									onClick={() => {
										newTab({
											id: createId(),
											title: "Music Library",
											url: "fr://music",
											current: true,
											displayUrl: "fr://music",
											icon: <MusicalNoteIcon className="size-5" />,
										});
									}}
								>
									<MusicalNoteIcon className="size-5 duration-150" />
								</div>
								<div title={platform.includes("Mac") ? "Toggle Tracks ⌃ + S" : "Toggle Tabs: Alt + S"} className="flex items-center justify-center p-2 hover:bg-[#ffffff10] text-(--text-secondary) hover:text-(--text-primary) rounded-md cursor-pointer duration-150" onClick={() => {}}>
									<QueueListIcon className="size-5 text-current pointer-events-none" />
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
