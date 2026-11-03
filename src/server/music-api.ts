import type { Plugin, ViteDevServer } from "vite";
import { create as createYoutubeDl } from "youtube-dl-exec";
import ytSearch from "yt-search";

interface ItunesTrack {
	trackId?: number;
	trackName?: string;
	artistName?: string;
	artistId?: number;
	collectionId?: number;
	collectionName?: string;
	trackTimeMillis?: number;
	artworkUrl100?: string;
	previewUrl?: string;
	wrapperType?: string;
	kind?: string;
	trackExplicitness?: string;
	trackCount?: number;
	releaseDate?: string;
}

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const trackToVideoCache = new Map<string, string>();
const streamUrlCache = new Map<string, { url: string; at: number }>();
const STREAM_URL_TTL = 15 * 60_000;

function sendJson(res: import("node:http").ServerResponse, status: number, data: unknown) {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(data));
}

function parseUrl(raw: string | undefined): URL {
	return new URL(raw || "/", "http://localhost");
}

function artworkHd(url: string | undefined): string {
	return (url || "").replace(/\d+x\d+bb/, "600x600bb");
}

async function findYoutubeVideoId(title: string, artist: string): Promise<string | null> {
	try {
		const result = (await ytSearch(`${artist} ${title} official audio`)) as { videos?: { videoId?: string }[] };
		return result.videos?.find((v) => v.videoId && videoIdPattern.test(v.videoId))?.videoId || null;
	} catch {
		return null;
	}
}

