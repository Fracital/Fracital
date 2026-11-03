import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";

import { getLanguageFromPath, getPathFromQuery } from "./textEditorUtils";
import { CheckIcon } from "@heroicons/react/24/solid";

interface TextEditorProps {
	path?: string;
	query?: string;
}

export const TextEditor = ({ path, query }: TextEditorProps) => {
	const [content, setContent] = useState<string>("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const resolvedPath = useMemo(() => getPathFromQuery(query, path), [path, query]);
	const language = useMemo(() => getLanguageFromPath(resolvedPath), [resolvedPath]);

	useEffect(() => {
		if (!resolvedPath) {
			setContent("");
			setError(null);
			return;
		}

		const loadFile = async () => {
			setIsLoading(true);
			setError(null);

			try {
				const data = await window.fr.fs.promises.readFile(resolvedPath, "utf8");
				setContent(typeof data === "string" ? data : "");
			} catch (err) {
				console.error(err);
				setError(err instanceof Error ? err.message : "Unable to read file");
				setContent("");
			} finally {
				setIsLoading(false);
			}
		};

		loadFile();
	}, [resolvedPath]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void saveFile();
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [content, resolvedPath]);

	const saveFile = async () => {
		if (!resolvedPath) return;

		setIsSaving(true);
		setError(null);

		try {
			await window.fr.fs.promises.writeFile(resolvedPath, content, "utf8");
		} catch (err) {
			console.error(err);
			setError(err instanceof Error ? err.message : "Unable to save file");
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="flex flex-col size-[calc(100%-4px)] ml-0.5 mt-0.5 rounded-xl overflow-hidden">
			<div className="flex items-center justify-between  p-2">
				<h1 className="pl-2">Text Editor</h1>
                <div>
                    <button className="p-2 bg-white/10 text-white stroke-current stroke-2 rounded-full hover:bg-white/20 disabled:opacity-50 disabled:hover:bg-white/10 cursor-pointer duration-100"
                        onClick={saveFile}
                        disabled={!resolvedPath || isSaving}
                    >
                        <CheckIcon className="size-4" />
                    </button>
                </div>
			</div>

			{error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}

			{isLoading ? (
				<div style={{ padding: "1rem", border: "1px solid #d1d5db", borderRadius: "0.5rem" }}>
					Loading file...
				</div>
			) : (
				<div className="h-full" style={{ overflow: "hidden" }}>
					<Editor
						height="100%"
						language={language}
						value={content}
						theme="vs-dark"
						options={{
							automaticLayout: true,
							fontSize: 14,
							minimap: { enabled: false },
							wordWrap: "on",
							scrollBeyondLastLine: false,
						}}
						onChange={(value) => setContent(value ?? "")}
					/>
				</div>
			)}
		</div>
	);
};