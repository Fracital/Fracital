import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve, sep } from "node:path";
import type { MiddlewareHandler } from "hono";
import type { Plugin, UserConfig, ViteDevServer } from "vite";
import { parseRequestUrl } from "./request-url";
import { appPath, injectUncloakScript, uncloakScriptPath } from "./cloak-endpoints";
import { injectClientConfig } from "./relay-gate";
import { ensureSeedCookie } from "./api-crypto";

// The loader is served at a per-domain path from cloak-endpoints.ts (the decoy's
// own "analytics" script). This file only owns finding the source on disk.
const LEGACY_LOADER_SRC = "/8f3c1a.js";

export function getUncloakScriptContent(hostname: string): string {
	const candidatePaths = [
		new URL("./uncloak-client.js", import.meta.url),
		resolve(process.cwd(), "src/server/uncloak-client.js"),
		resolve(process.cwd(), "public", "8f3c1a.js"),
	];
	for (const candidate of candidatePaths) {
		if (existsSync(candidate)) {
			let source = readFileSync(candidate, "utf8");
			// The client pulls the app shell from the decoy's own per-domain asset URL.
			source = source.replace(/__FRX_APP_PATH__/g, appPath(hostname));
			return source;
		}
	}
	return "";
}

const contentTypes: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".xml": "application/xml; charset=utf-8",
};

export function expandHomePath(inputPath: string): string {
	if (inputPath === "~" || inputPath.startsWith("~/")) {
		return resolve(homedir(), inputPath.replace(/^~(?:\/|$)/, ""));
	}
	const fromCwd = resolve(process.cwd(), inputPath);
	if (existsSync(fromCwd)) return fromCwd;

	const fromParent = resolve(process.cwd(), "..", inputPath);
	if (existsSync(fromParent)) return fromParent;

	return fromCwd;
}

/**
 * Fracital's decoys live in the sibling cloaks-fracital checkout: one folder
 * per domain, each with a dist/ build. CLOAKS_DIR (or CLOAK_DIR) overrides.
 */
export function defaultCloaksDir(): string {
	const envDir = process.env.CLOAKS_DIR || process.env.CLOAK_DIR;
	if (envDir) return expandHomePath(envDir);
	const fromHome = expandHomePath("~/src/cloaks-fracital");
	if (existsSync(fromHome)) return fromHome;
	return resolve(process.cwd(), "..", "cloaks-fracital");
}

/** Hosts that always serve the real app, never a decoy. */
const directHosts = new Set(
	(process.env.CLOAK_DIRECT_HOSTS || "fracital.dev,fractial.dev,www.fracital.dev,www.fractial.dev")
		.split(",")
		.map((host) => host.trim().toLowerCase())
		.filter(Boolean),
);

/** @deprecated use cloak-endpoints.injectUncloakScript(html, hostname) */
export function injectUncloakScriptForHost(html: string, hostname: string): string {
	// Legacy single-name entry, kept so old bookmarks/deep links still resolve.
	if (html.includes(LEGACY_LOADER_SRC)) return html;
	return injectUncloakScript(html, hostname);
}

export interface CloakSiteConfig {
	cloaksDir: string;
	hosts: string[];
	hostRoots: Map<string, string>;
}

export function discoverCloakSites(configuredDir?: string): CloakSiteConfig {
	const dirPath = configuredDir ? expandHomePath(configuredDir) : defaultCloaksDir();

	const hosts: string[] = [];
	const hostRoots = new Map<string, string>();

	if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
		const entries = readdirSync(dirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const hostname = entry.name.toLowerCase();
			if (!isValidHostname(hostname)) continue;

			const hostDir = resolve(dirPath, entry.name);

			const distDir = resolve(hostDir, "dist");
			const targetRoot = existsSync(distDir) && statSync(distDir).isDirectory() ? distDir : hostDir;

			hosts.push(hostname);
			hostRoots.set(hostname, targetRoot);
		}
	}

	return { cloaksDir: dirPath, hosts, hostRoots };
}

function resolveFilePath(hostRoot: string, pathname: string): string | null {
	const safePath = pathname.replace(/^\/+/, "");
	const candidates: string[] = [];

	if (!safePath) {
		candidates.push(resolve(hostRoot, "index.html"));
	} else {
		candidates.push(resolve(hostRoot, safePath));
		candidates.push(resolve(hostRoot, safePath, "index.html"));
		if (!safePath.endsWith(".html")) {
			candidates.push(resolve(hostRoot, `${safePath}.html`));
		}
	}

	for (const candidate of candidates) {
		if (candidate.startsWith(`${hostRoot}${sep}`) && existsSync(candidate) && statSync(candidate).isFile()) {
			return candidate;
		}
	}

	return null;
}

