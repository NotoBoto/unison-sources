// Nightly smoke test against the live sites (SOURCES_DESIGN.md §6): search → details → chapters → first chapter.
// Fails (exit 1) when a site changed in a way the plugin no longer understands; CI then opens an issue.
// Usage: node scripts/smoke.mjs [pluginId ...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "./build.mjs";
import { runLive } from "./record.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = process.env.UNISON_PROJECT ? path.resolve(process.env.UNISON_PROJECT) : ROOT;   // plugins, cases, site (unison-sources-extra)
const plan = JSON.parse(fs.readFileSync(path.join(PROJECT, "tests/smoke.json"), "utf8"));
const only = process.argv.slice(2);
await buildAll({ quiet: true });

const problems = [];
for (const [id, p] of Object.entries(plan)) {
  if (only.length && !only.includes(id)) continue;
  console.log(`== ${id}`);
  const calls = [{ fn: p.searchFn || "search", args: p.search }, { fn: "details", args: [p.book] }, { fn: "chapters", args: [p.book] }];
  const { results } = await runLive(id, calls, { log: () => {} });
  const [search, details, chapters] = results.map((r) => r.result);
  const bad = (what) => { problems.push(`${id}: ${what}`); console.log("  ✗ " + what); };
  if (search.err) bad(`search: ${JSON.stringify(search.err)}`); else if (!search.ok.items.length) bad("search: no results");
  if (details.err) bad(`details: ${JSON.stringify(details.err)}`);
  else if (p.expectLicense && details.ok.license !== p.expectLicense) bad(`details: licence ${details.ok.license}, expected ${p.expectLicense}`);
  if (chapters.err) { bad(`chapters: ${JSON.stringify(chapters.err)}`); continue; }
  if (chapters.ok.length < (p.minChapters || 1)) bad(`chapters: only ${chapters.ok.length}`);
  const first = chapters.ok[0];
  const { results: [ch] } = await runLive(id, [{ fn: "chapter", args: [p.book, first.id] }], { log: () => {} });
  if (ch.result.err) bad(`chapter: ${JSON.stringify(ch.result.err)}`);
  else if (ch.result.ok.kind === "text" && ch.result.ok.paras.length < 3) bad(`chapter: only ${ch.result.ok.paras.length} paragraphs`);
  else console.log(`  ✓ ${search.ok?.items.length} results, ${chapters.ok.length} chapters, first chapter ${ch.result.ok.paras?.length ?? "audio"} paragraphs`);
}
if (problems.length) {
  fs.mkdirSync(path.join(PROJECT, "tests/out"), { recursive: true });
  fs.writeFileSync(path.join(PROJECT, "tests/out/smoke-report.md"), "Nightly smoke test found problems:\n\n" + problems.map((p) => "- " + p).join("\n") + "\n");
}
process.exit(problems.length ? 1 : 0);
