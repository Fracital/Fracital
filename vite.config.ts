import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
// @ts-expect-error no types
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
// @ts-expect-error No types
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { isWebOS } from "./src/types";

// https://vite.dev/config/
export default defineConfig({
	optimizeDeps: {
		include: ["music-metadata"],
		exclude: ["@ruffle-rs/ruffle"],
	},
	server: {
		fs: {
			allow: [".."],
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		!isWebOS
			? viteStaticCopy({
					targets: [
						{
							src: `${baremuxPath}/**/*`.replace(/\\/g, "/"),
							dest: "baremux",
							overwrite: false,
						},
						{
							src: `${epoxyPath}/**/*`.replace(/\\/g, "/"),
							dest: "epoxy",
							overwrite: false,
						},
						{
							src: `${scramjetPath}/**/*`.replace(/\\/g, "/"),
							dest: "scramjet",
							overwrite: true,
						},
						{
							src: `${uvPath}/**/*`.replace(/\\/g, "/"),
							dest: "uv",
							overwrite: false,
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
	],
});
