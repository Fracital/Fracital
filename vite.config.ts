import "dotenv/config";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { stompPath } from "stomp-rewrite/path";
import { randomBytes } from "node:crypto";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { isWebOS } from "./src/types";
import { cloakRouting } from "./src/server/cloak-routing";
import { musicApi } from "./src/server/music-api";
import { shieldPlugin } from "./src/server/shield/vite-plugin";
import { buildObfuscatorPlugin } from "./src/server/build-obfuscator-plugin";

// The second proxy engine (stomp) ships under this neutral directory, which is
// also its service worker's scope. The file names are told to the engine at
// boot (`assets`), so no served URL carries the package name. Keep this map in
// step with STOMP_DIRECTORY / STOMP_ASSETS in src/libs/stompEngine.ts.
const STOMP_DIR = "vendor/rt";
const STOMP_FILES: [string, string][] = [
	["serviceWorker.js", "sw.js"],
	["injectDocument.js", "doc.js"],
	["injectWorker.js", "wk.js"],
	["transportWorker.js", "tw.js"],
	["rewriteWorker.js", "rw.js"],
	["controller.mjs", "api.mjs"],
];
// Source maps are pruned from dist; drop the pointer so nothing references a
// file that is not there.
const stripSourceMap = (content: string | Buffer) => content.toString().replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");

// The five helper globals stomp's rewriter, inject bundles and error page
// rendezvous on, minted once per build (and per dev server start) so a
// deployment never carries the package defaults. Each is an identifier no
// plain window has.
const mintHelperName = () => {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
	const bytes = randomBytes(6);
	return `$${Array.from(bytes, b => letters[b % letters.length]).join("")}`;
};
const mintHelperNames = () => {
	const names = new Set<string>();
	while (names.size < 5) names.add(mintHelperName());
	const [access, client, globalProxy, globalName, error] = names;
	return { access, client, globalProxy, globalName, error };
};
const stompNames = mintHelperNames();

