import assert from "node:assert/strict";
import test from "node:test";
import { canonicalUrl, defaultRow, fold, frecentSites, matchScore, rankAndGroup, type Suggestion, scoreUrl, topPicks, urlMatch } from "./rank";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = 1_800_000_000_000;

const row = (kind: Suggestion["kind"], id: string, score: number, extra: Partial<Suggestion> = {}): Suggestion => ({ kind, id, title: id, score, ...extra });
const searchOpts = { urlLike: false, defaultUrl: "https://duckduckgo.com/?q=x" };

test("matching tiers: exact, prefix, word prefix, substring", () => {
	assert.equal(matchScore("youtube", "youtube"), 1);
	assert.equal(matchScore("you", "youtube"), 0.85);
	assert.equal(matchScore("tube", "my tube"), 0.7);
	assert.equal(matchScore("tub", "youtube"), 0.5);
	assert.equal(matchScore("vimeo", "youtube"), 0);
});

test("folding ignores case, accents, the scheme, www. and a trailing slash", () => {
	assert.equal(fold("https://www.Beyoncé.com/"), "beyonce.com");
	assert.equal(matchScore("beyonce", "Beyoncé"), 1);
	assert.equal(urlMatch("youtube", "https://www.youtube.com/"), 1);
});

test("a multi-word query needs every word", () => {
	assert.ok(matchScore("post malone", "Post Malone - Better Now") > 0);
	assert.equal(matchScore("post drake", "Post Malone - Better Now"), 0);
});

test("canonical URLs drop the hash and trailing slash but keep the query", () => {
	assert.equal(canonicalUrl("https://YouTube.com/watch?v=1#t=2"), "https://youtube.com/watch?v=1");
	assert.equal(canonicalUrl("https://example.com/a/"), canonicalUrl("https://example.com/a"));
});

test("frecency: a few recent visits beat many old ones, and the score saturates", () => {
	const visits = [...Array.from({ length: 3 }, (_, i) => ({ url: "https://new.example/", title: "New", at: now - i * HOUR })), ...Array.from({ length: 10 }, (_, i) => ({ url: "https://old.example/", title: "Old", at: now - 60 * DAY - i * HOUR }))];
	const sites = frecentSites(visits, now);
	assert.equal(sites[0].url, "https://new.example/");
	assert.ok(sites[0].frecency > sites[1].frecency);
	assert.ok(scoreUrl(1, 1000) < 1 && scoreUrl(1, 1000) > 0.99);
	assert.ok(scoreUrl(1, 3) > 0.79 && scoreUrl(1, 3) < 0.81);
});

test("an open tab for the page hides its history row and sorts first", () => {
	const ranked = rankAndGroup("yout", [row("url", "url:yt", 0.8, { url: "https://www.youtube.com/" }), row("tab", "tab:1", 0.85, { url: "https://youtube.com" }), row("url", "url:other", 0.6, { url: "https://youtu.be/x" })], searchOpts);
	assert.deepEqual(
		ranked.rows.map(r => r.id),
		["default", "tab:1", "url:other"],
	);
});

test("an about: query shows only pages after the default row", () => {
	const ranked = rankAndGroup("about:se", [row("page", "page:settings", 0.9), row("url", "url:x", 0.9, { url: "https://x.y" }), row("game", "game:a", 0.9)], { urlLike: true, defaultUrl: "about:se" });
	assert.deepEqual(
		ranked.rows.map(r => r.kind),
		["url", "page"],
	);
});

test("the default row is Go to for an address and Search for words", () => {
	assert.equal(defaultRow("example.com", { urlLike: true, defaultUrl: "https://example.com" }).kind, "url");
	assert.equal(defaultRow("how to tie a tie", searchOpts).kind, "search");
	assert.equal(rankAndGroup("x", [], searchOpts).rows[0].id, "default");
});

test("caps: ten rows after the default, each kind capped, groups ordered by their best row", () => {
	const many = [
		...Array.from({ length: 8 }, (_, i) => row("url", `url:${i}`, 0.7 - i * 0.01, { url: `https://s${i}.example/` })),
		...Array.from({ length: 6 }, (_, i) => row("completion", `c:${i}`, 0.55 - i * 0.02)),
		row("game", "game:1", 0.95),
		...Array.from({ length: 5 }, (_, i) => row("song", `song:${i}`, 0.6 - i * 0.01)),
	];
	const ranked = rankAndGroup("s", many, searchOpts);
	assert.equal(ranked.rows.length, 11);
	assert.equal(ranked.groups[1].key, "game");
	assert.equal(ranked.rows.filter(r => r.kind === "url").length, 4);
	assert.equal(ranked.rows.filter(r => r.kind === "song").length, 3);
	// One game, four sites and three songs fill eight of the ten slots.
	assert.equal(ranked.rows.filter(r => r.kind === "completion").length, 2);
});

test("a completion that only repeats the query is dropped", () => {
	const ranked = rankAndGroup("Weather", [row("completion", "c:1", 0.55, { title: "weather" }), row("completion", "c:2", 0.53, { title: "weather tomorrow" })], searchOpts);
	assert.deepEqual(
		ranked.rows.map(r => r.id),
		["default", "c:2"],
	);
});

test("top picks: jump back in, top sites and open tabs, at most eight, no default row", () => {
	const picks = topPicks({
		recentGames: [row("game", "game:a", 1), row("game", "game:b", 1), row("game", "game:c", 1)],
		lastSong: row("song", "song:1", 1),
		recentSites: [row("url", "url:1", 1), row("url", "url:2", 1), row("url", "url:3", 1)],
		topSites: [row("url", "url:1", 1), row("url", "url:4", 1), row("url", "url:5", 1), row("url", "url:6", 1), row("url", "url:7", 1)],
		openTabs: [row("tab", "tab:1", 1), row("tab", "tab:2", 1), row("tab", "tab:3", 1)],
	});
	assert.equal(picks.rows.length, 8);
	assert.deepEqual(
		picks.groups.map(g => g.key),
		["jump", "top"],
	);
	assert.deepEqual(
		picks.groups[0].rows.map(r => r.id),
		["game:a", "game:b", "song:1", "url:1", "url:2"],
	);
	// url:1 was already shown under Jump back in.
	assert.deepEqual(
		picks.groups[1].rows.map(r => r.id),
		["url:4", "url:5", "url:6"],
	);
	assert.ok(picks.rows.every(r => r.id !== "default"));
	assert.equal(topPicks({ recentGames: [], recentSites: [], topSites: [], openTabs: [] }).rows.length, 0);
});
