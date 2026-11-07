#!/usr/bin/env node
/*
 * obfuscate-build.mjs — post-build string-literal / template obfuscator (PLAN.md section 5 "shield").
 *
 * WHAT
 *   Runs as a post-process on one or more Vite output dirs. For every eligible
 *   JS/MJS chunk, every HTML shell, and every SVG cloak it:
 *     - parses with acorn (ES2022+, module or script),
 *     - collects string literals in SAFE value/key positions and the quasis of
 *       non-tagged template literals,
 *     - encrypts each unique string into a per-file ChaCha20 constant pool,
 *     - replaces every literal with a memoized decode call `NAME(idx)` (string
 *       literals) or an equivalent `(NAME(i0)+String(e1)+NAME(i1)+...)`
 *       concatenation (template literals), and
 *     - prepends a tiny self-contained ChaCha20 decoder + the encrypted pool +
 *       the per-file key to the chunk.
 *
 *   The key ships in the file. Per PLAN.md section 5.8 this is cost-raising
 *   only; it is not secrecy. The point is that no sensitive plaintext (the
 *   canary list, scripts/canary-list.json) survives verbatim in the output.
 *
 *   Cipher: ChaCha20 (RFC 8439). Encryption uses @noble/ciphers' `chacha20`;
 *   the shipped decoder is a compact vanilla ChaCha20 that is symmetric with it
 *   (verified by the node:test in obfuscate-build.test.mjs). The decoder
 *   MEMOIZES — each pool entry is decrypted at most once.
 *
 * POSITIONS ENCRYPTED
 *   - any string literal in a value position (init, argument, array element,
 *     return, operand, property value, switch case test, default param, ...),
 *   - non-computed object/class string keys -> converted to computed `[NAME(i)]`,
 *   - already-computed member/key string literals -> plain replacement,
 *   - every quasi of a non-tagged template literal (value preserved via String()).
 *
 * POSITIONS SKIPPED (must stay static)
 *   - "use strict" and other directive-prologue literals,
 *   - import/export module specifiers (`... from "x"`), dynamic import() source,
 *   - import/export binding names (`import {"x" as y}`, `export {x as "y"}`),
 *   - import attributes (`with { type: "json" }`),
 *   - a MethodDefinition key named "constructor" and a `{ "__proto__": ... }`
 *     proto-setter key (converting these to computed changes semantics),
 *   - tagged template quasis.
 *
 * SVG CLOAK SHELLS (.svg served as image/svg+xml)
 *   The jsDelivr / single-file cloaks embed, inside a <foreignObject>, the same
 *   inline <script> __ABULXT_STRINGS__ / #eckey setup as the HTML shells. They
 *   are obfuscated the SAME way as HTML (neutralize a canary <title>/<meta>,
 *   encrypt the canary-bearing inline <script>), with two XML-specific twists:
 *     - the inline <script> body is XML markup, so entities are decoded
 *       (`&amp;` -> `&`) and any CDATA section is taken literally BEFORE
 *       obfuscating — this recovers the exact JS the browser would run, so the
 *       rebuilt string pool / EC key match runtime byte-for-byte; and
 *     - the obfuscated output (whose ChaCha20 decoder uses `<`, `<<`, `&`) is
 *       re-emitted wrapped in `<![CDATA[ ... ]]>` so the SVG stays well-formed
 *       XML. Any `]]>` inside the body is split across CDATA sections.
 *
 * USAGE
 *   node scripts/obfuscate-build.mjs <dir> [dir ...]
 *
 * JS COVERAGE
 *   Every JS chunk is processed, with no size cap. App chunks get full literal
 *   encryption (obfuscateJs). The proxy vendor runtime (assets/c, assets/t,
 *   assets/m, sw-app*) gets the proxy transform (obfuscateProxyJs) instead: proxy
 *   names in identifiers and whitespace-free strings are renamed by a same-length
 *   per-build substitution (also inside the embedded wasm, see mapWasmBytes),
 *   proxy strings the app shares or that are legal/prose text are encrypted, and
 *   non-legal proxy comments are removed. Ordinary vendor literals stay plain, so
 *   the hot path pays no decode cost. Names the app reads from the runtime are
 *   listed in APP_SHARED_NAMES. Inline <script>s and .wasm files follow the same
 *   split (obfuscateInlineScript, processProxyWasmFile).
 *
 * IDEMPOTENT: files already carrying the marker (__ABX_OBF__) are skipped, so
 * re-running is safe.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative, basename, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, createHmac } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const nobleUrl = pathToFileURL(join(REPO_ROOT, "node_modules/@noble/ciphers/chacha.js")).href;
const acornUrl = pathToFileURL(join(REPO_ROOT, "node_modules/acorn/dist/acorn.mjs")).href;
const { chacha20 } = await import(nobleUrl);
const acorn = await import(acornUrl);

const MARKER = "__FRX_OBF__";

// Neutral, canary-free shell text used when a static <title>/<meta> carried a
// canary. The app resets document.title at runtime (App.tsx), so this only
// shows before the SPA boots or with JS disabled.
const NEUTRAL_TITLE = "Workspace";
const NEUTRAL_DESC = "A fast, private workspace.";

function loadCanaries() {
	const parsed = JSON.parse(readFileSync(join(__dirname, "canary-list.json"), "utf8"));
	return (parsed.canaries || []).map(c => c.value).filter(v => typeof v === "string" && v.length > 0);
}
const CANARIES = loadCanaries();
const hasCanary = s => CANARIES.some(c => s.includes(c));

// Random output must never spell a canary by chance. The shipped pool is
// base64 of random ciphertext (the shield bytecode chunks alone are ~10 MB of
// it), so a short canary made of base64-alphabet letters ("epoxy": 64^-5 per
// position) turns up in roughly one build in fifty and the canary scan fails
// on a seed that has nothing to do with the source. Every random text that
// ships (pool entries, the key, proxy-name substitutions) is therefore
// rejection-sampled against the canaries, case-insensitively, so a build is
// clean independent of its seed. Only canaries that can occur in the alphabet
// in question are checked, so the loop always terminates quickly.
const CANARIES_LOWER = CANARIES.map(c => c.toLowerCase());
const B64_CANARIES = CANARIES_LOWER.filter(c => /^[a-z0-9+/]+$/.test(c));
const LETTER_CANARIES = CANARIES_LOWER.filter(c => /^[a-z]+$/.test(c));
function spellsCanary(text, list) {
	const lower = text.toLowerCase();
	return list.some(c => lower.includes(c));
}
function canaryFreeBase64(produce) {
	for (let attempt = 0; ; attempt++) {
		const out = produce();
		if (!spellsCanary(out, B64_CANARIES)) return out;
		if (attempt > 1000) throw new Error("canary-free base64 sampling did not converge");
	}
}

// ---------------------------------------------------------------------------
// Encryption (build side): ChaCha20 via @noble. Pool entry = base64(nonce||ct).
// ---------------------------------------------------------------------------
function makeCrypto() {
	let key;
	const keyB64 = canaryFreeBase64(() => {
		key = randomBytes(32);
		return key.toString("base64");
	});
	const pool = []; // base64 strings
	const index = new Map(); // plaintext -> idx
	function push(str) {
		if (index.has(str)) return index.get(str);
		const i = pool.length;
		index.set(str, i);
		const plain = Buffer.from(str, "utf8");
		pool.push(
			canaryFreeBase64(() => {
				const nonce = randomBytes(12);
				const ct = chacha20(key, nonce, plain);
				return Buffer.concat([nonce, Buffer.from(ct)]).toString("base64");
			}),
		);
		return i;
	}
	return { keyB64, pool, push };
}

// ---------------------------------------------------------------------------
// Decoder (ship side): compact vanilla ChaCha20, symmetric with @noble chacha20.
// Verified by obfuscate-build.test.mjs.
// ---------------------------------------------------------------------------
export function decoderSource(name, keyB64, pool) {
	return (
		`var ${name}=(function(){` +
		`function U(s){var b=atob(s),a=new Uint8Array(b.length),i=0;for(;i<b.length;i++)a[i]=b.charCodeAt(i);return a}` +
		`function R(a,b){return((a<<b)|(a>>>(32-b)))>>>0}` +
		`function CC(k,n,d){` +
		`var K=new Uint32Array(8),N=new Uint32Array(3),o=new Uint8Array(d.length),S=new Uint32Array(16),W=new Uint32Array(16),ct=0,i,off,r,bl=new Uint8Array(64),v,nn;` +
		`function Q(a,b,c,e){W[a]=(W[a]+W[b])>>>0;W[e]=R(W[e]^W[a],16);W[c]=(W[c]+W[e])>>>0;W[b]=R(W[b]^W[c],12);W[a]=(W[a]+W[b])>>>0;W[e]=R(W[e]^W[a],8);W[c]=(W[c]+W[e])>>>0;W[b]=R(W[b]^W[c],7)}` +
		`for(i=0;i<8;i++)K[i]=(k[i*4]|(k[i*4+1]<<8)|(k[i*4+2]<<16)|(k[i*4+3]<<24))>>>0;` +
		`for(i=0;i<3;i++)N[i]=(n[i*4]|(n[i*4+1]<<8)|(n[i*4+2]<<16)|(n[i*4+3]<<24))>>>0;` +
		`for(off=0;off<d.length;off+=64){` +
		`S[0]=0x61707865;S[1]=0x3320646e;S[2]=0x79622d32;S[3]=0x6b206574;` +
		`S[4]=K[0];S[5]=K[1];S[6]=K[2];S[7]=K[3];S[8]=K[4];S[9]=K[5];S[10]=K[6];S[11]=K[7];` +
		`S[12]=ct>>>0;S[13]=N[0];S[14]=N[1];S[15]=N[2];` +
		`for(i=0;i<16;i++)W[i]=S[i];` +
		`for(r=0;r<10;r++){Q(0,4,8,12);Q(1,5,9,13);Q(2,6,10,14);Q(3,7,11,15);Q(0,5,10,15);Q(1,6,11,12);Q(2,7,8,13);Q(3,4,9,14)}` +
		`for(i=0;i<16;i++){v=(W[i]+S[i])>>>0;bl[i*4]=v&255;bl[i*4+1]=(v>>>8)&255;bl[i*4+2]=(v>>>16)&255;bl[i*4+3]=(v>>>24)&255}` +
		`nn=Math.min(64,d.length-off);for(i=0;i<nn;i++)o[off+i]=d[off+i]^bl[i];ct++` +
		`}return o}` +
		`var K=U(${JSON.stringify(keyB64)}),P=${JSON.stringify(pool)},C=[],TD=new TextDecoder();` +
		`return function(i){if(C[i]!==void 0)return C[i];var raw=U(P[i]),n=raw.subarray(0,12),c=raw.subarray(12);return C[i]=TD.decode(CC(K,n,c))}` +
		`})();`
	);
}

// ---------------------------------------------------------------------------
// AST walk + edit collection.
// ---------------------------------------------------------------------------
const SKIP_KEYS = new Set(["type", "start", "end", "loc", "range", "sourceType", "comments"]);

function walk(node, parent, key, visit) {
	if (!node || typeof node.type !== "string") return;
	visit(node, parent, key);
	for (const k in node) {
		if (SKIP_KEYS.has(k)) continue;
		const v = node[k];
		if (Array.isArray(v)) {
			for (const c of v) if (c && typeof c.type === "string") walk(c, node, k, visit);
		} else if (v && typeof v.type === "string") {
			walk(v, node, k, visit);
		}
	}
}

function shouldSkipLiteral(node, parent, key) {
	if (!parent) return true;
	const pt = parent.type;
	if ((pt === "ImportDeclaration" || pt === "ExportNamedDeclaration" || pt === "ExportAllDeclaration") && key === "source") return true;
	if (pt === "ExportAllDeclaration" && key === "exported") return true;
	if (pt === "ImportExpression" && key === "source") return true;
	if (pt === "ImportSpecifier") return true; // imported name (string) / local never a string
	if (pt === "ExportSpecifier") return true; // local / exported string names
	if (pt === "ImportAttribute") return true;
	if (pt === "ExpressionStatement" && parent.directive) return true; // "use strict" etc.
	// proto-setter: { "__proto__": x } sets the prototype only as a plain key.
	if (pt === "Property" && key === "key" && !parent.computed && !parent.method && !parent.shorthand && parent.kind === "init" && node.value === "__proto__") return true;
	// constructor: converting the key to computed makes it a normal method.
	if (pt === "MethodDefinition" && key === "key" && !parent.computed && node.value === "constructor") return true;
	return false;
}

function literalIsComputedKey(parent, key) {
	const pt = parent.type;
	return (pt === "Property" || pt === "PropertyDefinition" || pt === "MethodDefinition") && key === "key" && !parent.computed;
}

// Collect edits for one parsed program. Returns the edit list. Pushes strings
// into crypto pool.
//
// IDENTIFIER VEIL (Fracital): the bundled proxy client lives inside the app
// chunk, so identifiers carrying a proxy/brand name appear in member and key
// positions: `globalThis.$scramjet`, `window.scramjetController`,
// `{ wisp_url: ... }`, `{ ScramjetClient: ... }`. String encryption alone
// leaves those in plaintext. In member/key positions we convert to a computed
// encrypted lookup (`obj[NAME(i)]`) whose runtime value is the exact original
// name, so every cross-file and cross-boundary contract holds. Any other
// position (declaration id, call callee, label, ...) throws: a loud build
// failure beats a silent plaintext leak.
const identNeedsVeil = nm => hasProxyName(nm) || hasCanary(nm);

// Comments carrying a canary or proxy name: legal comments get the proxy names
// renamed inside (license text preserved); anything else is removed. A removed
// multi-line comment keeps a newline so ASI behavior is unchanged.
function commentEdits(comments, code, edits) {
	for (const c of comments) {
		const raw = code.slice(c.start, c.end);
		if (!hasProxyName(raw) && !hasCanary(raw)) continue;
		if (LEGAL_RE.test(raw)) {
			const mapped = mapProxyText(raw);
			if (!hasCanary(mapped)) {
				edits.push({ start: c.start, end: c.end, text: mapped });
				continue;
			}
		}
		edits.push({ start: c.start, end: c.end, text: raw.includes("\n") ? "\n" : " " });
	}
}

function collectEdits(ast, code, name, crypto, comments) {
	const edits = [];
	if (comments) commentEdits(comments, code, edits);
	walk(ast, null, null, (node, parent, key) => {
		if (node.type === "Identifier" && identNeedsVeil(node.name)) {
			const call = `${name}(${crypto.push(node.name)})`;
			if (parent && parent.type === "MemberExpression" && key === "property" && !parent.computed) {
				// obj.Name -> obj[NAME(i)] (the '.' sits between object and property)
				const dot = code.lastIndexOf(".", node.start - 1);
				if (dot < parent.object.end || code.slice(dot + 1, node.start).trim() !== "") {
					throw new Error(`cannot locate '.' before ${node.name}`);
				}
				const optional = code[dot - 1] === "?";
				edits.push({ start: optional ? dot - 1 : dot, end: node.end, text: `${optional ? "?." : ""}[${call}]` });
				return;
			}
			if (parent && (parent.type === "Property" || parent.type === "ObjectPattern") && key === "key" && !parent.computed) {
				edits.push({ start: node.start, end: node.end, text: parent.shorthand ? `[${call}]: ${node.name}` : `[${call}]` });
				return;
			}
			if (parent && (parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && key === "key" && !parent.computed) {
				edits.push({ start: node.start, end: node.end, text: `[${call}]` });
				return;
			}
			throw new Error(`canary/proxy identifier "${node.name}" in unsupported position (${parent ? parent.type + ":" + key : "root"})`);
		}
		if (node.type === "Literal" && typeof node.value === "string") {
			if (shouldSkipLiteral(node, parent, key)) return;
			const idx = crypto.push(node.value);
			const call = `${name}(${idx})`;
			const text = literalIsComputedKey(parent, key) ? `[${call}]` : call;
			edits.push({ start: node.start, end: node.end, text });
			return;
		}
		if (node.type === "TemplateLiteral") {
			// Skip a tagged template's quasi.
			if (parent && parent.type === "TaggedTemplateExpression" && key === "quasi") return;
			const quasis = node.quasis;
			const exprs = node.expressions;
			if (exprs.length === 0) {
				const idx = crypto.push(quasis[0].value.cooked);
				edits.push({ start: node.start, end: node.end, text: `${name}(${idx})` });
				return;
			}
			// Leading gap: `...${  ->  (NAME(i0)+String(
			const i0 = crypto.push(quasis[0].value.cooked);
			edits.push({ start: node.start, end: exprs[0].start, text: `(${name}(${i0})+String(` });
			// Middle gaps between expr k and expr k+1: }quasi${  ->  )+NAME(ik)+String(
			for (let k = 1; k < exprs.length; k++) {
				const ik = crypto.push(quasis[k].value.cooked);
				edits.push({ start: exprs[k - 1].end, end: exprs[k].start, text: `)+${name}(${ik})+String(` });
			}
			// Trailing gap: }quasi`  ->  )+NAME(in))
			const inLast = crypto.push(quasis[quasis.length - 1].value.cooked);
			edits.push({ start: exprs[exprs.length - 1].end, end: node.end, text: `)+${name}(${inLast}))` });
		}
	});
	return edits;
}

const IDENT_PART = /[A-Za-z0-9_$]/;

// Linear-time splice: edits are applied in one pass over the source and joined
// once. (The previous per-edit string rebuild was O(edits x size), which made
// literal-heavy vendor files take quadratic time.)
function applyEdits(code, edits) {
	// Zero-length insertions sort before a replacement that starts at the same offset.
	edits.sort((a, b) => a.start - b.start || a.end - b.end);
	const parts = [];
	let pos = 0;
	for (const e of edits) {
		if (e.start < pos) throw new Error(`overlapping edits at ${e.start}..${e.end} (previous edit ends at ${pos})`);
		parts.push(code.slice(pos, e.start));
		let text = e.text;
		// Minified code drops whitespace after keywords: `return"x"`, `case"x":`,
		// `typeof"x"`. A plain `__abx$...(i)` replacement starts with an identifier
		// char, so it would fuse with the keyword. Insert a separating space.
		// The char before e.start is unedited source (edits do not overlap).
		if (text.length > 0 && e.start > 0 && IDENT_PART.test(text[0]) && IDENT_PART.test(code[e.start - 1])) {
			text = " " + text;
		}
		parts.push(text);
		pos = e.end;
	}
	parts.push(code.slice(pos));
	return parts.join("");
}

function parse(code, sourceType, comments) {
	return acorn.parse(code, { ecmaVersion: "latest", sourceType, allowHashBang: true, onComment: comments });
}

// End offset of the directive prologue ("use strict" etc.), or 0. The decoder is
// inserted AFTER it: a statement in front of "use strict" would demote the
// directive to a plain expression and silently drop strict mode.
function prologueEnd(ast) {
	let end = 0;
	for (const st of ast.body) {
		if (st.type !== "ExpressionStatement" || !st.directive) break;
		end = st.end;
	}
	return end;
}

// Assemble the shipped chunk: marker + decoder (after any directive prologue)
// + the edited body. `edits` is applied to `source`; the insertions are edits
// of zero length at the marker and decoder positions.
function assemble(source, ast, edits, name, crypto, sourceType, nameHint) {
	const at = prologueEnd(ast);
	edits.push({ start: 0, end: 0, text: `/*${MARKER}*/` });
	// No pool means nothing was encrypted: the decoder would be dead weight.
	if (crypto.pool.length > 0) edits.push({ start: at, end: at, text: decoderSource(name, crypto.keyB64, crypto.pool) + "\n" });
	const out = applyEdits(source, edits);
	// Safety net: the transformed output must still parse.
	try {
		parse(out, sourceType);
	} catch (err) {
		throw new Error(`obfuscated output failed to re-parse${nameHint ? " (" + nameHint + ")" : ""}: ${err.message}`);
	}
	return out;
}

function dedupeEdits(edits) {
	const seen = new Map();
	for (const e of edits) {
		const k = e.start + ":" + e.end;
		if (!seen.has(k)) seen.set(k, e);
	}
	return [...seen.values()];
}

// Obfuscate a block of JS. Returns { code, changed, count }. Throws on parse
// failure (of input or, as a safety net, of the transformed output).
export function obfuscateJs(source, sourceType = "module", nameHint = "") {
	if (source.includes(MARKER)) return { code: source, changed: false, count: 0 };
	const comments = [];
	const ast = parse(source, sourceType, comments);
	const name = "__frx$" + randomBytes(3).toString("hex");
	const crypto = makeCrypto();
	const edits = collectEdits(ast, source, name, crypto, comments);
	if (edits.length === 0) return { code: source, changed: false, count: 0 };
	const out = assemble(source, ast, edits, name, crypto, sourceType, nameHint);
	return { code: out, changed: true, count: edits.length };
}

// ---------------------------------------------------------------------------
// Proxy vendor runtime (assets/c, assets/t, assets/m, sw-app*). Third-party
// proxy code is NOT string-encrypted wholesale: encrypting every literal of the
// ~2 MB transport bundle put a decode on hot paths for no secrecy gain. Instead:
//   - every identifier containing a proxy name is renamed by a deterministic,
//     SAME-LENGTH substitution (scramjet -> 8 random letters, Epoxy -> 5, ...),
//     applied identically to identifiers, whitespace-free string values and the
//     embedded wasm binaries, so every reference inside the proxy set still
//     agrees. Same length keeps wasm section sizes and string offsets valid.
//   - string values that carry a proxy name and cannot be renamed (they are
//     shared with app code, legal notices, or prose) are encrypted instead, so
//     the name never appears in plaintext;
//   - non-legal comments that mention a proxy name are removed.
// Ordinary literals stay plain (no decode cost). App code keeps full encryption.
// The per-build key is random, so the substitution is not reproducible outside
// the build; it is cost-raising like the rest of this file, not secrecy.
// ---------------------------------------------------------------------------
const PROXY_SRC = "scramjet|stomp|bare[-_]?mux|wispurr|epoxy|libcurl";
const PROXY_RE = new RegExp(PROXY_SRC, "i");
const PROXY_RE_G = new RegExp(PROXY_SRC, "gi");
const PROXY_KEY = randomBytes(32);
const LEGAL_RE = /@license|@preserve|licen[sc]|copyright|^!/i;

// App-shared proxy strings (localStorage keys, worker names, the loader global).
// Read from src so the list cannot drift: any string literal in app source
// that carries a proxy name is one the vendor must not rename.
function loadAppSharedStrings() {
	const out = new Set(["bare-mux-path", "bare-mux-worker"]);
	const root = join(REPO_ROOT, "src");
	const visit = dir => {
		let entries;
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const nm of entries) {
			const full = join(dir, nm);
			const st = statSync(full);
			if (st.isDirectory()) visit(full);
			else if (/\.tsx?$/.test(nm)) {
				const src = readFileSync(full, "utf8");
				for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n]){1,300})\1/g)) {
					if (PROXY_RE.test(m[2])) out.add(m[2]);
				}
			}
		}
	};
	visit(root);
	return out;
}
const APP_SHARED = loadAppSharedStrings();

// Names the app reads from the vendor runtime. Fracital reads the `$scramjet`
// runtime global for the version display (Shell.tsx assembles it from pieces)
// and sw.js reads `$scramjetController` for routing. The vendor writes them as
// keys built from encrypted pieces instead, and every other occurrence
// (variables, locals) is renamed like the rest.
const APP_SHARED_NAMES = new Map([
	["$scramjet", ["$", "scram", "jet"]], // runtime global set by the vendored engine
	["$scramjetController", ["$", "scram", "jet", "Controller"]], // SW routing global
]);
for (const [nm, pieces] of APP_SHARED_NAMES) {
	if (pieces.join("") !== nm) throw new Error(`APP_SHARED_NAMES piece mismatch for ${nm}`);
}

// Shared names inside CODE-BEARING strings/templates (the controller generates
// its frame-inject script as a template literal containing `$scramjetController
// .load(...)`, config keys like `scramjetPath`, etc.). Those quasis mix names
// that must stay real (the published globals) with names that are renamed
// everywhere else (config keys). mapSharedProtected renames ONLY the non-shared
// proxy tokens, at identifier boundaries, so the decrypted runtime text matches
// both worlds. A string/quasi containing a shared name is then always
// ENCRYPTED (never shipped as renamed plaintext).
const SHARED_TOKEN_RES = [...APP_SHARED_NAMES.keys()].map(n => new RegExp(`${n.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")}(?![A-Za-z0-9_$])`));
const containsSharedName = s => SHARED_TOKEN_RES.some(re => re.test(s));
function mapSharedProtected(s) {
	// Walk the string; the earliest next occurrence wins. Proxy names rename;
	// shared names pass through untouched (identifier-boundary checked, so
	// "$scramjet$wrap" still renames while "$scramjetController" stays real).
	let result = "";
	let i = 0;
	const proxyRe = new RegExp(PROXY_SRC, "gi");
	while (i < s.length) {
		const rest = s.slice(i);
		proxyRe.lastIndex = 0;
		const pm = proxyRe.exec(rest);
		let sm = null;
		for (const re of SHARED_TOKEN_RES) {
			const m = re.exec(rest);
			if (m && (!sm || m.index < sm.index || (m.index === sm.index && m[0].length > sm[0].length))) sm = m;
		}
		if (!pm && !sm) {
			result += rest;
			break;
		}
		if (sm && (!pm || sm.index <= pm.index)) {
			result += rest.slice(0, sm.index) + sm[0];
			i += sm.index + sm[0].length;
		} else if (pm) {
			result += rest.slice(0, pm.index) + proxyReplacement(pm[0]);
			i += pm.index + pm[0].length;
		}
	}
	return result;
}

