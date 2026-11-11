#!/usr/bin/env node
/*
 * deploy-check.mjs: what a returning browser gets right after a deploy. Two
 * production builds are served one after the other on one port (the backend
 * is stopped, dist is swapped, the backend starts again), and one browser
 * profile visits the first build once and the second three times, the first
 * of them seconds after the swap. Every visit loads a page through Scramjet,
 * then selects the stomp engine and loads a page through that.
 *
 * The files of two builds do not work together (the proxy transform gives
 * each build its own names), so after the swap every vendored file the page
 * loads must be the new build's, and the engines must start at once. A
 * browser that kept one file of the old build in its HTTP cache ran it
 * against the new service worker, and the stomp engine did not start for
 * minutes: that is what this check fails on.
 *
 * Before the deploy, the first visit also sets a cookie and a localStorage
 * value on the proxied site through each engine, and every later visit reads
 * them back: a second visit to the first build (without a deploy, so a miss
 * there is the check's, not the deploy's), the three after the swap, and a
 * last one with the HTTP cache emptied first, as a browser returns once its
 * entries expired (the files of the build before, from that cache, opened the
 * stores of the build before). The engines keep them in stores the proxy
 * transform names; a name that changed with the build opened them empty, and
 * that is what this check fails on too.
 *
 *   node scripts/deploy-check.mjs                       builds twice (npm run build), leaves the second in dist
 *   node scripts/deploy-check.mjs --builds <a> <b>      two builds made earlier (copies of dist)
 *   --port <n>                                          the backend's port (default 5199)
 *
 * dist is replaced by each build in turn. Needs /usr/bin/google-chrome (or
 * CHROME=<binary>) and a network the relay can reach example.com on.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const ENGINE_DIR = "/vendor/rt/";
/** The vendored files the build rewrites: Scramjet's and the transport's wasm in /vendor/, stomp's in /vendor/rt/. */
const VENDORED = /^\/vendor\/(?:rt\/)?[^/]+\.(?:m?js|wasm|html)$/;
/** How long the stomp engine may take to start; a healthy start is about a second. */
const BOOT_LIMIT_MS = 20000;

const args = process.argv.slice(2);
const option = name => {
	const at = args.indexOf(name);
	return at === -1 ? null : args.slice(at + 1);
};
const port = Number(option("--port")?.[0] ?? 5199);
const base = `http://localhost:${port}/`;
const given = option("--builds");
if (given && (!given[0] || !given[1] || !existsSync(join(given[0], "index.html")) || !existsSync(join(given[1], "index.html")))) {
	console.error("usage: node scripts/deploy-check.mjs [--builds <dist of build A> <dist of build B>] [--port <n>]");
	process.exit(1);
}

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass });
	console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, timeout) => {
	const start = Date.now();
	for (;;) {
		const value = await fn().catch(() => null);
		if (value) return value;
		if (Date.now() - start > timeout) return null;
		await sleep(200);
	}
};

// --- the two builds ---
const scratch = mkdtempSync(join(tmpdir(), "deploy-check-"));
const builds = given ? [given[0], given[1]] : [join(scratch, "a"), join(scratch, "b")];
if (!given) {
	for (const dir of builds) {
		console.log(`building (${dir === builds[0] ? "A" : "B"}) ...`);
		const built = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
		if (built.status !== 0) {
			console.error("npm run build failed");
			process.exit(1);
		}
		cpSync(DIST, dir, { recursive: true });
	}
}
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

