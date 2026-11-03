import { createServer, type IncomingMessage } from "node:http";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
import { stream } from "hono/streaming";
import config from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "./package.json";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { create as createYoutubeDl } from "youtube-dl-exec";
import ytSearch from "yt-search";

export function fsrv() {
	config.config();
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = path.dirname(__filename);

	console.log("Starting Fracital...");
	const app = new Hono();

	const port = Number.parseInt(process.env.PORT || "8080", 10);

	app.use(
		"*",
		cors({
			origin: `http://localhost:${port}`,
			allowMethods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
			credentials: true,
		}),
	);

	const masqrCheck = process.env.MASQR && process.env.MASQR.toLowerCase() === "true";
	if (masqrCheck) {
		console.log("Masqr is Enabled");
	} else {
		console.log("Masqr is Disabled");
	}

	async function MasqFail(c: any) {
		const host = c.req.header("host");
		if (!host) {
			return c.html(fs.readFileSync("fail.html", "utf8"));
		}
		const safeHost = host.split(":")[0].replace(/[^a-zA-Z0-9-_\.]/g, "");
		const safeFilename = path.basename(`${safeHost}.html`);
		const safeJoin = path.join(process.cwd(), "Masqrd", safeFilename);
		try {
			await fs.promises.access(safeJoin);
			const failureFileLocal = await fs.promises.readFile(safeJoin, "utf8");
			return c.html(failureFileLocal);
		} catch {
			return c.html(fs.readFileSync("fail.html", "utf8"));
		}
	}

	if (masqrCheck) {
		const whitelisted = (process.env.WHITELISTED_DOMAINS || "")
			.split(",")
			.map(s => s.trim())
			.filter(Boolean);

		app.use("*", async (c, next) => {
			const host = c.req.header("host") ?? "";
			if (host && whitelisted.includes(host)) {
				await next();
				return;
			}
			if (c.req.url.includes("/bare")) {
				await next();
				return;
			}
			if (getCookie(c, "authcheck")) {
				await next();
				return;
			}
			if (getCookie(c, "refreshcheck") !== "true") {
				setCookie(c, "refreshcheck", "true", { maxAge: 10000 });
				return await MasqFail(c);
			}
			const authheader = c.req.header("authorization");
			if (!authheader) {
				c.header("WWW-Authenticate", "Basic");
				c.status(401);
				return await MasqFail(c);
			}
			const token = authheader.split(" ")[1] ?? "";
			let user = "";
			let pass = "";
			try {
				const decoded = Buffer.from(token, "base64").toString();
				[user, pass] = decoded.split(":");
			} catch {
				return await MasqFail(c);
			}
			const licenseResp = await fetch(`${process.env.LICENSE_SERVER_URL}${encodeURIComponent(pass)}&host=${encodeURIComponent(host)}`);
			const licenseCheck = (await licenseResp.json())?.status;
			console.log(`\x1b[0m${process.env.LICENSE_SERVER_URL}${pass}&host=${host} returned: ${licenseCheck}`);
			if (licenseCheck === "License valid") {
				setCookie(c, "authcheck", "true", {
					expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
				});
				return c.redirect("/");
			}
			return await MasqFail(c);
		});
	}

	// ============================================================
	// Music API
	// ============================================================
	const ytDlpPath = process.env.YT_DLP_PATH || "yt-dlp";
	const youtubeDl = createYoutubeDl(ytDlpPath);
	const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
	const trackToVideoCache = new Map<string, string>();
	const streamUrlCache = new Map<string, { url: string; at: number }>();
	const STREAM_URL_TTL = 15 * 60_000;

	const artworkHd = (url: string | undefined) => (url || "").replace(/\d+x\d+bb/, "600x600bb");

	const findVideoId = async (title: string, artist: string): Promise<string | null> => {
		try {
			const r = (await ytSearch(`${artist} ${title} official audio`)) as { videos?: { videoId?: string }[] };
			return r.videos?.find(v => v.videoId && videoIdPattern.test(v.videoId))?.videoId || null;
		} catch { return null; }
	};

	app.get("/api/music/health", c => c.json({ status: "ok", caches: { videos: trackToVideoCache.size, streams: streamUrlCache.size } }));

	app.get("/api/music/search", async c => {
		const q = c.req.query("q")?.trim();
		if (!q) return c.json({ tracks: [], albums: [] });
		const limit = Math.min(Number(c.req.query("limit")) || 24, 50);
		try {
			const ir = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=${limit}&country=US`, { headers: { Accept: "application/json" } });
			if (!ir.ok) throw new Error(`iTunes ${ir.status}`);
			const catalog = (await ir.json()) as { results?: any[] };
			const candidates = (catalog.results || []).filter((i: any) => i.wrapperType === "track" && i.kind === "song" && i.trackName && i.artistName);
			const albumMap = new Map<string, any>();
			for (const item of catalog.results || []) {
				if (item.collectionId && item.collectionName && !albumMap.has(String(item.collectionId)))
					albumMap.set(String(item.collectionId), { id: String(item.collectionId), title: item.collectionName, artist: item.artistName || "", artwork: artworkHd(item.artworkUrl100) });
			}
			const tracks = (await Promise.all(candidates.map(async (item: any) => {
				const vid = await findVideoId(item.trackName, item.artistName);
				if (!vid) return null;
				if (item.trackId) trackToVideoCache.set(String(item.trackId), vid);
				return {
					id: String(item.trackId || vid), title: item.trackName, artist: item.artistName,
					album: item.collectionName || undefined, albumId: item.collectionId ? String(item.collectionId) : undefined,
					duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
					streamUrl: `/api/music/playback/${vid}?fallback=${encodeURIComponent(item.previewUrl || "")}`,
					previewUrl: item.previewUrl || "", explicit: item.trackExplicitness === "explicit",
				};
			}))).filter(Boolean);
			return c.json({ tracks, albums: [...albumMap.values()].slice(0, 12) });
		} catch (err: any) { return c.json({ error: err.message }, 502); }
	});

	app.get("/api/music/album/:id", async c => {
		const id = c.req.param("id");
		try {
			const ir = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song`, { headers: { Accept: "application/json" } });
			if (!ir.ok) throw new Error(`iTunes ${ir.status}`);
			const catalog = (await ir.json()) as { results?: any[] };
			const results = catalog.results || [];
			const col = results.find((r: any) => r.wrapperType === "collection");
			const songs = results.filter((r: any) => r.wrapperType === "track" && r.kind === "song");
			const album = col ? { id: String(col.collectionId), title: col.collectionName, artist: col.artistName, artwork: artworkHd(col.artworkUrl100), trackCount: col.trackCount, releaseDate: col.releaseDate } : { id, title: "Album", artist: "", artwork: "" };
			const tracks = songs.map((item: any) => ({
				id: String(item.trackId), title: item.trackName || "Unknown", artist: item.artistName || "",
				album: item.collectionName || album.title, albumId: String(item.collectionId || id),
				duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100) || album.artwork,
				streamUrl: `/api/music/playback/${item.trackId}?fallback=${encodeURIComponent(item.previewUrl || "")}&title=${encodeURIComponent(item.trackName || "")}&artist=${encodeURIComponent(item.artistName || "")}`,
				previewUrl: item.previewUrl || "", explicit: item.trackExplicitness === "explicit",
			}));
			return c.json({ album, tracks });
		} catch (err: any) { return c.json({ error: err.message }, 502); }
	});

	app.get("/api/music/artist/:id", async c => {
		const id = c.req.param("id");
		try {
			const [sr, ar] = await Promise.all([
				fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song&limit=20`, { headers: { Accept: "application/json" } }),
				fetch(`https://itunes.apple.com/lookup?id=${id}&entity=album&limit=20`, { headers: { Accept: "application/json" } }),
			]);
			const sd = (await sr.json()) as { results?: any[] };
			const ad = (await ar.json()) as { results?: any[] };
			const rec = (sd.results || [])[0] || (ad.results || [])[0];
			const artist = { id: String(rec?.artistId || id), name: rec?.artistName || "Unknown", picture: artworkHd(rec?.artworkUrl100) };
			const tracks = (sd.results || []).filter((r: any) => r.wrapperType === "track" && r.kind === "song").map((item: any) => ({
				id: String(item.trackId), title: item.trackName, artist: item.artistName, album: item.collectionName,
				albumId: item.collectionId ? String(item.collectionId) : undefined,
				duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
				streamUrl: `/api/music/playback/${item.trackId}?fallback=${encodeURIComponent(item.previewUrl || "")}&title=${encodeURIComponent(item.trackName || "")}&artist=${encodeURIComponent(item.artistName || "")}`,
				previewUrl: item.previewUrl || "", explicit: item.trackExplicitness === "explicit",
			}));
			const albums = (ad.results || []).filter((r: any) => r.wrapperType === "collection").map((r: any) => ({
				id: String(r.collectionId), title: r.collectionName, artist: r.artistName, artwork: artworkHd(r.artworkUrl100), trackCount: r.trackCount, releaseDate: r.releaseDate,
			}));
			return c.json({ artist, tracks, albums });
		} catch (err: any) { return c.json({ error: err.message }, 502); }
	});

	app.get("/api/music/charts", async c => {
		const limit = Math.min(Number(c.req.query("limit")) || 25, 50);
		try {
			const ir = await fetch(`https://itunes.apple.com/search?term=top+hits+2026&entity=song&limit=${limit}&country=US`, { headers: { Accept: "application/json" } });
			const catalog = (await ir.json()) as { results?: any[] };
			const songs = (catalog.results || []).filter((r: any) => r.wrapperType === "track" && r.kind === "song");
			const albumMap = new Map<string, any>();
			const tracks = songs.map((item: any) => {
				if (item.collectionId && !albumMap.has(String(item.collectionId)))
					albumMap.set(String(item.collectionId), { id: String(item.collectionId), title: item.collectionName, artist: item.artistName, artwork: artworkHd(item.artworkUrl100) });
				return {
					id: String(item.trackId), title: item.trackName, artist: item.artistName, album: item.collectionName,
					albumId: item.collectionId ? String(item.collectionId) : undefined,
					duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
					streamUrl: `/api/music/playback/${item.trackId}?fallback=${encodeURIComponent(item.previewUrl || "")}&title=${encodeURIComponent(item.trackName || "")}&artist=${encodeURIComponent(item.artistName || "")}`,
					previewUrl: item.previewUrl || "", explicit: item.trackExplicitness === "explicit",
				};
			});
			return c.json({ tracks, albums: [...albumMap.values()].slice(0, 12) });
		} catch (err: any) { return c.json({ error: err.message }, 502); }
	});

	app.get("/api/music/playback/:id", async c => {
		const id = c.req.param("id");
		let fallback = c.req.query("fallback") || "";
		const titleHint = c.req.query("title") || "";
		const artistHint = c.req.query("artist") || "";
		const warm = c.req.query("warm") === "1";

		let videoId: string | null = null;
		if (videoIdPattern.test(id)) { videoId = id; }
		else if (/^\d+$/.test(id)) {
			videoId = trackToVideoCache.get(id) || null;
			if (!videoId) {
				let t = titleHint, a = artistHint;
				if (!t || !a) {
					try {
						const lr = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song`);
						const ld = (await lr.json()) as { results?: any[] };
						const tr = ld.results?.find((r: any) => r.wrapperType === "track");
						if (tr) { t = t || tr.trackName; a = a || tr.artistName; if (!fallback && tr.previewUrl) fallback = tr.previewUrl; }
					} catch {}
				}
				if (t && a) { videoId = await findVideoId(t, a); if (videoId) trackToVideoCache.set(id, videoId); }
			}
		}

		if (!videoId) {
			if (fallback.startsWith("https://")) return c.redirect(fallback, 302);
			return c.json({ error: "Could not resolve track" }, 400);
		}

		if (warm) {
			try {
				const cached = streamUrlCache.get(videoId);
				if (!cached || Date.now() - cached.at > STREAM_URL_TTL) {
					const result = (await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, { format: "bestaudio/best", getUrl: true, forceIpv4: true }, { timeout: 20_000 })) as unknown as string;
					const url = String(result).trim().split("\n")[0];
					if (url.startsWith("http")) streamUrlCache.set(videoId, { url, at: Date.now() });
				}
			} catch {}
			return c.body(null, 204);
		}

		try {
			const cached = streamUrlCache.get(videoId);
			let streamUrl = cached && Date.now() - cached.at < STREAM_URL_TTL ? cached.url : "";
			if (!streamUrl) {
				const result = (await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, { format: "bestaudio/best", getUrl: true, forceIpv4: true }, { timeout: 20_000 })) as unknown as string;
				streamUrl = String(result).trim().split("\n")[0];
				if (!streamUrl.startsWith("http")) throw new Error("yt-dlp failed");
				streamUrlCache.set(videoId, { url: streamUrl, at: Date.now() });
			}

			const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0", Referer: "https://www.youtube.com/" };
			const range = c.req.header("range");
			if (range) headers.Range = range;

			const upstream = await fetch(streamUrl, { headers });
			if (!upstream.ok || !upstream.body) throw new Error(`Upstream ${upstream.status}`);

			const respHeaders = new Headers();
			for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
				const v = upstream.headers.get(name);
				if (v) respHeaders.set(name, v);
			}
			respHeaders.set("Cache-Control", "private, max-age=3600");

			return stream(c, async s => {
				const reader = upstream.body!.getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						await s.write(value);
					}
				} finally {
					reader.cancel().catch(() => {});
				}
			}, undefined, respHeaders);
		} catch (err: any) {
			if (fallback.startsWith("https://")) return c.redirect(fallback, 302);
			return c.json({ error: err.message }, 502);
		}
	});

	// ============================================================

	app.use(
		"*",
		serveStatic({
			root: path.join(__dirname, "dist"),
		}),
	);
	wisp.options.dns_method = "resolve";
	wisp.options.dns_servers = ["1.1.1.3", "1.0.0.3"];
	wisp.options.dns_result_order = "ipv4first";
	const server = createServer(
		getRequestListener(app.fetch, {
			errorHandler: err => {
				console.error(err);
				return new Response("Internal Server Error", { status: 500 });
			},
		}),
	);

	server.on("upgrade", (req: IncomingMessage, socket: any, head: Buffer) => {
		if (req.url?.endsWith("/wisp/")) {
			wisp.routeRequest(req as any, socket as any, head as any);
		} else {
			socket.destroy();
		}
	});

	server.listen(port, () => {
		console.log(`\x1b[38;2;251;116;254mFracital v${version} is running on port ${port}\x1b[0m`);
	});

	process.on("SIGINT", () => {
		console.log("\x1b[0m");
		process.exit();
	});
}

fsrv();
