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
3. The deploy's refusals: `tests/test_tools_deploy.py -k DeployRefuses`, which the outcome's "deploy refuses" check reads.
4. Every native mode, each in its own evidence directory: every mode of `tests/reader_persistence_native.mjs` (`notebook`, `duties`, `sources`, `wakes` and `header` among them), `tests/reader_openings_native.mjs`, and the default and five modes of `tests/reader_native.mjs`. A unit check reads the harnesses and fails when a mode or entry point is added without a step here.
5. The wake replay (below), `--repeats` times (default 2), which the outcome's wake time check reads.

A unit check also holds every machine-read check source in `tools/pipeline/checks.json` to a step here: each is read from its own steps (`SOURCE_STEPS`) and from no other, so a check cannot be seeded that no step produces.

Every step runs with its own `PYTHONPYCACHEPREFIX` and log. A step passes only when it exits 0 and its own report agrees: unittest's `OK` with at least one test, TAP's `# fail 0` and `# cancelled 0` with at least one test, or a harness results file with at least one case, every case passed and the browser closed. One failing step does not stop the others, so one run shows everything; it does fail the run (exit 1).

Chrome for Testing comes from `--chrome`, else `AIM_CHROME_FOR_TESTING`, else the one version under `~/Library/Caches/aim-chrome-for-testing/chrome/`. It refuses when there are none or several.

`--out/summary.json` records the commit, every step's command, exit, counts and log, and whether the checkout was still at that commit and unchanged afterwards. `passed` is true only when every step passed and the checkout did not change. A refused run writes a summary with `refused` and `passed: false`, unless `--out` is the reason, so a refusal never changes the checkout.

The summary also names its `tools` (3.5): the blobs of `tools/release_check.py` and of every harness, the replay tool, its queue and its traffic file, and the Python, Node and Chrome versions. The deploy compares a measure only with a rerun the same tools produced (D32).

- `--only STEP,STEP` runs only those steps. Such a summary is marked `only` and never ships a commit; trials use it.
- `--base --cli LIVE/bin/aim-next --profile P` reads the live release's commit with the live CLI, takes its code from this repository (`git archive`, nothing written to the repository), and reruns the wake replay on it, alternating base and candidate, with this commit's harnesses and traffic. The summary's `base` holds that commit, its tools and its steps.
- `--report OUTCOME --cli … --profile P` (D35, D36) enters the outcome's release ([pipeline.md](pipeline.md#the-release)) into `checks` (its next round, held, when it is already there) and notes after every step the steps so far and the one running, which the outcome page shows beside the live release. A note that cannot be written is printed and changes nothing.

### The wake replay: `tools/wake_replay.py`

`tools/wake_replay.py run --file tests/fixtures/replay/wake-2026-11-05.json --out DIR --code CHECKOUT` replays a captured window of traffic against a fresh copy running CHECKOUT's code: the server, the effects runner and the wake broker, with each routed agent's queue a stand-in (`tools/wake_standin.py`) for the codex app-server that records when each hint arrives. It posts the file's messages on their schedule, with idle gaps longer than 5 s cut and turns kept, reads each agent's work when its wake comes (after the turn the file keeps for it, if any), and writes `replay.json`: per agent the median time from a commit to its wake reaching the queue, the wakes and the offsets of any message whose wake never came (lost, which fails the reading). Everything runs in a temporary directory removed afterwards, and every child is started and waited on by PID.

`tools/wake_replay.py capture --db BACKUP --from ISO --to ISO [--limit N] --out FILE` writes such a file from a read-only copy of a backup: who wrote to whom and when, the topics' participants, the routed agents and any hosted turns, with people named `person-N` and no words. The record keeps no turn spans for broker-routed agents, so the committed file has none: its replay measures the commit-to-queue time with every wake read at once.

For development, `tools/native.py --out DIR STEP [CASE_FILTER]` runs one native step (`journal`, `live`, `colors`, `openings`, `reader-keyboard`, ...) and lists each failed case with its most common failure kinds.

## Deploy: `tools/deploy.py`

```sh
tools/deploy.py --config INSTANCE/deploy.json --release-check EVIDENCE/release-SHA/summary.json SHA EVIDENCE_DIR \
  [--release N] [--live-since TIME] [--no-items] [--dry-run]
```

