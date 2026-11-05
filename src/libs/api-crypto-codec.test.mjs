// node --test suite for the /api/* response crypto.
//
// Imports the TypeScript sources directly via Node's native type stripping
// (Node 22.6+/23+; verified on Node 24). Run with:
//   cd main && node --test 'src/lib/api-crypto-codec.test.mjs'
//
// Proves: server-encrypt -> client-decrypt round-trip, tamper -> reject,
// wrong-key -> reject, and plaintext fallback when the client did not negotiate.

import test from 'node:test'
import assert from 'node:assert/strict'

import { generateSeed, encodeSeed } from './seal-codec.ts'
import {
  deriveApiKeys,
  sealJson,
  sealText,
  openToText,
  seedFromCookieHeader,
  seedFromDocumentCookie,
  API_CRYPTO_HEADER,
  API_CRYPTO_TOKEN,
  API_CRYPTO_CONTENT_TYPE,
} from './api-crypto-codec.ts'
import { clientAcceptsCrypto, writeSealedJson } from '../server/api-crypto.ts'
import { cryptoFetch } from './api-crypto-fetch.ts'

const SAMPLE = {
  album: { id: 'sample-album', title: 'Sample Album', artist: 'Sample Artist' },
  tracks: [
    { id: 't1', title: 'First', artist: 'Sample Artist', plays: 42, slug: 'first' },
    { id: 't2', title: 'Second', artist: 'Sample Artist', plays: 7, slug: 'second' },
  ],
}

// A minimal ServerResponse stand-in that records what a handler wrote.
function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    getHeader(name) { return this.headers[name.toLowerCase()] },
    end(chunk) { this.body = chunk ?? null; this.ended = true },
  }
}

test('round-trip: server seal -> client open recovers the original JSON', () => {
  const seed = generateSeed()
  const { keyRes } = deriveApiKeys(seed)
  const frame = sealJson(keyRes, SAMPLE)
  const text = openToText(keyRes, frame)
  assert.notEqual(text, null)
  assert.deepEqual(JSON.parse(text), SAMPLE)
})

test('two seals of the same body differ (fresh nonce)', () => {
  const { keyRes } = deriveApiKeys(generateSeed())
  const a = sealText(keyRes, 'hello')
  const b = sealText(keyRes, 'hello')
  assert.ok(!Buffer.from(a).equals(Buffer.from(b)), 'nonce must randomise the frame')
})

test('tamper -> reject (any flipped byte fails authentication)', () => {
  const { keyRes } = deriveApiKeys(generateSeed())
  const frame = sealJson(keyRes, SAMPLE)
  const tampered = frame.slice()
  tampered[tampered.length - 1] ^= 0x01
  assert.equal(openToText(keyRes, tampered), null)
})

test('wrong-key -> reject (a different seed cannot open it)', () => {
  const frame = sealJson(deriveApiKeys(generateSeed()).keyRes, SAMPLE)
  const otherKey = deriveApiKeys(generateSeed()).keyRes
  assert.equal(openToText(otherKey, frame), null)
})

test('deriveApiKeys: keyReq and keyRes are independent, deterministic from seed', () => {
  const seed = generateSeed()
  const a = deriveApiKeys(seed)
  const b = deriveApiKeys(seed)
  assert.ok(Buffer.from(a.keyRes).equals(Buffer.from(b.keyRes)), 'deterministic')
  assert.ok(!Buffer.from(a.keyReq).equals(Buffer.from(a.keyRes)), 'directional keys differ')
})

test('seedFromCookieHeader parses wcs from a cookie string (and ignores others)', () => {
  const seed = generateSeed()
  const header = `foo=bar; wcs=${encodeSeed(seed)}; other=baz`
  const parsed = seedFromCookieHeader(header)
  assert.notEqual(parsed, null)
  assert.ok(Buffer.from(parsed).equals(Buffer.from(seed)))
  assert.equal(seedFromCookieHeader('foo=bar'), null)
  assert.equal(seedFromCookieHeader(''), null)
})

test('clientAcceptsCrypto: only true when the negotiation token is present', () => {
  assert.equal(clientAcceptsCrypto({ headers: { [API_CRYPTO_HEADER]: API_CRYPTO_TOKEN } }), true)
  assert.equal(clientAcceptsCrypto({ headers: { [API_CRYPTO_HEADER]: `foo, ${API_CRYPTO_TOKEN}` } }), true)
  assert.equal(clientAcceptsCrypto({ headers: {} }), false)
  assert.equal(clientAcceptsCrypto({ headers: { [API_CRYPTO_HEADER]: 'v999' } }), false)
})

