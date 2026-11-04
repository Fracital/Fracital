import type { Plugin, ViteDevServer } from "vite";
import { create as createYoutubeDl } from "youtube-dl-exec";
import ytSearch from "yt-search";
import { rankAlbums, rankArtists, rankTracks } from "./music-rank";
import { artistBanner, artistBio, artistTopTracks, buildRadio, findDeezerArtist, relatedArtists } from "./music-radio";
import { artistStats, lastfmKey, trackPlays } from "./music-stats";
import { getRequestListener } from "@hono/node-server";
import { getAccountsApp, initAccounts } from "./accounts";
import { artistExtras } from "./artist-extras";
import type { SimilarArtist } from "./music-radio";

/** Adds Last.fm listener counts to an artist and its similar artists (no-op without a key). */
async function withListeners<A extends { name: string }>(artist: A, similar: SimilarArtist[]) {
	const [main, ...rest] = await Promise.all([artistStats(artist.name), ...similar.map(s => artistStats(s.name))]);
	return {
		artist: { ...artist, listeners: main?.listeners, scrobbles: main?.plays },
		similar: similar.map((s, i) => ({ ...s, listeners: rest[i]?.listeners })),
	};
}

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

/** iTunes marks singles and EPs with a title suffix. */
function albumType(title: string | undefined): "album" | "single" | "ep" {
	if (/ - single$/i.test(title || "")) return "single";
	if (/ - ep$/i.test(title || "")) return "ep";
	return "album";
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

	// Fracital Accounts — the same Hono app the production server mounts.
	void initAccounts();
	const accounts = getRequestListener(getAccountsApp().fetch);
	server.middlewares.use((req, res, next) => {
		if (/^\/api\/(auth|me|admin|artist-profile|artist-media|play-event)(\/|\?|$)/.test(req.url || "")) void accounts(req, res);
		else next();
	});

	server.middlewares.use(`${apiBase}/search`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const query = parseUrl(req.url).searchParams.get("q")?.trim();
		if (!query) return sendJson(res, 200, { tracks: [], albums: [] });
		const limit = Math.min(Number(parseUrl(req.url).searchParams.get("limit")) || 24, 50);

		try {
			// Query songs, albums and artists in parallel for full search coverage.
			const term = encodeURIComponent(query);
			const [songRes, albumRes, artistRes] = await Promise.all([
				fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=${limit}&country=US`, { headers: { Accept: "application/json" } }),
				fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=12&country=US`, { headers: { Accept: "application/json" } }),
				fetch(`https://itunes.apple.com/search?term=${term}&entity=musicArtist&limit=6&country=US`, { headers: { Accept: "application/json" } }),
			]);
			if (!songRes.ok) throw new Error(`iTunes ${songRes.status}`);
			const songCatalog = (await songRes.json()) as { results?: ItunesTrack[] };
			const albumCatalog = albumRes.ok ? ((await albumRes.json()) as { results?: any[] }) : { results: [] };
			const artistCatalog = artistRes.ok ? ((await artistRes.json()) as { results?: any[] }) : { results: [] };

			const candidates = (songCatalog.results || []).filter((i) => i.wrapperType === "track" && i.kind === "song" && i.trackName && i.artistName);

			// YouTube resolution is deferred to playback time so search responds instantly.
			const tracks = candidates.map((item) => ({
				id: String(item.trackId),
				title: item.trackName!,
				artist: item.artistName!,
				artistId: item.artistId ? String(item.artistId) : undefined,
				album: item.collectionName || undefined,
				albumId: item.collectionId ? String(item.collectionId) : undefined,
				duration: Math.round((item.trackTimeMillis || 0) / 1000),
				artwork: artworkHd(item.artworkUrl100),
				streamUrl: `${apiBase}/playback/${item.trackId}?fallback=${encodeURIComponent(item.previewUrl || "")}&title=${encodeURIComponent(item.trackName || "")}&artist=${encodeURIComponent(item.artistName || "")}`,
				previewUrl: item.previewUrl || "",
				explicit: item.trackExplicitness === "explicit",
			}));

			const albums = (albumCatalog.results || [])
				.filter((r: any) => r.wrapperType === "collection" && r.collectionName)
				.map((r: any) => ({
					id: String(r.collectionId),
					title: r.collectionName,
					artist: r.artistName || "",
					artistId: r.artistId ? String(r.artistId) : undefined,
					artwork: artworkHd(r.artworkUrl100),
					trackCount: r.trackCount,
					releaseDate: r.releaseDate,
					type: albumType(r.collectionName),
				}));

			// Profile pictures come from Deezer (cached); iTunes has none.
			const artists = await Promise.all(
				(artistCatalog.results || [])
					.filter((r: any) => r.artistId && r.artistName)
					.slice(0, 6)
					.map(async (r: any) => {
						const dz = await findDeezerArtist(r.artistName).catch(() => null);
						return { id: String(r.artistId), name: r.artistName, picture: dz?.picture_big || dz?.picture_medium || "" };
					}),
			);

			sendJson(res, 200, { tracks: rankTracks(query, tracks), albums: rankAlbums(query, albums), artists: rankArtists(query, artists) });
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
				? { id: String(collection.collectionId), title: collection.collectionName, artist: collection.artistName, artistId: collection.artistId ? String(collection.artistId) : undefined, artwork: artworkHd(collection.artworkUrl100), trackCount: collection.trackCount, releaseDate: collection.releaseDate, type: albumType(collection.collectionName) }
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
				fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song&limit=25`, { headers: { Accept: "application/json" } }),
				// 200 is the lookup API's maximum — the artist's entire discography.
				fetch(`https://itunes.apple.com/lookup?id=${id}&entity=album&limit=200`, { headers: { Accept: "application/json" } }),
			]);
			const songsData = (await songsRes.json()) as { results?: any[] };
			const albumsData = (await albumsRes.json()) as { results?: any[] };
			const artistRecord = (songsData.results || [])[0] || (albumsData.results || [])[0];

			const name = artistRecord?.artistName || "Unknown Artist";
			const known = name !== "Unknown Artist";
			const [banner, bio, similar, ranked, dzArtist] = await Promise.all([
				known ? artistBanner(name) : Promise.resolve(""),
				known ? artistBio(name).catch(() => "") : Promise.resolve(""),
				known ? relatedArtists(name).catch(() => []) : Promise.resolve([]),
				// Top tracks ranked by real streaming popularity (Deezer rank); iTunes order is the fallback.
				known ? artistTopTracks(name, apiBase, 20).catch(() => []) : Promise.resolve([]),
				known ? findDeezerArtist(name).catch(() => null) : Promise.resolve(null),
			]);
			const artist = { id: String(artistRecord?.artistId || id), name, picture: banner || artworkHd(artistRecord?.artworkUrl100 || ""), banner, bio, fans: dzArtist?.nb_fan };
			const tracks = ranked.length > 0
				? ranked
				: (songsData.results || [])
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
				.map((r: any) => ({ id: String(r.collectionId), title: r.collectionName, artist: r.artistName, artwork: artworkHd(r.artworkUrl100), trackCount: r.trackCount, releaseDate: r.releaseDate, type: albumType(r.collectionName), explicit: r.collectionExplicitness === "explicit" }))
				.sort((a: any, b: any) => new Date(b.releaseDate || 0).getTime() - new Date(a.releaseDate || 0).getTime());

			sendJson(res, 200, { ...(await withListeners(artist, similar)), tracks, albums });
		} catch (err) {
			sendJson(res, 502, { error: err instanceof Error ? err.message : "Artist lookup failed" });
		}
	});

	// Real Apple Music most-played chart, resolved to full tracks and cached.
	let chartsCache: { at: number; payload: unknown } | null = null;
	const CHARTS_TTL = 30 * 60_000;

	server.middlewares.use(`${apiBase}/charts`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const limit = Math.min(Number(parseUrl(req.url).searchParams.get("limit")) || 25, 50);
		try {
			if (chartsCache && Date.now() - chartsCache.at < CHARTS_TTL) return sendJson(res, 200, chartsCache.payload);

			const feed = (await (await fetch(`https://rss.marketingtools.apple.com/api/v2/us/music/most-played/${limit}/songs.json`, { headers: { Accept: "application/json" } })).json()) as {
				feed?: { results?: { id: string }[] };
			};
			const ids = (feed.feed?.results || []).map((r) => r.id).filter(Boolean);
			if (ids.length === 0) throw new Error("Empty charts feed");

			const lookup = (await (await fetch(`https://itunes.apple.com/lookup?id=${ids.join(",")}&entity=song`, { headers: { Accept: "application/json" } })).json()) as { results?: ItunesTrack[] };
			const byId = new Map((lookup.results || []).filter((r) => r.wrapperType === "track").map((r) => [String(r.trackId), r]));

			const albumMap = new Map<string, any>();
			// Keep the feed's chart order, not the lookup's.
			const tracks = ids
				.map((id) => byId.get(id))
				.filter((item): item is ItunesTrack => !!item?.trackName && !!item?.artistName)
				.map((item) => {
					if (item.collectionId && !albumMap.has(String(item.collectionId)))
						albumMap.set(String(item.collectionId), { id: String(item.collectionId), title: item.collectionName, artist: item.artistName, artwork: artworkHd(item.artworkUrl100) });
					return {
						id: String(item.trackId), title: item.trackName, artist: item.artistName,
						artistId: item.artistId ? String(item.artistId) : undefined,
						album: item.collectionName, albumId: item.collectionId ? String(item.collectionId) : undefined,
						duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
						streamUrl: `${apiBase}/playback/${item.trackId}?fallback=${encodeURIComponent(item.previewUrl || "")}&title=${encodeURIComponent(item.trackName || "")}&artist=${encodeURIComponent(item.artistName || "")}`,
						previewUrl: item.previewUrl || "", explicit: item.trackExplicitness === "explicit",
					};
				});

			const payload = { tracks, albums: [...albumMap.values()].slice(0, 12) };
			chartsCache = { at: Date.now(), payload };
			sendJson(res, 200, payload);
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
			// Numeric catalog ids, or lfm-<hash> for Last.fm songs that resolve via the title/artist hints.
		} else if (/^(\d+|lfm-[a-f0-9]+)$/.test(id)) {
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

	// Radio: a seeded, variety-tunable mix built from Deezer's artist graph.
	server.middlewares.use(`${apiBase}/radio`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const reqUrl = parseUrl(req.url);
		const artist = reqUrl.searchParams.get("artist")?.trim();
		if (!artist) return sendJson(res, 400, { error: "artist is required" });
		try {
			const mix = await buildRadio(
				{
					artist,
					title: reqUrl.searchParams.get("title")?.trim() || undefined,
					variety: Number(reqUrl.searchParams.get("variety")) || 40,
					limit: Math.min(Number(reqUrl.searchParams.get("limit")) || 25, 50),
				},
				apiBase,
			);
			if (!mix) return sendJson(res, 404, { error: "Artist not found" });
			sendJson(res, 200, mix);
		} catch (err) {
			sendJson(res, 502, { error: err instanceof Error ? err.message : "Radio failed" });
		}
	});

	// Social links + gallery photos for the artist page hero (loaded after the page).
	server.middlewares.use(`${apiBase}/artist-extras`, async (req, res) => {
		const name = parseUrl(req.url).searchParams.get("name")?.trim();
		if (!name) return sendJson(res, 400, { error: "name is required" });
		res.setHeader("Cache-Control", "public, max-age=3600");
		sendJson(res, 200, await artistExtras(name));
	});

	// A song's total YouTube streams across its official uploads.
	server.middlewares.use(`${apiBase}/plays`, async (req, res) => {
		if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
		const reqUrl = parseUrl(req.url);
		const title = reqUrl.searchParams.get("title")?.trim();
		const artist = reqUrl.searchParams.get("artist")?.trim();
		if (!title || !artist) return sendJson(res, 400, { error: "title and artist are required" });
		const stats = await trackPlays(title, artist);
		// Only cache hits, so a miss (e.g. before a Last.fm key is added) can be retried.
		res.setHeader("Cache-Control", stats ? "public, max-age=3600" : "no-store");
		sendJson(res, 200, { plays: stats?.plays ?? null, uploads: stats?.uploads ?? null, official: stats?.official ?? null, source: stats?.source ?? null });
	});

	server.middlewares.use(`${apiBase}/health`, (_req, res) => {
		sendJson(res, 200, { status: "ok", lastfm: !!lastfmKey(), caches: { videos: trackToVideoCache.size, streams: streamUrlCache.size } });
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
