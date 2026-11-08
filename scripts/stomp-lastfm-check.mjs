#!/usr/bin/env node
/*
 * stomp-lastfm-check.mjs: the Last.fm connect flow under the stomp engine,
 * without an account or credentials. Selects stomp, opens the Account page and
 * presses "Continue with Last.fm": a Fracital tab must open on Last.fm's auth
 * page through the proxy, the auth page request must carry rule 0 (the
 * first-party Origin/Referer rule) while a login POST carries none, and when
 * the frame reaches our callback URL with a token the host must intercept it
 * (the proxy refuses its own origin), call the callback first-party, surface
 * the server's answer in the Account page, and close the tab.
 *
 * The server needs accounts configured (DATABASE_URL) and a Last.fm key; with a
 * placeholder key Last.fm answers its auth page with a 503, which this check
 * accepts and reports (the login form itself is checked on /login).
 *
 *   node scripts/stomp-lastfm-check.mjs http://127.0.0.1:8137/
 */
import { chromium } from "playwright-core";

const base = process.argv[2];
if (!base) {
	console.error("usage: node scripts/stomp-lastfm-check.mjs <base-url>");
	process.exit(1);
}
const origin = new URL(base).origin;
const ENGINE_DIR = "/vendor/rt/";
const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass });
	console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
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

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e.stack || e)));
page.on("console", msg => {
	if (msg.type() === "error" || msg.type() === "warning") console.log(`  [console.${msg.type()}] ${msg.text().slice(0, 200)}`);
});
// First-party requests the host page makes to our server (not through the proxy).
const firstParty = [];
page.on("request", r => {
	if (r.frame() === page.mainFrame() && r.url().startsWith(origin) && /\/api\/(auth\/lastfm|me)/.test(r.url())) firstParty.push({ url: r.url(), method: r.method() });
});
page.on("response", async r => {
	const i = firstParty.find(f => f.url === r.url() && f.status === undefined);
	if (i) i.status = r.status();
});

const appReady = async () => {
	await waitFor(() => page.evaluate(() => !!window.appReady), "appReady");
	await page.evaluate(() => window.appReady);
};
// Opt in to the experimental engines and select stomp, then reload so the app
// reads it. Fracital's own start-up writes settings.json too (loadTheme reads
// the file, sets the theme and writes it back), so a write of ours that lands
// between that read and that write is lost: write, wait for the file to read
// back as written, and after the reload check again and repeat if it reverted.
const selectStomp = async () => {
	for (let attempt = 1; attempt <= 3; attempt++) {
		const kept = await page.evaluate(async () => {
			const path = "/settings.json";
			const fs = window.fr.fs.promises;
			for (let i = 0; i < 20; i++) {
				let data = {};
				try {
					data = JSON.parse(await fs.readFile(path, "utf8"));
				} catch {}
				if (data["experimental-proxies"] === true && data.proxy === "st") return true;
				data["experimental-proxies"] = true;
				data.proxy = "st";
				await fs.writeFile(path, JSON.stringify(data, null, 2), "utf8");
				await new Promise(r => setTimeout(r, 250));
			}
			return false;
		});
		await page.reload({ waitUntil: "load" });
		await appReady();
		const selected = await page.evaluate(async () => {
			try {
				const data = JSON.parse(await window.fr.fs.promises.readFile("/settings.json", "utf8"));
				return data["experimental-proxies"] === true && data.proxy === "st";
			} catch {
				return false;
			}
		});
		if (kept && selected) return;
	}
	throw new Error("could not keep the stomp engine selected in settings.json");
};
const addressBar = () => page.locator("input#input:not(.pointer-events-none *)").first();
const go = async url => {
	const input = addressBar();
	await input.click();
	await input.fill(url);
	await input.press("Enter");
};
const tabCount = () => page.evaluate(() => document.querySelectorAll("[data-url][id]").length);
const engineFrames = () => page.frames().filter(f => f.url().includes(ENGINE_DIR));
// The first proxied frame (tab documents and nested frames alike) whose document satisfies `pred`.
const frameWhere = async pred => {
	for (const f of engineFrames()) {
		const value = await f.evaluate(pred).catch(() => null);
		if (value) return { frame: f, value };
	}
	return null;
};
const isTabDocument = r => r.destination === "iframe" || r.destination === "document";
const requestLog = () => page.evaluate(() => (window.stompRequestLog || []).map(r => ({ url: r.url, method: r.method, destination: r.destination, status: r.status, kind: r.kind ?? null, rule: r.rule ?? null, error: r.error ?? null })));

