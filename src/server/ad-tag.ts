/**
 * The ad partner's tag is keyed by the site's own hostname, and its crawler
 * looks for it in the page source, so every HTML page a host serves (the app
 * shell and the decoy pages alike) carries
 * `<script src="//js.rev.iq/<hostname>" defer></script>` written server-side
 * for the hostname of that request.
 *
 * index.html ships a static tag as the fallback: it is what a request with no
 * usable hostname (an IP, localhost) gets, and what this rewrites otherwise.
 */

const AD_TAG_PATTERN = /<script\b[^>]*?\bsrc\s*=\s*["']?(?:https?:)?\/\/js\.rev\.iq\/[^"'\s>]*["']?[^>]*>\s*<\/script>/gi;

/**
 * The hostname the tag is keyed by: lowercase, no port, no leading `www.`.
 * Returns "" for anything that is not a plain DNS name, which also keeps a
 * hostile Host header out of the markup.
 */
export function adHostname(rawHostHeader: string): string {
	const host = rawHostHeader.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
	const hostname = host.startsWith("www.") ? host.slice(4) : host;
	if (!hostname || hostname.length > 253) return "";
	const labels = hostname.split(".");
	if (labels.length < 2) return "";
	if (!labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return "";
	// A numeric last label is an IP address, not a site.
	if (/^\d+$/.test(labels[labels.length - 1])) return "";
	return hostname;
}

export function adTag(hostname: string): string {
	return `<script src="//js.rev.iq/${hostname}" defer></script>`;
}

/** Sets the page's tag to the request's hostname: rewrites the one already there, or adds it to <head>. */
export function injectAdTag(html: string, rawHostHeader: string): string {
	const hostname = adHostname(rawHostHeader);
	if (!hostname) return html;
	const tag = adTag(hostname);

	let placed = false;
	const rewritten = html.replace(AD_TAG_PATTERN, () => {
		if (placed) return "";
		placed = true;
		return tag;
	});
	if (placed) return rewritten;

	if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `${tag}</head>`);
	if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, () => `${tag}</body>`);
	return `${html}${tag}`;
}
