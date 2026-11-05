import { chromium } from "playwright-core";

// End-to-end cloak flow on a decoy host: plain load shows only the decoy, then
// Ctrl+E mounts the app in a closed shadow root and the decoy title survives.
const base = process.argv[2] || "http://localhost:8137/";
const host = process.argv[3] || "catamounthealth.org";

const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-forwarded-host": host } });
const p = await ctx.newPage();
const errors = [];
const failedReqs = [];
p.on("pageerror", e => errors.push(String(e)));
p.on("requestfailed", r => failedReqs.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
p.on("response", r => {
	if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`);
});

await p.goto(base, { waitUntil: "load" });
await p.waitForTimeout(1500);

const before = await p.evaluate(() => ({
	title: document.title,
	bodyTextLen: (document.body.textContent || "").length,
	hasAppRoot: !!document.getElementById("__frx_host__"),
}));
console.log("plain load:", JSON.stringify(before));

await p.keyboard.press("Control+KeyE");
await p.waitForTimeout(12000);

const after = await p.evaluate(() => {
	const hostEl = document.getElementById("__frx_host__");
	return {
		title: document.title,
		hostPresent: !!hostEl,
		// The app mounts into the host's CLOSED shadow root: invisible to
		// childNodes/textContent by design. Boot proof is the app-driven globals:
		// scramjetReady is only set by App.tsx code running.
		appCodeRan: typeof window.scramjetReady !== "undefined",
		shadowHandoffConsumed: !globalThis.__frx_sr__,
		vendorScriptLoaded: typeof window.__FRX_CFG__ !== "undefined",
		engineGlobal: !!globalThis[["$", "scram", "jet"].join("")],
	};
});
console.log("after Ctrl+E:", JSON.stringify(after));
console.log("exceptions:", errors.length ? errors.slice(0, 3) : "none");
console.log("failed requests:", failedReqs.length ? failedReqs.slice(0, 6) : "none");

// External CDN fetches (fonts, libcurl wasm) and the 503 from accounts
// (disabled without DATABASE_URL) are environmental, not app failures.
const realErrors = errors.filter(e => !/Failed to fetch/.test(e));
const pass = before.title.includes("Catamount") && !before.hasAppRoot && after.hostPresent && after.appCodeRan && after.vendorScriptLoaded && after.engineGlobal && after.title.includes("Catamount") && realErrors.length === 0;
console.log(pass ? "CLOAK QA PASSED" : "CLOAK QA FAILED");
await b.close();
process.exit(pass ? 0 : 2);
