// Test hosts in Node: quickjs-ng 0.12.1 (wasm, same engine as the app and Studio) and V8 (reference).
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import vm from "node:vm";

// The same limits as the app and Studio (§4). Stack above 256 KB crashes the wasm host itself.
export const LIMITS = { memoryBytes: 64 * 1024 * 1024, stackBytes: 256 * 1024, timeoutMs: 30000 };

let modulePromise;
const qjsModule = () => (modulePromise ??= newQuickJSWASMModuleFromVariant(variant));

/** Runs driver + bundle + case on quickjs-ng; returns the output string. */
export async function runQjs(driver, bundle, caseJson) {
  const Q = await qjsModule();
  const rt = Q.newRuntime();
  rt.setMemoryLimit(LIMITS.memoryBytes);
  rt.setMaxStackSize(LIMITS.stackBytes);
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + LIMITS.timeoutMs));
  const ctx = rt.newContext();
  try {
    const ev = (code, name) => {
      const r = ctx.evalCode(code, name);
      if (r.error) { const e = ctx.dump(r.error); r.error.dispose(); throw new Error(`${name}: ${JSON.stringify(e)}`); }
      const v = ctx.dump(r.value); r.value.dispose(); return v;
    };
    ev(driver, "driver.js");
    ev(bundle, "plugin.js");
    ev(`__runCase(${JSON.stringify(caseJson)})`, "case");
    for (;;) {
      const j = rt.executePendingJobs();
      if (j.error) { const e = ctx.dump(j.error); j.error.dispose(); throw new Error("job: " + JSON.stringify(e)); }
      if (ev("__test.done", "poll")) return ev("__test.output", "output");
      if (j.value === 0) throw new Error("no pending jobs, but the case did not finish");
    }
  } finally {
    ctx.dispose();
    rt.dispose();
  }
}

/** Same on V8 (node:vm), as a reference: differences here point at engine-specific behaviour. */
export async function runV8(driver, bundle, caseJson) {
  const ctx = vm.createContext({});
  vm.runInContext(driver, ctx, { filename: "driver.js" });
  vm.runInContext(bundle, ctx, { filename: "plugin.js" });
  vm.runInContext(`__runCase(${JSON.stringify(caseJson)})`, ctx);
  for (let i = 0; i < 100000; i++) {
    if (ctx.__test.done) return ctx.__test.output;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error("V8 case did not finish");
}
