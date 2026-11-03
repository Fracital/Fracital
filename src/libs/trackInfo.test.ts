import test from "node:test";
import assert from "node:assert/strict";

import { guessFromFileName } from "./trackInfo";

test("guessFromFileName splits artist and title and drops track numbers", () => {
	assert.deepEqual(guessFromFileName("01 - The Weeknd - Blinding Lights.mp3"), { artist: "The Weeknd", title: "Blinding Lights" });
	assert.deepEqual(guessFromFileName("Daft_Punk - One More Time.flac"), { artist: "Daft Punk", title: "One More Time" });
	assert.deepEqual(guessFromFileName("03. Song Name.mp3"), { artist: "", title: "Song Name" });
	assert.deepEqual(guessFromFileName("7 Rings.m4a"), { artist: "", title: "7 Rings" });
	assert.deepEqual(guessFromFileName("Artist - Song - Live.mp3"), { artist: "Artist", title: "Song - Live" });
});
