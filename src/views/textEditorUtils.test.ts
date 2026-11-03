import assert from "node:assert/strict";
import test from "node:test";

import { getLanguageFromPath, getPathFromQuery } from "./textEditorUtils";

test("detects common file languages", () => {
	assert.equal(getLanguageFromPath("src/App.tsx"), "typescript");
	assert.equal(getLanguageFromPath("package.json"), "json");
	assert.equal(getLanguageFromPath("README.md"), "markdown");
	assert.equal(getLanguageFromPath("notes.txt"), "plaintext");
});

test("resolves a target path from a query string", () => {
	assert.equal(getPathFromQuery("path=/tmp/example.ts"), "/tmp/example.ts");
	assert.equal(getPathFromQuery("/tmp/example.ts"), "/tmp/example.ts");
	assert.equal(getPathFromQuery("foo=bar"), undefined);
});
