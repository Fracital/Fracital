import { dirExists, fileExists, GamesPath, MusicPath, SettingsPath } from "../types";
import { configureMusicApi } from "./music-service";
import { DEFAULT_QUICK_LINKS, runUpdater } from "./updater";

export const quickLinks = DEFAULT_QUICK_LINKS;

export const init = async () => {
	if (typeof window === "undefined" || !window.localStorage) throw Error("Cannot reach LocalStorage");

	// Music streaming API — runs on the same server (Vite dev / production backend). Set first: copying
	// the bundled games below can take a while, and music shouldn't wait on it.
	configureMusicApi({
		baseUrl: "/api/music",
	});

	if (!(await dirExists(MusicPath))) {
		await window.fr.fs.promises.mkdir(MusicPath);
	}
	if (!(await dirExists(GamesPath))) {
		await window.fr.fs.promises.mkdir(GamesPath);
	}

	const flashGames = import.meta.glob("../assets/games/flash/**/*", {
		eager: true,
		query: "?url",
		import: "default",
	}) as Record<string, string>;

	// Settings, themes and quick links are brought up to date here (see updater.ts). Built asset URLs carry
	// content hashes, so this signature changes whenever a bundled game file does.
	const { refreshGames, commitGames } = await runUpdater(Object.entries(flashGames).sort().join("|"));
	let copyFailed = false;

	for (const [sourcePath, assetUrl] of Object.entries(flashGames)) {
		const marker = "/assets/games/flash/";
		const markerIndex = sourcePath.indexOf(marker);
		if (markerIndex === -1) continue;

		const relativePath = sourcePath.slice(markerIndex + marker.length);
		const destinationPath = `${GamesPath}/${relativePath}`;
		const pathParts = relativePath.split("/");
		let currentPath = GamesPath;

		for (const directory of pathParts.slice(0, -1)) {
			currentPath += `/${directory}`;
			if (!(await dirExists(currentPath))) {
				await window.fr.fs.promises.mkdir(currentPath);
			}
		}

		const textExtensions = ["json", "txt", "html", "htm", "js", "css", "xml", "md", "svg"];
		const extension = relativePath.split(".").pop()?.toLowerCase() ?? "";
		const isText = textExtensions.includes(extension);
		const exists = await fileExists(destinationPath);
		if (exists && isText && !refreshGames) continue;

		// A game that can't be fetched (or is cut off mid-download) is skipped; it must not stop the rest of init.
		let text = "";
		let bytes: Uint8Array;
		try {
			const response = await fetch(assetUrl, { cache: "no-store" });
			const contentType = response.headers.get("content-type") ?? "";
			if (!response.ok || (!isText && contentType.includes("text/html"))) throw new Error(`HTTP ${response.status}`);
			if (isText) text = await response.text();
			bytes = isText ? new Uint8Array() : new Uint8Array(await response.arrayBuffer());
		} catch (error) {
			console.warn(`Could not copy Flash game asset: ${sourcePath}`, error);
			copyFailed = true;
			continue;
		}

		if (isText) {
			await window.fr.fs.promises.writeFile(destinationPath, text, "utf8");
			continue;
		}

		if (exists) {
			try {
				const stats = await window.fr.fs.promises.stat(destinationPath);
				// Skip only if the previously copied binary is intact
				if (stats.size === bytes.byteLength) continue;
			} catch {
				// fall through and rewrite
			}
		}
		// Filer only treats its own Buffer as binary; anything else is stringified
		await window.fr.fs.promises.writeFile(destinationPath, window.fr.buffer.from(bytes));
	}
	// A failed copy leaves the old signature, so the next boot tries the refresh again.
	if (!copyFailed) await commitGames();
	console.log("%cFracital%c: %cinit%c()", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff");

	// Mirror the persistent-tabs setting into localStorage so the stores can
	// read it synchronously at module load (settings.json loads async).
	try {
		const saved = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
		window.localStorage.setItem("fracital:persist-tabs", String(saved["persistent-tabs"] === true));
	} catch {
		/* defaults apply */
	}
};
