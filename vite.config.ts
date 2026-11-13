import "dotenv/config";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { stompPath } from "@sysce/stomp/path";
import { randomBytes } from "node:crypto";
import { holyWispVite } from "holywisp/vite";
import { isWebOS } from "./src/types";
import { cloakRouting } from "./src/server/cloak-routing";
import { acceptedRelayPath, RELAY_OPTIONS } from "./src/server/relay-gate";
import { musicApi } from "./src/server/music-api";
import { shieldPlugin } from "./src/server/shield/vite-plugin";
import { buildObfuscatorPlugin } from "./src/server/build-obfuscator-plugin";
import { emojiData } from "./src/server/emoji-data";

// The second proxy engine (stomp) ships under this neutral directory, which is
// also its service worker's scope. The file names are told to the engine at
// boot (`assets`), so no served URL carries the package name. Keep this map in
// step with STOMP_DIRECTORY / STOMP_ASSETS in src/libs/stompEngine.ts.
const STOMP_DIR = "vendor/rt";
// Every file of the engine carries this build's stamp in its name (sw.js is
// served as sw.<stamp>.js), and the app is told the stamp (__BUILD_STAMP__).
// The files of two builds do not work together: the proxy transform gives
// each build its own message names (scripts/obfuscate-build.mjs), and the
// error page reads a global minted per build. Under fixed names a browser or
// an edge cache that still held one file of the last build, within its
// max-age, ran it against the new service worker, and the engine did not
// start until the entry expired. A stamped name is a new URL with every
// build, so what the app loads is of its own build whatever a cache holds,
// and the files can be cached for good (backend.ts).
//
// Scramjet's page files are stamped the same way (core.js, core.wasm, ctl.js,
// ctl.frame.js): the transform renames the classes they share per build, and
// the app shell, which is never cached, names them. So is the transport's
// wasm (net.wasm), which the transform also rewrites per build. Scramjet's
// worker file keeps a fixed name: /sw.js imports it, and it shares no renamed
// name with the rest.
const buildStamp = randomBytes(4).toString("hex");
const stamped = (name: string) => name.replace(/\.(?=[^.]+$)/, `.${buildStamp}.`);
// The two engine scripts the app shell (index.html) loads.
const SHELL_SCRIPTS = ["/vendor/core.js", "/vendor/ctl.js"];
const STOMP_FILES: [string, string][] = [
	["serviceWorker.js", stamped("sw.js")],
	["injectDocument.js", stamped("doc.js")],
	["injectWorker.js", stamped("wk.js")],
	["transportWorker.js", stamped("tw.js")],
	["rewriteWorker.js", stamped("rw.js")],
	["controller.mjs", stamped("api.mjs")],
];
// Source maps are pruned from dist; drop the pointer so nothing references a
// file that is not there.
const stripSourceMap = (content: string | Buffer) => content.toString().replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");

