// Builds every plugin into site/ (the GitHub Pages layout, SOURCES_DESIGN.md §19.3):
//   site/index.json, site/index.json.sig (when UNISON_SIGNING_KEY is set), site/dist/<id>.js, site/icons/<id>.png
// Usage: node scripts/build.mjs [--repo unison-sources] [--name "Unison: источники"] [--plugins a,b]
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { signIndex } from "./sign.mjs";

export const ENGINE = "qjs-ng-0.12.1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = process.env.UNISON_PROJECT ? path.resolve(process.env.UNISON_PROJECT) : ROOT;   // plugins, cases, site (unison-sources-extra)
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const REPO = { id: arg("--repo", "unison-sources"), name: arg("--name", "Unison: источники") };
const ONLY = arg("--plugins", "");
const OUT = path.join(PROJECT, "site");

const coreVersion = /CORE_VERSION\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "lib/core/version.ts"), "utf8"))[1];

const REQUIRED = ["id", "name", "version", "api", "lang", "site", "domains", "icon", "content", "features", "nsfw", "studio", "browser", "rateLimit", "login"];
function validate(m, dir) {
  const miss = REQUIRED.filter((k) => !(k in m));
  if (miss.length) throw new Error(`${dir}: manifest misses ${miss.join(", ")}`);
  if (m.id !== dir) throw new Error(`${dir}: manifest id "${m.id}" must equal the folder name`);
  if (!/^[a-z0-9-]+$/.test(m.id)) throw new Error(`${dir}: bad id`);
  if (m.api !== 1) throw new Error(`${dir}: api must be 1`);
  if (!["ru", "en"].includes(m.lang)) throw new Error(`${dir}: lang`);
  if (!["none", "private", "public", "permission"].includes(m.studio)) throw new Error(`${dir}: studio`);
  if (!["never", "onChallenge", "always"].includes(m.browser)) throw new Error(`${dir}: browser`);
  if (!(m.rateLimit.rps > 0 && m.rateLimit.burst >= 1)) throw new Error(`${dir}: rateLimit`);
  if (m.icon !== `icons/${m.id}.png`) throw new Error(`${dir}: icon must be icons/${m.id}.png`);
  if (!m.domains.length) throw new Error(`${dir}: domains`);
}

export async function buildAll({ out = OUT, quiet = false } = {}) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "dist"), { recursive: true });
  fs.mkdirSync(path.join(out, "icons"), { recursive: true });
  const dirs = fs.readdirSync(path.join(PROJECT, "plugins")).filter((d) => fs.existsSync(path.join(PROJECT, "plugins", d, "index.ts")))
    .filter((d) => !ONLY || ONLY.split(",").includes(d)).sort();
  const plugins = [];
  for (const dir of dirs) {
    const src = path.join(PROJECT, "plugins", dir);
    const m = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
    validate(m, dir);
    const file = `dist/${m.id}.js`;
    const res = await build({
      entryPoints: [path.join(src, "index.ts")], bundle: true, format: "iife", target: "es2020", platform: "neutral",
      mainFields: ["module", "main"], charset: "utf8", legalComments: "none", minify: false, write: false,
      banner: { js: `/* ${m.id} ${m.version} · api ${m.api} · ${ENGINE} · core ${coreVersion} */` },
      logLevel: "warning",
    });
    const code = res.outputFiles[0].contents;
    if (/\bimport\s*\(|\brequire\s*\(/.test(Buffer.from(code).toString("utf8"))) throw new Error(`${dir}: bundle must not load modules at runtime (§4)`);
    fs.writeFileSync(path.join(out, file), code);
    fs.copyFileSync(path.join(src, "icon.png"), path.join(out, m.icon));
    plugins.push({
      id: m.id, name: m.name, version: m.version, api: m.api, engine: ENGINE, core: coreVersion,
      lang: m.lang, content: m.content, nsfw: m.nsfw, studio: m.studio, browser: m.browser,
      site: m.site, domains: m.domains, features: m.features, rateLimit: m.rateLimit, login: m.login,
      file, icon: m.icon,
      sha256: crypto.createHash("sha256").update(code).digest("hex"), size: code.length,
    });
    if (!quiet) console.log(`built ${file} (${code.length} bytes)`);
  }
  const index = { format: 1, repo: REPO, generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"), plugins };
  const json = JSON.stringify(index, null, 2) + "\n";
  fs.writeFileSync(path.join(out, "index.json"), json);
  if (process.env.UNISON_SIGNING_KEY) {
    fs.writeFileSync(path.join(out, "index.json.sig"), signIndex(Buffer.from(json, "utf8"), process.env.UNISON_SIGNING_KEY) + "\n");
    if (!quiet) console.log("signed index.json");
  } else if (!quiet) console.log("index.json NOT signed (UNISON_SIGNING_KEY is not set)");
  return { out, index };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAll().catch((e) => { console.error(e.message || e); process.exit(1); });
}
