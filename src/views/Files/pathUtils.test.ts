import test from "node:test";
import assert from "node:assert/strict";

import { joinPath, normalizePath } from "./pathUtils";

test("normalizePath keeps root as /", () => {
	assert.equal(normalizePath("/"), "/");
	assert.equal(normalizePath("//root//games//"), "/root/games");
});

test("joinPath avoids duplicating the current folder segment", () => {
	assert.equal(joinPath("/root/games", "o6zierlmvaxigtur8b7eziep"), "/root/games/o6zierlmvaxigtur8b7eziep");
	assert.equal(joinPath("/root/games/o6zierlmvaxigtur8b7eziep", "o6zierlmvaxigtur8b7eziep"), "/root/games/o6zierlmvaxigtur8b7eziep");
});
