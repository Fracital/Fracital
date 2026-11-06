import { dirExists, fileExists, GamesPath, MusicPath, SettingsPath, StaticThemePath, ThemePath } from "../types";
import { configureMusicApi } from "./music-service";

export const quickLinks = [
	{
		title: "Github",
		icon: "https://github.githubassets.com/favicons/favicon.svg",
		color: "#fff",
		href: "https://github.com/Fracital/Fracital",
	},
	{
		title: "YouTube",
		icon: "/youtube.svg",
		color: "#ffffff",
		href: "https://www.youtube.com",
	},
	{
		title: "Google",
		icon: "/google.svg",
		color: "#ffffff",
		href: "https://google.com",
	},
	{
		title: "Krunker",
		icon: "/krunker.png",
		color: "#ffffff",
		href: "https://krunk.io",
	},
	{
		title: "Estro AI Chat",
		icon: "/estro.svg",
		color: "#ffffff",
		href: "https://estro.help/",
	},
];

export const init = async () => {
	if (typeof window === "undefined" || !window.localStorage) throw Error("Cannot reach LocalStorage");

	if (!(await fileExists(SettingsPath))) {
		console.log("%cFracital%c: %cinit%c() -> %csettings.json%c does not exist, creating default settings", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff", "color: #56d364", "color: #e2b340");
		await window.fr.fs.promises.writeFile(
			SettingsPath,
			JSON.stringify(
				{
					theme: "default",
					proxy: "sj",
					quicklinks: JSON.stringify(quickLinks),
					"floating-tabs": false,
					"disable-visualizers": false,
					"tracks-visualizer": true,
					"big-player-visualizer": true,
					"big-player-default": true,
				},
				null,
				4,
			),
		);
	} else {
		console.log("%cFracital%c: %cinit%c() -> %csettings.json%c already exists", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff", "color: #56d364", "color: #e2b340");
	}
	if (!(await dirExists(ThemePath))) {
		const fetchTheme = async (file: string) => {
			const res = await fetch(`${StaticThemePath}/${file}`);
			if (!res.ok) throw new Error(`Theme ${file} returned HTTP ${res.status}`);
			return res.text();
		};
		const defaultTheme = await fetchTheme("default.css");
		const amberTheme = await fetchTheme("amber.css");
		const lightTheme = await fetchTheme("light.css");
		const greyTheme = await fetchTheme("greyscale.css");
		await window.fr.fs.promises.mkdir(ThemePath);
		await window.fr.fs.promises.mkdir(`${ThemePath}/default`);
		await window.fr.fs.promises.writeFile(
			`${ThemePath}/default/index.json`,
			JSON.stringify({
				name: "Default",
				description: "The default theme for Fracital.",
				author: "SNOOT",
				version: "1.0.0",
				license: "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)",
				color: "#fb74fe",
				brightness: "dark",
			}),
		);
		await window.fr.fs.promises.writeFile(`${ThemePath}/default/index.css`, defaultTheme);
		await window.fr.fs.promises.mkdir(`${ThemePath}/light`);
		await window.fr.fs.promises.writeFile(
			`${ThemePath}/light/index.json`,
			JSON.stringify({
				name: "Light",
				description: "The default light theme for Fracital.",
				author: "SNOOT",
				version: "1.0.0",
				license: "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)",
				color: "#e4b174",
				brightness: "light",
			}),
		);
		await window.fr.fs.promises.writeFile(`${ThemePath}/light/index.css`, lightTheme);
		await window.fr.fs.promises.mkdir(`${ThemePath}/amber`);
		await window.fr.fs.promises.writeFile(
			`${ThemePath}/amber/index.json`,
			JSON.stringify({
				name: "Amber",
				description: "A amber theme for Fracital.",
				author: "SNOOT",
				version: "1.0.0",
				license: "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)",
				color: "#e4b174",
				brightness: "dark",
			}),
		);
		await window.fr.fs.promises.writeFile(`${ThemePath}/amber/index.css`, amberTheme);
		await window.fr.fs.promises.mkdir(`${ThemePath}/greyscale`);
		await window.fr.fs.promises.writeFile(
			`${ThemePath}/greyscale/index.json`,
			JSON.stringify({
				name: "Greyscale",
				description: "A greyscale theme for Fracital.",
				author: "SNOOT",
				version: "1.0.0",
				license: "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)",
				color: "#e4b174",
				brightness: "dark",
			}),
		);
		await window.fr.fs.promises.writeFile(`${ThemePath}/greyscale/index.css`, greyTheme);
		console.log("%cFracital%c: %cinit%c() -> %cdirectory%c /themes created with default themes", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff", "color: #56d364", "color: #e2b340");
	}
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
		if (exists && isText) continue;

		const response = await fetch(assetUrl, { cache: "no-store" });
		const contentType = response.headers.get("content-type") ?? "";
		if (!response.ok || (!isText && contentType.includes("text/html"))) {
			console.warn(`Could not copy Flash game asset: ${sourcePath}`);
			continue;
		}

		if (isText) {
			await window.fr.fs.promises.writeFile(destinationPath, await response.text(), "utf8");
			continue;
		}

		const bytes = new Uint8Array(await response.arrayBuffer());
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
	console.log("%cFracital%c: %cinit%c()", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff");
	if (!window.localStorage.getItem("quicklinks")) {
		console.log("%cinit%c()%c -> setting: %c[%cquicklinks%c]", "color: #c7a1f2", "color: #79c0ff", "color: #ffffffbf", "color: #56d364", "color: #e2b340", "color: #56d364");
		window.localStorage.setItem("quicklinks", JSON.stringify(quickLinks));
	} else {
		console.log("%cinit%c()%c -> already set: %c[%cquicklinks%c]", "color: #c7a1f2", "color: #79c0ff", "color: #ffffffbf", "color: #56d364", "color: #e2b340", "color: #56d364");
		// Older defaults: swap the Fracital link for YouTube.
		try {
			const saved = JSON.parse(window.localStorage.getItem("quicklinks") || "[]") as { title?: string; href?: string }[];
			const youtube = quickLinks.find(l => l.title === "YouTube")!;
			const migrated = saved.map(l => (l.title === "Fracital" && /fractial\.dev/.test(l.href ?? "") ? youtube : l));
			if (migrated.some((l, i) => l !== saved[i])) window.localStorage.setItem("quicklinks", JSON.stringify(migrated));
		} catch {
			/* leave custom links alone */
		}
		// Add the newer defaults once; a user who deletes them afterwards keeps them deleted.
		if (!window.localStorage.getItem("quicklinks-v2")) {
			try {
				const saved = JSON.parse(window.localStorage.getItem("quicklinks") || "[]") as { href?: string }[];
				const added = quickLinks.filter(l => ["Krunker", "Estro AI Chat"].includes(l.title) && !saved.some(s => s.href === l.href));
				if (added.length) window.localStorage.setItem("quicklinks", JSON.stringify([...saved, ...added]));
			} catch {
				/* leave custom links alone */
			}
			window.localStorage.setItem("quicklinks-v2", "1");
		}
	}

	// Music streaming API — runs on the same server (Vite dev / production backend)
	configureMusicApi({
		baseUrl: "/api/music",
	});

	// Mirror the persistent-tabs setting into localStorage so the stores can
	// read it synchronously at module load (settings.json loads async).
	try {
		const saved = JSON.parse(await window.fr.fs.promises.readFile(SettingsPath, "utf8"));
		window.localStorage.setItem("fracital:persist-tabs", String(saved["persistent-tabs"] === true));
	} catch {
		/* defaults apply */
	}
};
