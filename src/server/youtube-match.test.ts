import test from "node:test";
import assert from "node:assert/strict";
import { scoreVideo, type MatchHints, type Video } from "./youtube-match";

const best = (videos: Video[], hints: MatchHints) => [...videos].sort((a, b) => scoreVideo(b, hints) - scoreVideo(a, hints))[0].title;

// Real search results for "TOOL Parabol official audio".
const parabolResults: Video[] = [
	{ videoId: "a", title: "TOOL - Parabola (Audio)", seconds: 366, author: { name: "TOOL" } },
	{ videoId: "b", title: "TOOL - Parabol (Audio)", seconds: 187, author: { name: "TOOL" } },
	{ videoId: "c", title: "TOOL - Parabola (Official Video)", seconds: 608, author: { name: "TOOL" } },
	{ videoId: "d", title: "TOOL - Parabol(a)", seconds: 543, author: { name: "Reign of Terrible" } },
	{ videoId: "e", title: "TOOL - Parabol/Parabola Lyrics", seconds: 548, author: { name: "TheSilentGuardian" } },
];

test("Parabol doesn't match Parabola", () => {
	assert.equal(best(parabolResults, { title: "Parabol", artist: "TOOL", duration: 184 }), "TOOL - Parabol (Audio)");
});

test("Parabol is picked by title alone when the length is unknown", () => {
	assert.equal(best(parabolResults, { title: "Parabol", artist: "TOOL" }), "TOOL - Parabol (Audio)");
});

test("Parabola still finds Parabola", () => {
	assert.equal(best(parabolResults, { title: "Parabola", artist: "TOOL", duration: 363 }), "TOOL - Parabola (Audio)");
});

test("explicit songs avoid clean edits, live takes and covers", () => {
	const videos: Video[] = [
		{ videoId: "1", title: "Artist - Song (Clean)", seconds: 200, author: { name: "Artist" } },
		{ videoId: "2", title: "Artist - Song (Live at Wembley)", seconds: 260, author: { name: "Artist" } },
		{ videoId: "3", title: "Song - Artist (cover)", seconds: 201, author: { name: "Some Fan" } },
		{ videoId: "4", title: "Song", seconds: 201, author: { name: "Artist - Topic" } },
	];
	assert.equal(best(videos, { title: "Song", artist: "Artist", explicit: true, duration: 200 }), "Song");
});
