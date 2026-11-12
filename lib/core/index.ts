// core: shared code bundled into every plugin (SOURCES_DESIGN.md §5.4).
export { CORE_VERSION } from "./version";
export { parseChapterHtml, normalizeText, normalizeSpaces, normalizeRu, normalizeEn, classes } from "./html";
export type { ParseOptions } from "./html";
export { parseUrl, queryParams, query, resolveUrl, hostAllowed } from "./url";
export { crypto } from "./crypto";
export { prosemirrorToHtml, isPmDoc, escapeHtml } from "./prosemirror";
export type { PmNode, PmImage } from "./prosemirror";

import { hex, sha1 } from "./crypto";

/** Chapter hash (§19.5): first 16 hex chars of SHA-1 over UTF-8 of title + "\n" + paras.join("\n"). */
export function chapterHash(title: string, paras: string[]): string {
  return hex(sha1(title + "\n" + paras.join("\n"))).slice(0, 16);
}