// Same-length substitution for one proxy name. The output letters depend only on
// the per-build key and the lower-cased token, and keep the case of each position.
// The letters are re-derived (deterministically, by attempt number) while they
// would spell a canary, so a substitution can never reintroduce one.
function proxyReplacement(match) {
	const token = match.toLowerCase();
	for (let attempt = 0; ; attempt++) {
		const h = createHmac("sha256", PROXY_KEY)
			.update(attempt === 0 ? token : token + ":" + attempt)
			.digest();
		let out = "";
		for (let i = 0; i < match.length; i++) {
			const ch = String.fromCharCode(97 + (h[i] % 26));
			out += match[i] >= "A" && match[i] <= "Z" ? ch.toUpperCase() : ch;
		}
		if (!spellsCanary(out, LETTER_CANARIES)) return out;
	}
}
export function mapProxyText(s) {
	return s.replace(PROXY_RE_G, proxyReplacement);
}
export function isProxyVendor(full) {
	const p = full.split(sep).join("/");
	// The vendored engine + controller ship renamed under dist/vendor/ (see
	// vite.config.ts), and Fracital's sw.js shares the vendor's renamed globals.
	return /\/vendor\//.test(p) || basename(full) === "sw.js";
}
export function hasProxyName(s) {
	return PROXY_RE.test(s);
}

