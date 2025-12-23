import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../store";

interface RufflePlayerProps {
	src?: string;
	data?: ArrayBuffer;
	className?: string;
	width?: string | number;
	height?: string | number;
	autoplay?: boolean;
	backgroundColor?: string;
	letterbox?: "on" | "off" | "fullscreen";
	unmuteOverlay?: "visible" | "hidden";
	quality?: "low" | "medium" | "high" | "best";
	scale?: "showAll" | "exactFit" | "noBorder" | "noScale";
	allowScriptAccess?: boolean;
	allowNetworking?: "all" | "internal" | "nione";
	volume?: number;
	onPlayerReady?: (player: any) => void;
}

export const RufflePlayer = ({
	src,
	data,
	className = "",
	width = "100%",
	height = "100%",
	autoplay = true,
	backgroundColor = "#000000",
	letterbox = "on",
	unmuteOverlay = "visible",
	quality = "high",
	scale = "showAll",
	allowScriptAccess = false,
	allowNetworking = "all",
	volume = 1,
	onPlayerReady,
}: RufflePlayerProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const playerRef = useRef<any>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const settings = useSettingsStore(state => state.settings);

	useEffect(() => {
		if (!containerRef.current || (!src && !data)) return;

		const container = containerRef.current;
		let cleanup: (() => void) | undefined;

		const loadRuffle = async () => {
			// @ts-expect-error - window.RufflePlayer rah
			while (!window.RufflePlayer) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}

			while (container.firstChild) {
				container.removeChild(container.firstChild);
			}

			try {
				// @ts-expect-error - window.RufflePlayer
				const ruffle = window.RufflePlayer.newest();
				const rufflePlayer = ruffle.createPlayer();
				container.appendChild(rufflePlayer);

				const config: any = {
					autoplay,
					backgroundColor,
					letterbox,
					unmuteOverlay,
					quality,
					scale,
					allowScriptAccess,
					allowNetworking,
					logLevel: "warn",
					showSwfDownload: false,
					contextMenu: "on",
					preloader: true,
				};

				let loadOptions;
				if (data) {
					const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data);
					console.log("Loading SWF with data, size:", uint8Array.length);
					console.log("First few bytes:", Array.from(uint8Array.slice(0, 10)));
					loadOptions = {
						data: uint8Array,
						...config,
					};
				} else {
					console.log("Loading SWF from URL:", src);
					loadOptions = {
						url: src,
						...config,
					};
				}

				rufflePlayer
					.load(loadOptions)
					.then(() => {
						setLoading(false);
						setError(null);
						playerRef.current = rufflePlayer;
						if (rufflePlayer.volume !== undefined) {
							rufflePlayer.volume = volume;
						}
						if (onPlayerReady) {
							rufflePlayer.style.height = "100%";
							rufflePlayer.style.width = "100%";
							onPlayerReady(rufflePlayer);
						}
					})
					.catch((err: Error) => {
						console.error("Failed to load SWF:", err);
						setError(`Failed to load game: ${err.message}`);
						setLoading(false);
					});

				cleanup = () => {
					if (rufflePlayer && rufflePlayer.remove) {
						rufflePlayer.remove();
					}
				};
			} catch (err) {
				console.error("Error creating Ruffle player:", err);
				setError("Error creating Ruffle player");
				setLoading(false);
			}
		};

		loadRuffle();

		return () => {
			if (cleanup) cleanup();
		};
	}, [src, data, autoplay, backgroundColor, letterbox, unmuteOverlay, quality, scale, allowScriptAccess, allowNetworking]);

	// Update volume when it changes
	useEffect(() => {
		if (playerRef.current && playerRef.current.volume !== undefined) {
			playerRef.current.volume = volume;
		}
	}, [volume]);

	return (
		<div className={`relative flex items-center justify-center ${className}`} style={{ width, height }}>
			<div
				ref={containerRef}
				className="w-full h-full"
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			/>
			{loading && (
				<div className="absolute inset-0 flex items-center justify-center bg-(--primary)">
					<div className="flex flex-col items-center gap-3">
						<div className={`size-12 border-4 border-(--accent) border-t-transparent rounded-full animate-spin`}></div>
						<span className="text-lg font-semibold text-(--text-secondary)">Loading Flash game...</span>
					</div>
				</div>
			)}
			{error && (
				<div className="absolute inset-0 flex items-center justify-center bg-(--primary)">
					<div className={`flex flex-col items-center gap-3 p-6 rounded-xl ${settings.brightness === "dark" ? "bg-[#ffffff10]" : "bg-[#00000025]"}`}>
						<span className="text-2xl font-bold text-(--text-primary)">Error</span>
						<span className="text-md text-(--text-secondary) text-center max-w-md">{error}</span>
					</div>
				</div>
			)}
		</div>
	);
};
