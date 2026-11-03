import test from "node:test";
import assert from "node:assert/strict";

import { rememberArtistNames, splitArtistCredit } from "./artistCredit";

test("keeps artists whose names contain separators intact", () => {
	assert.deepEqual(splitArtistCredit("Tyler, The Creator"), ["Tyler, The Creator"]);
	assert.deepEqual(splitArtistCredit("Earth, Wind & Fire"), ["Earth, Wind & Fire"]);
	assert.deepEqual(splitArtistCredit("Crosby, Stills, Nash & Young"), ["Crosby, Stills, Nash & Young"]);
	assert.deepEqual(splitArtistCredit("Lil Nas X"), ["Lil Nas X"]);
});

test("splits collaborations around protected names", () => {
	assert.deepEqual(splitArtistCredit("Tyler, The Creator & Kali Uchis"), ["Tyler, The Creator", "Kali Uchis"]);
	assert.deepEqual(splitArtistCredit("A$AP Rocky feat. Tyler, The Creator"), ["A$AP Rocky", "Tyler, The Creator"]);
	assert.deepEqual(splitArtistCredit("Lil Nas X & Jack Harlow"), ["Lil Nas X", "Jack Harlow"]);
});

test("splits ordinary credits", () => {
	assert.deepEqual(splitArtistCredit("Drake & 21 Savage"), ["Drake", "21 Savage"]);
	assert.deepEqual(splitArtistCredit("Metro Boomin, The Weeknd & 21 Savage"), ["Metro Boomin", "The Weeknd", "21 Savage"]);
	assert.deepEqual(splitArtistCredit("SZA ft. Kendrick Lamar"), ["SZA", "Kendrick Lamar"]);
	assert.deepEqual(splitArtistCredit("Skrillex x Fred again.."), ["Skrillex", "Fred again.."]);
});

test("protects names passed in or learned at runtime", () => {
	assert.deepEqual(splitArtistCredit("Foo, Bar & Friend", ["Foo, Bar"]), ["Foo, Bar", "Friend"]);
	rememberArtistNames(["Lorem, Ipsum"]);
	assert.deepEqual(splitArtistCredit("Lorem, Ipsum & Dolor"), ["Lorem, Ipsum", "Dolor"]);
});