// Wasm binaries (embedded base64 or a .wasm file) get the same-length mapping,
// but only inside the bytes that hold names or data: import and export names,
// data segment contents, and custom section contents (the `name` section entry
// by entry). Code, types, LEB lengths and constant expressions are never
// touched, so the module's structure and instructions are byte-for-byte the
// input's and the result is valid wherever the input is. A proxy name spelled
// by chance in other bytes (an instruction stream, a length) is not a name,
// and a match never spans two strings. (Ruffle's wasm spells "stomP" inside
// "initCustomPrototype", in its data section.)
//
// WebAssembly.validate cannot be the oracle: its answer depends on the build
// host. V8 turns wasm SIMD off on x64 CPUs without SSE4.1, so on a host whose
// virtual CPU has no SSE4.1 (terp's "Common KVM processor") Ruffle's SIMD
// build fails validation before any byte is mapped. It stays as a cross-check
// only when this host can validate the input.

// The [start, end) byte ranges of a wasm module that hold names or data.
// Throws on a module it cannot walk, rather than guessing.
export function wasmNameRanges(buf) {
	if (buf.length < 8 || buf.readUInt32LE(0) !== 0x6d736100 || buf.readUInt32LE(4) !== 1) throw new Error("not a wasm core module (version 1)");
	const ranges = [];
	let p = 8;
	const fail = what => {
		throw new Error(`cannot walk wasm module: ${what} at byte ${p}`);
	};
	const u = () => {
		// LEB128 (unsigned or signed: only its length matters here)
		for (let i = 0; i < 10; i++) {
			if (p >= buf.length) fail("truncated LEB128");
			if (!(buf[p++] & 0x80)) return;
		}
		fail("overlong LEB128");
	};
	const n = () => {
		let r = 0;
		for (let shift = 0; shift < 35; shift += 7) {
			if (p >= buf.length) fail("truncated LEB128");
			const b = buf[p++];
			r += (b & 0x7f) * 2 ** shift;
			if (!(b & 0x80)) return r;
		}
		fail("overlong u32");
	};
	const str = () => {
		const len = n();
		if (p + len > buf.length) fail("string past the end");
		if (len) ranges.push([p, p + len]);
		p += len;
	};
	const bytes = () => {
		const len = n();
		if (p + len > buf.length) fail("bytes past the end");
		return [p, (p += len)];
	};
	const valtype = () => {
		const t = buf[p++];
		if (t === 0x63 || t === 0x64) u(); // (ref null? <heaptype>)
	};
	const limits = () => {
		const flags = buf[p++];
		if (flags > 0x0f) fail(`limits flags 0x${flags.toString(16)}`);
		u();
		if (flags & 1) u();
		if (flags & 8) u(); // custom page size
	};
	const constExpr = () => {
		for (;;) {
			const op = buf[p++];
			if (op === 0x0b) return;
			if (op === 0x41 || op === 0x42 || op === 0x23 || op === 0xd0 || op === 0xd2) u();
			else if (![0x6a, 0x6b, 0x6c, 0x7c, 0x7d, 0x7e].includes(op)) fail(`constant expression opcode 0x${op?.toString(16)}`);
		}
	};
	const nameMap = () => {
		for (let k = n(); k > 0; k--) {
			u();
			str();
		}
	};
	while (p < buf.length) {
		const id = buf[p++];
		const size = n();
		const end = p + size;
		if (end > buf.length) fail("section past the end");
		if (id === 0) {
			const len = n();
			const secName = buf.toString("latin1", p, p + len);
			if (len) ranges.push([p, p + len]);
			p += len;
			if (secName === "name") {
				// Subsections: module name, then name maps (indirect for locals, labels, fields).
				while (p < end) {
					const sub = buf[p++];
					const subSize = n();
					const subEnd = p + subSize;
					if (subEnd > end) fail("name subsection past the end");
					if (sub === 0) str();
					else if ([1, 4, 5, 6, 7, 8, 9, 11].includes(sub)) nameMap();
					else if (sub === 2 || sub === 3 || sub === 10)
						for (let k = n(); k > 0; k--) {
							u();
							nameMap();
						}
					else p = subEnd; // unknown subsection: left as it is
					if (p !== subEnd) fail(`name subsection ${sub} length mismatch`);
				}
			} else {
				// Other custom sections are opaque to the engine: the content as one range.
				if (end > p) ranges.push([p, end]);
				p = end;
			}
		} else if (id === 2) {
			for (let k = n(); k > 0; k--) {
				str();
				str();
				const kind = buf[p++];
				if (kind === 0x00) u();
				else if (kind === 0x01) {
					valtype();
					limits();
				} else if (kind === 0x02) limits();
				else if (kind === 0x03) {
					valtype();
					p++; // mutability
				} else if (kind === 0x04) {
					p++; // tag attribute
					u();
				} else fail(`import kind 0x${kind?.toString(16)}`);
			}
		} else if (id === 7) {
			for (let k = n(); k > 0; k--) {
				str();
				p++; // kind
				u();
			}
		} else if (id === 11) {
			for (let k = n(); k > 0; k--) {
				const flags = n();
				if (flags === 0) constExpr();
				else if (flags === 2) {
					u();
					constExpr();
				} else if (flags !== 1) fail(`data segment flags ${flags}`);
				const [a, b] = bytes();
				if (b > a) ranges.push([a, b]);
			}
		} else {
			p = end; // code, types and the rest: never mapped
		}
		if (p !== end) fail(`section ${id} length mismatch`);
	}
	return ranges;
}

