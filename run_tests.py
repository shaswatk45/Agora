"""Run the full test suite without needing pytest installed.

    py -3.12 run_tests.py

(If pytest is available, `py -3.12 -m pytest` works too.)
"""
import importlib.util
import os
import sys
import traceback

_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_ROOT, "src"))
TESTS = os.path.join(_ROOT, "tests")

passed = failed = 0
for fname in sorted(os.listdir(TESTS)):
    if not (fname.startswith("test_") and fname.endswith(".py")):
        continue
    spec = importlib.util.spec_from_file_location(fname[:-3], os.path.join(TESTS, fname))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name in sorted(dir(mod)):
        if name.startswith("test_") and callable(getattr(mod, name)):
            try:
                getattr(mod, name)()
                print(f"  ok   {fname}::{name}"); passed += 1
            except Exception:
                print(f"  FAIL {fname}::{name}"); traceback.print_exc(); failed += 1

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
