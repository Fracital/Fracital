#!/usr/bin/env node
/*
 * Tests for obfuscate-build.mjs. Run: node --test scripts/obfuscate-build.test.mjs
 *
 *  1. Decoder round-trip: the shipped vanilla ChaCha20 decoder decrypts what the
 *     build side (@noble chacha20) encrypted, for a range of strings.
 *  2. Transform equivalence: obfuscated code evaluates to the same values as the
 *     original — string literals, computed/non-computed string keys, template
 *     literals (order, String() coercion, empty/nested quasis), switch cases.
 *  3. Idempotency and skip rules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { obfuscateJs, decoderSource, obfuscateSvg, wrapCdata, shouldProcessJs, obfuscateProxyJs, mapProxyText, mapWasmBytes, isProxyVendor, hasProxyName, STORE_NAMES, mapStoreName } from "./obfuscate-build.mjs";

function evalScript(code) {
	const sandbox = { atob, TextDecoder, Uint8Array, Uint32Array, String, Math, Object, Array, JSON, Date, result: undefined };
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox, { timeout: 5000 });
	return sandbox.result;
}

// Evaluate an inline-shell <script> body (assigns to window.*) and return window.
function evalInlineScript(code) {
	const win = {};
	const sandbox = { atob, TextDecoder, Uint8Array, Uint32Array, String, Math, Object, Array, JSON, Date, window: win };
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox, { timeout: 5000 });
	return win;
}
// Compare across vm realms by value (prototypes differ between contexts).
const snap = x => JSON.stringify(x);

// Round-trip a known set through a freshly obfuscated pool by evaluating the
// obfuscated program that reconstructs them.
test("decoder round-trips strings including unicode and canaries", () => {
	const strings = ["Fracital", "Terms of Service", "Privacy Policy", "https://discord.gg/zKV3atanu", "Go ad-free for $1", "support@mathewteachesalgebra.site", "", "x", "✓ ☃ é 🎮", "a".repeat(300), JSON.stringify({ a: 1, b: [1, 2, 3] })];
	const src = "result = [" + strings.map(s => JSON.stringify(s)).join(",") + "]";
	const { code, changed } = obfuscateJs(src, "script");
	assert.ok(changed);
	for (const s of strings) assert.ok(!code.includes(JSON.stringify(s)) || s === "", `plaintext survived: ${s}`);
	assert.equal(snap(evalScript(code)), snap(strings));
});

test("string literals, computed/non-computed keys preserved", () => {
	const src = `result = (function(){
    var o = { "a-b": 1, ["c"]: 2, plain: 3 };
    var m = {}; m["dyn"] = o["a-b"] + o["c"] + o.plain;
    switch ("Terms of Service") { case "Terms of Service": m.hit = "yes"; break; default: m.hit = "no" }
    return { keys: Object.keys(o).sort(), dyn: m.dyn, hit: m.hit, proto: ({ "__proto__": null }).hasOwnProperty }
  })()`;
	const orig = snap(evalScript(src));
	const { code } = obfuscateJs(src, "script");
	assert.equal(snap(evalScript(code)), orig);
});

test("template literals: order, coercion, empty quasi, nesting", () => {
	const src = `result = (function(){
    var x = 2, y = "q", d = new Date(0);
    var a = \`Go ad-free for $1\`;
    var b = \`sum=\${x + x}-\${y}\`;
    var c = \`\${x}start\`;
    var e = \`\${x}\${y}\`;
    var nested = \`outer \${ \`in-\${x}\` } end\`;
    var dateStr = \`d:\${d}\`;
    return { a: a, b: b, c: c, e: e, nested: nested, dateStr: dateStr }
  })()`;
	const orig = snap(evalScript(src));
	const { code } = obfuscateJs(src, "script");
	assert.ok(!code.includes("Go ad-free for $1"), "template canary survived");
	assert.equal(snap(evalScript(code)), orig);
});

test("directives and module specifiers are preserved", () => {
	const src = `"use strict";\nexport const u = "plain-value";\nexport * from "./other.js";`;
	const { code } = obfuscateJs(src, "module");
	assert.ok(code.includes('"use strict"'), "directive must stay");
	assert.ok(code.includes('"./other.js"'), "module specifier must stay");
	assert.ok(!code.includes('"plain-value"'), "value should be encrypted");
});

test("idempotent: re-running does not double-wrap", () => {
	const src = `result = "Privacy Policy"`;
	const once = obfuscateJs(src, "script");
	assert.ok(once.changed);
	const twice = obfuscateJs(once.code, "script");
	assert.equal(twice.changed, false);
	assert.equal(twice.code, once.code);
});

test("decoderSource produces re-parseable, self-contained JS", () => {
	const ds = decoderSource("__frx$test", Buffer.from("k".repeat(32)).toString("base64"), []);
	assert.ok(ds.includes("TextDecoder"));
	assert.ok(ds.startsWith("var __frx$test="));
});

// ---------------------------------------------------------------------------
// SVG cloak shell obfuscation.
// ---------------------------------------------------------------------------

// A tiny, CDATA/comment-aware XML well-formedness check: no in-repo XML parser,
// so (per the task) we verify balanced tags with CDATA sections removed and the
// script CDATA wrapping intact. Throws on the first problem.
function assertWellFormedXml(xml) {
	// 1. Strip comments.
	let s = xml.replace(/<!--[\s\S]*?-->/g, "");
	// 2. Strip CDATA sections, asserting each is properly opened and closed and
	//    that nothing inside prematurely ends it.
	let out = "";
	let i = 0;
	while (i < s.length) {
		const start = s.indexOf("<![CDATA[", i);
		if (start === -1) {
			out += s.slice(i);
			break;
		}
		out += s.slice(i, start);
		const end = s.indexOf("]]>", start + 9);
		assert.ok(end !== -1, "unterminated CDATA section");
		i = end + 3;
	}
	s = out;
	// 3. Tag-balance scan over what remains (no CDATA, no comments).
	const stack = [];
	const tagRe = /<(\/?)([a-zA-Z][\w:.-]*)([^>]*?)(\/?)>/g;
	let last = 0;
	let m;
	while ((m = tagRe.exec(s))) {
		const text = s.slice(last, m.index);
		assert.ok(!text.includes("<"), `stray '<' in text: ${JSON.stringify(text.slice(0, 40))}`);
		assert.ok(!text.includes("]]>"), "stray ]]> in text");
		last = tagRe.lastIndex;
		const [, close, name, , selfClose] = m;
		if (close) {
			const open = stack.pop();
			assert.equal(open, name, `mismatched closing tag </${name}> (open was <${open}>)`);
		} else if (!selfClose) {
			stack.push(name);
		}
	}
	const tail = s.slice(last);
	assert.ok(!tail.includes("<"), "stray < after last tag");
	assert.equal(stack.length, 0, `unclosed tags: ${stack.join(", ")}`);
}

// Extract the inner JS of the one inline <script> that carries the obfuscator
// marker (the obfuscated string-map script), unwrapping its CDATA.
function extractObfuscatedScript(svg) {
	const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
	let m;
	while ((m = re.exec(svg))) {
		const body = m[1];
		if (body.includes("__FRX_OBF__")) {
			// Reconstitute across any split CDATA sections (CDATA content is literal).
			let js = "";
			let i = 0;
			while (i < body.length) {
				const start = body.indexOf("<![CDATA[", i);
				if (start === -1) {
					js += body.slice(i);
					break;
				}
				js += body.slice(i, start);
				const end = body.indexOf("]]>", start + 9);
				js += body.slice(start + 9, end === -1 ? body.length : end);
				i = end === -1 ? body.length : end + 3;
			}
			return js;
		}
	}
	throw new Error("no obfuscated <script> found in SVG");
}

const SVG_CANARY = "fracital.xyz";

// Representative cloak shell: foreignObject + XHTML, a canary <title>/<meta>, a
// benign inline script, and the canary-bearing __FRACITAL_STRINGS__ / #eckey map.
// Note the XML-escaped values: `&amp;` and `&lt;` exercise entity decoding.
const SVG_FIXTURE =
	`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">\n` +
	`  <foreignObject width="100%" height="100%">\n` +
	`    <html xmlns="http://www.w3.org/1999/xhtml" lang="en">\n` +
	`      <head>\n` +
	`        <title>Fracital</title>\n` +
	`        <meta name="description" content="Fracital, the best site" />\n` +
	`        <script>(function(){var r=document.querySelector("foreignObject");})();</script>\n` +
	`        <div id="eckey" style="display:none">EC-KEY-abc123</div>\n` +
	`        <script>window.__FRACITAL_EC_KEY__="EC-KEY-abc123";window.__FRACITAL_STRINGS__={` +
	`"Fracital":"v-brand",` +
	`"Terms of Service":"v-tos",` +
	`"Privacy Policy":"v-priv",` +
	`"${SVG_CANARY}":"v-mail",` +
	`"Billing &amp; Subscription":"v-billing",` +
	`"expr":"a&lt;b &amp;&amp; c"` +
	`};</script>\n` +
	`      </head>\n` +
	`      <body><div id="root"></div></body>\n` +
	`    </html>\n` +
	`  </foreignObject>\n` +
	`</svg>\n`;

// The true runtime map/key an XML parser would yield from SVG_FIXTURE (entities
// decoded): this is what the obfuscated script must reconstruct.
const EXPECTED_MAP = {
	Fracital: "v-brand",
	"Terms of Service": "v-tos",
	"Privacy Policy": "v-priv",
	[SVG_CANARY]: "v-mail",
	"Billing & Subscription": "v-billing",
	expr: "a<b && c",
};
const EXPECTED_ECKEY = "EC-KEY-abc123";

test("SVG: obfuscation removes every canary from the cloak shell", () => {
	const { svg, changed, scriptCount, titleMeta } = obfuscateSvg(SVG_FIXTURE, "fixture.svg");
	assert.ok(changed);
	assert.equal(scriptCount, 1);
	assert.ok(titleMeta, "canary <title>/<meta> should be neutralized");
	for (const canary of [SVG_CANARY, "Terms of Service", "Privacy Policy", "Fracital"]) {
		assert.ok(!svg.includes(canary), `canary survived in SVG output: ${canary}`);
	}
});

test("SVG: output stays well-formed XML with the script wrapped in CDATA", () => {
	const { svg } = obfuscateSvg(SVG_FIXTURE, "fixture.svg");
	// Hand-rolled well-formedness: balanced tags + clean CDATA sections.
	assertWellFormedXml(svg);
	// The obfuscated script's decoder uses `<`/`<<`/`&`, so it MUST be CDATA-wrapped.
	const m = svg.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi).find(t => t.includes("__FRX_OBF__"));
	assert.ok(m.includes("<![CDATA["), "obfuscated script must open a CDATA section");
	assert.ok(m.includes("]]>"), "obfuscated script must close a CDATA section");
	// And the reconstituted JS must contain no `]]>` that would end CDATA early:
	// between the opening <![CDATA[ and the final ]]> there is exactly one closer.
	const inner = m.slice(m.indexOf("<script"));
	const bodyStart = inner.indexOf(">") + 1;
	const bodyEnd = inner.lastIndexOf("</script>");
	const scriptBody = inner.slice(bodyStart, bodyEnd);
	assert.ok(scriptBody.startsWith("<![CDATA["), "script body starts with CDATA open");
	assert.ok(scriptBody.endsWith("]]>"), "script body ends with CDATA close");
});

test("SVG: obfuscated inline script rebuilds the exact string map + EC key", () => {
	const { svg } = obfuscateSvg(SVG_FIXTURE, "fixture.svg");
	const js = extractObfuscatedScript(svg);
	const win = evalInlineScript(js);
	assert.equal(win.__FRACITAL_EC_KEY__, EXPECTED_ECKEY);
	assert.equal(snap(win.__FRACITAL_STRINGS__), snap(EXPECTED_MAP));
});

test("SVG: idempotent — running twice equals running once", () => {
	const once = obfuscateSvg(SVG_FIXTURE, "fixture.svg");
	assert.ok(once.changed);
	const twice = obfuscateSvg(once.svg, "fixture.svg");
	assert.equal(twice.changed, false);
	assert.equal(twice.svg, once.svg);
});

test("SVG: no-canary document is left untouched", () => {
	const clean = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>` + `<html xmlns="http://www.w3.org/1999/xhtml"><head>` + `<title>Workspace</title>` + `<script>window.__FRACITAL_EC_KEY__="EC-KEY-abc123";</script>` + `</head><body/></html></foreignObject></svg>`;
	const res = obfuscateSvg(clean, "clean.svg");
	assert.equal(res.changed, false);
	assert.equal(res.svg, clean);
});

test("wrapCdata splits an embedded ]]> so the section cannot end early", () => {
	const js = "var a=x[y[z]]>w;"; // contains ]]>
	const wrapped = wrapCdata(js);
	assert.ok(wrapped.startsWith("<![CDATA["));
	assert.ok(wrapped.endsWith("]]>"));
	// Reconstituting (concatenating CDATA contents) yields the original JS.
	let recon = "";
	let i = 0;
	while (i < wrapped.length) {
		const start = wrapped.indexOf("<![CDATA[", i);
		if (start === -1) break;
		const end = wrapped.indexOf("]]>", start + 9);
		recon += wrapped.slice(start + 9, end);
		i = end + 3;
	}
	assert.equal(recon, js);
});

// ---------------------------------------------------------------------------
// JS coverage policy: no size cap and no vendor exemption. Fracital processes
// everything in dist/, including sw.js (it shares renamed vendor globals).
// ---------------------------------------------------------------------------
const big = "x".repeat(3_000_000); // 3 MB, canary-free

test("shouldProcessJs: large first-party and shield chunks are always processed", () => {
	assert.equal(shouldProcessJs("dist/assets/s_o4e62h.js", big), true);
	assert.equal(shouldProcessJs("dist/assets/aB3x9kQ2.js", big), true);
});

test("shouldProcessJs: vendor and transport blobs are processed (no exemption)", () => {
	assert.equal(shouldProcessJs("dist/vendor/core.js", big), true);
	assert.equal(shouldProcessJs("dist/vendor/ctl.js", big), true);
	assert.equal(shouldProcessJs("dist/sw.js", big), true);
});

test("obfuscateJs: unparseable input throws rather than passing through", () => {
	assert.throws(() => obfuscateJs("var = ;", "module"));
});

test("large input (~2.6 MB, many literals) transforms, re-parses and evaluates equal", () => {
	const parts = [];
	for (let i = 0; i < 120000; i++) parts.push(`o[${JSON.stringify("k" + i)}]=${JSON.stringify("v" + i)}`);
	const src = `result=(function(){var o={};${parts.join(";")};return o})()`;
	assert.ok(src.length > 2_000_000, "fixture should be ~2.6 MB");
	const t0 = Date.now();
	const { code, changed, count } = obfuscateJs(src, "script");
	const ms = Date.now() - t0;
	assert.ok(changed);
	assert.ok(count >= 240000, "every literal should be collected");
	assert.ok(ms < 20000, `transform took ${ms} ms`);
	assert.ok(!code.includes('"v12345"'), "plaintext literal survived");
	const got = evalScript(code);
	assert.equal(got.k12345, "v12345");
	assert.equal(Object.keys(got).length, 120000);
});

// ---------------------------------------------------------------------------
// Proxy vendor transform (obfuscateProxyJs): names renamed, not string-encrypted.
// ---------------------------------------------------------------------------
const PROXY_RE = /scramjet|bare[-_]?mux|baremux|wispurr|epoxy|libcurl/i;

function evalWith(code, extra = {}) {
	const sandbox = { atob, TextDecoder, Uint8Array, Uint32Array, String, Math, Object, Array, JSON, Date, WebAssembly, ...extra };
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox, { timeout: 5000 });
	return sandbox;
}

test("proxy: name mapping is same-length, case-preserving and removes every token", () => {
	for (const t of ["scramjet", "Scramjet", "SCRAMJET", "bare-mux", "BareMux", "bare_mux", "baremux", "wispurr", "epoxy", "Epoxy", "libcurl"]) {
		const m = mapProxyText(t);
		assert.equal(m.length, t.length, t);
		assert.equal(PROXY_RE.test(m), false, `${t} -> ${m}`);
		assert.equal(m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase(), t[0] === t[0].toUpperCase() && t[0] !== t[0].toLowerCase());
	}
	// consistent: the same token maps the same way wherever it appears
	assert.equal(mapProxyText("ScramjetClient"), mapProxyText("Scramjet") + "Client");
	assert.equal(mapProxyText("scramjet$type"), mapProxyText("scramjet") + "$type");
	assert.equal(isProxyVendor("/x/dist/vendor/core.js"), true);
	assert.equal(isProxyVendor("/x/dist/vendor/ctl.js"), true);
	assert.equal(isProxyVendor("/x/dist/sw.js"), true);
	assert.equal(isProxyVendor("/x/dist/assets/index-abc.js"), false);
	assert.equal(hasProxyName("nothing here"), false);
});

test("proxy: renamed identifiers, keys and template code still agree at runtime", () => {
	const src = `
    class ScramjetClient { constructor(){ this.scramjet$type = 'x' } }
    const obj = { scramjet$type: 7, ['epoxy' + 'Name']: 1 };
    globalThis.result = [
      new ScramjetClient().scramjet$type,
      obj.scramjet$type,
      typeof ScramjetClient,
      \`\${typeof ScramjetClient.prototype.constructor}\`,
    ];
  `;
	const out = obfuscateProxyJs(src, "script", "t");
	assert.equal(out.changed, true);
	assert.equal(PROXY_RE.test(out.code), false, "no proxy token survives in plaintext");
	assert.deepEqual(JSON.parse(JSON.stringify(evalWith(src).result)), JSON.parse(JSON.stringify(evalWith(out.code).result)));
});

test("proxy: the engines' store names keep one name in every build, never the package's", () => {
	const src = `
    globalThis.result = ["stompCookies", "__scramjet_controller", "stomp-http-cache", "stompMessage"];
  `;
	const out = obfuscateProxyJs(src, "script", "t");
	const [cookies, jar, cache, message] = evalWith(out.code).result;
	// Fixed letters (production's names since 2026-11-10), so a deploy finds what a browser holds.
	assert.equal(cookies, "gdosxCookies");
	assert.equal(jar, "__ebshkqee_controller");
	assert.equal(cache, "gdosx-http-cache");
	// Every other proxy name is still renamed per build.
	assert.equal(message, mapProxyText("stompMessage"));
	for (const name of STORE_NAMES) assert.equal(hasProxyName(mapStoreName(name)), false, name);
	assert.equal(/stomp|scramjet/i.test(out.code), false, "no proxy token survives in plaintext");
});

test("proxy: a database opened under an unlisted proxy name fails the build", () => {
	assert.throws(() => obfuscateProxyJs(`indexedDB.open("stompNew", 1);`, "script", "t"), /STORE_NAMES/);
	assert.throws(() => obfuscateProxyJs(`self.indexedDB.open("__scramjet_other");`, "script", "t"), /STORE_NAMES/);
	// idb's openDB, whatever the minifier named it
	assert.throws(() => obfuscateProxyJs(`Tt("stompNew", 1, { upgrade: e => e.createObjectStore("x") });`, "script", "t"), /STORE_NAMES/);
	assert.equal(obfuscateProxyJs(`Tt("stompCookies", 2, { upgrade: e => e.createObjectStore("x") });`, "script", "t").changed, true);
});

test("proxy: app-shared names are written as encrypted keys; the plaintext name is absent", () => {
	const src = `
    globalThis.$scramjet = { versionInfo: { version: '2.0.0' } };
    globalThis.$scramjetController = { shouldRoute: function () { return true } };
    globalThis.answer = $scramjet.versionInfo.version + ':' + $scramjetController.shouldRoute();
  `;
	const out = obfuscateProxyJs(src, "script", "t");
	assert.equal(PROXY_RE.test(out.code), false);
	assert.equal(out.code.includes("$scramjet"), false);
	// the app side reads the same names it assembles from pieces
	const sb = evalWith(out.code);
	assert.equal(sb.answer, "2.0.0:true");
	assert.equal(typeof sb.$scramjet, "object");
	assert.equal(typeof sb.$scramjetController, "object");
});

test("proxy: a removed multi-line comment keeps its ASI line break", () => {
	const src = "function f() { return /* scramjet\n */ 1 }\nglobalThis.r = f();";
	const out = obfuscateProxyJs(src, "script", "t");
	assert.equal(PROXY_RE.test(out.code), false);
	assert.equal(evalWith(out.code).r, undefined);
});

