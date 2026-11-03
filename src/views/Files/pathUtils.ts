export const normalizePath = (path: string) => {
	if (!path || path === "/") return "/";

	const normalized = path.replace(/\/+/g, "/").replace(/\/+$/, "");
	if (!normalized) return "/";

	return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

export const joinPath = (basePath: string, segment: string) => {
	const normalizedBase = normalizePath(basePath);
	const normalizedSegment = segment.replace(/^\/+|\/+$/g, "");

	if (!normalizedSegment) return normalizedBase;
	if (normalizedBase === "/") return `/${normalizedSegment}`;

	const baseEndsWithSegment = normalizedBase.endsWith(`/${normalizedSegment}`);
	if (baseEndsWithSegment) return normalizedBase;

	return `${normalizedBase}/${normalizedSegment}`;
};
