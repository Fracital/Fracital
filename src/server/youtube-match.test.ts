import test from "node:test";
import assert from "node:assert/strict";
import { scoreMusicVideo, scoreVideo, type MatchHints, type Video } from "./youtube-match";

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

// --- Music videos ---

const bestVideo = (videos: Video[], hints: MatchHints) => {
	const [top] = videos.map(v => ({ v, s: scoreMusicVideo(v, hints) })).sort((a, b) => b.s - a.s);
	return top.s >= 70 ? top.v.title : null;
};

test("picks the artist's official video over reuploads and lyric videos", () => {
	const videos: Video[] = [
		{ videoId: "a", title: "Ella Langley - Choosin' Texas (Official Lyric Video)", seconds: 232, author: { name: "Ella Langley" } },
		{ videoId: "b", title: "Ella Langley - Choosin' Texas (Official Video)", seconds: 229, author: { name: "REGAL" } },
		{ videoId: "c", title: "Ella Langley - Choosin' Texas (Official Behind The Scenes Video)", seconds: 231, author: { name: "Ella Langley" } },
		{ videoId: "d", title: "Ella Langley - Choosin’ Texas (UN-Official Music Video) ft. Luke Grimes", seconds: 238, author: { name: "PrimulaPrincess_xo" } },
		{ videoId: "e", title: "Ella Langley - Choosin' Texas (Official Video)", seconds: 422, author: { name: "Ella Langley" } },
	];
	assert.equal(bestVideo(videos, { title: "Choosin' Texas", artist: "Ella Langley" }), "Ella Langley - Choosin' Texas (Official Video)");
	assert.equal(videos.find(v => bestVideo([v], { title: "Choosin' Texas", artist: "Ella Langley" }))?.videoId, "b");
});

test("an unlabeled 'Artist - Song' upload from the artist is the video, the bare art track isn't", () => {
	const videos: Video[] = [
		{ videoId: "a", title: "HUMBLE.", seconds: 177, author: { name: "Kendrick Lamar" } },
		{ videoId: "b", title: "Kendrick Lamar - HUMBLE.", seconds: 184, author: { name: "Kendrick Lamar" } },
		{ videoId: "c", title: "Kendrick Lamar – Humble (Official Music Video)", seconds: 185, author: { name: "Drip verse " } },
	];
	assert.equal(bestVideo(videos, { title: "HUMBLE.", artist: "Kendrick Lamar" }), "Kendrick Lamar - HUMBLE.");
});

test("songs without a music video find none", () => {
	const parabol: Video[] = [
		{ videoId: "a", title: "TOOL - Parabola (Official Video)", seconds: 608, author: { name: "TOOL" } },
		{ videoId: "b", title: "TOOL - Parabol (Audio)", seconds: 187, author: { name: "TOOL" } },
		{ videoId: "c", title: "Parabol", seconds: 185, author: { name: "TOOL" } },
		{ videoId: "d", title: "Parabol / Parabola - Tool - Music Video - Abstract Animation", seconds: 557, author: { name: "The Expert Layman" } },
	];
	assert.equal(bestVideo(parabol, { title: "Parabol", artist: "TOOL" }), null);
	const windowpane: Video[] = [
		{ videoId: "a", title: "Opeth - Windowpane (The Lost Tape)", seconds: 395, author: { name: "Opeth" } },
		{ videoId: "b", title: "Windowpane", seconds: 482, author: { name: "Opeth" } },
		{ videoId: "c", title: "Opeth - Windowpane (Live at Shepherd's Bush Empire, London)", seconds: 553, author: { name: "Opeth" } },
	];
	assert.equal(bestVideo(windowpane, { title: "Windowpane", artist: "Opeth" }), null);
});