function hostnameOf(rawHostHeader: string): string {
	const rawHost = rawHostHeader.split(",")[0].trim();
	const requestHostname = rawHost.split(":")[0].toLowerCase();
	return requestHostname.startsWith("www.") ? requestHostname.slice(4) : requestHostname;
}

/**
 * Vite plugin (dev + preview). Cloaked hosts get their decoy site from
 * cloaks-fracital with the uncloak script injected; the real Fracital bundle
 * is only reachable through /1.html after Ctrl+E, so a plain page load on a
 * cloak domain never touches the app, scramjet, or any client JS.
 */
export function cloakRouting(options?: { cloaksDir?: string }): Plugin {
	let cloakConfig: CloakSiteConfig;

	const registerMiddleware = (server: {
		middlewares: ViteDevServer["middlewares"];
		transformIndexHtml?: ViteDevServer["transformIndexHtml"];
	}) => {
		const hostSet = new Set(cloakConfig.hosts.map((h) => h.toLowerCase()));

		server.middlewares.use(async (request, response, next) => {
			try {
				const hostname = hostnameOf(((request.headers["x-forwarded-host"] || request.headers.host || "") as string) ?? "");

				const scriptPathname = decodeURIComponent(parseRequestUrl(request.url, "http://localhost").pathname);
				if (scriptPathname === uncloakScriptPath(hostname) || scriptPathname === "/8f3c1a.js") {
					response.statusCode = 200;
					response.setHeader("Content-Type", "text/javascript; charset=utf-8");

					response.setHeader("Cache-Control", "no-store");
					response.setHeader("CDN-Cache-Control", "no-store");
					response.end(getUncloakScriptContent(hostname));
					return;
				}

				if (directHosts.has(hostname)) return next();

				if (!hostSet.has(hostname)) return next();

				const hostRoot = cloakConfig.hostRoots.get(hostname);
				if (!hostRoot) return next();

				const pathname = scriptPathname;

				if (pathname.startsWith("/src/") || pathname.startsWith("/@") || pathname.startsWith("/node_modules/")) {
					return next();
				}

				if (pathname === "/1.html" || pathname === appPath(hostname)) {
					const mainIndex = resolve(process.cwd(), "index.html");
					const distIndex = resolve(process.cwd(), "dist", "index.html");
					const targetIndex = server.transformIndexHtml && existsSync(mainIndex) ? mainIndex : existsSync(distIndex) ? distIndex : mainIndex;

					if (existsSync(targetIndex)) {
						const raw = readFileSync(targetIndex, "utf8");
						const html = server.transformIndexHtml ? await server.transformIndexHtml(pathname, raw) : raw;
						response.statusCode = 200;
						response.setHeader("Content-Type", "text/html; charset=utf-8");
						response.setHeader("Cache-Control", "no-store");
						response.end(injectClientConfig(html));
						return;
					}
				}

				if (pathname.startsWith("/assets/")) {
					const distAsset = resolve(process.cwd(), "dist", pathname.replace(/^\/+/, ""));
					const publicAsset = resolve(process.cwd(), "public", pathname.replace(/^\/+/, ""));
					const target =
						existsSync(distAsset) && statSync(distAsset).isFile()
							? distAsset
							: existsSync(publicAsset) && statSync(publicAsset).isFile()
								? publicAsset
								: null;
					if (target) {
						const ext = extname(target).toLowerCase();
						const mime = contentTypes[ext] || "application/octet-stream";
						response.statusCode = 200;
						response.setHeader("Content-Type", mime);
						response.end(readFileSync(target));
						return;
					}
					return next();
				}

				const filePath = resolveFilePath(hostRoot, pathname);
				if (!filePath) {
					return next();
				}

				const ext = extname(filePath).toLowerCase();
				const mime = contentTypes[ext] || "application/octet-stream";

				if (ext === ".html") {
					const rawContent = readFileSync(filePath, "utf8");
					const injectedHtml = injectUncloakScript(rawContent, hostname);
					const finalHtml = server.transformIndexHtml ? await server.transformIndexHtml(pathname, injectedHtml) : injectedHtml;

					response.statusCode = 200;
					response.setHeader("Content-Type", "text/html; charset=utf-8");
					response.setHeader("Cache-Control", "no-cache");
					response.end(finalHtml);
					return;
				}

				const content = readFileSync(filePath);
				response.statusCode = 200;
				response.setHeader("Content-Type", mime);
				response.end(content);
			} catch (error) {
				next(error);
			}
		});
	};

	return {
		name: "cloak-routing",
		configResolved(config) {
			const configuredDir =
				options?.cloaksDir || config.env?.CLOAKS_DIR || config.env?.CLOAK_DIR || process.env.CLOAKS_DIR || process.env.CLOAK_DIR;
			cloakConfig = discoverCloakSites(configuredDir);
		},
		config(config: UserConfig) {
			const initialCloak = discoverCloakSites(options?.cloaksDir);
			const allowed = initialCloak.hosts.flatMap((h) => [h, `www.${h}`]);

			return {
				server: {
					allowedHosts:
						config.server?.allowedHosts === true
							? true
							: [...(Array.isArray(config.server?.allowedHosts) ? config.server.allowedHosts : []), ...allowed],
				},
				preview: {
					allowedHosts:
						config.preview?.allowedHosts === true
							? true
							: [...(Array.isArray(config.preview?.allowedHosts) ? config.preview.allowedHosts : []), ...allowed],
				},
			};
		},
		configureServer(server) {
			registerMiddleware(server);
		},
		configurePreviewServer(server) {
			registerMiddleware(server);
		},
	};
}

