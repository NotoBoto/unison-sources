// ed25519 signing of index.json (SOURCES_DESIGN.md §6, §19.3).
// Keys are raw 32-byte values in base64:
//   private key: env UNISON_SIGNING_KEY (GitHub Actions secret; offline copy kept by the owner)
//   public keys: built into the app and Studio (current + spare)
// Usage:
//   node scripts/sign.mjs keygen              → prints a new key pair (do not commit the private key)
//   node scripts/sign.mjs verify <index.json> <index.json.sig> <publicKeyBase64>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// PKCS#8 / SPKI prefixes for raw ed25519 keys
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const privateKey = (b64) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(b64, "base64")]), format: "der", type: "pkcs8" });
const publicKey = (b64) => crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(b64, "base64")]), format: "der", type: "spki" });

/** Returns the base64 signature of the raw bytes. */
export function signIndex(bytes, privateKeyB64) {
  return crypto.sign(null, bytes, privateKey(privateKeyB64.trim())).toString("base64");
}

export function verifyIndex(bytes, signatureB64, publicKeysB64) {
  const sig = Buffer.from(signatureB64.trim(), "base64");
  return publicKeysB64.some((k) => crypto.verify(null, bytes, publicKey(k.trim()), sig));
}

export function keygen() {
  const { privateKey: pk, publicKey: pub } = crypto.generateKeyPairSync("ed25519");
  const raw = (k, type) => k.export({ format: "der", type }).subarray(-32).toString("base64");
  return { privateKey: raw(pk, "pkcs8"), publicKey: raw(pub, "spki") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "keygen") {
    const k = keygen();
    console.log(`public  (built into the app and Studio): ${k.publicKey}`);
    console.log(`private (GitHub secret UNISON_SIGNING_KEY + offline copy, never commit): ${k.privateKey}`);
  } else if (cmd === "verify") {
    const ok = verifyIndex(fs.readFileSync(a), fs.readFileSync(b, "utf8"), [c]);
    console.log(ok ? "signature OK" : "signature INVALID");
    process.exit(ok ? 0 : 1);
  } else {
    console.error("usage: sign.mjs keygen | verify <index.json> <index.json.sig> <publicKeyBase64>");
    process.exit(2);
  }
}
