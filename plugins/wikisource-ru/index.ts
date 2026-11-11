// Russian Wikisource (ru.wikisource.org) through the MediaWiki API. SOURCES_DESIGN.md §7.
//
// Book id = title of the root page, e.g. "Герой нашего времени (Лермонтов)".
// A root page is one of:
//   - a list of editions ({{СписокРедакцийШапка}}): we take a modern-orthography edition ("/СО", "/1938 (СО)", …);
//   - a table of contents with subpages (chapters);
//   - the whole text on one page (one chapter).
// Chapter id = full page title of the chapter.
// Licence: the root page, then the edition page, then the first chapter ({{Отексте|ЛИЦЕНЗИЯ=…}}, PD-*/CC-* templates).

import manifest from "./manifest.json";
import { definePlugin, fetch, fail } from "../../lib/runtime";
import { parseChapterHtml, query, parseUrl } from "../../lib/core";
import type { BookDetails, BookStub, ChapterStub, Manifest, Page } from "../../lib/types";
import { parseDocument, DomUtils } from "htmlparser2";
import type { Element } from "domhandler";

const API = "https://ru.wikisource.org/w/api.php";
const WIKI = "https://ru.wikisource.org/wiki/";
const PAGE_SIZE = 20;

interface Parsed { title: string; text?: string; wikitext?: string; categories?: { category: string }[]; templates?: { title: string }[] }

async function api(params: Record<string, string | number>): Promise<any> {
  const url = API + "?" + query({ ...params, format: "json", formatversion: 2 });
  const r = await fetch(url);
  if (r.status === 429) fail("RATE_LIMITED", "Wikimedia API 429");
  if (r.status !== 200) fail("NOT_FOUND", `HTTP ${r.status}`, url);
  let d: any;
  try { d = JSON.parse(r.text); } catch { fail("CHANGED_LAYOUT", "not JSON", url); }
  if (d.error) fail(d.error.code === "missingtitle" ? "NOT_FOUND" : "CHANGED_LAYOUT", String(d.error.info), url);
  return d;
}

async function parsePage(page: string, prop: string): Promise<Parsed> {
  const d = await api({ action: "parse", page, prop, redirects: 1, disableeditsection: 1, disablelimitreport: 1, disabletoc: 1 });
  return d.parse as Parsed;
}

const pageUrl = (title: string) => WIKI + encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/");
const lastSegment = (t: string) => t.slice(t.lastIndexOf("/") + 1);

/** "Герой нашего времени (Лермонтов)" → title + author hint from the parentheses. */
function splitTitle(root: string): { title: string; author?: string } {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(root);
  return m ? { title: m[1], author: m[2] } : { title: root };
}

function stubFromTitle(t: string): BookStub {
  const id = t.split("/")[0];
  const { title, author } = splitTitle(id);
  return author ? { id, title, author } : { id, title };
}

async function searchBooks(srsearch: string, page: number): Promise<Page<BookStub>> {
  const d = await api({ action: "query", list: "search", srsearch, srnamespace: 0, srlimit: PAGE_SIZE, sroffset: (page - 1) * PAGE_SIZE, srprop: "" });
  const seen = new Set<string>();
  const items: BookStub[] = [];
  for (const r of d.query.search as { title: string }[]) {
    const s = stubFromTitle(r.title);
    if (!seen.has(s.id)) { seen.add(s.id); items.push(s); }
  }
  return { items, hasNext: !!d.continue };
}

// ---- licence ----

const LICENSE_RULES: [RegExp, NonNullable<BookDetails["license"]>][] = [
  [/^PD[-_ ]/i, "public-domain"],
  [/^CC[-_ ]?BY[-_ ]?SA/i, "cc-by-sa"],
  [/^CC[-_ ]?BY(?![-_ ]?(NC|ND))/i, "cc-by"],
];

// Russian public domain: 70 years after the author's death (+4 for authors who worked during the Great Patriotic War),
// counted from 1 January of the next year. Conservative and fixed (no Date: results must not depend on the host clock).
// Bump once a year: 2026 → 1951, 2027 → 1952, …
const PD_DEATH_YEAR_MAX = 1951;

