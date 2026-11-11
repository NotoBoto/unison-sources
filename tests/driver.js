// Golden-test driver. Every test host evaluates, in this order:
//   1. this file;  2. the plugin bundle;  3. `__runCase(<case JSON string>)`
// and then runs pending jobs until `__test.done` is true and reads `__test.output`.
// The driver plays the host side of the bridge (§19.1) from recorded fixtures, so hosts need no callbacks
// at all: the same code runs on quickjs-ng in Node (wasm), Python (PyPI), Android (NDK) and on V8.
globalThis.__test = { done: false, output: null };
(function () {
  var fixtures = {};
  var store = {};
  var missing = [];
  var logs = [];
  var waiters = {};

  function reply(id, ok, value) {
    Promise.resolve().then(function () {
      if (ok) __host_resolve(id, JSON.stringify(value));
      else __host_reject(id, JSON.stringify(value));
    });
  }

  globalThis.__host_request = function (id, op, argsJson) {
    var args = JSON.parse(argsJson);
    if (op === "fetch") {
      var r = fixtures[args[0]];
      if (!r) { missing.push(args[0]); return reply(id, false, { code: "FIXTURE_MISSING", message: args[0] }); }
      return reply(id, true, { status: r.status, headers: r.headers || {}, text: r.text, url: args[0] });
    }
    if (op === "storage.get") return reply(id, true, Object.prototype.hasOwnProperty.call(store, args[0]) ? store[args[0]] : null);
    if (op === "storage.set") { store[args[0]] = args[1]; return reply(id, true, null); }
    if (op === "log") { logs.push(String(args[1])); return reply(id, true, null); }
    return reply(id, false, { code: "ENGINE", message: "unknown op " + op });
  };

  globalThis.__host_done = function (callId, json) {
    var w = waiters[callId];
    delete waiters[callId];
    if (w) w(json);
  };

  globalThis.__runCase = function (caseJson) {
    var input = JSON.parse(caseJson);
    fixtures = input.fixtures || {};
    var results = [];
    var i = 0;
    function next() {
      if (i >= input.calls.length) {
        __test.output = JSON.stringify({ manifest: __unison.manifest, core: __unison.core, results: results, missing: missing }, null, 1);
        __test.done = true;
        return;
      }
      var c = input.calls[i];
      var callId = ++i;
      new Promise(function (res) {
        waiters[callId] = res;
        __unison.call(callId, c.fn, JSON.stringify(c.args));
      }).then(function (json) {
        results.push({ fn: c.fn, args: c.args, result: JSON.parse(json) });
        next();
      });
    }
    next();
  };
})();
