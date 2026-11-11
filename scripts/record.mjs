// Records a golden test case from the live site.
// Runs the built plugin in Node (V8) with real HTTP, honest User-Agent and the plugin's rateLimit,
// and saves every response it used as a fixture: tests/cases/<plugin>/<name>.json
// Usage: node scripts/record.mjs <plugin> <name> '<calls JSON>'
//   e.g. node scripts/record.mjs wikisource-ru hero '[{"fn":"details","args":["Герой нашего времени (Лермонтов)"]}]'
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const USER_AGENT = "UnisonSources/0.1 (https://github.com/NotoBoto/unison)";

/** Runs calls against the live site; returns {results, fixtures}. */
export async function runLive(pluginId, calls, { log = console.log } = {}) {
  const bundle = fs.readFileSync(path.join(ROOT, "site/dist", pluginId + ".js"), "utf8");
  const fixtures = {};
  const store = {};
  let last = 0;
  const box = { queue: [] };
  const ctx = vm.createContext({
    console,
    __host_request: (id, op, argsJson) => box.queue.push({ id, op, args: JSON.parse(argsJson) }),
    __host_done: (callId, json) => { box.done = { callId, json }; },
  });
  vm.runInContext(bundle, ctx, { filename: pluginId + ".js" });
  const m = ctx.__unison.manifest;
  const gap = 1000 / m.rateLimit.rps;

  async function serve(req) {
    if (req.op === "fetch") {
      const [url, init] = req.args;
      const host = new URL(url).hostname;
      if (!m.domains.some((d) => host === d || host.endsWith("." + d))) return [false, { code: "ENGINE", message: "domain not allowed: " + host }];
      const wait = last + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      log(`  GET ${decodeURI(url).slice(0, 140)}`);
      const r = await fetch(url, { method: init?.method || "GET", headers: { "User-Agent": USER_AGENT, ...(init?.headers || {}) }, body: init?.body });
      const text = await r.text();
      const headers = {};
      for (const k of ["content-type", "retry-after"]) if (r.headers.get(k)) headers[k] = r.headers.get(k);
      fixtures[url] = { status: r.status, headers, text };
      return [true, { status: r.status, headers, text, url }];
    }
    if (req.op === "storage.get") return [true, store[req.args[0]] ?? null];
    if (req.op === "storage.set") { store[req.args[0]] = req.args[1]; return [true, null]; }
    if (req.op === "log") { log("  log: " + req.args[1]); return [true, null]; }
    return [false, { code: "ENGINE", message: "op" }];
  }

  const results = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    log(`${c.fn}(${c.args.map((a) => JSON.stringify(a)).join(", ")})`);
    box.done = null;
    ctx.__unison.call(i + 1, c.fn, JSON.stringify(c.args));
    for (;;) {
      await new Promise((r) => setImmediate(r));
      if (box.done) break;
      const req = box.queue.shift();
      if (!req) continue;
      const [ok, val] = await serve(req);
      vm.runInContext(`${ok ? "__host_resolve" : "__host_reject"}(${req.id}, ${JSON.stringify(JSON.stringify(val))})`, ctx);
    }
    results.push({ fn: c.fn, args: c.args, result: JSON.parse(box.done.json) });
  }
  return { results, fixtures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [pluginId, name, callsJson] = process.argv.slice(2);
  if (!pluginId || !name || !callsJson) { console.error("usage: record.mjs <plugin> <name> '<calls JSON>'"); process.exit(2); }
  const calls = JSON.parse(callsJson);
  const { results, fixtures } = await runLive(pluginId, calls);
  for (const r of results) if (r.result.err) console.warn(`! ${r.fn}: ${JSON.stringify(r.result.err)}`);
  const dir = path.join(ROOT, "tests/cases", pluginId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + ".json");
  fs.writeFileSync(file, JSON.stringify({ plugin: pluginId, recorded: new Date().toISOString().replace(/\.\d+Z$/, "Z"), calls, fixtures }, null, 1) + "\n");
  console.log(`saved ${path.relative(ROOT, file)} (${Object.keys(fixtures).length} responses)`);
}