/** Death year from the header: "| АВТОР = [[Антон Павлович Чехов]] (1860—1904)". */
function authorDeathYear(p: Parsed): number | undefined {
  const m = p.wikitext ? /\|\s*АВТОР\s*=[^\n]*?\((?:\d{3,4})\s*[—–-]\s*(\d{3,4})\)/.exec(p.wikitext) : null;
  return m ? +m[1] : undefined;
}

function licenseOf(p: Parsed): BookDetails["license"] {
  const fromWikitext = p.wikitext ? /\|\s*ЛИЦЕНЗИЯ\s*=\s*([^|}\n]+)/.exec(p.wikitext) : null;
  const names = [
    ...(fromWikitext ? [fromWikitext[1].trim()] : []),
    ...(p.templates || []).map((t) => t.title.replace(/^Шаблон:/, "")),
    ...(p.categories || []).map((c) => c.category.replace(/_/g, " ")),
  ];
  for (const n of names) for (const [re, v] of LICENSE_RULES) if (re.test(n)) return v;
  return undefined;
}

// ---- structure ----

interface TocLink { id: string; title: string; volume?: string }

/** Links to subpages of `base` in reading order, with the last heading above each link as the volume. */
function tocLinks(html: string, base: string): TocLink[] {
  const doc = parseDocument(html);
  const out: TocLink[] = [];
  let volume: string | undefined;
  const prefix = base + "/";
  const visit = (nodes: any[]) => {
    for (const n of nodes) {
      if (n.type !== "tag") continue;
      const el = n as Element;
      if (/^h[2-6]$/.test(el.name)) {
        const t = DomUtils.textContent(el).replace(/\s+/g, " ").trim();
        if (t && !/^(Содержание|Примечания|Ссылки)$/.test(t)) volume = t;
        continue;
      }
      if (el.name === "a" && el.attribs.title && el.attribs.title.startsWith(prefix) && !/\bnew\b/.test(el.attribs.class || "")) {
        const id = el.attribs.title;
        if (!out.some((l) => l.id === id)) {
          const text = DomUtils.textContent(el).replace(/\s+/g, " ").trim() || lastSegment(id);
          out.push(volume ? { id, title: text, volume } : { id, title: text });
        }
        continue;
      }
      visit(el.children);
    }
  };
  visit(doc.children);
  // a part that has its own chapters listed is a container, not a chapter
  return out.filter((l) => !out.some((o) => o.id.startsWith(l.id + "/")));
}

