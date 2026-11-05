#!/usr/bin/env node
/*
 * prune-dist.mjs — remove attribution junk from the build output before
 * obfuscation runs. Vendor packages ship sourcemaps (with original webpack://
 * source paths) and TypeScript .d.ts trees; none of it may ship. The vendored
 * runtime is copied as five renamed files (see vite.config.ts), so any .map or
 * .d.ts in dist/ is a packaging regression — prune it and say so.
 *
 * Runs as the first step of `npm run protect`.
 */

import { readdirSync, statSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const PRUNE_DIRS = new Set(["temp-types-build", "types"]);
const isPrunable = name => name.endsWith(".map") || name.endsWith(".d.ts");

let removed = 0;
function walk(dir) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) {
			if (PRUNE_DIRS.has(name)) {
				rmSync(full, { recursive: true, force: true });
				removed++;
				continue;
			}
			walk(full);
		} else if (isPrunable(name)) {
			rmSync(full, { force: true });
			removed++;
		}
	}
}

walk(DIST);
console.log(`prune-dist: removed ${removed} sourcemap/type artifacts`);
