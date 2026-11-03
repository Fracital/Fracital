import test from "node:test";
import assert from "node:assert/strict";

import { parseLrc } from "./lrc";
import { artistsMatch, stripCredits, titlesMatch } from "./lyricMatch";

test("titlesMatch ignores case, accents, punctuation and version tags", () => {
	assert.equal(titlesMatch("Blinding Lights", "blinding lights"), true);
	assert.equal(titlesMatch("Café del Mar", "Cafe Del Mar!"), true);
	assert.equal(titlesMatch("Hey Jude - Remastered 2015", "Hey Jude"), true);
	assert.equal(titlesMatch("Song (feat. Someone)", "Song"), true);
	assert.equal(titlesMatch("Stay (Live)", "Stay"), true);
	assert.equal(titlesMatch("Blinding Lights", "Save Your Tears"), false);
	assert.equal(titlesMatch("Go", "Gone"), false);
});

test("artistsMatch needs one shared artist unless the artist is unknown", () => {
	assert.equal(artistsMatch("The Weeknd", ["The Weeknd"]), true);
	assert.equal(artistsMatch("Daft Punk, Pharrell Williams", ["Pharrell Williams"]), true);
	assert.equal(artistsMatch("Beyoncé feat. JAY-Z", ["Beyonce"]), true);
	assert.equal(artistsMatch("", ["Anyone"]), true);
	assert.equal(artistsMatch("The Weeknd", ["Someone Else"]), false);
});

test("stripCredits removes leading and trailing credits but keeps lyrics with colons", () => {
	const { lines } = parseLrc(["[00:00.000] 作词 : Max Martin", "[00:01.000] 作曲 : Abel Tesfaye", "[00:02.000] Producer: Someone", "[00:13.564]Yeah", "[00:20.000]He said: come home", "[00:30.000]Mixing Engineer: Someone"].join("\n"));
	assert.deepEqual(
		stripCredits(lines).map(l => l.text),
		["Yeah", "He said: come home"],
	);
});

test("stripCredits drops instrumental placeholders", () => {
	assert.deepEqual(stripCredits(parseLrc("[00:00.00]纯音乐，请欣赏").lines), []);
});
