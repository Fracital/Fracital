#!/usr/bin/env node
/*
 * stomp-check.mjs: end-to-end check of the stomp engine inside the app. Boots
 * the app, turns on the experimental proxies setting, selects stomp, and
 * drives real tabs through the shell: a page's title and URL, the address bar
 * following the page, window.open becoming a tab, the error page for an
 * unreachable site (whose error global carries the per-build name, not the
 * engine's), the tab favicon from the page's navigate report, the build string
 * in the engine selector, and the controller id surviving a reload.
 *
 *   node scripts/stomp-check.mjs http://localhost:5173/
 */
import { chromium } from "playwright-core";

const base = process.argv[2];
if (!base) {
	console.error("usage: node scripts/stomp-check.mjs <base-url>");
	process.exit(1);
}

const ENGINE_DIR = "/vendor/rt/";
const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass });
	console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e.stack || e)));
page.on("console", msg => {
	if (msg.type() === "error" || msg.type() === "warning") console.log(`  [console.${msg.type()}] ${msg.text().slice(0, 200)}`);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, what, timeout = 30000) => {
	const start = Date.now();
	for (;;) {
		const value = await fn();
		if (value) return value;
		if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${what}`);
		await sleep(200);
	}
};
const appReady = async () => {
	await waitFor(() => page.evaluate(() => !!window.appReady), "appReady to be assigned");
	await page.evaluate(() => window.appReady);
};

// --- boot on the default engine: stomp must not have started ---
await page.goto(base, { waitUntil: "load", timeout: 30000 });
await appReady();
await sleep(1500);
const idle = await page.evaluate(async dir => {
	const registrations = await navigator.serviceWorker.getRegistrations();
	return { controller: !!window.stompController, registered: registrations.some(r => new URL(r.scope).pathname === dir) };
}, ENGINE_DIR);
check("lazy boot: nothing of stomp runs while Scramjet is selected", !idle.controller && !idle.registered, JSON.stringify(idle));

// --- opt in, select stomp, reload so the app reads the setting ---
await page.evaluate(async () => {
	const path = "/settings.json";
	let data = {};
	try {
		data = JSON.parse(await window.fr.fs.promises.readFile(path, "utf8"));
	} catch {}
	data["experimental-proxies"] = true;
	data.proxy = "st";
	await window.fr.fs.promises.writeFile(path, JSON.stringify(data, null, 2), "utf8");
});
await page.reload({ waitUntil: "load" });
await appReady();

// Selecting the engine boots it (one controller for this browser tab).
await waitFor(() => page.evaluate(() => !!window.stompController), "the engine to boot once selected", 60000);
check("engine boots once selected", true);

// --- navigate the current tab through the address bar ---
// One address bar per tab; the current tab's is the one not parked under pointer-events-none.
const addressBar = () => page.locator("input#input:not(.pointer-events-none *)").first();
const go = async url => {
	const input = addressBar();
	await input.click();
	await input.fill(url);
	await input.press("Enter");
};
// The engine's frame for the current tab: the newest iframe routed under the engine directory.
const engineFrame = async () => {
	const frames = page.frames().filter(f => f.url().includes(ENGINE_DIR) && !f.url().endsWith("err.html"));
	return frames[frames.length - 1] ?? null;
};
const frameInfo = async () => {
	// The host's view: what the controller's frames report.
	return page.evaluate(() => {
		const controller = window.stompController;
		if (!controller) return null;
		const frames = controller.frames;
		const frame = frames[frames.length - 1];
		return frame ? { url: frame.url, title: frame.title, icon: frame.lastNavigate?.icon ?? null, count: frames.length, id: controller.id } : { count: 0, id: controller.id };
	});
};

await go("https://example.com/");
let info = await waitFor(
	async () => {
		const i = await frameInfo();
		return i?.url?.startsWith("https://example.com") && i.title ? i : null;
	},
	"example.com to report",
	45000,
);
check("example.com: frame url", info.url === "https://example.com/", info.url);
check("example.com: frame title", info.title === "Example Domain", info.title);
const docTitle = await (await engineFrame())?.title();
check("example.com: proxied document title", docTitle === "Example Domain", docTitle);
let address = await addressBar().inputValue();
check("example.com: address bar follows onNavigate", address === "https://example.com/", address);
const bodyText = await (await engineFrame())?.evaluate(() => document.body?.innerText?.slice(0, 60));
check("example.com: body rendered", (bodyText || "").length > 20, JSON.stringify(bodyText));

await go("https://en.wikipedia.org/wiki/Web_proxy");
info = await waitFor(
	async () => {
		const i = await frameInfo();
		return i?.url?.startsWith("https://en.wikipedia.org/wiki/") && /Wikipedia/.test(i.title || "") ? i : null;
	},
	"wikipedia to report",
	60000,
);
check("wikipedia: frame url", /^https:\/\/en\.wikipedia\.org\/wiki\/(Web_proxy|Proxy_server)/.test(info.url), info.url);
check("wikipedia: frame title", /Wikipedia/.test(info.title), info.title);
address = await addressBar().inputValue();
check("wikipedia: address bar", /^https:\/\/en\.wikipedia\.org\/wiki\//.test(address), address);
await sleep(1500);
const wikiHeading = await (await engineFrame())?.evaluate(() => document.querySelector("h1")?.textContent?.trim());
check("wikipedia: heading rendered", !!wikiHeading, wikiHeading);
// The icon comes from the page's own navigate report (NavigateInfo.icon), not from reading the frame's DOM.
check("wikipedia: icon reported by the page", /^https:\/\/en\.wikipedia\.org\/.*favicon/.test(info.icon || ""), info.icon);
const tabIcon = await waitFor(
	() =>
		page.evaluate(() => {
			const tabs = [...document.querySelectorAll("[data-url][id]")];
			const img = tabs.map(t => t.querySelector("img")).find(Boolean);
			return img?.getAttribute("src") || null;
		}),
	"the tab favicon image",
	20000,
).catch(() => null);
check("wikipedia: tab shows the favicon", !!tabIcon, tabIcon ? tabIcon.slice(0, 60) : "no img in the tab");

// --- the engine selector shows the controller's build ---
const build = await page.evaluate(() => window.stompController?.build);
const rowShowsBuild = await page.evaluate(b => [...document.querySelectorAll("span")].some(s => s.textContent === b), build);
check("selector shows the controller build", typeof build === "string" && build.length > 0 && rowShowsBuild, build);

// --- window.open from the page becomes a tab ---
const tabsBefore = await page.evaluate(() => document.querySelectorAll("[data-url][id]").length);
await (await engineFrame())?.evaluate(() => {
	window.open("https://example.org/", "_blank");
});
const tabsAfter = await waitFor(
	async () => {
		const n = await page.evaluate(() => document.querySelectorAll("[data-url][id]").length);
		return n > tabsBefore ? n : null;
	},
	"a new tab from window.open",
	15000,
).catch(() => tabsBefore);
check("window.open becomes a tab", tabsAfter === tabsBefore + 1, `${tabsBefore} -> ${tabsAfter}`);
info = await waitFor(
	async () => {
		const i = await frameInfo();
		return i?.url?.startsWith("https://example.org") ? i : null;
	},
	"the new tab to load example.org",
	30000,
).catch(() => null);
check("new tab loads the opened url", info?.url === "https://example.org/", info?.url);
address = await addressBar().inputValue();
check("new tab is current: address bar shows it", address === "https://example.org/", address);

// --- error page for an unreachable site ---
await go("https://nonexistent.invalid/");
// The global the service worker sets on the error page is the per-build name (names.error), never the engine's default.
const errorName = await page.evaluate(() => window.stompController?.config?.names?.error ?? null);
const errorInfo = await waitFor(
	async () => {
		for (const f of page.frames()) {
			if (!f.url().includes(ENGINE_DIR)) continue;
			const e = await f
				.evaluate(name => {
					const info = name ? globalThis[name] : null;
					if (!info) return null;
					return { ...info, heading: document.getElementById("title")?.textContent, shownUrl: document.getElementById("url")?.textContent, hasRetry: !!document.getElementById("retry"), defaultGlobal: "stompError" in globalThis };
				}, errorName)
				.catch(() => null);
			if (e) return e;
		}
		return null;
	},
	"the error page",
	45000,
).catch(() => null);
check("error page shows for nonexistent.invalid", !!errorInfo, JSON.stringify(errorInfo));
check("error page has Retry", !!errorInfo?.hasRetry);
check("error global carries the per-build name", !!errorName && errorName !== "stompError" && errorInfo?.defaultGlobal === false, `${errorName}`);
check("error page rendered the failure", errorInfo?.shownUrl === "https://nonexistent.invalid/" && !!errorInfo?.heading, `${errorInfo?.heading}: ${errorInfo?.shownUrl}`);
address = await addressBar().inputValue();
check("error page: address bar keeps the real url", address === "https://nonexistent.invalid/", address);

// --- reload keeps the controller id ---
const idBefore = await page.evaluate(() => ({ id: window.stompController?.id, saved: sessionStorage.getItem("fracital:st-controller") }));
await page.reload({ waitUntil: "load" });
await appReady();
await go("https://example.com/");
await waitFor(() => page.evaluate(() => !!window.stompController), "the engine after reload", 60000);
const idAfter = await page.evaluate(() => ({ id: window.stompController?.id, saved: sessionStorage.getItem("fracital:st-controller") }));
check("reload keeps the controller id", !!idBefore.id && idBefore.id === idAfter.id && idAfter.saved === idAfter.id, `${idBefore.id} -> ${idAfter.id}`);
const routed = await waitFor(async () => {
	const f = await engineFrame();
	return f?.url() || null;
}, "a routed frame after reload");
check("routed url carries the id", routed.includes(`${ENGINE_DIR}${idAfter.id}/`), routed);

console.log("page exceptions:", errors.length ? errors.slice(0, 3) : "none");
const failed = results.filter(r => !r.pass);
console.log(failed.length ? `STOMP E2E FAILED (${failed.length}/${results.length})` : `STOMP E2E PASSED (${results.length} checks)`);
await browser.close();
process.exit(failed.length ? 2 : 0);
