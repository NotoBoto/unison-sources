// Unit tests for lib/core: run the same bundle on quickjs-ng (wasm) and V8, compare with node:crypto and fixed answers.
import { build } from "esbuild";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import vm from "node:vm";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = await build({ entryPoints: [path.join(ROOT, "tests/unit-entry.ts")], bundle: true, format: "iife", target: "es2020", platform: "neutral", mainFields: ["module", "main"], write: false, logLevel: "warning" });
const code = res.outputFiles[0].text;

const Q = await newQuickJSWASMModuleFromVariant(variant);
const ctx = Q.newContext();
const r = ctx.evalCode(code + "\n;__unit()");
if (r.error) { console.error(ctx.dump(r.error)); process.exit(1); }
const qjs = ctx.dump(r.value);
r.value.dispose(); ctx.dispose();

const v8ctx = vm.createContext({});
const v8 = vm.runInContext(code + "\n;__unit()", v8ctx);

let failures = 0;
const check = (name, fn) => { try { fn(); console.log("✓ " + name); } catch (e) { failures++; console.log("✗ " + name + "\n  " + e.message.split("\n").slice(0, 6).join("\n  ")); } };

check("quickjs-ng and V8 give identical output", () => assert.equal(qjs, v8));
const o = JSON.parse(qjs);
const INPUTS = ["", "abc", "Привет, мир!", "😀 emoji ✓", "x".repeat(1000), "граница блока 55 байт: 0123456789012345678901", "a".repeat(64), "b".repeat(119)];
for (const alg of ["md5", "sha1", "sha256"]) check(`${alg} matches node:crypto`, () => assert.deepEqual(o[alg], INPUTS.map((s) => crypto.createHash(alg).update(s, "utf8").digest("hex"))));
check("base64 matches Buffer", () => assert.deepEqual(o.b64, INPUTS.map((s) => Buffer.from(s, "utf8").toString("base64"))));
check("base64 round trip", () => assert.ok(o.b64back.every(Boolean)));
check("chapter hash (§19.5)", () => assert.equal(o.hash, crypto.createHash("sha1").update("Глава 1\nПервый абзац.\n— Второй, — сказал он.", "utf8").digest("hex").slice(0, 16)));
check("parseUrl", () => assert.deepEqual(o.url, { protocol: "https:", host: "ru.wikisource.org:443", pathname: "/wiki/A%20B", search: "?x=1&y=%D0%AF", hash: "#top" }));
check("queryParams", () => assert.deepEqual(o.qp, { a: "1", b: "Я б", c: "" }));
check("query", () => assert.equal(o.q, "action=parse&page=%D0%93%D0%B5%D1%80%D0%BE%D0%B9%2F%D0%A1%D0%9E&n=2"));
check("resolveUrl", () => assert.deepEqual(o.resolve, ["https://a.org/x/img/p.png", "https://cdn.b.org/i.png", "https://a.org/abs?q=1"]));
check("hostAllowed", () => assert.deepEqual(o.host, [true, false]));
check("normalizeText ru/en", () => assert.deepEqual(o.norm, ["— Ты слышишь? — спросила Анна. «Да»", "“Hello,” she said. ‘It’s fine.’"]));
check("parseChapterHtml", () => assert.deepEqual(o.html, {
  title: "Глава 1",
  paras: ["Утро было тихим. Туман.", "— Ты слышишь?"],
  images: [{ after: 1, src: "https://ru.wikisource.org/i/a.jpg", w: 400, h: 300 }],
}));
check("prosemirrorToHtml", () => assert.equal(o.pm,
  `<p><b>Арка &lt;первая&gt; &amp; вторая</b></p><hr><p>- Ранг &lt;S&gt;,<br><i>сказал он.</i></p>` +
  `<img src="https://ranobelib.me/u/a1.jpg" width="800"><div><p>внутри</p></div>`));

console.log(failures ? `\n${failures} unit test(s) failed` : "\nall unit tests passed");
process.exit(failures ? 1 : 0);