/** Is the root page a list of editions? Two formats exist: {{СписокРедакцийШапка}} and {{Отексте|ЧАСТЬ=Редакции}} + {{список редакций}}. */
function isEditionList(p: Parsed): boolean {
  if (p.wikitext && /СписокРедакций|\{\{\s*список редакций|\|\s*ЧАСТЬ\s*=\s*Редакции/i.test(p.wikitext)) return true;
  return (p.categories || []).some((c) => c.category === "Списки_редакций");
}

/** For a list of editions: the edition to read. Modern orthography first: "СО", "… (СО)", else the latest year ≥ 1918. */
function pickEdition(root: string, p: Parsed): string | null {
  if (!p.wikitext || !isEditionList(p)) return null;
  const subs: { name: string; line: string }[] = [];
  for (const line of p.wikitext.split("\n")) {
    for (const m of line.matchAll(/\[\[\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\]/g)) {
      const target = m[1].trim();
      const name = target.startsWith("/") ? target.slice(1) : target.startsWith(root + "/") ? target.slice(root.length + 1) : null;
      if (name && !subs.some((s) => s.name === name)) subs.push({ name, line });
    }
  }
  if (!subs.length) return null;
  const modern = subs.filter((s) => /(^|\s|\()СО\)?$/.test(s.name));
  const year = (s: { name: string; line: string }) => Math.max(0, ...Array.from((s.name + " " + s.line).matchAll(/\b(1[6-9]\d\d|20\d\d)\b/g), (m) => +m[1]));
  const post1918 = subs.filter((s) => year(s) >= 1918).sort((a, b) => year(b) - year(a));
  const choice = modern.find((s) => s.name === "СО") ?? modern[0] ?? post1918[0] ?? subs[subs.length - 1];
  return `${root}/${choice.name}`;
}

async function structure(bookId: string): Promise<{ root: Parsed; base: string; basePage: Parsed }> {
  const root = await parsePage(bookId, "text|wikitext|categories|templates");
  const edition = pickEdition(bookId, root);
  if (!edition) return { root, base: bookId, basePage: root };
  const basePage = await parsePage(edition, "text|wikitext|categories|templates");
  return { root, base: edition, basePage };
}

function chaptersOf(bookId: string, base: string, basePage: Parsed): ChapterStub[] {
  const links = tocLinks(basePage.text || "", base);
  if (links.length === 0) return [{ id: base, title: splitTitle(bookId).title, url: pageUrl(base) }];
  return links.map((l) => {
    const c: ChapterStub = { id: l.id, title: l.title, url: pageUrl(l.id) };
    if (l.volume) c.volume = l.volume;
    return c;
  });
}

/** Title of a chapter page; a whole work on an edition page ("…/Вариант …", "…/1938 (СО)") gets the book title. */
function chapterTitle(chapterId: string): string {
  if (!chapterId.includes("/")) return splitTitle(chapterId).title;
  const last = lastSegment(chapterId);
  // no \b here: JS \b is ASCII-only and never matches next to Cyrillic letters
  const isEdition = /^(Вариант|Редакция)(?=\s|$)|^\d{4}(?=\s|$).*\((СО|ДО)\)$|^(СО|ДО)$/.test(last) && chapterId.split("/").length === 2;
  return isEdition ? splitTitle(chapterId.split("/")[0]).title : splitTitle(last).title;
}

function authorOf(p: Parsed): string | undefined {
  const m = p.wikitext ? /\|\s*АВТОР\s*=\s*\[\[(?:Автор:)?([^\]|]+)/.exec(p.wikitext) : null;
  return m ? m[1].trim() : undefined;
}

// ---- plugin ----

definePlugin(manifest as Manifest, {
  async search(q, page) {
    return searchBooks(q, page);
  },

  async popular(page) {
    return searchBooks('incategory:"Романы"', page);
  },

  async details(bookId) {
    const { root, base, basePage } = await structure(bookId);
    const { title, author: hint } = splitTitle(bookId);
    let license = licenseOf(root) ?? (base !== bookId ? licenseOf(basePage) : undefined);
    if (!license) {
      const first = chaptersOf(bookId, base, basePage)[0];
      if (first && first.id !== base) license = licenseOf(await parsePage(first.id, "wikitext|templates|categories"));
    }
    if (!license) {
      const died = authorDeathYear(root) ?? authorDeathYear(basePage);
      if (died !== undefined && died <= PD_DEATH_YEAR_MAX) license = "public-domain";
    }
    const author = authorOf(root) ?? authorOf(basePage) ?? hint;
    const d: BookDetails = { id: bookId, title, tags: [], status: "completed", lang: "ru", url: pageUrl(bookId), license: license ?? "unknown" };
    if (author) d.author = author;
    return d;
  },

  async chapters(bookId) {
    const { base, basePage } = await structure(bookId);
    return chaptersOf(bookId, base, basePage);
  },

  async chapter(_bookId, chapterId) {
    const p = await parsePage(chapterId, "text");
    const c = parseChapterHtml(p.text || "", {
      lang: "ru",
      root: { class: "mw-parser-output" },
      dropClasses: ["ws-noexport", "mw-editsection", "references-small", "header_notes", "headertemplate", "ambox", "metadata",
        "mw-cite-backlink", "searchaux", "mw-empty-elt"],
      dropIds: ["headertemplate", "extra_nav", "sub_nav", "title_line", "toc"],
      stopHeading: /^(Примечания|Комментарии)(?=$|[\s.:])/,   // not \b: it is ASCII-only and never matches after Cyrillic
      titleFromHeading: false,
      fallbackTitle: chapterTitle(chapterId),
      baseUrl: "https://ru.wikisource.org/",
    });
    if (c.paras.length === 0) fail("CHANGED_LAYOUT", "no text found", pageUrl(chapterId));
    return { kind: "text", ...c };
  },

  async bookIdFromUrl(url) {
    const u = parseUrl(url);
    if (!u || !/(^|\.)ru(\.m)?\.wikisource\.org$/.test(u.host) || !u.pathname.startsWith("/wiki/")) return null;
    let t: string;
    try { t = decodeURIComponent(u.pathname.slice(6)); } catch { return null; }
    t = t.replace(/_/g, " ").trim();
    if (!t || /^(Автор|Категория|Шаблон|Викитека|Служебная|Обсуждение)[:]/.test(t)) return null;
    return t.split("/")[0];
  },
});
