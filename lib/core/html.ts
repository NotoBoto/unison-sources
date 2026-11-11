// HTML of a chapter → { title, paras, images } (SOURCES_DESIGN.md §5.4).
// The same bundle runs on every host, so this must stay deterministic: no Intl, no locale APIs, no Date.

import { parseDocument, DomUtils } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import type { Image, Lang } from "../types";
import { resolveUrl } from "./url";

export interface ParseOptions {
  lang: Lang;
  /** Only this element's content is used (first match). Default: the whole document. */
  root?: { id?: string; class?: string; tag?: string };
  /** Extra things to drop on top of the defaults. */
  dropClasses?: string[];
  dropIds?: string[];
  dropTags?: string[];
  /** A heading whose text matches ends the chapter (notes, comments). */
  stopHeading?: RegExp;
  /** The first heading becomes the title (and is not a paragraph). Default true. */
  titleFromHeading?: boolean;
  /** Used for the title when the page has no heading. */
  fallbackTitle?: string;
  /** Base URL for relative image links. */
  baseUrl?: string;
  /** Images narrower than this (px, when known) are dropped as decoration. Default 100. */
  minImageWidth?: number;
}

const DEFAULT_DROP_TAGS = ["script", "style", "noscript", "template", "nav", "header", "footer", "aside", "form", "button",
  "sup", "table", "link", "meta", "iframe", "svg"];
const DEFAULT_DROP_CLASSES = ["noprint", "navbox", "advert", "ads", "ad", "share", "comments", "footnotes", "reference", "references"];
const BLOCK = new Set(["p", "div", "dd", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "center"]);

export function classes(el: Element): string[] {
  return (el.attribs.class || "").split(/\s+/).filter(Boolean);
}

function matches(el: Element, sel: { id?: string; class?: string; tag?: string }): boolean {
  if (sel.tag && el.name !== sel.tag) return false;
  if (sel.id && el.attribs.id !== sel.id) return false;
  if (sel.class && !classes(el).includes(sel.class)) return false;
  return true;
}

export function normalizeSpaces(s: string): string {
  return s
    .replace(/[       　]/g, " ")
    .replace(/[­​‌‍⁠﻿]/g, "")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .trim();
}

export function normalizeRu(s: string): string {
  s = s.replace(/^[-‐‑‒–―]\s+/, "— ");   // dialogue dash at the start
  s = s.replace(/ [-–] /g, " — ");                             // spaced hyphen inside the text
  s = s.replace(/"([^"]*)"/g, "«$1»");                          // straight quotes → «»
  return s;
}

export function normalizeEn(s: string): string {
  s = s.replace(/(^|[\s(\[{—–-])"/g, "$1“").replace(/"/g, "”");
  s = s.replace(/(^|[\s(\[{—–-])'/g, "$1‘").replace(/'/g, "’");
  return s;
}

export function normalizeText(s: string, lang: Lang): string {
  const t = normalizeSpaces(s);
  return lang === "en" ? normalizeEn(t) : normalizeRu(t);
}

const TERMINAL = /[.!?…:;»"”’)\]——]$/;
const LOWER_START = /^[a-zа-яё]/;

export function parseChapterHtml(html: string, opts: ParseOptions): { title: string; paras: string[]; images: Image[] } {
  const doc = parseDocument(html, { decodeEntities: true });
  let rootNodes: AnyNode[] = doc.children;
  if (opts.root) {
    const r = DomUtils.findOne((e) => matches(e, opts.root!), doc.children, true);
    if (r) rootNodes = r.children;
  }
  const dropTags = new Set([...DEFAULT_DROP_TAGS, ...(opts.dropTags || [])]);
  const dropClasses = new Set([...DEFAULT_DROP_CLASSES, ...(opts.dropClasses || [])]);
  const dropIds = new Set(opts.dropIds || []);
  const minW = opts.minImageWidth ?? 100;
  const titleFromHeading = opts.titleFromHeading !== false;

  const paras: string[] = [];
  const images: Image[] = [];
  let title: string | null = null;
  let buf = "";
  let stopped = false;

  const flush = () => {
    const t = normalizeText(buf, opts.lang);
    buf = "";
    if (t) paras.push(t);
  };

  const shouldDrop = (n: AnyNode): boolean => {
    if (n.type === "comment" || n.type === "directive") return true;
    if (n.type !== "tag" && n.type !== "script" && n.type !== "style") return false;
    const el = n as Element;
    if (dropTags.has(el.name)) return true;
    if (classes(el).some((c) => dropClasses.has(c))) return true;
    if (el.attribs.id && dropIds.has(el.attribs.id)) return true;
    if (/display\s*:\s*none/i.test(el.attribs.style || "")) return true;
    if (el.attribs.hidden !== undefined || el.attribs["aria-hidden"] === "true") return true;
    return false;
  };

  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (stopped) return;
      if (shouldDrop(n)) continue;
      if (n.type === "text") { buf += (n as unknown as { data: string }).data; continue; }
      if (n.type !== "tag") continue;
      const el = n as Element;
      if (el.name === "br") { buf += " "; continue; }
      if (el.name === "img") {
        const src = el.attribs.src || el.attribs["data-src"];
        const w = parseInt(el.attribs.width || "", 10) || undefined;
        const h = parseInt(el.attribs.height || "", 10) || undefined;
        if (src && (w === undefined || w >= minW)) {
          flush();
          const img: Image = { after: paras.length - 1, src: opts.baseUrl ? resolveUrl(opts.baseUrl, src) : src };
          if (w) img.w = w;
          if (h) img.h = h;
          images.push(img);
        }
        continue;
      }
      if (/^h[1-6]$/.test(el.name)) {
        const t = normalizeSpaces(DomUtils.textContent(el));
        if (opts.stopHeading && opts.stopHeading.test(t)) { flush(); stopped = true; return; }
        if (titleFromHeading && title === null && paras.length === 0 && t) { flush(); title = t; continue; }
      }
      const block = BLOCK.has(el.name);
      if (block) flush();
      walk(el.children);
      if (block) flush();
    }
  };
  walk(rootNodes);
  flush();

  // glue paragraphs broken mid-sentence: previous has no terminal punctuation, next starts lowercase
  const glued: string[] = [];
  const remap: number[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const prev = glued[glued.length - 1];
    if (prev !== undefined && !TERMINAL.test(prev) && LOWER_START.test(p)) glued[glued.length - 1] = prev + " " + p;
    else glued.push(p);
    remap[i] = glued.length - 1;
  }
  for (const img of images) img.after = img.after < 0 ? -1 : remap[img.after];

  return { title: title ?? (opts.fallbackTitle || ""), paras: glued, images };
}
