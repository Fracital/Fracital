import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRetrying, DbConfigError, poolConfig } from "./db-connect";

/** A sleep the test releases by hand, recording each requested delay. */
function manualSleep() {
	const delays: number[] = [];
	let wake: () => void = () => {};
	const sleep = (ms: number) => {
		delays.push(ms);
		return new Promise<void>(resolve => {
			wake = resolve;
		});
	};
	return { delays, sleep, wake: () => wake() };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test("retries with doubling delays capped at 30 s, then serves the value", async () => {
	const { delays, sleep, wake } = manualSleep();
	let calls = 0;
	const loop = createRetrying(
		async () => {
			calls++;
			if (calls < 8) throw new Error("ECONNREFUSED");
			return "db";
		},
		{ sleep },
	);
	assert.equal(loop.status(), "idle");
	loop.start();
	loop.start();
	await tick();
	assert.equal(loop.status(), "waiting");
	assert.equal(await loop.get(1000), null, "a request during the backoff gets null at once");
	for (let i = 0; i < 6; i++) {
		wake();
		await tick();
	}
	wake();
	await tick();
	assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
	assert.equal(calls, 8, "start() twice runs one loop");
	assert.equal(loop.status(), "ready");
	assert.equal(await loop.get(0), "db");
	assert.equal(loop.current(), "db");
});

test("get() waits for an attempt in flight, up to its limit", async () => {
	let finish: (v: string) => void = () => {};
	const loop = createRetrying(() => new Promise<string>(resolve => (finish = resolve)));
	loop.start();
	assert.equal(loop.status(), "connecting");
	assert.equal(await loop.get(5), null, "times out while the attempt hangs");
	const pending = loop.get(1000);
	finish("db");
	assert.equal(await pending, "db");
});

test("a config error stops the loop for good", async () => {
	let calls = 0;
	const errors: string[] = [];
	const loop = createRetrying(
		async () => {
			calls++;
			throw new DbConfigError("bad settings");
		},
		{ onConfigError: err => errors.push(err.message), sleep: async () => {} },
	);
	loop.start();
	await tick();
	assert.equal(loop.status(), "off");
	assert.equal(calls, 1);
	assert.deepEqual(errors, ["bad settings"]);
});

test("poolConfig verifies the certificate in every TLS case", () => {
	const dir = mkdtempSync(join(tmpdir(), "db-connect-"));
	try {
		const ca = join(dir, "ca.crt");
		writeFileSync(ca, "PEM");
		const pinned = poolConfig("postgres://u:p@terp.db:5432/app?sslmode=require", { DATABASE_CA: ca });
		assert.deepEqual(pinned.ssl, { ca: "PEM", rejectUnauthorized: true, servername: "terp.db" });
		assert.equal(pinned.connectionString, "postgres://u:p@terp.db:5432/app");

		const byUrl = poolConfig("postgres://u:p@terp.db/app?sslmode=verify-full&sslrootcert=/x.crt", {});
		assert.equal(byUrl.ssl, undefined, "node-postgres applies the URL's settings");
		assert.equal(byUrl.connectionString, "postgres://u:p@terp.db/app?sslmode=verify-full&sslrootcert=/x.crt");

		assert.deepEqual(poolConfig("postgres://u:p@db.example.com/app", {}).ssl, { rejectUnauthorized: true, servername: "db.example.com" });
		assert.deepEqual(poolConfig("postgres://u:p@80.93.219.21/app", {}).ssl, { rejectUnauthorized: true, servername: undefined });
		assert.equal(poolConfig("postgres://u:p@localhost/app", {}).ssl, false);

		assert.throws(() => poolConfig("postgres://u:p@terp.db/app?sslmode=no-verify", {}), DbConfigError);
		assert.throws(() => poolConfig("postgres://u:p@terp.db/app?uselibpqcompat=true&sslmode=require", {}), DbConfigError);
		assert.throws(() => poolConfig("postgres://u:p@terp.db/app", { DATABASE_CA: join(dir, "missing.crt") }), DbConfigError);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
