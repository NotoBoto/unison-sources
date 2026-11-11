// Golden-test host for Android: bare quickjs-ng 0.12.1 built with the NDK, run through adb.
// usage: golden <driver.js> <plugin.js> <case.json>   → prints the output string
// Build (see tests/README.md):
//   $NDK/toolchains/llvm/prebuilt/<host>/bin/aarch64-linux-android26-clang -Os -std=gnu11 -I<quickjs-ng> \
//     -o golden golden.c <quickjs-ng>/{quickjs,libregexp,libunicode,dtoa}.c -lm
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "quickjs.h"

static double deadline_ms;

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static int interrupt(JSRuntime *rt, void *opaque) { return now_ms() > deadline_ms; }

static char *read_file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *b = malloc(n + 1);
    if (fread(b, 1, n, f) != (size_t) n) { fprintf(stderr, "short read %s\n", path); exit(2); }
    b[n] = 0;
    fclose(f);
    return b;
}

static void fail_exception(JSContext *ctx, const char *where) {
    JSValue e = JS_GetException(ctx);
    const char *s = JS_ToCString(ctx, e);
    fprintf(stderr, "%s: %s\n", where, s ? s : "?");
    exit(3);
}

static JSValue eval(JSContext *ctx, const char *code, const char *name) {
    JSValue v = JS_Eval(ctx, code, strlen(code), name, JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(v)) fail_exception(ctx, name);
    return v;
}

int main(int argc, char **argv) {
    if (argc < 4) { fprintf(stderr, "usage: golden driver.js plugin.js case.json\n"); return 1; }
    JSRuntime *rt = JS_NewRuntime();
    JS_SetMemoryLimit(rt, 64 * 1024 * 1024);
    JS_SetMaxStackSize(rt, 256 * 1024);
    deadline_ms = now_ms() + 30000;
    JS_SetInterruptHandler(rt, interrupt, NULL);
    JSContext *ctx = JS_NewContext(rt);

    char *driver = read_file(argv[1]), *bundle = read_file(argv[2]), *cs = read_file(argv[3]);
    JS_FreeValue(ctx, eval(ctx, driver, "driver.js"));
    JS_FreeValue(ctx, eval(ctx, bundle, "plugin.js"));
    JSValue global = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, global, "__case", JS_NewString(ctx, cs));
    JS_FreeValue(ctx, global);
    JS_FreeValue(ctx, eval(ctx, "__runCase(__case)", "case"));

    for (;;) {
        JSContext *c2;
        int r;
        while ((r = JS_ExecutePendingJob(rt, &c2)) > 0) {}
        if (r < 0) fail_exception(c2, "job");
        JSValue done = eval(ctx, "__test.done", "poll");
        int ok = JS_ToBool(ctx, done);
        JS_FreeValue(ctx, done);
        if (ok) break;
        fprintf(stderr, "no pending jobs, but the case did not finish\n");
        return 4;
    }
    JSValue out = eval(ctx, "__test.output", "output");
    size_t len;
    const char *s = JS_ToCStringLen(ctx, &len, out);
    fwrite(s, 1, len, stdout);
    JS_FreeCString(ctx, s);
    JS_FreeValue(ctx, out);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 0;
}