test("proxy: legal comments stay (names renamed); non-legal proxy comments are removed", () => {
	const src = "/*! libcurl is licensed under LGPL */\n// epoxy internals\nglobalThis.k = 1;";
	const out = obfuscateProxyJs(src, "script", "t");
	assert.equal(out.code.includes("licensed under LGPL"), true);
	assert.equal(PROXY_RE.test(out.code), false);
	assert.equal(out.code.includes("internals"), false);
});

test("proxy: the directive prologue stays first so strict mode survives", () => {
	const src = '"use strict";\nglobalThis.t = (function () { return this })() === undefined ? "strict" : "sloppy";\nglobalThis.s = "bare-mux-path";';
	const out = obfuscateProxyJs(src, "script", "t");
	assert.equal(out.code.indexOf('"use strict"') < out.code.indexOf("var __frx$"), true);
	assert.equal(evalWith(out.code).t, "strict");
	assert.equal(evalWith(out.code).s, "bare-mux-path", "the app-shared value is encrypted, value preserved");
});

test("proxy: embedded wasm export names are renamed in the binary, and the module still validates", () => {
	// Minimal wasm: one function, exported as "scramjet_add".
	const name = Buffer.from("scramjet_add");
	const exp = Buffer.concat([Buffer.from([0x01, name.length]), name, Buffer.from([0x00, 0x00])]);
	const sec = (id, body) => Buffer.concat([Buffer.from([id, body.length]), body]);
	const wasm = Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), sec(0x01, Buffer.from([0x01, 0x60, 0x00, 0x00])), sec(0x03, Buffer.from([0x01, 0x00])), sec(0x07, exp), sec(0x0a, Buffer.from([0x01, 0x02, 0x00, 0x0b]))]);
	assert.equal(WebAssembly.validate(wasm), true);
	const b64 = wasm.toString("base64");
	const src = `globalThis.names = WebAssembly.Module.exports(new WebAssembly.Module(Uint8Array.from(atob(${JSON.stringify("data:application/octet-stream;base64," + b64)
		.slice(1, -1)
		.replace(/^/, '"')}".split(",")[1]), (c) => c.charCodeAt(0)))).map((e) => e.name);`;
	const out = obfuscateProxyJs(src, "script", "t");
	assert.equal(out.code.includes(b64), false, "the wasm blob is not shipped as plaintext base64");
	const names = evalWith(out.code, { WebAssembly }).names;
	assert.deepEqual([...names], [mapProxyText("scramjet_add")]);
	assert.equal(names[0].length, "scramjet_add".length);
});

