// Golden tests: every recorded case (tests/cases/<plugin>/<name>.json) is run on quickjs-ng (wasm) and V8,
// and optionally on Python (--python <python.exe>) and Android (--android <adb serial>, needs --ndk).
// The outputs must be byte-identical to tests/expected/<plugin>/<name>.json.
//   node tests/golden.mjs            check
//   node tests/golden.mjs --update   rewrite the expected files from the quickjs-ng output
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildAll } from "../scripts/build.mjs";
import { runQjs, runV8 } from "./hosts/node_qjs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const UPDATE = flag("--update");
const PYTHON = opt("--python");
const ANDROID = opt("--android");          // adb serial
const NDK = opt("--ndk") || process.env.ANDROID_NDK_HOME;
const QJS_SRC = opt("--qjs-src") || process.env.QJS_NG_SRC;   // quickjs-ng v0.12.1 sources for the Android host
const OUT = path.join(ROOT, "tests/out");

const { out: site } = await buildAll({ out: path.join(OUT, "site"), quiet: true });
const driverPath = path.join(ROOT, "tests/driver.js");
const driver = fs.readFileSync(driverPath, "utf8");

const cases = [];
for (const plugin of fs.readdirSync(path.join(ROOT, "tests/cases"))) {
  for (const f of fs.readdirSync(path.join(ROOT, "tests/cases", plugin)).filter((f) => f.endsWith(".json")).sort()) {
    cases.push({ plugin, name: f.replace(/\.json$/, ""), file: path.join(ROOT, "tests/cases", plugin, f) });
  }
}

let android;
if (ANDROID) android = prepareAndroid();

let failed = 0;
for (const c of cases) {
  const bundlePath = path.join(site, "dist", c.plugin + ".js");
  const bundle = fs.readFileSync(bundlePath, "utf8");
  const caseJson = fs.readFileSync(c.file, "utf8");
  const label = `${c.plugin}/${c.name}`;
  const outputs = {};
  const t0 = Date.now();
  outputs.qjs = await runQjs(driver, bundle, caseJson);
  const qjsMs = Date.now() - t0;
  outputs.v8 = await runV8(driver, bundle, caseJson);
  if (PYTHON) outputs.python = execFileSync(PYTHON, ["-I", path.join(ROOT, "tests/hosts/run_case.py"), driverPath, bundlePath, c.file], { maxBuffer: 1 << 28 }).toString("utf8");
  if (android) outputs.android = android.run(bundlePath, c.file);

  const parsed = JSON.parse(outputs.qjs);
  if (parsed.missing.length) { console.log(`✗ ${label}: fixtures missing for ${parsed.missing.length} request(s):\n  ${parsed.missing.join("\n  ")}`); failed++; continue; }
  const errs = parsed.results.filter((r) => r.result.err && !(r.expectError));
  const expFile = path.join(ROOT, "tests/expected", c.plugin, c.name + ".json");
  if (UPDATE) {
    fs.mkdirSync(path.dirname(expFile), { recursive: true });
    fs.writeFileSync(expFile, outputs.qjs);
  }
  const expected = fs.existsSync(expFile) ? fs.readFileSync(expFile, "utf8") : null;
  const verdicts = Object.entries(outputs).map(([host, o]) => `${host} ${o === expected ? "✓" : "✗"}`);
  const ok = expected !== null && Object.values(outputs).every((o) => o === expected);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}  [${verdicts.join(", ")}]  qjs ${qjsMs} ms${errs.length ? `  (${errs.length} call(s) returned errors: ${errs.map((e) => e.fn + ":" + e.result.err.code).join(", ")})` : ""}`);
  if (!ok && expected !== null) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [host, o] of Object.entries(outputs)) if (o !== expected) fs.writeFileSync(path.join(OUT, `${c.plugin}-${c.name}.${host}.json`), o);
    console.log(`  differing outputs saved to tests/out/`);
  }
  if (expected === null) console.log(`  no expected output yet: run with --update`);
}
if (android) android.cleanup();
console.log(failed ? `\n${failed} of ${cases.length} case(s) failed` : `\nall ${cases.length} case(s) passed`);
process.exit(failed ? 1 : 0);

function prepareAndroid() {
  if (!NDK || !QJS_SRC) throw new Error("--android needs --ndk <ndk dir> (or ANDROID_NDK_HOME) and --qjs-src <quickjs-ng v0.12.1 dir> (or QJS_NG_SRC)");
  const adb = (a, opts = {}) => execFileSync("adb", ["-s", ANDROID, ...a], { maxBuffer: 1 << 28, ...opts });
  const abi = adb(["shell", "getprop", "ro.product.cpu.abi"]).toString().trim();
  const triple = { "arm64-v8a": "aarch64-linux-android26", "x86_64": "x86_64-linux-android26" }[abi];
  if (!triple) throw new Error("unsupported ABI " + abi);
  const hostTag = { win32: "windows-x86_64", linux: "linux-x86_64", darwin: "darwin-x86_64" }[process.platform];
  const ext = process.platform === "win32" ? ".cmd" : "";
  const clang = path.join(NDK, "toolchains/llvm/prebuilt", hostTag, "bin", triple + "-clang" + ext);
  const bin = path.join(os.tmpdir(), "unison-golden-" + abi);
  const srcs = ["quickjs.c", "libregexp.c", "libunicode.c", "dtoa.c"].map((f) => path.join(QJS_SRC, f));
  execFileSync(clang, ["-Os", "-std=gnu11", "-I", QJS_SRC, "-o", bin, path.join(ROOT, "tests/android/golden.c"), ...srcs, "-lm"], { shell: process.platform === "win32" });
  const dir = "/data/local/tmp/unison-golden";
  adb(["shell", `rm -rf ${dir} && mkdir -p ${dir}`]);
  adb(["push", bin, `${dir}/golden`]);
  adb(["push", driverPath, `${dir}/driver.js`]);
  adb(["shell", `chmod 755 ${dir}/golden`]);
  console.log(`android: ${ANDROID} (${abi})`);
  return {
    run(bundlePath, casePath) {
      adb(["push", bundlePath, `${dir}/plugin.js`]);
      adb(["push", casePath, `${dir}/case.json`]);
      return adb(["exec-out", `${dir}/golden ${dir}/driver.js ${dir}/plugin.js ${dir}/case.json`]).toString("utf8");
    },
    cleanup() { adb(["shell", `rm -rf ${dir}`]); },
  };
}