// --- the backend, on one build at a time ---
let backend = null;
const stopBackend = async () => {
	if (!backend) return;
	const gone = new Promise(resolve => backend.once("exit", resolve));
	// Its own process group: the backend's relay child goes with it.
	try {
		process.kill(-backend.pid, "SIGTERM");
	} catch {}
	await Promise.race([gone, sleep(5000)]);
	backend = null;
};
const serve = async dir => {
	await stopBackend();
	rmSync(DIST, { recursive: true, force: true });
	cpSync(dir, DIST, { recursive: true });
	backend = spawn("npx", ["tsx", "backend.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: "ignore", detached: true });
	const up = await waitFor(async () => (await fetch(base)).ok, 60000);
	if (!up) throw new Error(`the backend did not answer on ${base}`);
};

// --- one visit ---
const profile = join(scratch, "profile");
/** What the first visit stores on the proxied site, as a cookie and in localStorage. */
const token = `dc${randomBytes(4).toString("hex")}`;
/** In the proxied site's realm: store the token, or say whether it is still there. */
const siteStorage = (write, value) => (write ? `document.cookie = "deploycheck=${value}; max-age=86400; path=/"; localStorage.setItem("deploycheck", "${value}"); null` : `[document.cookie.split("; ").includes("deploycheck=${value}"), localStorage.getItem("deploycheck") === "${value}"]`);
/** How long an engine may take to keep what a page stored (it writes to its stores asynchronously). */
const PERSIST_MS = 2000;
const storageChecks = (label, engine, kept) => {
	check(`${label}: the cookie set through ${engine} before is there`, kept?.[0] === true, kept ? "" : "the page did not load");
	check(`${label}: the localStorage value set through ${engine} before is there`, kept?.[1] === true, kept ? "" : "the page did not load");
};
const visit = async (label, dir, write, emptyHttpCache = false) => {
	// Third-party hosts do not resolve: the app's own pages and the relay are on localhost.
	const context = await chromium.launchPersistentContext(profile, {
		executablePath: process.env.CHROME || "/usr/bin/google-chrome",
		args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"],
		viewport: { width: 1400, height: 900 },
	});
	const page = context.pages()[0] ?? (await context.newPage());
	// Every vendored file the page loads, with the bytes it got, wherever they came from.
	const cdp = await context.newCDPSession(page);
	const loads = [];
	const pending = new Map();
	await cdp.send("Network.enable");
	// The HTTP cache only: cookies, storage and service workers stay.
	if (emptyHttpCache) await cdp.send("Network.clearBrowserCache");
	cdp.on("Network.responseReceived", e => {
		const url = new URL(e.response.url);
		if (url.origin !== new URL(base).origin || !VENDORED.test(url.pathname) || e.response.fromServiceWorker) return;
		pending.set(e.requestId, { file: url.pathname, from: e.response.fromDiskCache ? "the HTTP cache" : "the server" });
	});
	cdp.on("Network.loadingFinished", async e => {
		const load = pending.get(e.requestId);
		if (!load) return;
		pending.delete(e.requestId);
		const body = await cdp.send("Network.getResponseBody", { requestId: e.requestId }).catch(() => null);
		load.sha = body ? sha(Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8")) : null;
		loads.push(load);
	});

	// What the page and the engine's registration say when the engine does not start.
	const said = [];
	page.on("console", message => {
		if (message.type() === "error" && /engine|worker|vendor/i.test(message.text())) said.push(message.text().slice(0, 200));
	});
	const registrationState = () =>
		page
			.evaluate(async dir => {
				const registration = await navigator.serviceWorker.getRegistration(dir);
				const worker = w => (w ? `${w.scriptURL.split("/").pop()} ${w.state}` : "none");
				return registration ? `installing ${worker(registration.installing)}, waiting ${worker(registration.waiting)}, active ${worker(registration.active)}` : "no registration";
			}, ENGINE_DIR)
			.catch(() => "unknown");

	const appReady = async () => {
		await waitFor(() => page.evaluate(() => !!window.appReady), 30000);
		await page.evaluate(() => window.appReady);
	};
	await page.goto(base, { waitUntil: "load", timeout: 30000 });
	await appReady();
	// Scramjet boots with the app whichever engine is selected (scripts/proxy-check.mjs).
	const scramjetLoad = (code, persistMs = 0) =>
		page
			.evaluate(
				async ([code, persistMs]) => {
					const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: not within ${ms / 1000} s`)), ms))]);
					try {
						await within(window.scramjetReady, 20000, "the engine starts");
						const iframe = document.createElement("iframe");
						iframe.style.cssText = "position:fixed;inset:0;opacity:0;pointer-events:none";
						document.body.appendChild(iframe);
						const loaded = new Promise(resolve => iframe.addEventListener("load", resolve, { once: true }));
						window.scramjetController.createFrame(iframe).go("https://example.com/");
						await within(loaded, 30000, "the page loads");
						const title = iframe.contentDocument?.title;
						// The site's own realm, so the engine's cookie and storage hooks answer.
						const kept = iframe.contentWindow.eval(code);
						if (persistMs) await new Promise(resolve => setTimeout(resolve, persistMs));
						iframe.remove();
						return { error: title === "Example Domain" ? "" : `the page's title is ${JSON.stringify(title)}`, kept };
					} catch (error) {
						return { error: String(error?.message ?? error), kept: null };
					}
				},
				[code, persistMs],
			)
			.catch(error => ({ error: String(error), kept: null }));
	const scramjet = await scramjetLoad(siteStorage(write, token), write ? PERSIST_MS : 0);
	check(`${label}: a page loads through Scramjet`, scramjet.error === "", scramjet.error);
	if (!write) storageChecks(label, "Scramjet", scramjet.kept);
	// Opt in to the experimental engines and select stomp (scripts/stomp-check.mjs selectStomp).
	const selected = () =>
		page.evaluate(async () => {
			try {
				const data = JSON.parse(await window.fr.fs.promises.readFile("/settings.json", "utf8"));
				return data["experimental-proxies"] === true && data.proxy === "st";
			} catch {
				return false;
			}
		});
	for (let attempt = 0; attempt < 3 && !(await selected()); attempt++) {
		await page.evaluate(async () => {
			const fs = window.fr.fs.promises;
			for (let i = 0; i < 20; i++) {
				let data = {};
				try {
					data = JSON.parse(await fs.readFile("/settings.json", "utf8"));
				} catch {}
				if (data["experimental-proxies"] === true && data.proxy === "st") return;
				data["experimental-proxies"] = true;
				data.proxy = "st";
				await fs.writeFile("/settings.json", JSON.stringify(data, null, 2), "utf8");
				await new Promise(r => setTimeout(r, 250));
			}
		});
		loads.length = 0;
		await page.reload({ waitUntil: "load" });
		await appReady();
	}

	const booted = !!(await waitFor(() => page.evaluate(() => !!window.stompController), BOOT_LIMIT_MS));
	check(`${label}: the stomp engine starts`, booted, booted ? "" : `not within ${BOOT_LIMIT_MS / 1000} s; ${await registrationState()}${said.length ? `; ${said.join(" | ")}` : ""}`);
	let frame = null;
	if (booted) {
		const input = page.locator("input#input:not(.pointer-events-none *)").first();
		await input.click();
		await input.fill("https://example.com/");
		await input.press("Enter");
		frame = await waitFor(async () => {
			for (const f of page.frames()) if (f.url().includes(ENGINE_DIR) && (await f.title().catch(() => "")) === "Example Domain") return f;
			return null;
		}, 45000);
	}
	check(`${label}: a page loads through the stomp engine`, !!frame);
	const kept = frame ? await frame.evaluate(code => window.eval(code), siteStorage(write, token)).catch(() => null) : null;
	if (write) await sleep(PERSIST_MS);
	else storageChecks(label, "the stomp engine", kept);
	// Stay as long as a visit does: a service worker the browser found changed
	// is installed and takes over in the seconds after the page asked for it.
	await sleep(4000);
	await waitFor(
		() =>
			page.evaluate(async dir => {
				const registration = await navigator.serviceWorker.getRegistration(dir);
				return !registration || (!registration.installing && !registration.waiting);
			}, ENGINE_DIR),
		15000,
	);

	// Every vendored file the page loaded is a file of the build being served.
	const foreign = loads.filter(load => {
		const path = join(dir, load.file);
		return !existsSync(path) || sha(readFileSync(path)) !== load.sha;
	});
	check(`${label}: every vendored file the page loaded is this build's`, loads.length > 0 && foreign.length === 0, foreign.length ? foreign.map(load => `${load.file} from ${load.from} is not`).join(", ") : `${loads.length} loads`);
	await context.close();
};

let failure = null;
try {
	await serve(builds[0]);
	await visit("build A", builds[0], true);
	await visit("build A, second visit", builds[0], false);
	await serve(builds[1]);
	// The first visit seconds after the deploy, then two more inside any cache's lifetime.
	for (const label of ["first visit after the deploy", "second visit after the deploy", "third visit after the deploy"]) await visit(label, builds[1], false);
	await visit("a visit once the HTTP cache expired", builds[1], false, true);
} catch (error) {
	failure = error;
} finally {
	await stopBackend();
	rmSync(scratch, { recursive: true, force: true });
}
if (failure) {
	console.error(failure);
	process.exit(1);
}
const failed = results.filter(r => !r.pass);
console.log(failed.length ? `DEPLOY CHECK FAILED (${failed.length}/${results.length})` : `DEPLOY CHECK PASSED (${results.length} checks)`);
process.exit(failed.length ? 2 : 0);