async function lookupItunesTrack(id: string): Promise<{ title: string; artist: string; preview: string } | null> {
	try {
		const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song`, { headers: { Accept: "application/json" } });
		if (!res.ok) return null;
		const data = (await res.json()) as { results?: ItunesTrack[] };
		const track = data.results?.find((r) => r.wrapperType === "track");
		if (!track?.trackName || !track?.artistName) return null;
		return { title: track.trackName, artist: track.artistName, preview: track.previewUrl || "" };
	} catch {
		return null;
	}
}

function registerMusicApi(server: { middlewares: ViteDevServer["middlewares"] }, apiBase: string, resolverPath: string) {
	const youtubeDl = createYoutubeDl(resolverPath);

	server.middlewares.use(`${apiBase}/search`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const query = parseUrl(req.url).searchParams.get("q")?.trim();
		if (!query) return sendJson(res, 200, { tracks: [], albums: [] });
		const limit = Math.min(Number(parseUrl(req.url).searchParams.get("limit")) || 24, 50);

		try {
			const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}&country=US`, { headers: { Accept: "application/json" } });
			if (!itunesRes.ok) throw new Error(`iTunes ${itunesRes.status}`);
			const catalog = (await itunesRes.json()) as { results?: ItunesTrack[] };
			const candidates = (catalog.results || []).filter((i) => i.wrapperType === "track" && i.kind === "song" && i.trackName && i.artistName);

			const albumMap = new Map<string, { id: string; title: string; artist: string; artwork: string }>();
			for (const item of catalog.results || []) {
				if (item.collectionId && item.collectionName && !albumMap.has(String(item.collectionId))) {
					albumMap.set(String(item.collectionId), { id: String(item.collectionId), title: item.collectionName, artist: item.artistName || "", artwork: artworkHd(item.artworkUrl100) });
				}
			}

			const tracks = (
				await Promise.all(
					candidates.map(async (item) => {
						const videoId = await findYoutubeVideoId(item.trackName!, item.artistName!);
						if (!videoId) return null;
						if (item.trackId) trackToVideoCache.set(String(item.trackId), videoId);
						return {
							id: String(item.trackId || videoId),
							title: item.trackName!,
							artist: item.artistName!,
							album: item.collectionName || undefined,
							albumId: item.collectionId ? String(item.collectionId) : undefined,
							duration: Math.round((item.trackTimeMillis || 0) / 1000),
							artwork: artworkHd(item.artworkUrl100),
							streamUrl: `${apiBase}/playback/${videoId}?fallback=${encodeURIComponent(item.previewUrl || "")}`,
							previewUrl: item.previewUrl || "",
							explicit: item.trackExplicitness === "explicit",
						};
					}),
				)
			).filter((t): t is NonNullable<typeof t> => t !== null);

			sendJson(res, 200, { tracks, albums: [...albumMap.values()].slice(0, 12) });
		} catch (err) {
			sendJson(res, 502, { error: err instanceof Error ? err.message : "Search failed" });
		}
	});

	server.middlewares.use(`${apiBase}/album`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const id = decodeURIComponent(parseUrl(req.url).pathname.replace(/^\//, ""));
		if (!id) return sendJson(res, 400, { error: "Missing album ID" });

		try {
			const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song`, { headers: { Accept: "application/json" } });
			if (!itunesRes.ok) throw new Error(`iTunes ${itunesRes.status}`);
			const catalog = (await itunesRes.json()) as { results?: any[] };
			const results = catalog.results || [];
			const collection = results.find((r: any) => r.wrapperType === "collection");
			const songs = results.filter((r: any) => r.wrapperType === "track" && r.kind === "song");

			const album = collection
				? { id: String(collection.collectionId), title: collection.collectionName, artist: collection.artistName, artistId: collection.artistId ? String(collection.artistId) : undefined, artwork: artworkHd(collection.artworkUrl100), trackCount: collection.trackCount, releaseDate: collection.releaseDate }
				: { id, title: "Album", artist: "", artwork: "" };

			const tracks = songs.map((item: any) => ({
				id: String(item.trackId),
				title: item.trackName || "Unknown",
				artist: item.artistName || "",
				album: item.collectionName || album.title,
				albumId: String(item.collectionId || id),
				duration: Math.round((item.trackTimeMillis || 0) / 1000),
				artwork: artworkHd(item.artworkUrl100) || album.artwork,
				streamUrl: `${apiBase}/playback/${item.trackId}?fallback=${encodeURIComponent(item.previewUrl || "")}&title=${encodeURIComponent(item.trackName || "")}&artist=${encodeURIComponent(item.artistName || "")}`,
				previewUrl: item.previewUrl || "",
				explicit: item.trackExplicitness === "explicit",
			}));

			sendJson(res, 200, { album, tracks });
		} catch (err) {
			sendJson(res, 502, { error: err instanceof Error ? err.message : "Album lookup failed" });
		}
	});

	server.middlewares.use(`${apiBase}/artist`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const id = decodeURIComponent(parseUrl(req.url).pathname.replace(/^\//, ""));
		if (!id) return sendJson(res, 400, { error: "Missing artist ID" });

		try {
			const [songsRes, albumsRes] = await Promise.all([
				fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song&limit=20`, { headers: { Accept: "application/json" } }),
				fetch(`https://itunes.apple.com/lookup?id=${id}&entity=album&limit=20`, { headers: { Accept: "application/json" } }),
			]);
			const songsData = (await songsRes.json()) as { results?: any[] };
			const albumsData = (await albumsRes.json()) as { results?: any[] };
			const artistRecord = (songsData.results || [])[0] || (albumsData.results || [])[0];

			const artist = { id: String(artistRecord?.artistId || id), name: artistRecord?.artistName || "Unknown Artist", picture: artworkHd(artistRecord?.artworkUrl100 || "") };
			const tracks = (songsData.results || [])
				.filter((r: any) => r.wrapperType === "track" && r.kind === "song")
				.map((item: any) => ({
					id: String(item.trackId), title: item.trackName, artist: item.artistName, album: item.collectionName,
					albumId: item.collectionId ? String(item.collectionId) : undefined,
					duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
					streamUrl: `${apiBase}/playback/${item.trackId}?fallback=${encodeURIComponent(item.previewUrl || "")}&title=${encodeURIComponent(item.trackName || "")}&artist=${encodeURIComponent(item.artistName || "")}`,
					previewUrl: item.previewUrl || "", explicit: item.trackExplicitness === "explicit",
				}));
			const albums = (albumsData.results || [])
				.filter((r: any) => r.wrapperType === "collection")
				.map((r: any) => ({ id: String(r.collectionId), title: r.collectionName, artist: r.artistName, artwork: artworkHd(r.artworkUrl100), trackCount: r.trackCount, releaseDate: r.releaseDate }));

			sendJson(res, 200, { artist, tracks, albums });
		} catch (err) {
			sendJson(res, 502, { error: err instanceof Error ? err.message : "Artist lookup failed" });
		}
	});

	server.middlewares.use(`${apiBase}/charts`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const limit = Math.min(Number(parseUrl(req.url).searchParams.get("limit")) || 25, 50);
		try {
			const itunesRes = await fetch(`https://itunes.apple.com/search?term=top+hits+2026&entity=song&limit=${limit}&country=US`, { headers: { Accept: "application/json" } });
			const catalog = (await itunesRes.json()) as { results?: ItunesTrack[] };
			const songs = (catalog.results || []).filter((r) => r.wrapperType === "track" && r.kind === "song");
			const albumMap = new Map<string, any>();
			const tracks = songs.map((item) => {
				if (item.collectionId && !albumMap.has(String(item.collectionId)))
					albumMap.set(String(item.collectionId), { id: String(item.collectionId), title: item.collectionName, artist: item.artistName, artwork: artworkHd(item.artworkUrl100) });
				return {
					id: String(item.trackId), title: item.trackName, artist: item.artistName, album: item.collectionName,
					albumId: item.collectionId ? String(item.collectionId) : undefined,
					duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
					streamUrl: `${apiBase}/playback/${item.trackId}?fallback=${encodeURIComponent(item.previewUrl || "")}&title=${encodeURIComponent(item.trackName || "")}&artist=${encodeURIComponent(item.artistName || "")}`,
					previewUrl: item.previewUrl || "", explicit: item.trackExplicitness === "explicit",
				};
			});
			sendJson(res, 200, { tracks, albums: [...albumMap.values()].slice(0, 12) });
		} catch (err) {
			sendJson(res, 502, { error: err instanceof Error ? err.message : "Charts failed" });
		}
	});

	server.middlewares.use(`${apiBase}/playback`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const reqUrl = parseUrl(req.url);
		const id = decodeURIComponent(reqUrl.pathname.replace(/^\//, ""));
		let fallback = reqUrl.searchParams.get("fallback") || "";
		const titleHint = reqUrl.searchParams.get("title") || "";
		const artistHint = reqUrl.searchParams.get("artist") || "";
		const warmOnly = reqUrl.searchParams.get("warm") === "1";

		const redirectToFallback = () => {
			if (fallback.startsWith("https://")) { res.statusCode = 302; res.setHeader("Location", fallback); res.end(); return true; }
			return false;
		};

		let videoId: string | null = null;
		if (videoIdPattern.test(id)) {
			videoId = id;
		} else if (/^\d+$/.test(id)) {
			videoId = trackToVideoCache.get(id) || null;
			if (!videoId) {
				let title = titleHint, artist = artistHint;
				if (!title || !artist) {
					const info = await lookupItunesTrack(id);
					if (info) { title = title || info.title; artist = artist || info.artist; if (!fallback && info.preview) fallback = info.preview; }
				}
				if (title && artist) { videoId = await findYoutubeVideoId(title, artist); if (videoId) trackToVideoCache.set(id, videoId); }
			}
		}

		if (!videoId) { if (redirectToFallback()) return; return sendJson(res, 400, { error: "Could not resolve track" }); }

		if (warmOnly) {
			try {
				const cached = streamUrlCache.get(videoId);
				if (!cached || Date.now() - cached.at > STREAM_URL_TTL) {
					const result = (await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, { format: "bestaudio/best", getUrl: true, forceIpv4: true }, { timeout: 20_000 })) as unknown as string;
					const url = String(result).trim().split("\n")[0];
					if (url.startsWith("http")) streamUrlCache.set(videoId, { url, at: Date.now() });
				}
			} catch {}
			res.statusCode = 204; return res.end();
		}

		try {
			const cached = streamUrlCache.get(videoId);
			let streamUrl = cached && Date.now() - cached.at < STREAM_URL_TTL ? cached.url : "";
			if (!streamUrl) {
				const result = (await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, { format: "bestaudio/best", getUrl: true, forceIpv4: true }, { timeout: 20_000 })) as unknown as string;
				streamUrl = String(result).trim().split("\n")[0];
				if (!streamUrl.startsWith("http")) throw new Error("yt-dlp did not return a stream URL");
				streamUrlCache.set(videoId, { url: streamUrl, at: Date.now() });
			}
			const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0", Referer: "https://www.youtube.com/" };
			if (req.headers.range) headers.Range = req.headers.range;
			const upstream = await fetch(streamUrl, { headers });
			if (!upstream.ok || !upstream.body) throw new Error(`Upstream ${upstream.status}`);
			res.statusCode = upstream.status;
			for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) { const v = upstream.headers.get(name); if (v) res.setHeader(name, v); }
			res.setHeader("Cache-Control", "private, max-age=3600");
			const reader = upstream.body.getReader();
			const pump = async () => { while (true) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); } res.end(); };
			pump().catch(() => res.end());
			req.on("close", () => reader.cancel().catch(() => {}));
		} catch (err) {
			if (!res.headersSent && redirectToFallback()) return;
			if (!res.headersSent) sendJson(res, 502, { error: err instanceof Error ? err.message : "Stream failed" });
		}
	});

	server.middlewares.use(`${apiBase}/health`, (_req, res) => {
		sendJson(res, 200, { status: "ok", caches: { videos: trackToVideoCache.size, streams: streamUrlCache.size } });
	});
}

export function musicApi(options: { apiBase?: string; resolverPath?: string } = {}): Plugin {
	const apiBase = (options.apiBase || "/api/music").replace(/\/$/, "");
	const resolverPath = options.resolverPath || "yt-dlp";
	return {
		name: "fracital-music-api",
		configureServer(server) { registerMusicApi(server, apiBase, resolverPath); },
		configurePreviewServer(server) { registerMusicApi(server, apiBase, resolverPath); },
	};
}