// --- select stomp, reload, boot ---
await page.goto(base, { waitUntil: "load", timeout: 30000 });
await appReady();
await selectStomp();
await waitFor(() => page.evaluate(() => !!window.stompController), "the engine to boot", 60000);

// --- the Account page's Last.fm button ---
await go("about:account");
const button = page.getByRole("button", { name: /Continue with Last\.fm/ }).first();
await button.waitFor({ timeout: 20000 });
const tabsBefore = await tabCount();
await button.click();
const tabsAfter = await waitFor(
	async () => {
		const n = await tabCount();
		return n > tabsBefore ? n : null;
	},
	"a Last.fm tab",
	20000,
).catch(() => tabsBefore);
check("connect opens a Fracital tab", tabsAfter === tabsBefore + 1, `${tabsBefore} -> ${tabsAfter}`);
const startCall = firstParty.find(f => f.url.includes("/api/auth/lastfm/url"));
check("host asked the server for the auth URL (JSON route)", !!startCall, JSON.stringify(startCall));
const authReport = await waitFor(async () => (await requestLog()).find(r => isTabDocument(r) && /^https:\/\/www\.last\.fm\/api\/auth/.test(r.url)), "the auth page request report", 45000).catch(() => null);
check("auth page requested through the proxy", !!authReport, JSON.stringify(authReport));
check("auth page request matched rule 0 (first-party Origin/Referer)", authReport?.rule === 0, `rule=${authReport?.rule}`);
// Every /api/auth hop (the 301 to the slash-less path and its 302 onwards) carries the rule.
const authHops = (await requestLog()).filter(r => isTabDocument(r) && /^https:\/\/www\.last\.fm\/api\/auth/.test(r.url));
check("every auth page hop matched the rule", authHops.length > 0 && authHops.every(r => r.rule === 0), authHops.map(r => `${r.status} rule=${r.rule}`).join(", "));
const cb = (() => {
	try {
		return new URL(authReport?.url || "").searchParams.get("cb") || "";
	} catch {
		return "";
	}
})();
check("auth URL carries our callback as cb", cb.startsWith(`${origin}/api/auth/lastfm/callback`), cb);
// Last.fm sends a visitor without a session on to /login?next=/api/auth...; the address bar follows.
// Inside frame.evaluate, `location` is the routed one (the page's hooked view is
// for the page's own scripts), so documents are told apart by title and content.
const lastfmDoc = () => (/Last\.fm/.test(document.title) ? { title: document.title, hasPassword: !!document.querySelector("input[type=password]"), unavailable: /Temporarily Unavailable/.test(document.title) } : null);
const authDoc = await waitFor(() => frameWhere(lastfmDoc).then(r => (r && (r.value.hasPassword || r.value.unavailable) ? r.value : null)), "the Last.fm document with its form", 60000).catch(() => null);
const address = await addressBar().inputValue();
check("tab shows a Last.fm document and the address bar follows it", !!authDoc && /^https:\/\/www\.last\.fm\//.test(address), `${JSON.stringify(authDoc)} address=${address}`);
check("Last.fm auth page continued to its sign-in form (or answered its 503 for an unknown API key)", !!authDoc?.hasPassword || !!authDoc?.unavailable, JSON.stringify(authDoc));
if (authDoc?.unavailable) console.log("  note: Last.fm answered 503 Temporarily Unavailable (placeholder API key); the login form is checked on /login below");

// --- the login form is not touched by the rule: GET /login and an empty POST ---
// The tab is still on the /login?next= document the auth page sent it to, which
// has the same title and form: mark every document there now, so the wait below
// takes only the one this navigation loads (a form found on the old document
// was submitted just before the navigation replaced it, and no POST was made).
for (const f of engineFrames()) await f.evaluate(() => (window.__checkStale = true)).catch(() => undefined);
await go("https://www.last.fm/login");
const login = await waitFor(
	() => frameWhere(() => (!window.__checkStale && document.title === "Login | Last.fm" && document.readyState !== "loading" && document.querySelector("form input[type=password]") ? { title: document.title, action: document.querySelector("form input[type=password]")?.form?.action } : null)),
	"the login form",
	60000,
).catch(() => null);
check("login form renders through the proxy", !!login, JSON.stringify(login?.value));
const loginGets = (await requestLog()).filter(r => isTabDocument(r) && /^https:\/\/www\.last\.fm\/login/.test(r.url));
check("login page requests carry no rule", loginGets.length > 0 && loginGets.every(r => r.rule === null), loginGets.map(r => `${r.status} rule=${r.rule}`).join(", "));
// Submitted from the host page with its own native submit(): Last.fm replaces
// HTMLFormElement.prototype.submit in its realm with a wrapper that drops the
// submission while its module loader is unhappy (it times out natively too), and
// the tab document is same-origin with the host. submit(), not requestSubmit(): the
// empty required fields would otherwise stop it, and an empty POST is what is
// wanted (no credentials). Through the prototype: a control named "submit" shadows
// form.submit on this form.
const loginFrameElement = await login?.frame.frameElement().catch(() => null);
await loginFrameElement
	?.evaluate(iframe => {
		const form = iframe.contentDocument?.querySelector("form input[type=password]")?.form;
		if (form) HTMLFormElement.prototype.submit.call(form);
	})
	.catch(() => undefined);
const loginPost = await waitFor(async () => (await requestLog()).find(r => r.method === "POST" && /^https:\/\/www\.last\.fm\/login/.test(r.url)), "the login POST", 30000).catch(() => null);
check("empty login POST went through the proxy without a rule (no credentials sent)", !!loginPost && loginPost.rule === null, JSON.stringify(loginPost));

// --- the callback plumbing with a synthetic token ---
const tabsWithLastfm = await tabCount();
await go(`${cb || `${origin}/api/auth/lastfm/callback`}?token=fake`);
const refused = await waitFor(async () => (await requestLog()).find(r => r.url.startsWith(`${origin}/api/auth/lastfm/callback`)), "the refused callback report", 30000).catch(() => null);
check("proxy refused our own origin and reported the callback URL", !!refused && refused.kind === "refused", JSON.stringify(refused));
const closed = await waitFor(async () => ((await tabCount()) < tabsWithLastfm ? true : null), "the Last.fm tab to close", 20000).catch(() => false);
check("host closed the Last.fm tab", closed === true, `${tabsWithLastfm} -> ${await tabCount()}`);
const cbCall = await waitFor(() => firstParty.find(f => f.url.includes("/api/auth/lastfm/callback") && f.url.includes("token=fake") && f.status !== undefined) || null, "the first-party callback call", 20000).catch(() => null);
check("host called the callback first-party with the token", !!cbCall, JSON.stringify(cbCall));
const errorText = await waitFor(
	() =>
		page
			.locator(".text-red-300")
			.first()
			.textContent()
			.catch(() => null),
	"the Account page error",
	20000,
).catch(() => null);
check("the exchange failure surfaces in the Account page", !!errorText && errorText.trim().length > 0, JSON.stringify(errorText));
const proxiedCallback = (await requestLog()).filter(r => r.url.startsWith(origin) && r.status && r.status !== 0 && r.kind !== "refused");
check("no proxied request ever reached our origin", proxiedCallback.length === 0, JSON.stringify(proxiedCallback.slice(0, 2)));

console.log("--- request flow (proxied, as reported):");
for (const r of (await requestLog()).filter(r => /last\.fm|audioscrobbler|\/api\/auth\/lastfm/.test(r.url))) console.log(`  ${r.method} ${r.status} ${r.destination} rule=${r.rule} kind=${r.kind} ${r.url.slice(0, 140)}`);
console.log("--- first-party calls from the host page:");
for (const f of firstParty.filter(f => f.url.includes("lastfm"))) console.log(`  ${f.method} ${f.status} ${f.url.slice(0, 140)}`);
console.log("page exceptions:", errors.length ? errors.slice(0, 3) : "none");
const failed = results.filter(r => !r.pass);
console.log(failed.length ? `STOMP LASTFM FAILED (${failed.length}/${results.length})` : `STOMP LASTFM PASSED (${results.length} checks)`);
await browser.close();
process.exit(failed.length ? 2 : 0);
