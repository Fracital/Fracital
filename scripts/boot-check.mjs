#!/usr/bin/env node
/*
 * boot-check.mjs — headless-Chrome boot verification for a shield build.
 * For each route: load, wait, then report rendered DOM size, page title,
 * __shieldFlags, exceptions, console errors, and shield-specific errors.
 * Exits 2 when any route fails to render or logs a shield error.
 *
 *   node scripts/boot-check.mjs http://localhost:8137/ [http://localhost:8137/#/games ...]
 */
import { chromium } from "playwright-core";

const targets = process.argv.slice(2);
if (!targets.length) {
	console.error("usage: node scripts/boot-check.mjs <url> [...]");
	process.exit(1);
}

const browser = await chromium.launch({
	executablePath: "/usr/bin/google-chrome",
	args: ["--no-sandbox", "--disable-gpu"],
});

let failed = false;
for (const url of targets) {
	const page = await browser.newPage();
	const exceptions = [];
	const consoleErrors = [];
	page.on("pageerror", e => exceptions.push(String(e)));
	page.on("console", m => {
		if (m.type() === "error") consoleErrors.push(m.text());
	});
	try {
		await page.goto(url, { waitUntil: "load", timeout: 30000 });
		await page.waitForTimeout(10000);
		const info = await page
			.evaluate(() =>
				JSON.stringify({
					rootBytes: document.getElementById("root")?.innerHTML.length ?? -1,
					flags: window.__shieldFlags ?? null,
					title: document.title,
				}),
			)
			.catch(e => JSON.stringify({ error: String(e) }));
		const parsed = JSON.parse(info);
		const shieldErr = consoleErrors.filter(e => /shield|bytecode|step budget|integrity/i.test(e));
		console.log(`=== ${url}`);
		console.log(`    rootBytes=${parsed.rootBytes} title=${JSON.stringify(parsed.title)} flags=${JSON.stringify(parsed.flags)}`);
		console.log(`    exceptions: ${exceptions.length ? exceptions.slice(0, 3).join(" | ") : "none"}`);
		console.log(`    console errors: ${consoleErrors.length ? consoleErrors.slice(0, 5).join(" | ") : "none"}`);
		console.log(`    shield errors: ${shieldErr.length ? shieldErr.join(" | ") : "none"}`);
		if (!parsed.rootBytes || parsed.rootBytes < 2000 || shieldErr.length || exceptions.length) failed = true;
	} catch (e) {
		console.log(`=== ${url}\n    NAVIGATION FAILURE: ${e}`);
		failed = true;
	}
	await page.close();
}
await browser.close();
process.exit(failed ? 2 : 0);
