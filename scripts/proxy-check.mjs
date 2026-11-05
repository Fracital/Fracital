#!/usr/bin/env node
/*
 * proxy-check.mjs — end-to-end proxy verification: boot the app, create a
 * controller frame, and navigate it through the service worker + transport +
 * relay to a target the server can reach. This exercises the whole vendored
 * stack (engine, controller, wasm transport, gated relay path).
 *
 *   node scripts/proxy-check.mjs http://localhost:8137/ [target-url]
 */
import { chromium } from "playwright-core";

const base = process.argv[2];
if (!base) {
	console.error("usage: node scripts/proxy-check.mjs <base-url> [target]");
	process.exit(1);
}
const target = process.argv[3] || `${base}api/music/health`;

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e.stack || e)));

await page.goto(base, { waitUntil: "load", timeout: 30000 });

const result = await page.evaluate(async targetUrl => {
	const out = { ready: false, frameCreated: false, navigated: false, contentBytes: 0, error: null };
	try {
		// The VM boots asynchronously: wait for App.tsx module code to ASSIGN the
		// ready promise, then await the promise itself.
		await Promise.race([
			new Promise(res => {
				const t = setInterval(() => {
					if (window.scramjetReady) {
						clearInterval(t);
						res();
					}
				}, 100);
			}),
			new Promise((_, rej) => setTimeout(() => rej(new Error("engine assign timeout")), 20000)),
		]);
		await Promise.race([window.scramjetReady, new Promise((_, rej) => setTimeout(() => rej(new Error("engine ready timeout")), 20000))]);
		out.ready = true;
		const controller = window.scramjetController;
		if (!controller) throw new Error("controller global missing");
		const iframe = document.createElement("iframe");
		iframe.style.cssText = "position:fixed;inset:0;opacity:0;pointer-events:none";
		document.body.appendChild(iframe);
		const frame = controller.createFrame(iframe);
		out.frameCreated = true;
		const loaded = new Promise(res => iframe.addEventListener("load", res, { once: true }));
		frame.go(targetUrl);
		await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new Error("frame load timeout")), 25000))]);
		out.navigated = true;
		await new Promise(r => setTimeout(r, 1000));
		out.contentBytes = iframe.contentDocument?.body?.textContent?.length ?? 0;
		out.contentSample = iframe.contentDocument?.body?.textContent?.slice(0, 80) ?? "";
	} catch (e) {
		out.error = String(e);
	}
	return out;
}, target);

console.log("target:", target);
console.log("engine ready:", result.ready);
console.log("frame created:", result.frameCreated);
console.log("navigated:", result.navigated);
console.log("content bytes:", result.contentBytes, result.contentSample ? JSON.stringify(result.contentSample) : "");
console.log("error:", result.error || "none");
console.log("page exceptions:", errors.length ? errors.slice(0, 3) : "none");

const pass = result.ready && result.frameCreated && result.navigated && result.contentBytes > 10;
console.log(pass ? "PROXY E2E PASSED" : "PROXY E2E FAILED");
await browser.close();
process.exit(pass ? 0 : 2);
