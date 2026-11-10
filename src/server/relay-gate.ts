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
 *
 * The relay itself is holyWisp, a child process the backend (and the vite dev
 * server) starts and hands upgrades to; RELAY_OPTIONS is its config for both.
 */
import type { holywispOptions } from "holywisp";

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

/**
 * holyWisp's config. What the old in-process server did, plus the edge fleet's
 * numbers (abulxt roles/edge_wisp), which carry this site's relay traffic in
 * production; anything not set here keeps holyWisp's default.
 */
export const RELAY_OPTIONS: holywispOptions = {
	// A loopback port of its own, picked at start; route() is the only way in.
	host: "127.0.0.1",
	port: 0,
	// Cloudflare's family-filtering resolvers, IPv4 answers first.
	dnsServers: ["1.1.1.3", "1.0.0.3"],
	dnsResultOrder: "ipv4first",
	allowTCP: true,
	allowUDP: true,
	// Literal IPs in CONNECT, as before (holyWisp refuses them by default).
	allowDirectIP: true,
	allowPrivateIPs: false,
	allowLoopbackIPs: false,
	allowLinkLocalIPs: false,
	enableV2: true,
	// Clients come through OpenResty on this host, which sets both headers to
	// the end client. CF-Connecting-IP is not stripped there, so it is not trusted.
	trustedProxies: ["127.0.0.1", "::1"],
	trustedHeaders: ["X-Real-IP", "X-Forwarded-For"],
	// Off, as on the edges: on, the 101st stream per second to one origin is
	// closed, which a page bursting to one origin can hit.
	floodProtection: { enabled: false },
	// The family resolvers answer 0.0.0.0 / :: for a filtered name. holyWisp
	// refuses that (as the old server did) but by default also scores it as a
	// private-address probe, 15 points a stream, so a page with a few blocked
	// resources would lock its user out of the relay for hours.
	reputation: { weights: { privateEgress: 0 } },
	// The edges' flow-control numbers: 256 KiB messages, 64 MiB queued per stream.
	maxMessageSize: 262149,
	streamQueueMax: 64 * 1024 * 1024,
	bufferRemainingLength: 128,
	tcpNoDelay: true,
	serveWebclient: false,
	logLevel: "warn",
};
