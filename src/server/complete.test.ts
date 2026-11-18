import assert from "node:assert/strict";
import test from "node:test";
import { parseCompletions } from "./complete";

test("DuckDuckGo, Google and Bing replies all parse", () => {
	assert.deepEqual(parseCompletions(["weat", ["weather", "weather tomorrow"]], "weat"), ["weather", "weather tomorrow"]);
	assert.deepEqual(parseCompletions(["weat", ["weather radar", "weather map"], [], []], "weat"), ["weather radar", "weather map"]);
	assert.deepEqual(parseCompletions(["weat", ["weather channel"]], "weat"), ["weather channel"]);
	// DuckDuckGo without type=list.
	assert.deepEqual(parseCompletions(["weat", [{ phrase: "weather" }, { phrase: "weather now" }]], "weat"), ["weather", "weather now"]);
});

test("malformed replies give nothing", () => {
	assert.deepEqual(parseCompletions(null, "x"), []);
	assert.deepEqual(parseCompletions("oops", "x"), []);
	assert.deepEqual(parseCompletions(["x"], "x"), []);
	assert.deepEqual(parseCompletions(["x", "not a list"], "x"), []);
	assert.deepEqual(parseCompletions(["x", [1, null, {}]], "x"), []);
});

test("the query itself and duplicates are dropped, and at most eight are kept", () => {
	const many = Array.from({ length: 12 }, (_, i) => `weather ${i}`);
	assert.equal(parseCompletions(["weather", many], "weather").length, 8);
	assert.deepEqual(parseCompletions(["Weather", ["weather", " WEATHER ", "weather today", "Weather Today"]], "weather"), ["weather today"]);
});