/**
 * Hono middleware (production, backend.ts). Same rules as the vite plugin:
 * decoy static files on cloak hosts with the uncloak script injected,
 * /1.html serving the built app, everything else falling through to the
 * normal API/static handlers.
 */
export function cloakMiddleware(options: { distDir: string; cloaksDir?: string }): MiddlewareHandler {
	const cloakConfig = discoverCloakSites(options.cloaksDir);
	const hostSet = new Set(cloakConfig.hosts.map((h) => h.toLowerCase()));

	return async (c, next) => {
		const hostname = hostnameOf(c.req.header("x-forwarded-host") || c.req.header("host") || "");

		let pathname: string;
		try {
			pathname = decodeURIComponent(parseRequestUrl(c.req.url).pathname);
		} catch {
			pathname = c.req.path;
		}

		if (pathname === uncloakScriptPath(hostname) || pathname === "/8f3c1a.js") {
			c.header("Content-Type", "text/javascript; charset=utf-8");
			c.header("Cache-Control", "no-store");
			c.header("CDN-Cache-Control", "no-store");
			return c.body(getUncloakScriptContent(hostname));
		}

		if (directHosts.has(hostname)) return next();

		if (!hostSet.has(hostname)) return next();

		const hostRoot = cloakConfig.hostRoots.get(hostname);
		if (!hostRoot) return next();

		if (pathname === "/1.html" || pathname === appPath(hostname)) {
			const distIndex = resolve(options.distDir, "index.html");
			if (existsSync(distIndex)) {
				ensureSeedCookie(c);
				c.header("Cache-Control", "no-store");
				return c.html(injectClientConfig(readFileSync(distIndex, "utf8")));
			}
			return next();
		}

		const filePath = resolveFilePath(hostRoot, pathname);
		if (!filePath) return next();

		const ext = extname(filePath).toLowerCase();
		const mime = contentTypes[ext] || "application/octet-stream";

		if (ext === ".html") {
			c.header("Cache-Control", "no-cache");
			return c.html(injectUncloakScript(readFileSync(filePath, "utf8"), hostname));
		}

		c.header("Content-Type", mime);
		return c.body(new Uint8Array(readFileSync(filePath)));
	};
}

export function isValidHostname(name: string): boolean {
	if (!name || name.length > 253) return false;
	if (name.startsWith(".") || name.endsWith(".") || name.startsWith("_")) return false;

	const labels = name.split(".");
	if (labels.length < 2) return false;

	const tld = labels[labels.length - 1];
	if (!/^[a-zA-Z]{2,}$/.test(tld) && !/^xn--[a-zA-Z0-9]+$/i.test(tld)) {
		return false;
	}

	const labelRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
	for (const label of labels) {
		if (!labelRegex.test(label)) return false;
	}

	return true;
}
