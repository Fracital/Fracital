import { readFileSync } from "node:fs";
const m = JSON.parse(readFileSync("dist/shield-manifest.json", "utf8"));
console.log("counts:", JSON.stringify(m.counts), "bootViaLoader:", m.bootViaLoader, "entry:", m.entry);
for (const c of m.chunks) {
	console.log(`${c.id} entry=${c.isEntry} ${c.rawBytes}B -> ${c.decision} | ${c.reason || ""}`);
}
