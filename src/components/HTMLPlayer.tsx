import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../store";

interface HTMLPlayerProps {
	folderPath?: string;
	gameFile?: string;
	className?: string;
	width?: string | number;
	height?: string | number;
}

// Helper to get MIME type from file extension
const getMimeType = (filename: string): string => {
	const ext = filename.split(".").pop()?.toLowerCase();
	const mimeTypes: Record<string, string> = {
		html: "text/html",
		css: "text/css",
		js: "application/javascript",
		json: "application/json",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		mp3: "audio/mpeg",
		ogg: "audio/ogg",
		wav: "audio/wav",
		woff: "font/woff",
		woff2: "font/woff2",
		ttf: "font/ttf",
		otf: "font/otf",
	};
	return mimeTypes[ext || ""] || "application/octet-stream";
};

export const HTMLPlayer = ({ folderPath, gameFile = "index.html", className = "", width = "100%", height = "100%" }: HTMLPlayerProps) => {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [htmlContent, setHtmlContent] = useState<string>("");
	const settings = useSettingsStore(state => state.settings);

	useEffect(() => {
		if (!folderPath) {
			console.log("[HTMLPlayer] No folderPath provided");
			return;
		}

		console.log("[HTMLPlayer] Loading game from:", folderPath, "gameFile:", gameFile);

		const loadGame = async () => {
			try {
				setLoading(true);
				setError(null);

				// Read the main HTML file
				const htmlPath = `${folderPath}/${gameFile}`;
				console.log("[HTMLPlayer] Reading HTML from:", htmlPath);
				let html = await window.fr.fs.promises.readFile(htmlPath, "utf8");

				// Get all files in the folder
				const entries = await window.fr.fs.promises.readdir(folderPath);
				console.log("[HTMLPlayer] Files in folder:", entries);

				// Create a map of filename to data URI
				const fileMap = new Map<string, string>();

				// Load all files and convert to data URIs
				for (const filename of entries) {
					if (filename === "index.json" || filename === gameFile) continue; // Skip metadata and the HTML file itself

					try {
						const filePath = `${folderPath}/${filename}`;
						const mimeType = getMimeType(filename);

						// Read file as binary buffer
						const buffer = await window.fr.fs.promises.readFile(filePath);
						const bytes = new Uint8Array(buffer);

						// Convert to base64
						let binary = "";
						for (let i = 0; i < bytes.length; i++) {
							binary += String.fromCharCode(bytes[i]);
						}
						const base64 = btoa(binary);
						const dataUri = `data:${mimeType};base64,${base64}`;

						fileMap.set(filename, dataUri);
						console.log("[HTMLPlayer] Loaded:", filename, "as data URI");
					} catch (err) {
						console.warn(`[HTMLPlayer] Failed to load ${filename}:`, err);
					}
				}

				console.log("[HTMLPlayer] Total files loaded:", fileMap.size);

				// Replace all src/href references with data URIs
				html = html.replace(/(src|href)=["'](?!http|https:|\/\/|data:)([^"']+)["']/gi, (_match: string, attr: string, path: string) => {
					// Clean the path
					const cleanPath = path
						.replace(/^\.?\/+/, "")
						.split("?")[0]
						.split("#")[0];

					if (fileMap.has(cleanPath)) {
						console.log("[HTMLPlayer] Replacing", cleanPath, "with data URI");
						return `${attr}="${fileMap.get(cleanPath)}"`;
					}

					console.warn(`[HTMLPlayer] File not found: ${cleanPath}`);
					return _match;
				});

				console.log("[HTMLPlayer] Setting HTML content");
				setHtmlContent(html);
				setLoading(false);
			} catch (err) {
				console.error("[HTMLPlayer] Failed to load HTML game:", err);
				setError(`Failed to load game: ${err instanceof Error ? err.message : "Unknown error"}`);
				setLoading(false);
			}
		};

		loadGame();
	}, [folderPath, gameFile]);

	const handleIframeLoad = () => {
		setLoading(false);
	};

	const handleIframeError = () => {
		setError("Failed to load game");
		setLoading(false);
	};

	return (
		<div className={`relative flex items-center justify-center ${className}`} style={{ width, height }}>
			{htmlContent && <iframe ref={iframeRef} srcDoc={htmlContent} className="w-full h-full" title="HTML Game" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock" onLoad={handleIframeLoad} onError={handleIframeError} />}
			{loading && (
				<div className="absolute inset-0 flex items-center justify-center bg-(--primary)">
					<div className="flex flex-col items-center gap-3">
						<div className={`size-12 border-4 border-(--accent) border-t-transparent rounded-full animate-spin`}></div>
						<span className="text-lg font-semibold text-(--text-secondary)">Loading HTML game...</span>
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
