/**
 * Minimal ListenBrainz API client: the optional alternative to Last.fm for scrobbling,
 * loved songs and the listening library. Users connect by pasting the user token from
 * listenbrainz.org/settings, so there's no app to register and no env to set.
 *
 * Read calls are public (by username); writes send `Authorization: Token <user token>`.
 * Shares one small concurrency limit so a busy server stays under ListenBrainz's rate limit.
 */

const API = "https://api.listenbrainz.org";
const MAX_CONCURRENT = 4;
let active = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
	if (active >= MAX_CONCURRENT) await new Promise<void>(resolve => waiting.push(resolve));
	active++;
	try {
		return await fn();
	} finally {
		active--;
		waiting.shift()?.();
	}
}

export class ListenBrainzError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** 401: the token was reset or is wrong. 429, 5xx and network failures (0) are temporary. */
export const lbRevoked = (err: unknown) => err instanceof ListenBrainzError && err.status === 401;
export const lbTemporary = (err: unknown) => !(err instanceof ListenBrainzError) || err.status === 0 || err.status === 429 || err.status >= 500;

/**
 * Calls the API. Returns null for 204 (ListenBrainz's "stats not calculated yet") and,
 * unless `throwOnError`, for any failure; throws ListenBrainzError otherwise.
 */
export async function lbCall<T>(path: string, opts: { token?: string; body?: unknown; query?: Record<string, string>; throwOnError?: boolean } = {}): Promise<T | null> {
	const url = `${API}${path}${opts.query ? `?${new URLSearchParams(opts.query)}` : ""}`;
	return limited(async () => {
		try {
			const res = await fetch(url, {
				method: opts.body === undefined ? "GET" : "POST",
				headers: {
					Accept: "application/json",
					"User-Agent": "Fracital/2.0",
					...(opts.token ? { Authorization: `Token ${opts.token}` } : {}),
					...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
				},
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
				signal: AbortSignal.timeout(8000),
			});
			if (res.status === 204) return null;
			const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
			if (!res.ok || !data) throw new ListenBrainzError(res.status, data?.error || `ListenBrainz ${res.status}`);
			return data;
		} catch (err) {
			if (!opts.throwOnError) return null;
			throw err instanceof ListenBrainzError ? err : new ListenBrainzError(0, err instanceof Error ? err.message : "ListenBrainz request failed");
		}
	});
}

/** The username a token belongs to, or null when ListenBrainz says it isn't valid. Throws when unreachable. */
export async function lbValidateToken(token: string): Promise<string | null> {
	const res = await lbCall<{ valid?: boolean; user_name?: string }>("/1/validate-token", { token, throwOnError: true }).catch(err => {
		if (err instanceof ListenBrainzError && (err.status === 400 || err.status === 401)) return null;
		throw err;
	});
	return res?.valid && res.user_name ? res.user_name : null;
}

/** A song as the library routes need it (accounts.ts turns these into playable tracks). */
export interface ListenTrack {
	title: string;
	artist: string;
	album?: string;
	plays?: number;
	/** Unix seconds: when it was listened to or loved. */
	at?: number;
	nowPlaying?: boolean;
}

interface Meta {
	artist_name?: string;
	track_name?: string;
	release_name?: string;
}

const fromMeta = (m: Meta | undefined, extra: Partial<ListenTrack> = {}): ListenTrack | null => (m?.track_name && m.artist_name ? { title: m.track_name, artist: m.artist_name, album: m.release_name || undefined, ...extra } : null);
const present = <T>(v: T | null): v is T => v !== null;
const user = (name: string) => `/1/user/${encodeURIComponent(name)}`;
const stats = (name: string) => `/1/stats/user/${encodeURIComponent(name)}`;

/** Last.fm's periods (the library UI's) mapped to ListenBrainz stats ranges. */
const RANGES: Record<string, string> = { "7day": "week", "1month": "month", "3month": "quarter", "6month": "half_yearly", "12month": "year", overall: "all_time" };
export const lbRange = (period: string) => RANGES[period] || "half_yearly";

export async function lbListenCount(username: string): Promise<number> {
	const res = await lbCall<{ payload?: { count?: number } }>(`${user(username)}/listen-count`);
	return Number(res?.payload?.count) || 0;
}

