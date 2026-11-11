// Bundled by tests/unit.mjs and run inside quickjs-ng and V8: returns computed values as JSON.
import { crypto, chapterHash, parseUrl, queryParams, query, resolveUrl, hostAllowed, normalizeText, parseChapterHtml } from "../lib/core";

const INPUTS = ["", "abc", "Привет, мир!", "😀 emoji ✓", "x".repeat(1000), "граница блока 55 байт: 0123456789012345678901", "a".repeat(64), "b".repeat(119)];

(globalThis as any).__unit = () => JSON.stringify({
  md5: INPUTS.map((s) => crypto.md5(s)),
  sha1: INPUTS.map((s) => crypto.sha1(s)),
  sha256: INPUTS.map((s) => crypto.sha256(s)),
  b64: INPUTS.map((s) => crypto.base64Encode(s)),
  b64back: INPUTS.map((s) => crypto.utf8Decode(crypto.base64Decode(crypto.base64Encode(s))) === s),
  hash: chapterHash("Глава 1", ["Первый абзац.", "— Второй, — сказал он."]),
  url: parseUrl("https://Ru.Wikisource.org:443/wiki/A%20B?x=1&y=%D0%AF#top"),
  qp: queryParams("?a=1&b=%D0%AF+%D0%B1&c"),
  q: query({ action: "parse", page: "Герой/СО", n: 2, skip: undefined }),
  resolve: [resolveUrl("https://a.org/x/y/z.html", "../img/p.png"), resolveUrl("https://a.org/x/", "//cdn.b.org/i.png"), resolveUrl("https://a.org/x/y", "/abs?q=1")],
  host: [hostAllowed("https://api.cdnlibs.org/x", ["cdnlibs.org"]), hostAllowed("https://evilcdnlibs.org/", ["cdnlibs.org"])],
  norm: [normalizeText("- Ты  слышишь? - спросила Анна. \"Да\"", "ru"), normalizeText("\"Hello,\" she said. 'It's fine.'", "en")],
  html: parseChapterHtml(
    `<div class="x"><h2>Глава 1</h2><p>Утро было</p><p>тихим. Туман.</p><p class="ads">Реклама</p>` +
    `<p>- Ты слышишь?</p><img src="/i/a.jpg" width="400" height="300"><p style="display:none">скрыто</p>` +
    `<h2>Примечания</h2><p>сноска</p></div>`,
    { lang: "ru", root: { class: "x" }, stopHeading: /^Примечания/, baseUrl: "https://ru.wikisource.org/wiki/X" }),
});
