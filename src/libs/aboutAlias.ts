/**
 * Old about: URLs whose pages now live inside another page. Kept dependency-free so the
 * tab store can use it without an import cycle.
 */

/** The Digital Library and full player are sections of about:music: `about:library?x` → `about:music?digilib&x`. */
export function normalizeAboutUrl(url: string): string;
export function normalizeAboutUrl(url: string | undefined): string | undefined;
export function normalizeAboutUrl(url: string | undefined): string | undefined {
	if (!url) return url;
	const lib = /^about:library(?:\?(.*))?$/.exec(url);
	if (lib) return `about:music?digilib${lib[1] ? `&${lib[1]}` : ""}`;
	// The full player is the "Now Playing" section: about:player?lyrics → about:music?player&lyrics.
	const player = /^about:player(?:\?(.*))?$/.exec(url);
	if (player) return `about:music?player${player[1] ? `&${player[1]}` : ""}`;
	return url;
}
