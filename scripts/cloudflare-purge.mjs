#!/usr/bin/env node
/*
 * cloudflare-purge.mjs — purge every active Cloudflare zone the token can see.
 *
 * Deploys change fixed-name assets (/vendor/*.js, sw.js); an edge cache holding
 * an old copy runs stale code against the new app. Origin cache headers keep
 * this from recurring, but only a purge clears an entry cached under an older
 * policy.
 *
 * Auth: CLOUDFLARE_API_TOKEN (env; a GitHub Actions secret in CI). No token ->
 * skip quietly (local/dev runs shouldn't fail). Best-effort per zone: one bad
 * zone doesn't fail the deploy. Never prints the token.
 */

const token = (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY || "").trim();

if (!token) {
	console.log("[cloudflare-purge] no CLOUDFLARE_API_TOKEN set; skipping");
	process.exit(0);
}

const api = async (path, options = {}) => {
	const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		...options,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || data.success === false) {
		throw new Error(`${options.method || "GET"} ${path} -> HTTP ${res.status}: ${(data.errors || []).map(e => e.message).join(", ") || "unknown"}`);
	}
	return data;
};

const zones = [];
let page = 1;
for (;;) {
	const data = await api(`/zones?status=active&per_page=50&page=${page}`);
	zones.push(...(data.result || []));
	const info = data.result_info;
	if (!info || page >= info.total_pages) break;
	page++;
}

if (zones.length === 0) {
	console.log("[cloudflare-purge] token is valid but sees no active zones; nothing to do");
	process.exit(0);
}

let failed = 0;
for (const zone of zones) {
	try {
		await api(`/zones/${zone.id}/purge_cache`, { method: "POST", body: JSON.stringify({ purge_everything: true }) });
		console.log(`[cloudflare-purge] purged ${zone.name}`);
	} catch (err) {
		failed++;
		console.error(`[cloudflare-purge] failed for ${zone.name}: ${err.message}`);
	}
}

console.log(`[cloudflare-purge] done: ${zones.length - failed}/${zones.length} zones purged`);
process.exit(failed === zones.length ? 1 : 0);