The deploy ships only a commit the release check passed. `SHA` must be the full 40-character commit, and the summary must name exactly that commit, show every required step passed and the checkout unchanged during the run. A summary that is unreadable, of another commit or of a checkout that changed is recorded in `00-release-check.json` and refused before anything is read. One of this commit whose steps failed is measured first (below) and refused after the checks, before anything stops. Run it from the release-check worktree at `SHA`, so the deploy's list of required steps is that commit's own.

With `outcome` in the config, the deploy measures the summary as a run of that outcome's checks before anything stops ([targets.md](targets.md#what-got-worse)), as `reporter_profile`'s actor through the live CLI: `02-checks` reads the checks, live baseline, allowances, fix topics and release piece (`checks OUTCOME --live SHA`) and refuses a reporter who is the coordinator or not a member, and, when a check reads a replayed measure, a summary whose `base.commit` is not the live head ("the replay was measured beside …, but release N is live; run the release check again"); `02-worse` posts each worse check into its open fix topic or starts one (`post … --operation fix-post-CHECK-SHA12`, `start … --operation fix-CHECK-SHA12`); `02-run` writes the run with `bin/aim-next-admin record-checks --as REPORTER` and notes "Held: … got worse." on the release piece. The verdict follows: anything worse refuses first, then a summary that did not pass. After `02-release`, `03-stage` moves the outcome's release, the one `02-checks` read ([pipeline.md](pipeline.md#the-release)), from `checks` into `deploy`; its gate reads the readings `02-run` linked to that piece, whatever commit the piece was combined with (or none). When the live code keeps no outcome checks, `02-checks.json` says so and keeps the run, which the checks import writes from the release record.

Before stopping anything it also works out the release records it will write (docs/releases.md) and writes them to `02-release.json`. This release's record holds the pipeline items named by `Pipeline:` trailers (the last paragraph, as git reads trailers) in every commit from the live HEAD to `SHA`, merges included and oldest first; each commit and the items it named; the release check's counts; and the release number, one past the latest release. The latest release is found from what the system keeps, so the number is never typed:

- The live instance's records.
- The records the repository keeps at `SHA` in `tools/pipeline/releases/` (releases recorded afterwards, such as 18 and 19), when they are this instance's: it records one of them, or, while it records none, the newest is the live HEAD or one of its ancestors. Those it lacks are written into the instance first, under `before` in `02-release.json`, below or above its own. Together with the instance's records they must be one line: numbers one after another, one commit per number, each commit after the one before; otherwise the deploy refuses.
- When the latest record's commit is not the live HEAD, releases went live without their records (a deploy stopped after the restart, or one was finished by hand). Each commit a server run record (`launch.json`) started after the latest record's commit is one, recorded in the order they started, each at the first time a server started it, so a restart at the same commit is not a release of its own. Its items are those named from the commit before it. The live HEAD is the last; when no run record started it, `--live-since TIME` names when it went live, and the deploy refuses without it. A live HEAD that does not descend from the latest record's commit is refused, and so is a run record that started a commit neither before the latest record's commit nor on the way to the live HEAD, or that started a commit after one it comes before: the releases since the latest record are then recorded by hand (docs/releases.md).
- Only when nothing kept places the live HEAD does `--release N` name the number, which is then the instance's first.

A deploy of the live HEAD itself is a restart: it ships nothing, so it needs neither `--no-items` nor `--release`, and it writes no record of its own, only those the instance lacks (above). `02-release.json` then holds `"record": null` and `restart_of`, the release the live HEAD is (null when nothing records it). Running a deploy again at a commit that went live without its record is such a restart, so that commit is recorded once, from its server's run record.

It refuses, still before stopping anything, when a `Pipeline` trailer does not name item numbers; when no commit names an item, unless `--no-items` says the release ships none; when whether the live code keeps release records, the live release records, those the repository keeps, the commits and their trailers, a server run record, or whether one commit comes before another cannot be read; when a record names an item an earlier release shipped; when `--release` is missing where it is needed or does not follow the latest release, or is given to a restart; when `--live-since` is missing where it is needed or given where a run record already says, or where the live HEAD is recorded; when one commit would be two releases; or when any record would not pass the store's own checks.