// Returns the mapped bytes, or the input unchanged when nothing matched.
export function mapWasmBytes(buf) {
	let out = null;
	for (const [a, b] of wasmNameRanges(buf)) {
		const s = buf.toString("latin1", a, b);
		const m = mapProxyText(s);
		if (m === s) continue;
		out ??= Buffer.from(buf);
		out.write(m, a, "latin1");
	}
	if (!out) return buf;
	if (out.length !== buf.length || (WebAssembly.validate(buf) && !WebAssembly.validate(out))) {
		throw new Error("proxy name mapping produced an invalid wasm module");
	}
	return out;
}

function mapWasmBase64(value) {
	const buf = Buffer.from(value, "base64");
	if (buf.subarray(0, 4).toString("latin1") !== "\0asm") return null;
	const out = mapWasmBytes(buf);
	if (out === buf) return null;
	if (buf.toString("base64") !== value) throw new Error("wasm base64 literal is not canonical; cannot map it safely");
	return out.toString("base64");
}

function collectProxyEdits(ast, comments, source, name, crypto, nameHint) {
	const edits = [];
	const enc = text => `${name}(${crypto.push(text)})`;
	const encPieces = pieces => pieces.map(enc).join("+");

	for (const c of comments) {
		const raw = source.slice(c.start, c.end);
		if (!hasProxyName(raw)) continue;
		if (LEGAL_RE.test(raw)) edits.push({ start: c.start, end: c.end, text: mapProxyText(raw) });
		else edits.push({ start: c.start, end: c.end, text: raw.includes("\n") ? "\n" : " " });
	}

	walk(ast, null, null, (node, parent, key) => {
		if (node.type === "Identifier" || node.type === "PrivateIdentifier") {
			if (!hasProxyName(node.name)) return;
			const pieces = APP_SHARED_NAMES.get(node.name);
			// Module export aliases: the app never imports these ES exports (it reads the
			// UMD global), so the alias is renamed like any other proxy identifier.
			if (!pieces || (parent && parent.type === "ExportSpecifier")) {
				edits.push({ start: node.start, end: node.end, text: mapProxyText(node.name) });
				return;
			}
			if (parent && parent.type === "MemberExpression" && key === "property" && !parent.computed) {
				// obj.Name -> obj[<pieces>] (the '.' sits between object and property)
				const dot = source.lastIndexOf(".", node.start - 1);
				if (dot < parent.object.end || source.slice(dot + 1, node.start).trim() !== "") {
					throw new Error(`cannot locate '.' before ${node.name} (${nameHint})`);
				}
				const optional = source[dot - 1] === "?";
				edits.push({ start: optional ? dot - 1 : dot, end: node.end, text: `${optional ? "?." : ""}[${encPieces(pieces)}]` });
				return;
			}
			if (parent && (parent.type === "Property" || parent.type === "ObjectPattern") && key === "key" && !parent.computed) {
				// { Name: v } -> { [<pieces>]: v };  { Name } -> { [<pieces>]: Name' }
				const keyText = `[${encPieces(pieces)}]`;
				edits.push({ start: node.start, end: node.end, text: parent.shorthand ? `${keyText}: ${mapProxyText(node.name)}` : keyText });
				return;
			}
			if (parent && (parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && key === "key" && !parent.computed) {
				edits.push({ start: node.start, end: node.end, text: `[${encPieces(pieces)}]` });
				return;
			}
			// `var $shared;` (no init): the classic-script declaration exists only to
			// create the global; the assignment that publishes it is rewritten to
			// globalThis[<pieces>] by the target rule below. Rename the dead local so
			// the plaintext name disappears without changing semantics. An
			// INITIALIZED declaration cannot be redirected span-locally: hard fail.
			if (parent && parent.type === "VariableDeclarator" && key === "id") {
				if (parent.init) throw new Error(`app-shared name ${node.name} declared with an initializer (${nameHint})`);
				edits.push({ start: node.start, end: node.end, text: mapProxyText(node.name) + "$unused" });
				return;
			}
			// Bare assignment/update target: `globalThis[<pieces>] = ...` with no
			// wrapping parens (a parenthesized reference is not a valid target).
			if ((parent && parent.type === "AssignmentExpression" && key === "left") || (parent && parent.type === "UpdateExpression" && key === "argument")) {
				edits.push({ start: node.start, end: node.end, text: `globalThis[${encPieces(pieces)}]` });
				return;
			}
			// Binding/label positions cannot hold a member expression — fail loudly
			// instead of silently miscompiling.
			if (
				parent &&
				(/^(?:Function|Class)(?:Declaration|Expression)$/.test(parent.type) ||
					parent.type === "ArrowFunctionExpression" ||
					parent.type === "CatchClause" ||
					parent.type === "LabeledStatement" ||
					parent.type === "BreakStatement" ||
					parent.type === "ContinueStatement" ||
					parent.type === "ArrayPattern" ||
					parent.type === "RestElement" ||
					parent.type === "AssignmentPattern" ||
					parent.type.startsWith("Import"))
			) {
				throw new Error(`app-shared name ${node.name} in binding/label position ${parent.type}:${key} (${nameHint})`);
			}
			// Bare read in any other expression position (member object, call callee,
			// operand): parenthesized global lookup of the real name.
			edits.push({ start: node.start, end: node.end, text: `(globalThis[${encPieces(pieces)}])` });
			return;
		}

		if (node.type === "Literal" && typeof node.value === "string") {
			const v = node.value;
			if (shouldSkipLiteral(node, parent, key)) return;
			// Embedded wasm (bare base64, or a data: URI): map its names in the binary
			// and keep the blob encrypted. Its base64 text never shows a proxy name.
			const wm = /(^|base64,)(AGFzbQ[A-Za-z0-9+/=]*)/.exec(v);
			if (wm && v.length > 64) {
				const mapped = mapWasmBase64(wm[2]);
				const text = mapped === null ? v : v.slice(0, wm.index) + wm[1] + mapped + v.slice(wm.index + wm[0].length);
				edits.push({ start: node.start, end: node.end, text: literalIsComputedKey(parent, key) ? `[${enc(text)}]` : enc(text) });
				return;
			}
			if (!hasProxyName(v)) return;
			if (LEGAL_RE.test(v) || APP_SHARED.has(v) || containsSharedName(v)) {
				// Legal/prose/app-shared values keep their text; any non-shared proxy
				// tokens inside are still renamed (mapSharedProtected), matching the
				// identifier-side renames at runtime after decrypt.
				const call = enc(LEGAL_RE.test(v) || APP_SHARED.has(v) ? v : mapSharedProtected(v));
				edits.push({ start: node.start, end: node.end, text: literalIsComputedKey(parent, key) ? `[${call}]` : call });
				return;
			}
			edits.push({ start: node.start, end: node.end, text: JSON.stringify(mapProxyText(v)) });
			return;
		}

		if (node.type === "TemplateLiteral") {
			const quasis = node.quasis;
			if (!quasis.some(q => hasProxyName(q.value.cooked))) return;
			const tagged = parent && parent.type === "TaggedTemplateExpression" && key === "quasi";
			const needsEnc = quasis.some(q => LEGAL_RE.test(q.value.cooked) || APP_SHARED.has(q.value.cooked) || containsSharedName(q.value.cooked));
			if (needsEnc) {
				if (tagged) throw new Error(`tagged template with a shared/legal proxy string (${nameHint})`);
				const exprs = node.expressions;
				// Quasi text keeps shared names real and renames the rest, so generated
				// code agrees with both the published globals and the renamed config keys.
				const qText = quasis.map(q => mapSharedProtected(q.value.cooked));
				if (exprs.length === 0) {
					edits.push({ start: node.start, end: node.end, text: enc(qText[0]) });
					return;
				}
				edits.push({ start: node.start, end: exprs[0].start, text: `(${enc(qText[0])}+String(` });
				for (let k = 1; k < exprs.length; k++) {
					edits.push({ start: exprs[k - 1].end, end: exprs[k].start, text: `)+${enc(qText[k])}+String(` });
				}
				edits.push({ start: exprs[exprs.length - 1].end, end: node.end, text: `)+${enc(qText[quasis.length - 1])})` });
				return;
			}
			// Code-bearing template text: rename the proxy names inside each quasi's
			// source span. The span holds only raw template text and delimiters.
			for (const q of quasis) {
				if (!hasProxyName(q.value.cooked)) continue;
				edits.push({ start: q.start, end: q.end, text: mapProxyText(source.slice(q.start, q.end)) });
			}
		}
	});
	// A shorthand property's key and value can be one node visited twice.
	return dedupeEdits(edits);
}

// Proxy-set transform for one JS file. Same output contract as obfuscateJs.
export function obfuscateProxyJs(source, sourceType = "module", nameHint = "") {
	if (source.includes(MARKER)) return { code: source, changed: false, count: 0 };
	const comments = [];
	const ast = parse(source, sourceType, comments);
	const name = "__frx$" + randomBytes(3).toString("hex");
	const crypto = makeCrypto();
	const edits = collectProxyEdits(ast, comments, source, name, crypto, nameHint);
	if (edits.length === 0) return { code: source, changed: false, count: 0 };
	const out = assemble(source, ast, edits, name, crypto, sourceType, nameHint);
	return { code: out, changed: true, count: edits.length };
}

// Same-length mapping for a proxy .wasm file on disk. Returns true when changed.
function processProxyWasmFile(full) {
	const buf = readFileSync(full);
	if (buf.subarray(0, 4).toString("latin1") !== "\0asm") return { changed: false };
	const out = mapWasmBytes(buf);
	if (out !== buf) writeFileSync(full, out);
	return { changed: out !== buf };
}

// ---------------------------------------------------------------------------
// File processing.
// ---------------------------------------------------------------------------
const JS_EXT = new Set([".js", ".mjs", ".cjs"]);

function extname(f) {
	const d = f.lastIndexOf(".");
	return d >= 0 ? f.slice(d) : "";
}

function* walkFiles(dir) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const nm of entries) {
		const full = join(dir, nm);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) yield* walkFiles(full);
		else if (st.isFile()) yield { full, size: st.size };
	}
}

