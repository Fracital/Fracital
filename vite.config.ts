import "dotenv/config";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { isWebOS } from "./src/types";
import { cloakRouting } from "./src/server/cloak-routing";
import { musicApi } from "./src/server/music-api";
import { shieldPlugin } from "./src/server/shield/vite-plugin";
import { buildObfuscatorPlugin } from "./src/server/build-obfuscator-plugin";

// https://vite.dev/config/
export default defineConfig({
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
							rename: "core.js",
							overwrite: true,
						},
						{
							src: `${scramjetPath}/scramjet.wasm`.replace(/\\/g, "/"),
							dest: "vendor",
							rename: "core.wasm",
							overwrite: true,
						},
						{
							src: "node_modules/@mercuryworkshop/scramjet-controller/dist/controller.api.js",
							dest: "vendor",
							rename: "ctl.js",
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
							rename: "ctl.sw.js",
							overwrite: true,
						},
						{
							src: "node_modules/@mercuryworkshop/scramjet-controller/dist/controller.inject.js",
							dest: "vendor",
							rename: "ctl.frame.js",
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