test('writeSealedJson: negotiated + seed -> sealed body that the client decrypts', () => {
  const seed = generateSeed()
  const body = JSON.stringify(SAMPLE)
  const request = { headers: { [API_CRYPTO_HEADER]: API_CRYPTO_TOKEN, cookie: `wcs=${encodeSeed(seed)}` } }
  const response = mockResponse()

  const sealed = writeSealedJson(request, response, body)
  assert.equal(sealed, true, 'should seal and signal the caller to stop')
  assert.equal(response.ended, true)
  assert.equal(response.statusCode, 200)
  assert.equal(response.getHeader('content-type'), API_CRYPTO_CONTENT_TYPE)
  assert.equal(response.getHeader(API_CRYPTO_HEADER), API_CRYPTO_TOKEN)
  assert.equal(response.getHeader('cache-control'), 'private, no-store')
  assert.equal(response.getHeader('vary'), API_CRYPTO_HEADER)
  assert.ok(Buffer.isBuffer(response.body), 'sealed body is raw bytes')

  // The client side recovers the exact JSON from the recorded ciphertext.
  const { keyRes } = deriveApiKeys(seed)
  const text = openToText(keyRes, new Uint8Array(response.body))
  assert.deepEqual(JSON.parse(text), SAMPLE)
})

test('writeSealedJson: not negotiated -> false (caller sends plaintext)', () => {
  const seed = generateSeed()
  const request = { headers: { cookie: `wcs=${encodeSeed(seed)}` } } // no accept header
  const response = mockResponse()
  assert.equal(writeSealedJson(request, response, JSON.stringify(SAMPLE)), false)
  assert.equal(response.ended, false, 'must not touch the response on fallback')
})

test('writeSealedJson: negotiated but no cookie -> false (cannot derive key)', () => {
  const request = { headers: { [API_CRYPTO_HEADER]: API_CRYPTO_TOKEN } } // no cookie
  const response = mockResponse()
  assert.equal(writeSealedJson(request, response, JSON.stringify(SAMPLE)), false)
  assert.equal(response.ended, false)
})

// ---- client cryptoFetch transparency (server seal -> cryptoFetch decrypts) ----

async function withStubbedEnv({ seedCookie, serverResponse }, fn) {
  const origFetch = globalThis.fetch
  const origDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    if (seedCookie !== undefined) globalThis.document = { cookie: seedCookie }
    else delete globalThis.document
    globalThis.fetch = async () => serverResponse()
    return await fn()
  } finally {
    globalThis.fetch = origFetch
    if (origDocument) Object.defineProperty(globalThis, 'document', origDocument)
    else delete globalThis.document
  }
}

test('cryptoFetch: transparently decrypts a sealed response into usable JSON', async () => {
  const seed = generateSeed()
  const { keyRes } = deriveApiKeys(seed)
  const sealedBytes = sealJson(keyRes, SAMPLE)
  const serverResponse = () =>
    new Response(Buffer.from(sealedBytes), {
      status: 200,
      headers: { 'content-type': API_CRYPTO_CONTENT_TYPE, [API_CRYPTO_HEADER]: API_CRYPTO_TOKEN },
    })

  await withStubbedEnv({ seedCookie: `wcs=${encodeSeed(seed)}`, serverResponse }, async () => {
    const res = await cryptoFetch('/api/catalog/sample')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get(API_CRYPTO_HEADER), null, 'sealed marker stripped from synthetic response')
    assert.deepEqual(await res.json(), SAMPLE)
  })
})

test('cryptoFetch: plaintext response passes through unchanged (fallback)', async () => {
  const serverResponse = () =>
    new Response(JSON.stringify(SAMPLE), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })

  await withStubbedEnv({ seedCookie: undefined, serverResponse }, async () => {
    const res = await cryptoFetch('/api/catalog/sample')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), SAMPLE)
  })
})

test('cryptoFetch: sealed response but no seed -> failure Response (no crash)', async () => {
  const seed = generateSeed()
  const sealedBytes = sealJson(deriveApiKeys(seed).keyRes, SAMPLE)
  const serverResponse = () =>
    new Response(Buffer.from(sealedBytes), {
      status: 200,
      headers: { 'content-type': API_CRYPTO_CONTENT_TYPE, [API_CRYPTO_HEADER]: API_CRYPTO_TOKEN },
    })

  await withStubbedEnv({ seedCookie: undefined, serverResponse }, async () => {
    const res = await cryptoFetch('/api/catalog/sample')
    assert.equal(res.ok, false, 'undecryptable sealed body surfaces as a failed response')
  })
})

test('seedFromDocumentCookie: reads wcs from document.cookie when present', async () => {
  const seed = generateSeed()
  await withStubbedEnv({ seedCookie: `wcs=${encodeSeed(seed)}`, serverResponse: () => new Response(null) }, () => {
    const parsed = seedFromDocumentCookie()
    assert.notEqual(parsed, null)
    assert.ok(Buffer.from(parsed).equals(Buffer.from(seed)))
  })
})