// Every JS chunk is obfuscated, with no size cap and no vendor exemption: first-
// party app chunks, shield bytecode chunks (s_*.js), and third-party vendor /
// transport blobs (scramjet/, controller/) are all processed. Service workers
// (sw.js) are always processed: sw.js shares the vendor's renamed globals, so
// skipping it would break routing, and its comments name the transport stack.
export function shouldProcessJs(full, content) {
	const base = basename(full);
	if (base === "sw.js") return true; // proxy transform (isProxyVendor covers it)
	return true; // includes the proxy runtime (renamed by obfuscateProxyJs)
}

// Inline <script> bodies from HTML/SVG shells. Proxy-named bodies go through the
// proxy transform (their identifiers must agree with the proxy runtime); bodies
// that carry an app canary get the full encryption. Both at once is refused.
function obfuscateInlineScript(source, isModule, hint) {
	const tryBoth = fn => {
		try {
			return fn(isModule ? "module" : "script");
		} catch {
			return fn(isModule ? "script" : "module");
		}
	};
	// App canary bodies (e.g. the index.html string table, whose keys are the
	// plaintext labels, "Scramjet" among them) get full literal encryption; the
	// proxy transform only runs for shells that carry proxy names and no app canary.
	const appCanary = CANARIES.some(c => !hasProxyName(c) && source.includes(c));
	if (hasProxyName(source) && !appCanary) {
		return tryBoth(t => obfuscateProxyJs(source, t, hint + " <script>"));
	}
	return tryBoth(t => obfuscateJs(source, t, hint + " <script>"));
}

