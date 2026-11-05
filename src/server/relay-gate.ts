/**
 * Relay gate: the websocket relay endpoint lives at a keyed, neutral path so
 * the protocol name never appears on the wire and scanners can't find an open
 * relay. The key comes from WISP_GATE_KEY (per-host env, never committed).
 *
 * The client learns the path from a small inline config block the server
 * injects into the app shell at serve time (`window.__FRX_CFG__`). Key names
 * in that block stay neutral ("relay") so the shipped HTML has no protocol
 * fingerprints. When no key is configured (local dev), the client and server
 * both fall back to the legacy path.
 */

const RELAY_SEGMENT = "pipe";
const LEGACY_PATH = "/wisp/";

export function relayGateKey(): string {
	return process.env.WISP_GATE_KEY ?? "";
}

/** The server-side relay path, or "" when no gate key is configured. */
export function relayPath(): string {
	const key = relayGateKey();
	return key ? `/${RELAY_SEGMENT}/${key}/` : "";
}

/** The path the upgrade handler accepts right now (gated, or legacy in dev). */
export function acceptedRelayPath(): string {
	return relayPath() || LEGACY_PATH;
}

/** Neutral client config injected into the app shell. */
export function injectClientConfig(html: string): string {
	if (html.includes("__FRX_CFG__")) return html;
	const tag = `<script>window.__FRX_CFG__=${JSON.stringify({ relay: acceptedRelayPath() })};</script>`;
	if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
	return tag + html;
}
