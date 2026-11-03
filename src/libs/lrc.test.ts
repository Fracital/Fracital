import test from "node:test";
import assert from "node:assert/strict";

import { activeLineIndex, lyricFormatOf, parseLrc, parseLyrics, parseSrt, toLrc } from "./lrc";

test("parseLrc reads timestamps, skips metadata and sorts lines", () => {
	const result = parseLrc("[ar:Someone]\n[ti:Song]\n[00:12.50]Second\n[00:01.00]First\n[01:02]Third");
	assert.equal(result.synced, true);
	assert.deepEqual(result.lines, [
		{ time: 1, text: "First" },
		{ time: 12.5, text: "Second" },
		{ time: 62, text: "Third" },
	]);
});

test("parseLrc expands repeated timestamps and strips word tags", () => {
	const result = parseLrc("[00:01.00][00:10.000]Chorus <00:01.50>line\r\n[00:05.00]");
	assert.deepEqual(result.lines, [
		{ time: 1, text: "Chorus line" },
		{ time: 5, text: "" },
		{ time: 10, text: "Chorus line" },
	]);
});

test("parseLrc applies the offset tag", () => {
	const result = parseLrc("[offset:500]\n[00:02.00]Hi");
	assert.deepEqual(result.lines, [{ time: 1.5, text: "Hi" }]);
});

test("parseLrc falls back to plain lyrics and keeps verse breaks", () => {
	const result = parseLrc("\nLine one\nLine two\n\n\nLine three\n\n");
	assert.equal(result.synced, false);
	assert.deepEqual(result.lines, [
		{ time: null, text: "Line one" },
		{ time: null, text: "Line two" },
		{ time: null, text: "Line three", breakBefore: true },
	]);
});

test("parseLrc keeps blank-line section breaks in synced lyrics", () => {
	const result = parseLrc("[ti:Song]\n\n[00:01]Verse a\n[00:03]Verse b\n\n[00:05][00:20]Chorus\n\n[00:10]Verse two\n[00:25]Outro");
	assert.deepEqual(result.lines, [
		{ time: 1, text: "Verse a" },
		{ time: 3, text: "Verse b" },
		{ time: 5, text: "Chorus", breakBefore: true },
		{ time: 10, text: "Verse two", breakBefore: true },
		{ time: 20, text: "Chorus", breakBefore: true },
		{ time: 25, text: "Outro" },
	]);
});

test("activeLineIndex finds the current line", () => {
	const { lines } = parseLrc("[00:01]a\n[00:05]b\n[00:09]c");
	assert.equal(activeLineIndex(lines, 0.5), -1);
	assert.equal(activeLineIndex(lines, 1), 0);
	assert.equal(activeLineIndex(lines, 7), 1);
	assert.equal(activeLineIndex(lines, 100), 2);
});

test("parseSrt reads cues, joins multi-line text and strips markup", () => {
	const result = parseSrt("\uFEFF1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Hello</i>\r\nworld\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\n{\\an8}Again\r\n");
	assert.equal(result.synced, true);
	assert.deepEqual(result.lines, [
		{ time: 1.5, text: "Hello world" },
		{ time: 3, text: "Again" },
	]);
});

test("parseSrt sorts cues and marks long gaps", () => {
	const result = parseSrt("2\n01:00:10,000 --> 01:00:12,000\nLater\n\n1\n00:00:01.000 --> 00:00:02.000\nFirst\n");
	assert.deepEqual(result.lines, [
		{ time: 1, text: "First" },
		{ time: 2, text: "" },
		{ time: 3610, text: "Later" },
	]);
});

test("parseSrt falls back to plain text", () => {
	const result = parseSrt("Just words\nMore words");
	assert.equal(result.synced, false);
	assert.deepEqual(
		result.lines.map(l => l.text),
		["Just words", "More words"],
	);
});

test("lyricFormatOf and parseLyrics pick the right parser", () => {
	assert.equal(lyricFormatOf("Song.LRC"), "lrc");
	assert.equal(lyricFormatOf("song.srt"), "srt");
	assert.equal(lyricFormatOf("song.txt"), "txt");
	assert.equal(lyricFormatOf("song.mp3"), null);
	assert.equal(parseLyrics("1\n00:00:01,000 --> 00:00:02,000\nHi", "srt").synced, true);
	assert.equal(parseLyrics("[00:01.00]Hi", "txt").synced, true);
});

test("toLrc round-trips synced and plain lyrics with section breaks", () => {
	const synced = parseLrc("[00:01.00]One\n[00:02.50]Two\n\n[01:05.25]Three");
	assert.equal(toLrc(synced), "[00:01.00]One\n[00:02.50]Two\n\n[01:05.25]Three\n");
	assert.deepEqual(parseLrc(toLrc(synced)), synced);

	const plain = parseLrc("One\nTwo\n\nThree");
	assert.equal(toLrc(plain), "One\nTwo\n\nThree\n");
	assert.deepEqual(parseLrc(toLrc(plain)), plain);
});

test("parseSrt handles files without blank lines between cues", () => {
	const result = parseSrt("1\n00:00:16,424 --> 00:00:21,128\nFirst line\n2\n00:00:21,373 --> 00:00:26,440\nSecond line\n3\n00:00:26,514 --> 00:00:30,877\nLine with 2024 in it\n");
	assert.deepEqual(result.lines, [
		{ time: 16.424, text: "First line" },
		{ time: 21.373, text: "Second line" },
		{ time: 26.514, text: "Line with 2024 in it" },
	]);
});
