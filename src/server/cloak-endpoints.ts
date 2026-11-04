import { createHash } from "node:crypto";

/**
 * Per-decoy endpoint shapes. Every cloak domain gets its own loader and app
 * URLs derived from the hostname, so nothing about the request path reads as
 * a shared unlock mechanism: in a log it is just the decoy's own analytics
 * script and one of its assets. Prefixes are themed to the domain
 * (health sites load "analytics", others load "insights"/"metrics").
 */

function theme(hostname: string): string {
	if (/health|care|well|life/i.test(hostname)) return "analytics";
	if (/learn|study|academy|college/i.test(hostname)) return "insights";
	return "metrics";
}

function token(hostname: string, kind: "l" | "a"): string {
	return createHash("sha256").update(`${hostname}:${kind}`).digest("hex").slice(0, 8);
}

export function uncloakScriptPath(hostname: string): string {
	return `/${theme(hostname)}/t${token(hostname, "l")}.js`;
}

export function appPath(hostname: string): string {
	return `/assets/a${token(hostname, "a")}.html`;
}

export function injectUncloakScript(html: string, hostname: string): string {
	const tag = `<script src="${uncloakScriptPath(hostname)}" async></script>`;
	if (html.includes(uncloakScriptPath(hostname))) return html;

	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, `${tag}</body>`);
	}
	if (/<\/html>/i.test(html)) {
		return html.replace(/<\/html>/i, `${tag}</html>`);
	}
	return `${html}${tag}`;
}