test("proxy: wasm mapping renames names and data only, never code bytes that happen to spell a name", () => {
	// Ruffle's wasm spells "stomP" inside "initCustomPrototype" in its data
	// section; its SIMD build does not validate at all on a build host without
	// SSE4.1. Here the code section also spells "stomp": i32.xor, i32.shl,
	// i32.rem_s, i32.div_s, i32.rem_u are 0x73 0x74 0x6f 0x6d 0x70. Renaming
	// those bytes would turn them into other opcodes; they must stay as they are.
	const sec = (id, body) => Buffer.concat([Buffer.from([id, body.length]), body]);
	const str = s => Buffer.concat([Buffer.from([s.length]), Buffer.from(s, "latin1")]);
	const module = code => {
		const body = Buffer.concat([Buffer.from([0x00]), code, Buffer.from([0x0b])]);
		return Buffer.concat([
			Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
			sec(0x01, Buffer.from([0x01, 0x60, 0x00, 0x01, 0x7f])),
			sec(0x03, Buffer.from([0x01, 0x00])),
			sec(0x05, Buffer.from([0x01, 0x00, 0x01])),
			sec(0x07, Buffer.concat([Buffer.from([0x01]), str("stomp_value"), Buffer.from([0x00, 0x00])])),
			sec(0x0a, Buffer.concat([Buffer.from([0x01, body.length]), body])),
			sec(0x0b, Buffer.concat([Buffer.from([0x01, 0x00, 0x41, 0x00, 0x0b]), str("initCustomPrototype")])),
		]);
	};
	const opcodes = Buffer.from("stomp", "latin1");
	const code = Buffer.concat([Buffer.from([0x41, 60, 0x41, 50, 0x41, 40, 0x41, 3, 0x41, 1, 0x41, 2]), opcodes]);
	const wasm = module(code);
	assert.equal(WebAssembly.validate(wasm), true);
	const out = mapWasmBytes(wasm);
	assert.equal(out.length, wasm.length);
	const at = wasm.indexOf(code);
	assert.deepEqual(out.subarray(at, at + code.length), code, "the code bytes are untouched");
	assert.equal(WebAssembly.validate(out), true);
	const exports = new WebAssembly.Instance(new WebAssembly.Module(out)).exports;
	assert.deepEqual(Object.keys(exports), [mapProxyText("stomp_value")]);
	assert.equal(exports[mapProxyText("stomp_value")](), new WebAssembly.Instance(new WebAssembly.Module(wasm)).exports.stomp_value());
	const mapped = mapProxyText("initCustomPrototype");
	assert.notEqual(mapped, "initCustomPrototype");
	assert.equal(out.includes(Buffer.from(mapped, "latin1")), true, "the data string is renamed");
	assert.equal(out.toString("latin1").toLowerCase().split("stomp").length - 1, 1, "only the opcode bytes still spell the name");

	// A module this host cannot validate (as Ruffle's SIMD build on a CPU
	// without SSE4.1; here a type error stands in) is still mapped by its
	// structure instead of being rejected.
	const unvalidatable = module(Buffer.from([0x6a])); // i32.add with an empty stack
	assert.equal(WebAssembly.validate(unvalidatable), false);
	const mappedUnvalidatable = mapWasmBytes(unvalidatable);
	assert.equal(mappedUnvalidatable.includes(Buffer.from(mapped, "latin1")), true);
	assert.equal(mappedUnvalidatable.toString("latin1").toLowerCase().includes("stomp"), false);
});