It then stops the instance's runner and then its server, by the PIDs their own run records captured, waiting on each exit. The runner runs under its supervisor (`bin/aim-next-runner supervise`, see [effects-runner.md](effects-runner.md)), so the deploy stops the supervisor, which passes the stop on and exits after its runner; a bare runner started before supervision is found and stopped directly. A runner is found by its own arguments (`aim-next-runner --profile … --runner-id … --routes …`), however its interpreter and checkout path are spelled, so one a killed supervisor left behind is seen and refused. It backs up the database with the code that wrote it, fast-forwards the live checkout to `SHA`, runs `bin/aim-next-admin migrate`, restarts the server and waits for its ready line, restarts the runner under its supervisor and waits for the runner to acquire its guard, and then checks the reader, `/api/bootstrap` and the CLI. It writes each record to `release-N.json` in `EVIDENCE_DIR`. When the reader answers 200, the CLI exits 0 and both processes are still running, it writes the records into the instance in order with the new code's `bin/aim-next-admin record-release`, this release's stamped with that moment, and keeps them and each write's result in `11-release.json`. A release that does not verify is not recorded: the refusal says the commit is live and gives the commands that record it once it works (the next deploy also records it, from its server's run record). A record the instance refuses stops the deploy with the release live, and nothing after it is tried; the refusal gives the commands for it and every record after it, which are safe to run again. Each step writes `NN-step.json` into `EVIDENCE_DIR`, and the first failure stops the run (exit 1, `refused: <why>`). It refuses before stopping anything when the live processes are not exactly one server and at most one runner (a supervisor with at most one runner of its own, or one bare runner), matching their run records, or when the live checkout has tracked changes or `SHA` is not a fast-forward of its HEAD. It also stops after the stop step if a runner was running and did not end with `"status": "stopped"`: a paused runner needs a deliberate resume. `--dry-run` writes `00-release-check`, `00-plan`, `01-live`, `02-checkout`, `02-checks` (with an outcome) and `02-release` and changes nothing: it posts nothing and writes no run. It exits 1 when a check got worse or the release check has not passed, after showing the live processes, checkout and checks.

The record is written after the verify, not before the stop, because it states that a commit is live: before the restart the new code, its schema and its admin verb are not there yet, and a deploy that fails after stopping has not put the release live. Everything the records need is read and checked before anything stops, so the only step left at the end is the writes. A release that goes live without its record is not lost: the next deploy finds that the live HEAD is not the latest record's commit and records it first.

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
| `outcome`, `reporter_profile` | optional, together: the outcome whose checks the deploy measures, and the profile of a member who is not its coordinator, who reads them, opens fix topics, writes the run and moves the release piece |

An unknown or missing key is refused. Keep the live config beside the instance it describes, not in the repository.

## Trials: `tools/checks.py trial`

```sh
tools/checks.py trial --cli LIVE/bin/aim-next --profile P --outcome OUTCOME --of SHA --without 34 --revert SHA1[,SHA2] --out DIR
```

A trial asks whether leaving suspects out clears a stopped candidate (D34). It refuses unless SHA is the outcome's candidate with a worse reading not accepted, and every reverted commit lies between the live release and SHA. It clones the repository (`--repo`, this checkout by default) at SHA into a temporary directory, reverts the commits newest first (a conflict refuses), and runs that clone's release check with `--only` the steps the stopped checks read and `--base`. It reports the run with `check-report` as a trial of SHA, `without` the items and the reverted commits, and prints, by the same rule as the deploy, which stopped checks it cleared. The clone is removed whatever happens. The outcome page names the trial with the fewest items left out that clears every stopped check as the likely cause; a stopped check the trial did not read counts as still worse, and checks it did not rerun are not its results. It never posts: the coordinator says what it found in the fix topic.

## Release pipeline page: `tools/pipeline/build_pipeline.py`

```sh
LIVE/bin/aim-next --profile PROFILE --json releases > RECORDS
tools/pipeline/build_pipeline.py --releases RECORDS [OUTPUT]
```

writes the Release pipeline page from `tools/pipeline/items.json`, the edits each revision appends to the script, and the instance's release records (`--releases -` reads them from standard input). An item a release record names is shipped: it leaves its section, and SHIPPED lists each release, newest first, with its items and time; the "Changed" line names the newest. It fails when an item number is missing or listed twice, or when two release records name the same item. Item 84 replaces it with pipeline records in Theseus; until then, edit it here rather than in a temporary copy.
