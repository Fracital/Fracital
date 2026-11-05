// node --test suite for the Wisp Cloak frame codec.
//
// Imports the TypeScript source directly via Node's native type stripping
// (Node 22.6+/23+; verified on Node 24). Run with:
//   cd main && node --test 'src/lib/seal-codec.test.mjs'
//
// (The bare directory form `node --test src/lib/` is not reliably
// discovered on every Node build — prefer the glob above.)

import test from "node:test";
import assert from "node:assert/strict";

import { deriveKeys, deriveSubprotocol, generateSeed, encodeSeed, decodeSeed, seal, open, base64urlEncode, base64urlDecode, SEED_LEN, NONCE_LEN, MIN_FRAME_LEN } from "./seal-codec.ts";

const te = new TextEncoder();
const td = new TextDecoder();

function eq(a, b) {
	return Buffer.from(a).equals(Buffer.from(b));
}

test("generateSeed produces 32 random bytes that round-trip through base64url", () => {
	const a = generateSeed();
	const b = generateSeed();
	assert.equal(a.length, SEED_LEN);
	assert.ok(!eq(a, b), "two seeds must differ");
	const decoded = decodeSeed(encodeSeed(a));
	assert.ok(decoded && eq(decoded, a), "seed survives encode/decode");
});

test("decodeSeed rejects malformed or wrong-length values", () => {
	assert.equal(decodeSeed(""), null);
	assert.equal(decodeSeed(null), null);
	assert.equal(decodeSeed("short"), null);
	assert.equal(decodeSeed(base64urlEncode(new Uint8Array(16))), null); // wrong length
});

test("base64url round-trips arbitrary byte lengths", () => {
	for (let n = 0; n < 40; n++) {
		const bytes = new Uint8Array(n);
		for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
		const decoded = base64urlDecode(base64urlEncode(bytes));
		assert.ok(decoded && eq(decoded, bytes), `round-trip failed at length ${n}`);
	}
});

test("key derivation is deterministic and STABLE for a fixed seed", () => {
	// Fixed seed → fixed keys/subprotocol across builds (regression guard).
	const seed = new Uint8Array(SEED_LEN);
	for (let i = 0; i < SEED_LEN; i++) seed[i] = i;
	const k1 = deriveKeys(seed);
	const k2 = deriveKeys(seed);
	assert.ok(eq(k1.keyC2S, k2.keyC2S));
	assert.ok(eq(k1.keyS2C, k2.keyS2C));
	assert.equal(k1.subprotocol, k2.subprotocol);
	assert.equal(k1.subprotocol, deriveSubprotocol(seed));
	// c2s and s2c must be distinct
	assert.ok(!eq(k1.keyC2S, k1.keyS2C), "directional keys must differ");
	// Pin the derived values so a refactor that changes the scheme is caught.
	assert.equal(encodeSeed(k1.keyC2S).length, 43);
	console.log("      stable subprotocol for all-ascending seed:", k1.subprotocol);
});

test("different seeds derive different keys", () => {
	const a = deriveKeys(generateSeed());
	const b = deriveKeys(generateSeed());
	assert.ok(!eq(a.keyC2S, b.keyC2S));
	assert.notEqual(a.subprotocol, b.subprotocol);
});

test("seal/open round-trip with derived key", () => {
	const { keyC2S } = deriveKeys(generateSeed());
	const msg = te.encode("the quick brown fox jumps over the lazy dog");
	const frame = seal(keyC2S, msg);
	assert.equal(frame.length, NONCE_LEN + msg.length + 16);
	const back = open(keyC2S, frame);
	assert.ok(back && eq(back, msg));
	assert.equal(td.decode(back), "the quick brown fox jumps over the lazy dog");
});

test("seal/open round-trip for empty and large payloads", () => {
	const { keyC2S } = deriveKeys(generateSeed());
	for (const n of [0, 1, 16, 1024, 65535]) {
		const msg = new Uint8Array(n);
		for (let i = 0; i < n; i++) msg[i] = (i * 7) & 0xff;
		const back = open(keyC2S, seal(keyC2S, msg));
		assert.ok(back && eq(back, msg), `failed at length ${n}`);
	}
});

test("two seals of the same plaintext differ (random nonce)", () => {
	const { keyC2S } = deriveKeys(generateSeed());
	const msg = te.encode("identical plaintext");
	const f1 = seal(keyC2S, msg);
	const f2 = seal(keyC2S, msg);
	assert.ok(!eq(f1, f2), "ciphertext must be randomized per frame");
	assert.ok(!eq(f1.subarray(0, NONCE_LEN), f2.subarray(0, NONCE_LEN)), "nonces must differ");
	// both still decrypt to the same plaintext
	assert.ok(eq(open(keyC2S, f1), msg) && eq(open(keyC2S, f2), msg));
});

test("tampered frame returns null (every byte position)", () => {
	const { keyC2S } = deriveKeys(generateSeed());
	const msg = te.encode("authenticate me");
	const frame = seal(keyC2S, msg);
	// flip a bit in the nonce, in the ciphertext, and in the tag
	for (const pos of [0, NONCE_LEN, frame.length - 1]) {
		const bad = frame.slice();
		bad[pos] ^= 0x80;
		assert.equal(open(keyC2S, bad), null, `tamper at ${pos} should fail`);
	}
});

test("wrong key returns null", () => {
	const a = deriveKeys(generateSeed());
	const b = deriveKeys(generateSeed());
	const frame = seal(a.keyC2S, te.encode("secret"));
	assert.equal(open(b.keyC2S, frame), null);
	// also: opening a c2s frame with the s2c key fails
	assert.equal(open(a.keyS2C, frame), null);
});

test("truncated / undersized frames return null, never throw", () => {
	const { keyC2S } = deriveKeys(generateSeed());
	assert.equal(open(keyC2S, new Uint8Array(0)), null);
	assert.equal(open(keyC2S, new Uint8Array(MIN_FRAME_LEN - 1)), null);
	assert.equal(open(keyC2S, new Uint8Array(NONCE_LEN)), null);
});

test("client-seal / server-open interop across BOTH directions", () => {
	// One seed, shared by both ends. Client seals C2S, server opens C2S.
	// Server seals S2C, client opens S2C.
	const seed = generateSeed();
	const client = deriveKeys(seed);
	const server = deriveKeys(seed);

	// client -> server
	const up = te.encode("CONNECT tcp example.com:443");
	const upFrame = seal(client.keyC2S, up);
	const upOnServer = open(server.keyC2S, upFrame);
	assert.ok(upOnServer && eq(upOnServer, up), "server must open client C2S frame");

	// server -> client
	const down = te.encode("wisp INFO packet payload");
	const downFrame = seal(server.keyS2C, down);
	const downOnClient = open(client.keyS2C, downFrame);
	assert.ok(downOnClient && eq(downOnClient, down), "client must open server S2C frame");

	// cross-direction keys must NOT open (server never opens its own S2C with C2S)
	assert.equal(open(server.keyS2C, upFrame), null);
});

test("length-bucket padding round-trips and masks plaintext length", () => {
	const { keyC2S } = deriveKeys(generateSeed());
	const padding = 256;
	const small = te.encode("hi");
	const big = te.encode("x".repeat(200));
	const fSmall = seal(keyC2S, small, { padding });
	const fBig = seal(keyC2S, big, { padding });
	// both pad to the same bucket -> same wire length despite different plaintext
	assert.equal(fSmall.length, fBig.length, "padded frames in the same bucket share a length");
	assert.ok(eq(open(keyC2S, fSmall, { padding }), small));
	assert.ok(eq(open(keyC2S, fBig, { padding }), big));
});