test("proxy: shared name with bare var declaration + assignment + reads (controller pattern)", () => {
	// Mirrors controller.api.js: `var $scramjetController; ... $scramjetController = factory()`
	// and sw.js's later bare reads. The global must be published under the real name.
	const src = `
    var $scramjetController;
    (function(){ $scramjetController = { v: 7, route: function () { return this.v } } })();
    globalThis.answer = $scramjetController.route();
  `;
	const out = obfuscateProxyJs(src, "script", "t");
	assert.equal(PROXY_RE.test(out.code), false, "no proxy token survives in plaintext");
	assert.equal(out.code.includes("$scramjet"), false);
	const sb = evalWith(out.code);
	assert.equal(sb.answer, 7);
	assert.equal(typeof sb.$scramjetController, "object", "global published under the real name");
});

test("proxy: generated-code template keeps shared globals real, renames config keys", () => {
	// The controller builds its frame-inject script as a template containing the
	// shared global ($scramjetController.load) and renamed config keys
	// (t.scramjetPath). The decrypted runtime text must have the REAL global name
	// (the vendor publishes it via pieces) and the RENAMED config key.
	const src = `
    const cfg = { scramjetPath: '/vendor/core.js' };
    const make = (t) => \`$scramjetController.load({ path: t.scramjetPath })\`;
    globalThis.code = make(cfg);
  `;
	const out = obfuscateProxyJs(src, "script", "t");
	assert.equal(PROXY_RE.test(out.code), false, "no proxy token in plaintext");
	assert.equal(out.code.includes("$scramjetController"), false);
	const sb = evalWith(out.code);
	// At runtime the generated code references the real global and the renamed key.
	assert.ok(sb.code.includes("$scramjetController.load"), "shared global name preserved at runtime: " + sb.code);
	assert.ok(sb.code.includes(mapProxyText("scramjet") + "Path"), "config key renamed at runtime: " + sb.code);
	assert.ok(!sb.code.includes("scramjetPath"), "original config key gone at runtime");
});
