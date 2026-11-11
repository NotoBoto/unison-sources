// Pure-JS hashing and encoding: quickjs-ng 0.12.1 has no crypto, atob/btoa or TextEncoder (§4).
// Everything works on UTF-8 bytes so results are identical on every host.

export function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function utf8Decode(b: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 31) << 6) | (b[i++] & 63);
    else if (c < 0xf0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    if (cp > 0xffff) { cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); }
    else s += String.fromCharCode(cp);
  }
  return s;
}

const bytesOf = (x: string | ArrayLike<number>): number[] => (typeof x === "string" ? utf8Encode(x) : Array.from(x));

export function hex(b: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return s;
}

export function fromHex(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.substr(i, 2), 16));
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(x: string | ArrayLike<number>): string {
  const b = bytesOf(x);
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < b.length ? B64[n & 63] : "=");
  }
  return s;
}

export function base64Decode(s: string): number[] {
  const clean = s.replace(/[^A-Za-z0-9+/\-_]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return out;
}

// ---- digests: return byte arrays ----

function words(b: number[], bigEndian: boolean): number[] {
  const len = b.length;
  const padded = b.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  const bitLen = len * 8;
  const lenBytes = [0, 0, 0, Math.floor(bitLen / 2 ** 32) >>> 0, 0, 0, 0, 0];
  const lo = bitLen >>> 0;
  if (bigEndian) {
    const hi = Math.floor(bitLen / 2 ** 32) >>> 0;
    padded.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  } else {
    const hi = lenBytes[3];
    padded.push(lo & 255, (lo >>> 8) & 255, (lo >>> 16) & 255, (lo >>> 24) & 255, hi & 255, (hi >>> 8) & 255, (hi >>> 16) & 255, (hi >>> 24) & 255);
  }
  const w: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    w.push(bigEndian
      ? ((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0
      : (padded[i] | (padded[i + 1] << 8) | (padded[i + 2] << 16) | (padded[i + 3] << 24)) >>> 0);
  }
  return w;
}

const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
const be = (h: number[]) => h.flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
const le = (h: number[]) => h.flatMap((x) => [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255]);

export function sha1(x: string | ArrayLike<number>): number[] {
  const w = words(bytesOf(x), true);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const m = new Array<number>(80);
  for (let i = 0; i < w.length; i += 16) {
    for (let t = 0; t < 16; t++) m[t] = w[i + t];
    for (let t = 16; t < 80; t++) m[t] = rotl(m[t - 3] ^ m[t - 8] ^ m[t - 14] ^ m[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rotl(a, 5) + f + e + k + m[t]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return be([h0, h1, h2, h3, h4]);
}

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256(x: string | ArrayLike<number>): number[] {
  const w = words(bytesOf(x), true);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const m = new Array<number>(64);
  for (let i = 0; i < w.length; i += 16) {
    for (let t = 0; t < 16; t++) m[t] = w[i + t];
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(m[t - 15], 7) ^ rotr(m[t - 15], 18) ^ (m[t - 15] >>> 3);
      const s1 = rotr(m[t - 2], 17) ^ rotr(m[t - 2], 19) ^ (m[t - 2] >>> 10);
      m[t] = (m[t - 16] + s0 + m[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[t] + m[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return be(h);
}

const S_MD5 = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
// Fixed table instead of Math.sin: libm results may differ in the last bits between hosts.
const K_MD5 = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af,
  0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
  0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244, 0x432aff97,
  0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

export function md5(x: string | ArrayLike<number>): number[] {
  const w = words(bytesOf(x), false);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let i = 0; i < w.length; i += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let t = 0; t < 64; t++) {
      let f: number, g: number;
      if (t < 16) { f = (b & c) | (~b & d); g = t; }
      else if (t < 32) { f = (d & b) | (~d & c); g = (5 * t + 1) % 16; }
      else if (t < 48) { f = b ^ c ^ d; g = (3 * t + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * t) % 16; }
      const tmp = d; d = c; c = b;
      b = (b + rotl((a + f + K_MD5[t] + w[i + g]) >>> 0, S_MD5[t])) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return le([a0, b0, c0, d0]);
}

export const crypto = {
  md5: (x: string | ArrayLike<number>) => hex(md5(x)),
  sha1: (x: string | ArrayLike<number>) => hex(sha1(x)),
  sha256: (x: string | ArrayLike<number>) => hex(sha256(x)),
  base64Encode, base64Decode, hex, fromHex, utf8Encode, utf8Decode,
};
