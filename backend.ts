import { createServer, type IncomingMessage } from "node:http";
import dns from "node:dns";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import config from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "./package.json";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { create as createYoutubeDl } from "youtube-dl-exec";
import { cloakMiddleware } from "./src/server/cloak-routing";
import { rankAlbums, rankArtists, rankTracks } from "./src/server/music-rank";
import { artistBanner, artistBio, artistTopTracks, buildRadio, findDeezerArtist, relatedArtists } from "./src/server/music-radio";
import { artistStats, lastfmKey, trackPlays } from "./src/server/music-stats";
import { getAccountsApp, initAccounts } from "./src/server/accounts";
import { artistExtras } from "./src/server/artist-extras";
import { albumInfo, songCredits, songInfo } from "./src/server/song-info";
import { findYoutubeMatch, isExplicitEdition, playbackHints } from "./src/server/youtube-match";
import { upstreamRange } from "./src/server/stream-range";

export function fsrv() {
	config.config();
	// yt-dlp resolves googlevideo URLs IP-locked with forceIpv4; node's fetch must
	// connect from the same family or the CDN resets the stream mid-transfer.
	dns.setDefaultResultOrder("ipv4first");
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

	// ============================================================
	// Fracital Accounts (/api/auth, /api/me)
	// ============================================================
	void initAccounts();
	app.route("/", getAccountsApp());

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
	// iTunes marks singles and EPs with a title suffix.
	const albumType = (title: string | undefined): "album" | "single" | "ep" => (/ - single$/i.test(title || "") ? "single" : / - ep$/i.test(title || "") ? "ep" : "album");


	// Social links + gallery photos for the artist page hero (loaded after the page).
	app.get("/api/music/artist-extras", async c => {
		const name = c.req.query("name")?.trim();
		if (!name) return c.json({ error: "name is required" }, 400);
		c.header("Cache-Control", "public, max-age=3600");
		return c.json(await artistExtras(name));
	});

	// Now Playing: release date, and credits (loaded when the Credits panel opens).
	app.get("/api/music/song-info", async c => {
		const title = c.req.query("title")?.trim();
		const artist = c.req.query("artist")?.trim();
		if (!title || !artist) return c.json({ error: "title and artist are required" }, 400);
		c.header("Cache-Control", "public, max-age=3600");
		return c.json(await songInfo(title, artist, c.req.query("albumId")?.trim() || undefined));
	});
	app.get("/api/music/album-info", async c => {
		const title = c.req.query("title")?.trim();
		const artist = c.req.query("artist")?.trim();
		if (!title || !artist) return c.json({ error: "title and artist are required" }, 400);
		const info = await albumInfo(c.req.query("id")?.trim() || undefined, title, artist, Number(c.req.query("tracks")) || undefined);
		c.header("Cache-Control", info.partial ? "no-store" : "public, max-age=3600");
		return c.json(info);
	});
	app.get("/api/music/song-credits", async c => {
		const title = c.req.query("title")?.trim();
		const artist = c.req.query("artist")?.trim();
		if (!title || !artist) return c.json({ error: "title and artist are required" }, 400);
		const credits = await songCredits(title, artist);
		c.header("Cache-Control", credits.partial ? "no-store" : "public, max-age=3600");
		return c.json(credits);
	});

	// A song's total YouTube streams across its official uploads.
	app.get("/api/music/plays", async c => {
		const title = c.req.query("title")?.trim();
		const artist = c.req.query("artist")?.trim();
		if (!title || !artist) return c.json({ error: "title and artist are required" }, 400);
		const stats = await trackPlays(title, artist);
		// Only cache hits, so a miss (e.g. before a Last.fm key is added) can be retried.
		c.header("Cache-Control", stats ? "public, max-age=3600" : "no-store");
		return c.json({ plays: stats?.plays ?? null, uploads: stats?.uploads ?? null, official: stats?.official ?? null, source: stats?.source ?? null });
	});

	app.get("/api/music/health", c => c.json({ status: "ok", lastfm: !!lastfmKey(), caches: { videos: trackToVideoCache.size, streams: streamUrlCache.size } }));

	// Radio: a seeded, variety-tunable mix built from Deezer's artist graph.
	app.get("/api/music/radio", async c => {
		const artist = c.req.query("artist")?.trim();
		if (!artist) return c.json({ error: "artist is required" }, 400);
		try {
			const mix = await buildRadio(
				{
					artist,
					title: c.req.query("title")?.trim() || undefined,
					variety: Number(c.req.query("variety")) || 40,
					limit: Math.min(Number(c.req.query("limit")) || 25, 50),
				},
				"/api/music",
			);
			if (!mix) return c.json({ error: "Artist not found" }, 404);
			return c.json(mix);
		} catch (err: any) {
			return c.json({ error: err.message }, 502);
		}
	});


	app.get("/api/music/search", async c => {
		const q = c.req.query("q")?.trim();
		if (!q) return c.json({ tracks: [], albums: [], artists: [] });
		const limit = Math.min(Number(c.req.query("limit")) || 24, 50);
		try {
			// Query songs, albums and artists in parallel for full search coverage.
			const term = encodeURIComponent(q);
			const [songRes, albumRes, artistRes] = await Promise.all([
				fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=${limit}&country=US`, { headers: { Accept: "application/json" } }),
				fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=12&country=US`, { headers: { Accept: "application/json" } }),
				fetch(`https://itunes.apple.com/search?term=${term}&entity=musicArtist&limit=6&country=US`, { headers: { Accept: "application/json" } }),
			]);
			if (!songRes.ok) throw new Error(`iTunes ${songRes.status}`);
			const songCatalog = (await songRes.json()) as { results?: any[] };
			const albumCatalog = albumRes.ok ? ((await albumRes.json()) as { results?: any[] }) : { results: [] };
			const artistCatalog = artistRes.ok ? ((await artistRes.json()) as { results?: any[] }) : { results: [] };
			const candidates = (songCatalog.results || []).filter((i: any) => i.wrapperType === "track" && i.kind === "song" && i.trackName && i.artistName);
			// YouTube resolution is deferred to playback time so search responds instantly.
			const tracks = candidates.map((item: any) => ({
				id: String(item.trackId), title: item.trackName, artist: item.artistName,
				artistId: item.artistId ? String(item.artistId) : undefined,
				album: item.collectionName || undefined, albumId: item.collectionId ? String(item.collectionId) : undefined,
				duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
				// Title/artist hints let playback resolve YouTube without another iTunes lookup.
				streamUrl: `/api/music/playback/${item.trackId}?${playbackHints({ preview: item.previewUrl, title: item.trackName || "", artist: item.artistName || "", explicit: isExplicitEdition(item.trackExplicitness), duration: (item.trackTimeMillis || 0) / 1000 })}`,
				previewUrl: item.previewUrl || "", explicit: isExplicitEdition(item.trackExplicitness),
			}));
			const albums = (albumCatalog.results || [])
				.filter((r: any) => r.wrapperType === "collection" && r.collectionName)
				.map((r: any) => ({
					id: String(r.collectionId), title: r.collectionName, artist: r.artistName || "",
					artistId: r.artistId ? String(r.artistId) : undefined,
					artwork: artworkHd(r.artworkUrl100), trackCount: r.trackCount, releaseDate: r.releaseDate, type: albumType(r.collectionName),
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
			return c.json({ tracks: rankTracks(q, tracks), albums: rankAlbums(q, albums), artists: rankArtists(q, artists) });
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
			const album = col ? { id: String(col.collectionId), title: col.collectionName, artist: col.artistName, artistId: col.artistId ? String(col.artistId) : undefined, artwork: artworkHd(col.artworkUrl100), trackCount: col.trackCount, releaseDate: col.releaseDate, type: albumType(col.collectionName) } : { id, title: "Album", artist: "", artwork: "" };
			const tracks = songs.map((item: any) => ({
				id: String(item.trackId), title: item.trackName || "Unknown", artist: item.artistName || "",
				album: item.collectionName || album.title, albumId: String(item.collectionId || id),
				duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100) || album.artwork,
				streamUrl: `/api/music/playback/${item.trackId}?${playbackHints({ preview: item.previewUrl, title: item.trackName || "", artist: item.artistName || "", explicit: isExplicitEdition(item.trackExplicitness), duration: (item.trackTimeMillis || 0) / 1000 })}`,
				previewUrl: item.previewUrl || "", explicit: isExplicitEdition(item.trackExplicitness),
			}));
			return c.json({ album, tracks });
		} catch (err: any) { return c.json({ error: err.message }, 502); }
	});

	app.get("/api/music/artist/:id", async c => {
		const id = c.req.param("id");
		try {
			const [sr, ar] = await Promise.all([
				fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song&limit=25`, { headers: { Accept: "application/json" } }),
				// 200 is the lookup API's maximum — the artist's entire discography.
				fetch(`https://itunes.apple.com/lookup?id=${id}&entity=album&limit=200`, { headers: { Accept: "application/json" } }),
			]);
			const sd = (await sr.json()) as { results?: any[] };
			const ad = (await ar.json()) as { results?: any[] };
			const rec = (sd.results || [])[0] || (ad.results || [])[0];
			const artistName = rec?.artistName || "Unknown";
			const known = artistName !== "Unknown";
			const [banner, bio, similar, ranked, dzArtist] = await Promise.all([
				known ? artistBanner(artistName) : Promise.resolve(""),
				known ? artistBio(artistName).catch(() => "") : Promise.resolve(""),
				known ? relatedArtists(artistName).catch(() => []) : Promise.resolve([]),
				// Top tracks ranked by real streaming popularity (Deezer rank); iTunes order is the fallback.
				known ? artistTopTracks(artistName, "/api/music", 20).catch(() => []) : Promise.resolve([]),
				known ? findDeezerArtist(artistName).catch(() => null) : Promise.resolve(null),
			]);
			const artist = { id: String(rec?.artistId || id), name: artistName, picture: banner || artworkHd(rec?.artistId ? rec?.artworkUrl100 : ""), banner, bio, fans: dzArtist?.nb_fan };
			const tracks = ranked.length > 0
				? ranked
				: (sd.results || []).filter((r: any) => r.wrapperType === "track" && r.kind === "song").map((item: any) => ({
					id: String(item.trackId), title: item.trackName, artist: item.artistName, album: item.collectionName,
					albumId: item.collectionId ? String(item.collectionId) : undefined,
					duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
					streamUrl: `/api/music/playback/${item.trackId}?${playbackHints({ preview: item.previewUrl, title: item.trackName || "", artist: item.artistName || "", explicit: isExplicitEdition(item.trackExplicitness), duration: (item.trackTimeMillis || 0) / 1000 })}`,
					previewUrl: item.previewUrl || "", explicit: isExplicitEdition(item.trackExplicitness),
				}));
			const albums = (ad.results || []).filter((r: any) => r.wrapperType === "collection").map((r: any) => ({
				id: String(r.collectionId), title: r.collectionName, artist: r.artistName, artwork: artworkHd(r.artworkUrl100), trackCount: r.trackCount, releaseDate: r.releaseDate, type: albumType(r.collectionName), explicit: isExplicitEdition(r.collectionExplicitness),
			})).sort((a: any, b: any) => new Date(b.releaseDate || 0).getTime() - new Date(a.releaseDate || 0).getTime());
			// Last.fm listener counts (no-op without LASTFM_API_KEY).
			const [mainStats, ...similarStats] = await Promise.all([artistStats(artistName), ...similar.map(s => artistStats(s.name))]);
			return c.json({
				artist: { ...artist, listeners: mainStats?.listeners, scrobbles: mainStats?.plays },
				similar: similar.map((s, i) => ({ ...s, listeners: similarStats[i]?.listeners })),
				tracks,
				albums,
			});
		} catch (err: any) { return c.json({ error: err.message }, 502); }
	});

	// Real Apple Music most-played chart, resolved to full tracks and cached.
	let chartsCache: { at: number; payload: unknown } | null = null;
	const CHARTS_TTL = 30 * 60_000;

	app.get("/api/music/charts", async c => {
		const limit = Math.min(Number(c.req.query("limit")) || 25, 50);
		try {
			if (chartsCache && Date.now() - chartsCache.at < CHARTS_TTL) return c.json(chartsCache.payload as object);

			const feed = (await (await fetch(`https://rss.marketingtools.apple.com/api/v2/us/music/most-played/${limit}/songs.json`, { headers: { Accept: "application/json" } })).json()) as { feed?: { results?: { id: string }[] } };
			const ids = (feed.feed?.results || []).map(r => r.id).filter(Boolean);
			if (ids.length === 0) throw new Error("Empty charts feed");

			const lookup = (await (await fetch(`https://itunes.apple.com/lookup?id=${ids.join(",")}&entity=song`, { headers: { Accept: "application/json" } })).json()) as { results?: any[] };
			const byId = new Map((lookup.results || []).filter((r: any) => r.wrapperType === "track").map((r: any) => [String(r.trackId), r]));

			const albumMap = new Map<string, any>();
			// Keep the feed's chart order, not the lookup's.
			const tracks = ids
				.map(id => byId.get(id))
				.filter((item: any) => item?.trackName && item?.artistName)
				.map((item: any) => {
					if (item.collectionId && !albumMap.has(String(item.collectionId)))
						albumMap.set(String(item.collectionId), { id: String(item.collectionId), title: item.collectionName, artist: item.artistName, artwork: artworkHd(item.artworkUrl100) });
					return {
						id: String(item.trackId), title: item.trackName, artist: item.artistName,
						artistId: item.artistId ? String(item.artistId) : undefined,
						album: item.collectionName, albumId: item.collectionId ? String(item.collectionId) : undefined,
						duration: Math.round((item.trackTimeMillis || 0) / 1000), artwork: artworkHd(item.artworkUrl100),
						streamUrl: `/api/music/playback/${item.trackId}?${playbackHints({ preview: item.previewUrl, title: item.trackName || "", artist: item.artistName || "", explicit: isExplicitEdition(item.trackExplicitness), duration: (item.trackTimeMillis || 0) / 1000 })}`,
						previewUrl: item.previewUrl || "", explicit: isExplicitEdition(item.trackExplicitness),
					};
				});

			const payload = { tracks, albums: [...albumMap.values()].slice(0, 12) };
			chartsCache = { at: Date.now(), payload };
			return c.json(payload);
		} catch (err: any) { return c.json({ error: err.message }, 502); }
	});

	app.get("/api/music/playback/:id", async c => {
		const id = c.req.param("id");
		let fallback = c.req.query("fallback") || "";
		const titleHint = c.req.query("title") || "";
		const artistHint = c.req.query("artist") || "";
		const explicitHint = c.req.query("explicit") === "1";
		const durationHint = Number(c.req.query("dur")) || undefined;
		const warm = c.req.query("warm") === "1";

		let videoId: string | null = null;
		if (videoIdPattern.test(id)) { videoId = id; }
		// Numeric catalog ids, or lfm-<hash> for Last.fm songs that resolve via the title/artist hints.
		else if (/^(\d+|lfm-[a-f0-9]+)$/.test(id)) {
			const cacheKey = titleHint && artistHint ? `${id}|${artistHint}|${titleHint}`.toLowerCase() : id;
			videoId = trackToVideoCache.get(cacheKey) || null;
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
				if (t && a) { videoId = await findYoutubeMatch({ title: t, artist: a, explicit: explicitHint, duration: durationHint }); if (videoId) trackToVideoCache.set(cacheKey, videoId); }
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
			const resolveStream = async (fresh: boolean): Promise<string> => {
				const cached = fresh ? undefined : streamUrlCache.get(videoId);
				if (cached && Date.now() - cached.at < STREAM_URL_TTL) return cached.url;
				const result = (await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, { format: "bestaudio/best", getUrl: true, forceIpv4: true }, { timeout: 20_000 })) as unknown as string;
				const url = String(result).trim().split("\n")[0];
				if (!url.startsWith("http")) throw new Error("yt-dlp failed");
				streamUrlCache.set(videoId, { url, at: Date.now() });
				return url;
			};

			const base: Record<string, string> = { "User-Agent": "Mozilla/5.0", Referer: "https://www.youtube.com/" };
			const withRange = async (url: string) => {
				const range = await upstreamRange(c.req.header("range"), url, base);
				return range ? { ...base, Range: range } : base;
			};

			// A cached googlevideo URL can expire or be IP-bound; retry once with a fresh resolution.
			const cachedUrl = await resolveStream(false);
			let upstream = await fetch(cachedUrl, { headers: await withRange(cachedUrl) }).catch(() => null);
			if (!upstream || !upstream.ok || !upstream.body) {
				const freshUrl = await resolveStream(true);
				upstream = await fetch(freshUrl, { headers: await withRange(freshUrl) });
			}
			if (!upstream.ok || !upstream.body) throw new Error(`Upstream ${upstream.status}`);

			// Pass the audio straight through with the real content-type and status —
			// Hono's stream() helper would default everything to text/plain + 200,
			// which browsers reject as an unsupported media source.
			const respHeaders = new Headers();
			for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
				const v = upstream.headers.get(name);
				if (v) respHeaders.set(name, v);
			}
			if (!respHeaders.has("content-type")) respHeaders.set("content-type", "audio/webm");
			respHeaders.set("Cache-Control", "private, max-age=3600");

			return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
		} catch (err: any) {
			if (fallback.startsWith("https://")) return c.redirect(fallback, 302);
			return c.json({ error: err.message }, 502);
		}
	});

	// ============================================================

	// Cloak routing: hosts with a folder in ../cloaks-fracital get their decoy
	// site with the uncloak script injected. The real app only becomes
	// reachable through /1.html after Ctrl+E — nothing client-side loads on a
	// plain page load. Unknown hosts fall through to the app as normal.
	app.use(
		"*",
		cloakMiddleware({
			distDir: path.join(__dirname, "dist"),
		}),
	);

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
