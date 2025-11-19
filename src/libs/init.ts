import { dirExists, fileExists, ThemePath, StaticThemePath, MusicPath, GamesPath, SettingsPath } from "../types";

export const quickLinks = [
	{
		title: "Github",
		icon: "https://github.githubassets.com/favicons/favicon.svg",
		color: "#fff",
		href: "https://github.com/NovaAppsInc/Fracital",
	},
	{
		title: "Fracital",
		icon: "/fracital.svg",
		color: "#fb74fe",
		href: "https://fractial.dev",
	},
	{
		title: "Google",
		icon: "/google.svg",
		color: "#ffffff",
		href: "https://google.com",
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
				},
				null,
				4,
			),
		);
	} else {
		console.log("%cFracital%c: %cinit%c() -> %csettings.json%c already exists", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff", "color: #56d364", "color: #e2b340");
	}
	if (!(await dirExists(ThemePath))) {
		const defaultTheme = await fetch(`${StaticThemePath}/default.css`).then(res => res.text());
		const amberTheme = await fetch(`${StaticThemePath}/amber.css`).then(res => res.text());
		const lightTheme = await fetch(`${StaticThemePath}/light.css`).then(res => res.text());
		const greyTheme = await fetch(`${StaticThemePath}/greyscale.css`).then(res => res.text());
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
		window.location.reload();
	}
	if (!(await dirExists(MusicPath))) {
		await window.fr.fs.promises.mkdir(MusicPath);
	}
	if (!(await dirExists(GamesPath))) {
		await window.fr.fs.promises.mkdir(GamesPath);
		// Copy default game from public to Filer FS
		try {
			const response = await fetch("/games/bfe.swf");
			if (response.ok) {
				const arrayBuffer = await response.arrayBuffer();
				// Create folder for the game
				await window.fr.fs.promises.mkdir(`${GamesPath}/bfe`);
			// Write the SWF file
			await window.fr.fs.promises.writeFile(`${GamesPath}/bfe/game.swf`, window.fr.buffer.from(arrayBuffer));
			// Create metadata file
			const now = new Date().toISOString();
			await window.fr.fs.promises.writeFile(
				`${GamesPath}/bfe/index.json`,
				JSON.stringify({
					title: "Banned From Equestria",
					type: "flash",
					createdAt: now,
					modifiedAt: now,
				}, null, 2)
			);
				console.log("%cFracital%c: %cinit%c() -> %cdirectory%c /games created with default game", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff", "color: #56d364", "color: #e2b340");
			}
		} catch (err) {
			console.error("Failed to copy default game:", err);
		}
	}
	console.log("%cFracital%c: %cinit%c()", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff");
	if (!window.localStorage.getItem("quicklinks")) {
		console.log("%cinit%c()%c -> setting: %c[%cquicklinks%c]", "color: #c7a1f2", "color: #79c0ff", "color: #ffffffbf", "color: #56d364", "color: #e2b340", "color: #56d364");
		window.localStorage.setItem("quicklinks", JSON.stringify(quickLinks));
	} else {
		console.log("%cinit%c()%c -> already set: %c[%cquicklinks%c]", "color: #c7a1f2", "color: #79c0ff", "color: #ffffffbf", "color: #56d364", "color: #e2b340", "color: #56d364");
	}
};
