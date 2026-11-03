export const getLanguageFromPath = (filePath?: string): string => {
	if (!filePath) return "plaintext";

	const extension = filePath.split(".").pop()?.toLowerCase();

	switch (extension) {
		case "ts":
		case "tsx":
			return "typescript";
		case "js":
		case "jsx":
			return "javascript";
		case "json":
			return "json";
		case "css":
			return "css";
		case "html":
			return "html";
		case "md":
			return "markdown";
		case "xml":
			return "xml";
		case "yaml":
		case "yml":
			return "yaml";
		case "py":
			return "python";
		default:
			return "plaintext";
	}
};

export const getPathFromQuery = (query?: string, fallbackPath?: string): string | undefined => {
	if (fallbackPath) return fallbackPath;
	if (!query) return undefined;

	const trimmedQuery = query.trim();
	if (!trimmedQuery) return undefined;

	if (!trimmedQuery.includes("=")) return decodeURIComponent(trimmedQuery);

	const params = new URLSearchParams(trimmedQuery);
	const queryPath = params.get("path");
	return queryPath ? decodeURIComponent(queryPath) : undefined;
};
