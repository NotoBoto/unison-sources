// Minimal URL handling: quickjs-ng 0.12.1 has no URL / URLSearchParams (§4).

export interface ParsedUrl {
  protocol: string;   // "https:"
  host: string;       // "ru.wikisource.org" (with port if any)
  pathname: string;   // "/wiki/..." (still percent-encoded)
  search: string;     // "?a=1" or ""
  hash: string;       // "#x" or ""
}

const RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;

export function parseUrl(url: string): ParsedUrl | null {
  const m = RE.exec(url.trim());
  if (!m) return null;
  return { protocol: m[1].toLowerCase(), host: m[2].toLowerCase(), pathname: m[3] || "/", search: m[4] || "", hash: m[5] || "" };
}

export function queryParams(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of search.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = decodeQ(i < 0 ? part : part.slice(0, i));
    out[k] = i < 0 ? "" : decodeQ(part.slice(i + 1));
  }
  return out;
}

const decodeQ = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };

/** Builds a query string with stable key order (as given). */
export function query(params: Record<string, string | number | boolean | undefined>): string {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])))
    .join("&");
}

/** Resolves a relative reference against an absolute base URL. */
export function resolveUrl(base: string, ref: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref)) return ref;
  const b = parseUrl(base);
  if (!b) return ref;
  if (ref.startsWith("//")) return b.protocol + ref;
  if (ref.startsWith("/")) return `${b.protocol}//${b.host}${ref}`;
  if (ref.startsWith("?")) return `${b.protocol}//${b.host}${b.pathname}${ref}`;
  if (ref.startsWith("#")) return `${b.protocol}//${b.host}${b.pathname}${b.search}${ref}`;
  const dir = b.pathname.replace(/[^/]*$/, "");
  const segs: string[] = [];
  for (const s of (dir + ref).split("/")) {
    if (s === "..") segs.pop();
    else if (s !== ".") segs.push(s);
  }
  return `${b.protocol}//${b.host}${segs.join("/")}`;
}

export function hostAllowed(url: string, domains: string[]): boolean {
  const p = parseUrl(url);
  if (!p) return false;
  const host = p.host.replace(/:\d+$/, "");
  return domains.some((d) => host === d || host.endsWith("." + d));
}
