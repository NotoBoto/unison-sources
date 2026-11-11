// Plugin side of the host bridge (SOURCES_DESIGN.md §4, §19.1).
//
// The host defines, before the bundle:
//   __host_request(id, op, argsJson)   op: "fetch" | "storage.get" | "storage.set" | "log"
//   __host_done(callId, resultJson)    {"ok": result} | {"err": {code, message, url?}}
// The bundle defines, for the host:
//   __host_resolve(id, resultJson), __host_reject(id, errorJson)
//   __unison = { manifest, core: {version}, call(callId, fn, argsJson) }

import type { FetchInit, FetchResponse, Manifest, Plugin, PluginError } from "./types";
import { CORE_VERSION } from "./core/version";

declare const __host_request: (id: number, op: string, argsJson: string) => void;
declare const __host_done: (callId: number, resultJson: string) => void;

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const pending = new Map<number, Pending>();
let seq = 0;

function request<T>(op: string, args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    __host_request(id, op, JSON.stringify(args));
  });
}

const g = globalThis as Record<string, unknown>;
g.__host_resolve = (id: number, json: string) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p.resolve(JSON.parse(json));
};
g.__host_reject = (id: number, json: string) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p.reject(JSON.parse(json));
};

export function fetch(url: string, init: FetchInit = {}): Promise<FetchResponse> {
  return request<FetchResponse>("fetch", [url, init]);
}

export const storage = {
  get<T = unknown>(key: string): Promise<T | null> { return request<T | null>("storage.get", [key]); },
  set(key: string, value: unknown): Promise<null> { return request<null>("storage.set", [key, value]); },
};

export function log(...parts: unknown[]): void {
  const message = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  request("log", ["info", message]).catch(() => undefined);
}

export function fail(code: PluginError["code"], message: string, url?: string): never {
  const e: PluginError = url ? { code, message, url } : { code, message };
  throw e;
}

function toError(e: unknown): PluginError {
  if (e && typeof e === "object" && typeof (e as PluginError).code === "string") {
    const pe = e as PluginError;
    return pe.url ? { code: pe.code, message: String(pe.message), url: pe.url } : { code: pe.code, message: String(pe.message) };
  }
  const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : String(e);
  return { code: "ENGINE", message: msg };
}

const FUNCTIONS = ["popular", "latest", "search", "details", "chapters", "chapter", "filters", "bookIdFromUrl"] as const;

/** Registers the plugin. Call exactly once from the plugin entry file. */
export function definePlugin(manifest: Manifest, plugin: Plugin): void {
  g.__unison = {
    manifest,
    core: { version: CORE_VERSION },
    call(callId: number, fn: string, argsJson: string) {
      Promise.resolve()
        .then(() => {
          if (!(FUNCTIONS as readonly string[]).includes(fn)) fail("NOT_FOUND", `unknown function ${fn}`);
          const f = (plugin as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[fn];
          if (typeof f !== "function") fail("NOT_FOUND", `${manifest.id} has no ${fn}()`);
          return f.apply(plugin, JSON.parse(argsJson));
        })
        .then(
          (ok) => __host_done(callId, JSON.stringify({ ok })),
          (e) => __host_done(callId, JSON.stringify({ err: toError(e) })),
        );
    },
  };
}
