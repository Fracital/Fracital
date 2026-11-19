#!/usr/bin/env node
/*
 * stomp-check-gate.mjs: whether stomp-check.mjs passed, for stomp-update.yml.
 *
 *   node scripts/stomp-check-gate.mjs <results.json> [<results.json> ...]
 *
 * Each file is the STOMP_CHECK_RESULTS of one stomp-check run, all against the
 * same build. The workflow runs the check again when it fails, because
 * Wikipedia now and then answers a runner with 429, so a check passes when it
 * passed in one of the runs. Every check stomp-check.mjs names must pass, and
 * so must any check a run reported under another name, except the ones in
 * KNOWN. A run that stopped early (stomp-check throws on a timeout) counts the
 * checks it did not reach as failed. A file that is missing or unreadable is a
 * run that reached nothing.
 *
 * Exits 0 when the gate passes, 2 when it does not, 1 on bad usage.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Checks that fail on the version Fracital pins too: not counted, and said when one passes again. */
const KNOWN = new Map([["address bar: the page's own url reloads it", "fails on 4.2.0-nightly.202611190245.g6a59a1d, before any update"]]);

const files = process.argv.slice(2);
if (!files.length) {
	console.error("usage: node scripts/stomp-check-gate.mjs <results.json> [...]");
	process.exit(1);
}

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "stomp-check.mjs"), "utf8");
const named = [...source.matchAll(/\bcheck\(\s*"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`));
if (!named.length) {
	console.error("::error::stomp-check-gate: found no check names in scripts/stomp-check.mjs");
	process.exit(1);
}

const runs = files.map(file => {
	try {
		const results = JSON.parse(readFileSync(file, "utf8"));
		return Array.isArray(results) ? results : [];
	} catch {
		return [];
	}
});
const passed = new Set(
	runs
		.flat()
		.filter(r => r?.pass === true)
		.map(r => r.name),
);
const all = [
	...new Set([
		...named,
		...runs
			.flat()
			.map(r => r?.name)
			.filter(n => typeof n === "string"),
	]),
];

const failed = [];
for (const name of all) {
	if (KNOWN.has(name)) {
		if (passed.has(name)) console.log(`::notice::stomp-check: "${name}" passes now; take it out of KNOWN in scripts/stomp-check-gate.mjs`);
		else console.log(`stomp-check: known failure, not counted: ${name} (${KNOWN.get(name)})`);
		continue;
	}
	if (!passed.has(name)) failed.push(name);
}
for (const name of KNOWN.keys()) if (!all.includes(name)) console.log(`::notice::stomp-check: the known failure "${name}" is no longer a check; take it out of KNOWN`);

const counted = all.filter(name => !KNOWN.has(name)).length;
const reached = runs.map(r => r.length).join(", ");
if (failed.length) {
	for (const name of failed) console.log(`::error::stomp-check: failed in every run (${runs.length}): ${name}`);
	console.log(`stomp-check gate: ${failed.length} of ${counted} counted checks failed (checks reached per run: ${reached})`);
	process.exit(2);
}
console.log(`stomp-check gate: passed, all ${counted} counted checks pass (checks reached per run: ${reached})`);