function processJsFile(full) {
	const content = readFileSync(full, "utf8");
	if (content.includes(MARKER)) return { skipped: "already-obfuscated" };
	if (!shouldProcessJs(full, content)) return { skipped: "policy" };
	// Vite emits ESM chunks; .cjs files are CommonJS/classic scripts.
	const sourceType = extname(full) === ".cjs" ? "script" : "module";
	let res;
	try {
		const transform = isProxyVendor(full) ? obfuscateProxyJs : obfuscateJs;
		res = transform(content, sourceType, relative(REPO_ROOT, full));
	} catch (err) {
		// Hard failure: a file we are required to obfuscate must never be shipped
		// in the clear because it failed to parse.
		throw new Error(`cannot obfuscate ${relative(REPO_ROOT, full)}: ${err.message}`);
	}
	if (res.changed) writeFileSync(full, res.code);
	return { changed: res.changed, count: res.count };
}

function neutralizeTitleMeta(html) {
	let changed = false;
	html = html.replace(/(<title[^>]*>)([\s\S]*?)(<\/title>)/i, (m, open, inner, close) => {
		if (!hasCanary(inner)) return m;
		changed = true;
		return open + NEUTRAL_TITLE + close;
	});
	html = html.replace(/<meta\b[^>]*>/gi, tag => {
		if (!/name\s*=\s*["']description["']/i.test(tag)) return tag;
		const cm = tag.match(/content\s*=\s*("([^"]*)"|'([^']*)')/i);
		if (!cm) return tag;
		const val = cm[2] != null ? cm[2] : cm[3];
		if (!hasCanary(val)) return tag;
		changed = true;
		const q = cm[1][0];
		return tag.replace(cm[0], `content=${q}${NEUTRAL_DESC}${q}`);
	});
	return { html, changed };
}

function processHtmlFile(full) {
	let html = readFileSync(full, "utf8");
	if (html.includes(MARKER)) return { skipped: "already-obfuscated" };
	const rel = relative(REPO_ROOT, full);

	const nt = neutralizeTitleMeta(html);
	html = nt.html;

	let scriptCount = 0;
	html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
		if (/\bsrc\s*=/i.test(attrs)) return m; // external script
		if (!body.trim()) return m;
		if (!hasCanary(body) && !hasProxyName(body)) return m; // only inline scripts that leak
		const isModule = /type\s*=\s*["']module["']/i.test(attrs);
		let res;
		try {
			res = obfuscateInlineScript(body, isModule, rel);
		} catch (err2) {
			throw new Error(`cannot obfuscate inline <script> in ${rel}: ${err2.message}`);
		}
		if (res.changed) scriptCount++;
		return `<script${attrs}>${res.code}</script>`;
	});

	// Final safety: no canary may survive anywhere in the shell.
	const leftover = CANARIES.filter(c => html.includes(c));
	if (leftover.length) {
		throw new Error(`canary still present in ${rel} after obfuscation: ${leftover.map(c => JSON.stringify(c)).join(", ")}`);
	}

	const changed = nt.changed || scriptCount > 0;
	if (changed) {
		html = `<!--${MARKER}-->` + html;
		writeFileSync(full, html);
	}
	return { changed, scriptCount, titleMeta: nt.changed };
}

// ---------------------------------------------------------------------------
// SVG cloak shells. An .svg served as image/svg+xml is XML, so (a) inline
// <script> text has its entities decoded / CDATA taken literally before it
// reaches the JS engine, and (b) the obfuscated output (ChaCha20 decoder uses
// `<`, `<<`, `&`) must be wrapped in CDATA to stay well-formed XML.
// ---------------------------------------------------------------------------

// Decode the XML predefined entities (and numeric char refs) that the SVG build
// uses to escape JS text into XML. Only these appear in machine-generated
// shells; anything else is left verbatim.
function decodeXmlEntities(s) {
	return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, ent) => {
		if (ent[0] === "#") {
			const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
			return Number.isFinite(code) && code >= 0 ? String.fromCodePoint(code) : m;
		}
		switch (ent) {
			case "amp":
				return "&";
			case "lt":
				return "<";
			case "gt":
				return ">";
			case "quot":
				return '"';
			case "apos":
				return "'";
			default:
				return m;
		}
	});
}