// https://vite.dev/config/
export default defineConfig({
	define: {
		__STOMP_NAMES__: JSON.stringify(stompNames),
	},
	optimizeDeps: {
		include: ["music-metadata"],
		exclude: ["@ruffle-rs/ruffle"],
	},
	build: {
		rollupOptions: {
			output: {
				// Hash-only bundle names: no module names in shipped file names.
				entryFileNames: "assets/[hash].js",
				chunkFileNames: "assets/[hash].js",
				assetFileNames: "assets/[hash][extname]",
				manualChunks(id: string) {
					if (!id.includes("node_modules")) return undefined;
					// @fortawesome/react-fontawesome uses a tagged template
					// (String.raw) the shield VM does not support. Splitting it into a
					// vendor-only chunk keeps the app chunks compilable; this chunk is
					// third-party-only, ships native, and still gets string-encrypted
					// by the post-build obfuscator.
					if (id.includes("@fortawesome")) return "fortawesome";
					// music-metadata's per-format parser chunks must live in ONE vendor
					// chunk with the core: separate native parser chunks import the
					// shared core chunk, which the app also uses — a native→VM edge
					// that demotes the whole app out of the shield frontier.
					if (/music-metadata|strtok3|token-types|file-type|uint8array-extras|@tokenizer|content-type|media-typer/.test(id)) return "mmeta";
					return undefined;
				},
			},
		},
	},
	server: {
		fs: {
			allow: [".."],
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		cloakRouting(),
		// Compile every compilable chunk to encrypted VM bytecode. Compile mode is
		// the default; SHIELD_MODE=manifest is a local debug opt-out, never
		// shipped. Vendor-only chunks (React, parsers) stay native for main-thread
		// perf — they carry no app strings, and the post-build obfuscator still
		// encrypts their literals.
		shieldPlugin({
			mode: process.env.SHIELD_MODE === "manifest" ? "manifest" : "compile",
			nativeVendorChunks: true,
			// react-router's ESM build bundles a computed import(f.module) for lazy
			// route modules (a path this app never executes) into the entry chunk.
			computedImportFallback: "native-fallback",
		}),
		// Injects the per-build AES string registry (__FRX_STRINGS__ + #eckey) that
		// the HolyText family reveals into shadow DOM at runtime. Runs during
		// generateBundle; the shield's writeBundle rewrite composes after it.
		buildObfuscatorPlugin(),
		!isWebOS
			? viteStaticCopy({
					targets: [
						// Vendored proxy runtime ships under neutral paths; the packages'
						// real names must never appear in a URL. The controller's config
						// strings are rewritten to the renamed paths at copy time.
						{
							src: `${scramjetPath}/scramjet.js`.replace(/\\/g, "/"),
							dest: "vendor",
							rename: { stripBase: true, name: "core.js" },
							overwrite: true,
							// On pages with content outside <html> (Google sign-in etc.) the engine prepends its
							// scripts ahead of <!doctype>, which drops the page into quirks mode and breaks layout.
							// Insert them after any leading doctype instead.
							transform: (content: string | Buffer) => {
								const text = content.toString();
								const quirky = /(\w+)\.warn\(`detected quirky document structure parsing @ \$\{\w+\.origin\.href\}!`\),(\w+)\.root\.children\.unshift\(\.\.\.(\w+)\)/;
								if (!quirky.test(text)) throw new Error("vendor doctype patch target missing (engine package changed shape)");
								return text.replace(quirky, (_, _log, doc, scripts) => `${doc}.root.children.splice(${doc}.root.children.findIndex(n=>n.type==="directive")+1,0,...${scripts})`);
							},
						},
						{
							src: `${scramjetPath}/scramjet.wasm`.replace(/\\/g, "/"),
							dest: "vendor",
							rename: { stripBase: true, name: "core.wasm" },
							overwrite: true,
						},
						{
							src: "node_modules/@mercuryworkshop/scramjet-controller/dist/controller.api.js",
							dest: "vendor",
							rename: { stripBase: true, name: "ctl.js" },
							overwrite: true,
							transform: (content: string | Buffer) => {
								const text = content.toString();
								const pairs: [string, string][] = [
									["/scramjet/scramjet.js", "/vendor/core.js"],
									["/scramjet/scramjet.wasm", "/vendor/core.wasm"],
									["/controller/controller.inject.js", "/vendor/ctl.frame.js"],
								];
								let out = text;
								for (const [from, to] of pairs) {
									if (!out.includes(from)) throw new Error(`vendor config string missing: ${from} (controller package changed shape)`);
									out = out.split(from).join(to);
								}
								return out;
							},
						},
						{
							src: "node_modules/@mercuryworkshop/scramjet-controller/dist/controller.sw.js",
							dest: "vendor",
							rename: { stripBase: true, name: "ctl.sw.js" },
							overwrite: true,
						},
						{
							src: "node_modules/@mercuryworkshop/scramjet-controller/dist/controller.inject.js",
							dest: "vendor",
							rename: { stripBase: true, name: "ctl.frame.js" },
							overwrite: true,
						},
						// The stomp engine: the service worker, the two inject bundles, the
						// transport worker and the controller module, under neutral names.
						...STOMP_FILES.map(([from, to]) => ({
							src: `${stompPath}/${from}`.replace(/\\/g, "/"),
							dest: STOMP_DIR,
							rename: { stripBase: true as const, name: to },
							overwrite: true,
							transform: stripSourceMap,
						})),
						// The engine's error page, given the name of the global the service
						// worker sets on it (names.error); see src/stomp/error.html.
						{
							src: "src/stomp/error.html",
							dest: STOMP_DIR,
							rename: { stripBase: true, name: "err.html" },
							overwrite: true,
							transform: (content: string | Buffer) => {
								const text = content.toString();
								if (!text.includes("__STOMP_ERROR_NAME__")) throw new Error("error page placeholder missing (src/stomp/error.html changed shape)");
								return text.split("__STOMP_ERROR_NAME__").join(stompNames.error);
							},
						},
						// The transport module stomp's transport worker imports: epoxy over
						// the relay, the Fracital build (wasm inlined, one file).
						{
							src: "node_modules/@mercuryworkshop/epoxy-transport/dist/index.mjs",
							dest: STOMP_DIR,
							rename: { stripBase: true, name: "link.mjs" },
							overwrite: true,
						},
						// Transport engine wasm, self-hosted (never a CDN: filters
						// block jsdelivr and the relay dies with it).
						{
							src: "node_modules/libcurl.js/libcurl.wasm",
							dest: "vendor",
							rename: { stripBase: true, name: "net.wasm" },
							overwrite: true,
						},
						// Flash emulator, self-hosted for the same reason. Companion
						// chunks/wasm keep their content-hashed names; only the entry is
						// renamed. ruffle.js resolves its siblings relative to its own URL.
						{
							src: "node_modules/@ruffle-rs/ruffle/*.js",
							dest: "vendor/flash",
							rename: (name: string, ext: string) => (name === "ruffle" ? { stripBase: true as const, name: "player.js" } : { stripBase: true as const, name: `${name}.${ext}` }),
							overwrite: true,
						},
						{
							src: "node_modules/@ruffle-rs/ruffle/*.wasm",
							dest: "vendor/flash",
							rename: { stripBase: true },
							overwrite: true,
						},
						// Code editor, self-hosted (monaco's default loader pulls from
						// jsdelivr at runtime). The min/vs tree is self-contained: its
						// loader fetches chunks, css and fonts relative to itself.
						{
							src: "node_modules/monaco-editor/min/vs/**/*",
							dest: "vendor/editor/vs",
							rename: { stripBase: 4 },
							overwrite: true,
						},
					],
				})
			: null,
		{
			name: "vite-wisp-server",
			configureServer(server) {
				server.httpServer?.on("upgrade", (req: any, socket: any, head: any) => (req.url?.startsWith("/wisp") ? wisp.routeRequest(req, socket, head) : undefined));
			},
		},
		musicApi(),
	],
});
