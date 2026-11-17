/**
 * Postgres connection settings and the retry loop that keeps a database feature
 * coming back after an outage (accounts.ts).
 *
 * TLS always verifies the server's certificate. Ways to say which certificate to trust:
 * - `DATABASE_CA=/path/ca.crt`: that file is the only trusted CA, and the name checked is the
 *   URL's host (terp.db's certificate is issued to `terp.db`, so the URL must use that name).
 * - `?sslmode=verify-full&sslrootcert=/path/ca.crt` in DATABASE_URL: node-postgres reads both.
 * - Neither: remote hosts are checked against the system CAs; localhost connects without TLS.
 * `sslmode=disable` turns TLS off. Settings that keep TLS but skip the check
 * (`sslmode=no-verify`, `uselibpqcompat`) are refused.
 */
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import type { PoolConfig } from "pg";

/** A settings mistake: retrying can't fix it, so the feature stays off until the config changes. */
export class DbConfigError extends Error {}

const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);

export function poolConfig(url: string, env: NodeJS.ProcessEnv = process.env): PoolConfig {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new DbConfigError("DATABASE_URL isn't a valid URL");
	}
	const host = parsed.hostname.replace(/^\[|\]$/g, "");
	const params = parsed.searchParams;
	const mode = params.get("sslmode");
	if (mode === "no-verify" || params.has("uselibpqcompat")) throw new DbConfigError("DATABASE_URL turns off certificate verification; set DATABASE_CA to the server's certificate instead");
	// Without a timeout a connect to an unreachable host hangs for minutes (the OS's TCP timeout).
	const base: PoolConfig = { max: 10, connectionTimeoutMillis: 10_000, keepAlive: true };
	const servername = isIP(host) ? undefined : host;
	const caPath = env.DATABASE_CA?.trim();
	if (caPath) {
		if (mode === "disable") throw new DbConfigError("DATABASE_CA is set but DATABASE_URL has sslmode=disable");
		let ca: string;
		try {
			ca = readFileSync(caPath, "utf8");
		} catch (err) {
			throw new DbConfigError(`DATABASE_CA can't be read (${(err as NodeJS.ErrnoException).code ?? err})`);
		}
		// node-postgres lets SSL settings in the URL replace the ssl option, so they come out.
		for (const key of ["sslmode", "sslrootcert", "ssl"]) params.delete(key);
		return { ...base, connectionString: parsed.toString(), ssl: { ca, rejectUnauthorized: true, servername } };
	}
	// sslmode=disable, or verify-full/verify-ca with sslrootcert: node-postgres applies them as written.
	if (mode || params.has("sslrootcert")) return { ...base, connectionString: url };
	if (LOCAL_HOSTS.has(host)) return { ...base, connectionString: url, ssl: false };
	return { ...base, connectionString: url, ssl: { rejectUnauthorized: true, servername } };
}

export type RetryStatus = "idle" | "connecting" | "waiting" | "ready" | "off";

export interface Retrying<T> {
	/** Starts the loop (once); later calls do nothing. */
	start(): void;
	status(): RetryStatus;
	/** The value once connected, else null. */
	current(): T | null;
	/** The value; while an attempt is running, waits for it up to `ms`. Never waits through a backoff. */
	get(ms: number): Promise<T | null>;
}

export interface RetryOptions {
	minDelayMs?: number;
	maxDelayMs?: number;
	/** Told about each failed attempt and how long until the next one. */
	onFailure?: (err: unknown, attempt: number, delayMs: number) => void;
	onReady?: (attempt: number) => void;
	/** A DbConfigError: the loop stops. */
	onConfigError?: (err: DbConfigError) => void;
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
	new Promise<void>(resolve => {
		setTimeout(resolve, ms).unref();
	});

/**
 * Runs `attempt` until it succeeds: right away, then after 1 s, doubling up to 30 s, forever.
 * A failed attempt cleans up after itself; only a success is kept.
 */
export function createRetrying<T>(attempt: () => Promise<T>, options: RetryOptions = {}): Retrying<T> {
	const { minDelayMs = 1000, maxDelayMs = 30_000, sleep = defaultSleep } = options;
	let status: RetryStatus = "idle";
	let value: T | null = null;
	let inFlight: Promise<void> | null = null;

	const loop = async () => {
		for (let n = 1; ; n++) {
			status = "connecting";
			let done: () => void = () => {};
			inFlight = new Promise<void>(resolve => {
				done = resolve;
			});
			try {
				value = await attempt();
				status = "ready";
				done();
				options.onReady?.(n);
				return;
			} catch (err) {
				if (err instanceof DbConfigError) {
					status = "off";
					done();
					options.onConfigError?.(err);
					return;
				}
				const delay = Math.min(maxDelayMs, minDelayMs * 2 ** Math.min(n - 1, 30));
				status = "waiting";
				done();
				options.onFailure?.(err, n, delay);
				await sleep(delay);
			}
		}
	};

	return {
		start() {
			if (status !== "idle") return;
			status = "connecting";
			void loop();
		},
		status: () => status,
		current: () => value,
		async get(ms) {
			if (status === "connecting" && inFlight) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				await Promise.race([inFlight, new Promise<void>(resolve => (timer = setTimeout(resolve, ms)))]);
				clearTimeout(timer);
			}
			return value;
		},
	};
}
