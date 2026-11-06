# Tools

The tools under `tools/` check a commit, prove a check catches what it claims to, and deploy a checked commit. They use CPython 3.9 (`/usr/bin/python3`) and the standard library only, and each one's checks are in `tests/test_tools_*.py`. None of them names a machine path: the instance, profiles and browser come from arguments or a config file.

## Mutant helper: `tools/mutant.py`

A check is load-bearing only if it fails when the behaviour it covers is broken. The helper breaks it, runs the check, and puts it back:

```sh
tools/mutant.py --name drop-guard \
  --replace aim_next/marks.py 'if not pending:' 'if False:' \
  -- /usr/bin/python3 -m unittest tests.test_marks
```

- Each `OLD` must occur exactly once in its file, or nothing changes (exit 2). `--replace` can repeat; replacements in one file apply in order.
- The command runs with the mutant in place and its own `PYTHONPYCACHEPREFIX`. It kills the mutant only by exiting non-zero and printing a line matching `--killed-by` (default: unittest's `FAILED`, TAP's `not ok`, or node's `✖`). A crash or an exit without such a line is not a kill.
- The files are written back byte for byte, even when the run is interrupted, and the command runs again as a control with a fresh `PYTHONPYCACHEPREFIX`. It must pass.
- Exit 0: killed, restored, control passed. Exit 1: the mutant survived or the control failed. `verdict.json`, `mutant.log` and `control.log` are in `--evidence` (default: a new temporary directory), with a copy of each original file.

Run it in a worktree that nobody else is editing, since restoring writes the files back as they were when it started.

## Release check: `tools/release_check.py`

The release check speaks for one commit: the HEAD of the checkout the tool lives in.

```sh
git worktree add ~/aim-worktrees/release-check <commit>
~/aim-worktrees/release-check/tools/release_check.py --out ~/aim-worktrees/evidence/release-<commit>
```

It refuses (exit 2) before running anything when:

- the checkout has tracked or untracked changes, so a result would not speak for its commit;
- any directory above the checkout is writable by anyone, such as `/private/tmp`, where `tests/test_codex_broker.py` refuses its parents;
- `--out` is relative or already holds files, a native harness is missing, or `node` or Python cannot be run.

Then it runs, one at a time:

1. Python units: `/usr/bin/python3 -m unittest discover -s tests -p 'test_*.py' -v` (`--python` to change).
2. Node units: `node --test --test-reporter=tap tests/*.test.mjs` (`--node` to change).
3. Every native mode, each in its own evidence directory: the ten modes of `tests/reader_persistence_native.mjs`, `tests/reader_openings_native.mjs`, and the default and four modes of `tests/reader_native.mjs`. A unit check reads the harnesses and fails when a mode or entry point is added without a step here.

Every step runs with its own `PYTHONPYCACHEPREFIX` and log. A step passes only when it exits 0 and its own report agrees: unittest's `OK` with at least one test, TAP's `# fail 0` and `# cancelled 0` with at least one test, or a harness results file with at least one case, every case passed and the browser closed. One failing step does not stop the others, so one run shows everything; it does fail the run (exit 1).

Chrome for Testing comes from `--chrome`, else `AIM_CHROME_FOR_TESTING`, else the one version under `~/Library/Caches/aim-chrome-for-testing/chrome/`. It refuses when there are none or several.

`--out/summary.json` records the commit, every step's command, exit, counts and log, and whether the checkout was still at that commit and unchanged afterwards. `passed` is true only when every step passed and the checkout did not change. A refused run writes a summary with `refused` and `passed: false`.

For development, `tools/native.py --out DIR STEP [CASE_FILTER]` runs one native step (`journal`, `live`, `colors`, `openings`, `reader-keyboard`, ...) and lists each failed case with its most common failure kinds.
