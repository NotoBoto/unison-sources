"""Golden-test host for Python (the same binding Unison Studio uses): PyPI quickjs-ng==0.12.1.1.

usage: python -I run_case.py <driver.js> <plugin.js> <case.json>   → prints the output string
No Python callbacks are registered (the binding forbids them under set_time_limit, §4): the driver serves fixtures.
"""
import sys
import quickjs

MEMORY = 64 * 1024 * 1024
STACK = 256 * 1024
TIMEOUT_S = 30


def main(driver_path, bundle_path, case_path):
    read = lambda p: open(p, encoding="utf-8").read()
    ctx = quickjs.Context()
    ctx.set_memory_limit(MEMORY)
    ctx.set_max_stack_size(STACK)
    ctx.set_time_limit(TIMEOUT_S)
    ctx.eval(read(driver_path))
    ctx.eval(read(bundle_path))
    ctx.set("__case", read(case_path))
    ctx.eval("__runCase(__case)")
    while True:
        while ctx.execute_pending_job():
            pass
        if ctx.eval("__test.done"):
            sys.stdout.buffer.write(ctx.eval("__test.output").encode("utf-8"))
            return
        if not ctx.execute_pending_job():
            raise SystemExit("no pending jobs, but the case did not finish")


if __name__ == "__main__":
    main(*sys.argv[1:4])
