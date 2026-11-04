/**
 * Old about: URLs whose pages now live inside another page. Kept dependency-free so the
 * tab store can use it without an import cycle.
 */

/** The Digital Library is a section of about:music: `about:library?x` → `about:music?digilib&x`. */
export function normalizeAboutUrl(url: string): string;
export function normalizeAboutUrl(url: string | undefined): string | undefined;
export function normalizeAboutUrl(url: string | undefined): string | undefined {
	const m = url ? /^about:library(?:\?(.*))?$/.exec(url) : null;
	if (!m) return url;
	return `about:music?digilib${m[1] ? `&${m[1]}` : ""}`;
}