// Reconstruct the JavaScript an XML parser would hand the engine for a <script>
// body: CDATA sections are literal; all other text has its entities decoded.
function xmlScriptToJs(body) {
	const OPEN = "<![CDATA[";
	const CLOSE = "]]>";
	let out = "";
	let i = 0;
	while (i < body.length) {
		const start = body.indexOf(OPEN, i);
		if (start === -1) {
			out += decodeXmlEntities(body.slice(i));
			break;
		}
		out += decodeXmlEntities(body.slice(i, start));
		const end = body.indexOf(CLOSE, start + OPEN.length);
		const contentEnd = end === -1 ? body.length : end;
		out += body.slice(start + OPEN.length, contentEnd);
		i = end === -1 ? body.length : end + CLOSE.length;
	}
	return out;
}

// Wrap arbitrary JS in a CDATA section, splitting any `]]>` across sections so
// it cannot terminate the CDATA early. The reconstituted text is identical.
export function wrapCdata(js) {
	const safe = js.split("]]>").join("]]]]><![CDATA[>");
	return `<![CDATA[${safe}]]>`;
}

// Prepend the idempotency marker as an XML comment, after an optional
// <?xml ...?> declaration (which must stay first).
function insertSvgMarker(svg) {
	const comment = `<!--${MARKER}-->`;
	const m = svg.match(/^\s*<\?xml[^>]*\?>/);
	if (m) return svg.slice(0, m[0].length) + comment + svg.slice(m[0].length);
	return comment + svg;
}