export async function lbRecent(username: string, count: number): Promise<ListenTrack[]> {
	type L = { listened_at?: number; track_metadata?: Meta };
	const [now, listens] = await Promise.all([lbCall<{ payload?: { listens?: L[] } }>(`${user(username)}/playing-now`), lbCall<{ payload?: { listens?: L[] } }>(`${user(username)}/listens`, { query: { count: String(count) } })]);
	const playing = (now?.payload?.listens ?? []).map(l => fromMeta(l.track_metadata, { nowPlaying: true }));
	return [...playing, ...(listens?.payload?.listens ?? []).map(l => fromMeta(l.track_metadata, { at: l.listened_at }))].filter(present);
}

/** Loved songs (feedback score 1), newest first. */
export async function lbLoved(username: string, count: number, offset = 0): Promise<{ total: number; tracks: ListenTrack[] }> {
	type F = { created?: number; track_metadata?: Meta };
	const res = await lbCall<{ feedback?: F[]; total_count?: number }>(`/1/feedback/user/${encodeURIComponent(username)}/get-feedback`, { query: { score: "1", count: String(count), offset: String(offset), metadata: "true" } });
	return { total: Number(res?.total_count) || 0, tracks: (res?.feedback ?? []).map(f => fromMeta(f.track_metadata, { at: f.created })).filter(present) };
}

export async function lbTopTracks(username: string, period: string, count: number): Promise<ListenTrack[]> {
	type R = Meta & { listen_count?: number };
	const res = await lbCall<{ payload?: { recordings?: R[] } }>(`${stats(username)}/recordings`, { query: { range: lbRange(period), count: String(count) } });
	return (res?.payload?.recordings ?? []).map(r => fromMeta(r, { plays: Number(r.listen_count) || 0 })).filter(present);
}

export async function lbTopArtists(username: string, period: string, count: number): Promise<{ name: string; plays: number }[]> {
	type A = { artist_name?: string; listen_count?: number };
	const res = await lbCall<{ payload?: { artists?: A[] } }>(`${stats(username)}/artists`, { query: { range: lbRange(period), count: String(count) } });
	return (res?.payload?.artists ?? []).filter(a => a.artist_name).map(a => ({ name: a.artist_name!, plays: Number(a.listen_count) || 0 }));
}

export async function lbTopAlbums(username: string, period: string, count: number): Promise<{ title: string; artist: string; artwork: string; plays: number }[]> {
	type G = { release_group_name?: string; artist_name?: string; listen_count?: number; caa_id?: number; caa_release_mbid?: string };
	const res = await lbCall<{ payload?: { release_groups?: G[] } }>(`${stats(username)}/release-groups`, { query: { range: lbRange(period), count: String(count) } });
	return (res?.payload?.release_groups ?? [])
		.filter(g => g.release_group_name && g.artist_name)
		.map(g => ({
			title: g.release_group_name!,
			artist: g.artist_name!,
			artwork: g.caa_id && g.caa_release_mbid ? `https://coverartarchive.org/release/${g.caa_release_mbid}/${g.caa_id}-250.jpg` : "",
			plays: Number(g.listen_count) || 0,
		}));
}

/** One listen to submit. `at` is the Unix second it started; omitted for "playing now". */
export interface Listen {
	title: string;
	artist: string;
	album?: string;
	duration?: number;
	at?: number;
}

/** Submits listens: `playing_now` (one, no timestamp), `single` (one) or `import` (a batch). Throws ListenBrainzError. */
export async function lbSubmit(token: string, type: "playing_now" | "single" | "import", listens: Listen[]): Promise<void> {
	const payload = listens.map(l => ({
		...(type === "playing_now" ? {} : { listened_at: l.at }),
		track_metadata: {
			artist_name: l.artist,
			track_name: l.title,
			...(l.album ? { release_name: l.album } : {}),
			additional_info: { submission_client: "Fracital", ...(l.duration ? { duration_ms: l.duration * 1000 } : {}) },
		},
	}));
	await lbCall("/1/submit-listens", { token, body: { listen_type: type, payload }, throwOnError: true });
}

/** The MusicBrainz recording for a song (feedback needs one), or null when ListenBrainz can't match it. The lookup needs a user token. */
export async function lbLookupRecording(token: string, title: string, artist: string): Promise<string | null> {
	const res = await lbCall<{ recording_mbid?: string }>("/1/metadata/lookup/", { token, query: { artist_name: artist, recording_name: title } });
	return res?.recording_mbid || null;
}

/** Loves (1) or clears (0) a recording. Throws ListenBrainzError. */
export async function lbFeedback(token: string, recordingMbid: string, score: 0 | 1): Promise<void> {
	await lbCall("/1/feedback/recording-feedback", { token, body: { recording_mbid: recordingMbid, score }, throwOnError: true });
}
