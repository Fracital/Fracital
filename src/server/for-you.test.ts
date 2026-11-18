import assert from "node:assert/strict";
import test from "node:test";
import { daySeed, dedupeTracks, dropDisliked, shuffleSeeded, songKey } from "./for-you";

/** The client's feedbackKey (src/libs/playlists.ts), copied here as the reference. */
const clientFeedbackKey = (title: string, artist: string) => {
	const first = artist.split(/,| & | feat\.? | ft\.? | x /i)[0] ?? artist;
	return `${first}|${title}`
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, "")
		.replace(/[^\p{L}\p{N}|]+/gu, "");
};

test("the server's song key matches the client's feedback key", () => {
	const cases: [string, string][] = [
		["Better Now", "Post Malone"],
		["HUMBLE. (feat. Nobody)", "Kendrick Lamar & SZA"],
		["Song [Remastered 2011]", "Artist, Other"],
		["Café del Mar", "Energy 52 feat. Someone"],
		["Intro (Reprise)", "¥$, Kanye West & Ty Dolla $ign"],
	];
	for (const [title, artist] of cases) assert.equal(songKey(title, artist), clientFeedbackKey(title, artist));
	assert.equal(songKey("Better Now (Official)", "Post Malone"), songKey("Better Now", "Post Malone"));
});

test("disliked songs are dropped and duplicates collapse", () => {
	const tracks = [
		{ title: "Better Now", artist: "Post Malone" },
		{ title: "Better Now", artist: "Post Malone" },
		{ title: "Circles", artist: "Post Malone" },
		{ title: "Sunflower", artist: "Post Malone & Swae Lee" },
	];
	assert.equal(dedupeTracks(tracks).length, 3);
	const kept = dropDisliked(dedupeTracks(tracks), [songKey("Circles", "Post Malone")]);
	assert.deepEqual(
		kept.map(t => t.title),
		["Better Now", "Sunflower"],
	);
});

test("the shuffle is stable for a day and changes with the seed", () => {
	const list = Array.from({ length: 12 }, (_, i) => i);
	const seed = daySeed(1_800_000_000_000);
	assert.deepEqual(shuffleSeeded(list, seed), shuffleSeeded(list, seed));
	assert.deepEqual(
		[...shuffleSeeded(list, seed)].sort((a, b) => a - b),
		list,
	);
	assert.notDeepEqual(shuffleSeeded(list, seed), shuffleSeeded(list, seed + 1));
	assert.equal(daySeed(1_800_000_000_000), daySeed(1_800_000_000_000 + 3_600_000));
	assert.notEqual(daySeed(1_800_000_000_000), daySeed(1_800_000_000_000 + 86_400_000));
});