// Pure core: obfuscate one SVG document string. Mirrors processHtmlFile but
// treats the shell as XML. Returns { svg, changed, scriptCount, titleMeta }.
export function obfuscateSvg(svg, nameHint = "") {
	if (svg.includes(MARKER)) return { svg, changed: false, scriptCount: 0, titleMeta: false };

	const nt = neutralizeTitleMeta(svg);
	svg = nt.html;

	let scriptCount = 0;
	svg = svg.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
		if (/\bsrc\s*=/i.test(attrs)) return m; // external script
		if (!body.trim()) return m;
		if (!hasCanary(body) && !hasProxyName(body)) return m; // only inline scripts that leak
		const isModule = /type\s*=\s*["']module["']/i.test(attrs);
		const source = xmlScriptToJs(body); // decode XML -> the real JS the engine runs
		let res;
		try {
			res = obfuscateInlineScript(source, isModule, nameHint);
		} catch (err2) {
			throw new Error(`cannot obfuscate inline <script> in ${nameHint}: ${err2.message}`);
		}
		if (res.changed) scriptCount++;
		// Wrap in CDATA: the decoder's `<` / `<<` / `&` are not raw-text safe in XML.
		return `<script${attrs}>${wrapCdata(res.code)}</script>`;
	});

	// Final safety: no canary may survive anywhere in the shell.
	const leftover = CANARIES.filter(c => svg.includes(c));
	if (leftover.length) {
		throw new Error(`canary still present in ${nameHint} after obfuscation: ${leftover.map(c => JSON.stringify(c)).join(", ")}`);
	}

	const changed = nt.changed || scriptCount > 0;
	if (changed) svg = insertSvgMarker(svg);
	return { svg, changed, scriptCount, titleMeta: nt.changed };
}

function processSvgFile(full) {
	const svg = readFileSync(full, "utf8");
	if (svg.includes(MARKER)) return { skipped: "already-obfuscated" };
	const res = obfuscateSvg(svg, relative(REPO_ROOT, full));
	if (res.changed) writeFileSync(full, res.svg);
	return res;
}

function run(dirs) {
	let totalFiles = 0;
	let jsChanged = 0;
	let htmlChanged = 0;
	let svgChanged = 0;
	for (const d of dirs) {
		const abs = resolve(REPO_ROOT, d);
		if (!existsSync(abs)) {
			console.log(`skip (missing): ${d}`);
			continue;
		}
		console.log(`obfuscating: ${relative(REPO_ROOT, abs) || abs}`);
		for (const { full, size } of walkFiles(abs)) {
			const ext = extname(full);
			if (JS_EXT.has(ext)) {
				totalFiles++;
				const r = processJsFile(full);
				if (r.changed) {
					jsChanged++;
					console.log(`  js   ${relative(REPO_ROOT, full)} (${r.count} literals)`);
				}
			} else if (ext === ".html") {
				totalFiles++;
				const r = processHtmlFile(full);
				if (r.changed) {
					htmlChanged++;
					console.log(`  html ${relative(REPO_ROOT, full)} (${r.scriptCount} script(s)${r.titleMeta ? ", title/meta" : ""})`);
				}
			} else if (ext === ".svg") {
				totalFiles++;
				const r = processSvgFile(full);
				if (r.changed) {
					svgChanged++;
					console.log(`  svg  ${relative(REPO_ROOT, full)} (${r.scriptCount} script(s)${r.titleMeta ? ", title/meta" : ""})`);
				}
			} else if (ext === ".wasm" && isProxyVendor(full)) {
				totalFiles++;
				const r = processProxyWasmFile(full);
				if (r.changed) {
					jsChanged++;
					console.log(`  wasm ${relative(REPO_ROOT, full)} (proxy names mapped)`);
				}
			} else if (ext === ".css") {
				const css = readFileSync(full, "utf8");
				const leak = CANARIES.filter(c => css.includes(c));
				if (leak.length) throw new Error(`canary in CSS ${relative(REPO_ROOT, full)}: ${leak.join(", ")} (manual handling needed)`);
			}
		}
	}
	console.log(`obfuscation done: ${jsChanged} JS, ${htmlChanged} HTML, ${svgChanged} SVG changed (scanned ${totalFiles} candidate files)`);
}

// Only run when invoked directly (not when imported by the test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
	if (args.length === 0) {
		console.error("usage: node scripts/obfuscate-build.mjs <dir> [dir ...]");
		process.exit(1);
	}
	try {
		run(args);
	} catch (err) {
		console.error("obfuscate-build FAILED:", err.message);
		process.exit(1);
	}
}