// UV: the bundle, its service worker, and the client and handler a proxied
// page loads, under neutral stamped names (pages load them, so two builds'
// files must never meet). UV_PREFIX and the shared worker's name are also in
// src/libs/uvEngine.ts.
const UV_DIR = "node_modules/@titaniumnetwork-dev/ultraviolet/dist";
const UV_PREFIX = "/~/v/";
const UV_FILES: [string, string][] = [
	["uv.bundle.js", stamped("pk.js")],
	["uv.sw.js", stamped("pw.js")],
	["uv.client.js", stamped("pc.js")],
	["uv.handler.js", stamped("ph.js")],
];
const UV_CONFIG = stamped("pf.js");
const vendorPath = (name: string) => `/vendor/${name}`;
const uvConfig = `self.__uv$config = ${JSON.stringify({ prefix: UV_PREFIX, handler: vendorPath(UV_FILES[3][1]), client: vendorPath(UV_FILES[2][1]), bundle: vendorPath(UV_FILES[0][1]), config: vendorPath(UV_CONFIG), sw: vendorPath(UV_FILES[1][1]) }).replace(/}$/, ",encodeUrl:Ultraviolet.codec.xor.encode,decodeUrl:Ultraviolet.codec.xor.decode}")};\n`;

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
		__BUILD_STAMP__: JSON.stringify(buildStamp),
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
					// Bundler helpers (commonjs interop, preload) are shared by vendor and
					// app code: kept with the vendor chunks so no native chunk imports a VM
					// one, which would demote the app out of the shield frontier.
					if (id.startsWith("\0")) return "rt";
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
					// Every other package gets its own third-party-only chunk, which ships
					// native (nativeVendorChunks). Left to the bundler, React, the router
					// and the rest land in the app chunks and run inside the VM, which
					// makes every render several times slower on low-end hardware.
					const pkg = id
						.split("node_modules/")
						.pop()
						?.match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[1];
					return pkg ? `v-${pkg}` : undefined;
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
		// The comment box's emoji, built from emojibase-data (see the plugin).
		emojiData(),
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
		!isWebOS && {
			name: "stamp-shell-scripts",
			transformIndexHtml(html: string) {
				for (const src of SHELL_SCRIPTS) {
					if (!html.includes(`"${src}"`)) throw new Error(`index.html no longer loads ${src}`);
					html = html.split(`"${src}"`).join(`"${stamped(src)}"`);
				}
				return html;
			},
		},
		!isWebOS
			? viteStaticCopy({
					targets: [
						// Vendored proxy runtime ships under neutral paths; the packages'
						// real names must never appear in a URL. The controller's config
						// strings are rewritten to the renamed paths at copy time.
						{
							src: `${scramjetPath}/scramjet.js`.replace(/\\/g, "/"),
							dest: "vendor",
							rename: { stripBase: true, name: stamped("core.js") },
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
							rename: { stripBase: true, name: stamped("core.wasm") },
							overwrite: true,
						},
						{
							src: "node_modules/@mercuryworkshop/scramjet-controller/dist/controller.api.js",
							dest: "vendor",
							rename: { stripBase: true, name: stamped("ctl.js") },
							overwrite: true,
							transform: (content: string | Buffer) => {
								const text = content.toString();
								const pairs: [string, string][] = [
									["/scramjet/scramjet.js", stamped("/vendor/core.js")],
									["/scramjet/scramjet.wasm", stamped("/vendor/core.wasm")],
									["/controller/controller.inject.js", stamped("/vendor/ctl.frame.js")],
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
							rename: { stripBase: true, name: stamped("ctl.frame.js") },
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
							rename: { stripBase: true, name: stamped("err.html") },
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
							rename: { stripBase: true, name: stamped("link.mjs") },
							overwrite: true,
						},
						// UV's files, its config, and the loader the service worker imports
						// (fixed name, as sw.js names it; it changes with every build, which
						// is what updates the worker).
						...UV_FILES.map(([from, to]) => ({
							src: `${UV_DIR}/${from}`,
							dest: "vendor",
							rename: { stripBase: true as const, name: to },
							overwrite: true,
							transform: stripSourceMap,
						})),
						{
							src: `${UV_DIR}/uv.config.js`,
							dest: "vendor",
							rename: { stripBase: true, name: UV_CONFIG },
							overwrite: true,
							transform: () => uvConfig,
						},
						{
							src: `${UV_DIR}/sw.js`,
							dest: "vendor",
							rename: { stripBase: true, name: "pl.js" },
							overwrite: true,
							transform: () => `importScripts(${[UV_FILES[0][1], UV_CONFIG, UV_FILES[1][1]].map(n => JSON.stringify(vendorPath(n))).join(", ")});\n`,
						},
						// bare-mux's shared worker: UV pages and the service worker reach
						// the app page's relay transport through it (uvEngine.ts).
						{
							src: "node_modules/@mercuryworkshop/bare-mux/dist/worker.js",
							dest: "vendor",
							rename: { stripBase: true, name: stamped("mx.js") },
							overwrite: true,
							transform: stripSourceMap,
						},
						// HTTP/3 for origins that offer it (stomp docs/http3.md): stomp-h3,
						// which the transport worker imports only once an origin advertises
						// h3. Neutral names; the module names its wasm, so that name is
						// rewritten to match.
						{
							src: "node_modules/@mercuryworkshop/epoxy-transport/dist/h3/stomp_h3.js",
							dest: STOMP_DIR,
							rename: { stripBase: true, name: stamped("q3.mjs") },
							overwrite: true,
							transform: (content: string | Buffer) => {
								const text = content.toString();
								if (!text.includes("stomp_h3_bg.wasm")) throw new Error("stomp-h3 no longer names stomp_h3_bg.wasm (epoxy build changed shape)");
								return text.split("stomp_h3_bg.wasm").join(stamped("q3.wasm"));
							},
						},
						{
							src: "node_modules/@mercuryworkshop/epoxy-transport/dist/h3/stomp_h3_bg.wasm",
							dest: STOMP_DIR,
							rename: { stripBase: true, name: stamped("q3.wasm") },
							overwrite: true,
						},
						// Transport engine wasm, self-hosted (never a CDN: filters
						// block jsdelivr and the relay dies with it).
						{
							src: "node_modules/libcurl.js/libcurl.wasm",
							dest: "vendor",
							rename: { stripBase: true, name: stamped("net.wasm") },
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
		// The relay for dev and preview: the legacy path the app falls back to, and
		// the gated path decoy pages are given when WISP_GATE_KEY is set.
		holyWispVite({
			path: req => req.url?.startsWith("/wisp") || req.url === acceptedRelayPath(),
			config: RELAY_OPTIONS,
		}),
		musicApi(),
	],
});
