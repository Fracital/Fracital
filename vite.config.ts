import "dotenv/config";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { isWebOS } from "./src/types";
import { musicApi } from "./src/server/music-api";

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
							src: `${scramjetPath}/**/*`.replace(/\\/g, "/"),
							dest: "scramjet",
							overwrite: true,
						},
						{
							src: "node_modules/@mercuryworkshop/scramjet-controller/dist/*",
							dest: "controller",
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
