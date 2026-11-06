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
- The command runs with the mutant in place and its own `PYTHONPYCACHEPREFIX`. It kills the mutant only by exiting non-zero and printing a line matching `--killed-by`. The default is a failed assertion: unittest's `FAIL: test_name` line, or `ERR_ASSERTION` from `node:assert`, which both node reporters print. A crash, an exit without such a line, or a test module that cannot load is not a kill: a mutant that breaks the syntax makes `unittest discover` print `FAILED (errors=1)` and `node --test` print `not ok`, with no assertion run.
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
- `--out` is relative, is not a directory, already holds files, or is inside the checkout without being ignored (`work/` is ignored), a native harness is missing, or `node` or Python cannot be run.

Then it runs, one at a time:

1. Python units: `/usr/bin/python3 -m unittest discover -s tests -p 'test_*.py' -v` (`--python` to change).
2. Node units: `node --test --test-reporter=tap tests/*.test.mjs` (`--node` to change).
3. Every native mode, each in its own evidence directory: the ten modes of `tests/reader_persistence_native.mjs`, `tests/reader_openings_native.mjs`, and the default and four modes of `tests/reader_native.mjs`. A unit check reads the harnesses and fails when a mode or entry point is added without a step here.

Every step runs with its own `PYTHONPYCACHEPREFIX` and log. A step passes only when it exits 0 and its own report agrees: unittest's `OK` with at least one test, TAP's `# fail 0` and `# cancelled 0` with at least one test, or a harness results file with at least one case, every case passed and the browser closed. One failing step does not stop the others, so one run shows everything; it does fail the run (exit 1).

Chrome for Testing comes from `--chrome`, else `AIM_CHROME_FOR_TESTING`, else the one version under `~/Library/Caches/aim-chrome-for-testing/chrome/`. It refuses when there are none or several.

`--out/summary.json` records the commit, every step's command, exit, counts and log, and whether the checkout was still at that commit and unchanged afterwards. `passed` is true only when every step passed and the checkout did not change. A refused run writes a summary with `refused` and `passed: false`, unless `--out` is the reason, so a refusal never changes the checkout.

For development, `tools/native.py --out DIR STEP [CASE_FILTER]` runs one native step (`journal`, `live`, `colors`, `openings`, `reader-keyboard`, ...) and lists each failed case with its most common failure kinds.

## Deploy: `tools/deploy.py`

```sh
tools/deploy.py --config INSTANCE/deploy.json --release-check EVIDENCE/release-SHA/summary.json SHA EVIDENCE_DIR \
  [--release N] [--no-items] [--dry-run]
```

The deploy ships only a commit the release check passed. `SHA` must be the full 40-character commit, and the summary must name exactly that commit, show every required step passed and the checkout unchanged during the run. Otherwise it records why in `00-release-check.json` and refuses before reading or stopping anything. Run it from the release-check worktree at `SHA`, so the deploy's list of required steps is that commit's own.

Before stopping anything it also works out the release record it will write (docs/releases.md) and writes it to `02-release.json`: the pipeline items named by `Pipeline:` lines in every commit from the live HEAD to `SHA`, merges included and oldest first; each commit and the items it named; the release check's counts; and the release number, one past the newest the live instance records. It refuses, still before stopping anything, when a `Pipeline:` line does not name item numbers; when no commit names an item, unless `--no-items` says the release ships none; when the live release records cannot be read; when the instance records no release yet and `--release` does not name this one's number; when `--release` does not follow the newest recorded; or when the record would not pass the store's own checks.

It then stops the instance's runner and then its server, by the PIDs their own run records captured, waiting on each exit. It backs up the database with the code that wrote it, fast-forwards the live checkout to `SHA`, runs `bin/aim-next-admin migrate`, restarts the server and waits for its ready line, restarts the runner and waits for it to acquire its guard, and then checks the reader, `/api/bootstrap` and the CLI. When the reader answers 200, the CLI exits 0 and both processes are still running, it writes the release record into the instance with the new code's `bin/aim-next-admin record-release`, stamped with that moment, and keeps the same record in `11-release.json` (and `release-record.json`, the file it handed the verb). A release that does not verify is not recorded. A record the instance refuses stops the deploy with the release live and the exact command to record it; that command is safe to run again. Each step writes `NN-step.json` into `EVIDENCE_DIR`, and the first failure stops the run (exit 1, `refused: <why>`). It refuses before stopping anything when the live processes are not exactly one server and at most one runner, matching their run records, or when the live checkout has tracked changes or `SHA` is not a fast-forward of its HEAD. It also stops after the stop step if the runner did not end with `"status": "stopped"`: a paused runner needs a deliberate resume. `--dry-run` writes `00-release-check`, `00-plan`, `01-live`, `02-checkout` and `02-release` and changes nothing; it exits 1 when the release check has not passed, after showing the live processes and checkout.

The record is written after the verify, not before the stop, because it states that a commit is live: before the restart the new code, its schema and its admin verb are not there yet, and a deploy that fails after stopping has not put the release live. Everything the record needs is read and checked before anything stops, so the only step left at the end is the write itself.

The config is a JSON object. Paths for profiles and routes are relative to `instance` unless absolute:

| key | meaning |
| --- | --- |
| `live` | absolute path of the live checkout the server and runner run from |
| `instance` | absolute instance directory, holding `data.sqlite3`, `run-server-NN/`, `run-runner-NN/` and `backups/` |
| `server_profile` | the server's profile; the backup, migration and CLI check use it too |
| `port` | the server's loopback port |
| `tailnet_origin` | optional; passed to the server as `--tailnet-origin` |
| `runner_profile`, `runner_id`, `routes` | the runner's profile, `--runner-id` and routes file |
| `python` | optional; absolute interpreter, default `/usr/bin/python3` |

An unknown or missing key is refused. Keep the live config beside the instance it describes, not in the repository.

## Release pipeline page: `tools/pipeline/build_pipeline.py`

`tools/pipeline/build_pipeline.py [OUTPUT]` writes the hand-written Release pipeline page from `tools/pipeline/items.json` and the edits each revision appends to the script. It fails when an item number is missing or listed twice. Item 84 replaces it with pipeline records in Theseus; until then, edit it here rather than in a temporary copy.
