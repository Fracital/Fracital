import { useSettingsStore, useFilesStore, useTabsStore } from "../../store";
import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon, FolderIcon, DocumentIcon, PlayIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { joinPath, normalizePath } from "./pathUtils";

interface FilesProps {
	children?: React.ReactNode;
	query?: string | undefined;
}

const Files = ({ children, query }: FilesProps) => {
	const settings = useSettingsStore(state => state.settings);

	const fileTree = useFilesStore(state => state.fileTree);
	const currentDirectory = useFilesStore(state => state.currentDirectory);
	const setCurrentDirectory = useFilesStore(state => state.setCurrentDirectory);
	const newTab = useTabsStore(state => state.newTab);

	const [crumbs, setCrumbs] = useState<string[]>([]);

	const currentDirRef = useRef<HTMLInputElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	const [currentDirName, setCurrentDirName] = useState<string>("root");

	useEffect(() => {
		setCurrentDirectory("/");
	}, []);

	useEffect(() => {
		if (currentDirectory) {
			const parts = currentDirectory.split("/").filter(part => part.length > 0);
			const lastPart = parts[parts.length - 1];
			setCrumbs(parts);
			currentDirRef.current!.value = currentDirectory;
			if (lastPart === undefined) setCurrentDirName("root");
			else setCurrentDirName(lastPart);
		} else {
			setCrumbs([]);
		}
	}, [currentDirectory]);

	useEffect(() => {
		// Placeholder for fetching and setting up the file system tree based on the query
		// This could involve API calls or local file system access depending on the environment
	}, [query]);

	const openSwfInGamesTab = (entryName: string) => {
		if (!entryName.toLowerCase().endsWith(".swf")) return;

		const segments = currentDirectory.split("/").filter(Boolean);
		const gamesIndex = segments.lastIndexOf("games");
		const gameId = gamesIndex >= 0 && segments[gamesIndex + 1] ? segments[gamesIndex + 1] : segments[segments.length - 1];

		if (!gameId) return;

		newTab({
			id: createId(),
			title: "Games",
			url: `about:games?g=${encodeURIComponent(gameId)}`,
			displayUrl: `about:games?g=${encodeURIComponent(gameId)}`,
			icon: <PlayIcon className="size-5" />,
		});
	};

	const openFileInTextEditor = (entryName: string) => {
		const filePath = normalizePath(entryName.startsWith("/") ? entryName : joinPath(currentDirectory, entryName));

		newTab({
			id: createId(),
			title: entryName,
			url: `about:text?path=${filePath}`,
			displayUrl: `about:text?path=${filePath}`,
			icon: <DocumentIcon className="size-5" />,
		});
	};

	return (
		<div className="w-full h-full relative overflow-hidden">
			{
				<div className="flex flex-col p-4 gap-2">
					<div className="flex items-center justify-between">
						<div className="flex flex-col gap-1.5">
							<input type="text" ref={currentDirRef} className={"bg-transparent outline-none min-w-40 max-w-65 leading-none text-lg font-semibold text-(--text-secondary) placeholder:(text-(--text-tertiary) italic) duration-150"} placeholder="current path" />
							<div className={"relative flex items-center p-1 gap-0.5 h-max leading-none text-(--text-secondary) bg-[#ffffff10] rounded-lg cursor-text"}>
								<div className={"flex items-center gap-0.5"}>
									<button
										className="flex items-center p-1.5 px-2 gap-1.5 leading-none text-lg font-semibold hover:bg-[#ffffff10] rounded-md cursor-pointer duration-150"
										onClick={() => {
											const path = "/";
											if (currentDirectory === "/") return;
											setCurrentDirectory(path);
										}}
									>
										<span>root</span>
									</button>
									{currentDirectory !== "/" && <ChevronRightIcon className="size-4 text-(--text-secondary) stroke-current stroke-2 pointer-events-none" />}
								</div>
								{crumbs.length >= 1 &&
									crumbs.map((crumb, index) => (
										<div className={"flex items-center gap-0.5"} key={index}>
											{index > 0 && <ChevronRightIcon className="size-4 text-(--text-secondary) stroke-current stroke-2 pointer-events-none" />}
											<button
												key={index}
												className="flex items-center p-1.5 px-2 gap-1.5 leading-none text-lg font-semibold hover:bg-[#ffffff10] rounded-md cursor-pointer duration-150"
												onClick={() => {
													const path = normalizePath("/" + crumbs.slice(0, index + 1).join("/"));
													setCurrentDirectory(path);
												}}
											>
												<span>{crumb}</span>
											</button>
										</div>
									))}
							</div>
						</div>
					</div>
					<div className="flex flex-col gap-1.5">
						<div className="flex w-full items-center justify-between">
							<input type="text" ref={searchRef} className={"p-2 bg-[#ffffff10] outline-none rounded-lg min-w-40 max-w-65 leading-none text-lg font-semibold text-(--text-secondary) placeholder:(text-(--text-tertiary) italic) duration-150"} placeholder={`search ${currentDirName}`} />
							<div></div>
						</div>
						<div className="flex flex-col">
							{fileTree &&
								fileTree.map((entry, index) => (
									<div
										key={index}
										className="flex items-center justify-center p-2 gap-1.5 w-max hover:bg-[#ffffff18] rounded-md cursor-pointer select-none duration-100"
										onClick={() => {
											if (entry.isDirectory) {
												const newPath = entry.path ? normalizePath(entry.path) : joinPath(currentDirectory, entry.name);
												setCurrentDirectory(newPath);
											} else if (entry.name.toLowerCase().endsWith(".swf")) {
												openSwfInGamesTab(entry.name);
											} else {
												openFileInTextEditor(entry.name);
											}
										}}
									>
										<div className="leading-none">{entry.isDirectory ? <FolderIcon className="size-5 text-(--text-accent)" /> : <DocumentIcon className="size-5 text-(--text-accent)" />}</div>
										<div className="leading-none font-medium">{entry.name}</div>
									</div>
								))}
						</div>
					</div>
				</div>
			}
		</div>
	);
};

export default Files;
