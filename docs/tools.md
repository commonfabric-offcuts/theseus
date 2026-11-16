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
- Every mutated file must be in one git checkout (or, outside git, one folder); otherwise nothing changes (exit 2).

Run it in a worktree that nobody else is editing, since restoring writes the files back as they were when it started.

### What a reviewer gets

A reviewer can check each kill against the exact revision it ran on, without trusting the author's description. That needs a commit: make the evidence a reviewer will verify on a clean checkout of the commit under review.

- `verdict.json` records `revision`: the checkout's root, `git_dir` (the repository's own directory, a worktree's common one, which stays when the worktree is removed), its `commit` and `dirty`, git's porcelain listing of uncommitted and untracked changes when the mutant ran (all three `null` outside git). `replacements` lists each `OLD` and `NEW` in order, by path in that checkout, and `hashes` gives each file's sha256 as it was, as mutated, and as restored.
- `mutant.patch` is the change as a unified diff.
- `checkout/` is the tree the mutant ran in, kept until review: the recorded commit (by `git archive`), with the uncommitted changes and untracked files copied over, deleted files removed and the mutant applied. Ignored files are not in it. Running the same command there shows the kill again.
- `tools/mutant.py --verify EVIDENCE` checks the kill against the recorded commit, which it reads from `git_dir`, so it works after the worktree is gone. It requires that the verdict shows a kill (killed, restored, control passed, and its failed line is in `mutant.log`), with a hash for every mutated file; that the tree was clean; that each copy of an original hashes as recorded and is the file at the commit; that each recorded replacement occurs once and turns it into the recorded mutant; and that the kept checkout is exactly the commit (as `git archive` gives it) with only the mutant applied. Exit 0 when all hold. Exit 1 names each one that does not, including a run on uncommitted changes or outside git (no commit holds what ran) and a repository that can no longer be read.
- `tools/mutant.py --reviewed EVIDENCE` removes `checkout/` once the review is done and records `checkout_removed_at` in the verdict. The verdict, patch, logs and original copies stay.

A run that reuses an evidence directory replaces its verdict and its checkout.

## Act ledger: `tools/acts.py`

A release's acts, and the check that holds each one, are listed in
`tests/acts.json`. Each row names the pipeline item, the act in a person's
words, a break (one or more `[file, OLD, NEW]` replacements that stop the act
where the code does it) and its check: `{"node": "tests/x.test.mjs"}`,
`{"python": "test_x.py"}`, or a browser mode and case filter,
`{"native": "reading", "case": "reading 👍 in the Reader"}`.

```sh
tools/acts.py tests/acts.json --evidence /abs/dir [--only REGEX]
```

Each row goes through `tools/mutant.py`: a unit check must fail on an
assertion, and a browser case on a `FAILED` line from `tools/native.py`, which
gets a fresh output folder for the mutant and for its control. One line per
act says caught (with the failing line), SURVIVED, or refused (its break no
longer applies). Exit 0 only when every act chosen was caught. `--only`
chooses the acts whose item number or words match. Each act's evidence is in
its own folder under `--evidence`. Run it under `heavy-run --browser` when a
browser case is chosen.

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
3. The deploy's refusals: the `DeployRefuses` classes of `tests/test_tools_deploy.py` and every test of `tests/test_tools_train.py`, the merged train the deploy may take in place of a summary (`-p 'test_tools_*.py' -k test_tools_deploy.DeployRefuses -k test_tools_train.`), which the outcome's "deploy refuses" check reads.
4. Every native mode, each in its own evidence directory: every mode of `tests/reader_persistence_native.mjs` (`notebook`, `duties`, `sources`, `wakes`, `header` and `health` among them), `tests/reader_openings_native.mjs`, the default and five modes of `tests/reader_native.mjs`, and the seven modes of `tests/webkit_native.mjs` that run checks again in Safari's engine, the phone check page and the New line among them ([device-evidence.md](device-evidence.md)). A unit check reads the harnesses and fails when a mode or entry point is added without a step here.
5. The wake replay (below), `--repeats` times (default 1), which the outcome's wake time check reads.

One replay takes about 16 minutes, so the release check of a combined release runs it once. Two (`--repeats 2`) are needed when the summary will be compared against a rule that asks for two: an outcome's wake time check with `repeats` 2 (as `tools/pipeline/checks.json` seeds it), when the deploy measures that outcome (`outcome` in its config), or to decide whether a slower reading is real, since a measure is worse only when every run is worse than every base run (D29). The deploy refuses a summary whose replay ran fewer times than a replayed check asks, before it tells anything or stops anything, and a trial runs the replay as many times as the stopped check asks.

### Skipping what a change cannot reach: `--live COMMIT`

`--live` names the live release's commit. When no path changed between it and HEAD is one the browser modes or the wake replay could see, the release check skips all of them (every `native-*` step and `wake-replay`) and runs the units and the deploy's refusals. Those steps run a server from the checkout's code and drive it with harnesses, so the rule is kept on the paths changed, never on a label. A changed path they could see (`seen()`) is any path outside `docs/`, `tools/` and `tests/` (so any change in `web/`, `aim_next/` or `bin/` runs everything, and so does a top-level file); a file they run (a native harness, the replay, its stand-in and traffic, `tools/release_check.py` itself) and a `tools/` module those import; and any file in `tests/` except a Python unit module (`tests/test_*.py`) or node unit module (`tests/*.test.mjs`) that no harness names (`tests/reader_fixture.py` imports `test_store`, so a change to `tests/test_store.py` runs everything). Deleted and renamed paths count on both sides. When git cannot say what changed, the check refuses rather than run or skip anything. `--live` and `--only` are refused together.

The summary says what it skipped and why, in `skipped` (`steps`, `live`, `changed`, `why`: "… they were not run: N steps skipped, not passed."), and the skipped steps are not in `steps`, so no reader counts them as passed. When `--live` is given and a seen path changed, `ran_all` names those paths. The release record of such a release keeps `skipped` in its measurements beside empty browser counts.

A summary with `skipped` is not a passed release check to anything but the deploy, which reads the live checkout's HEAD and the paths changed from it to `SHA` itself and takes the summary only when that HEAD is the summary's `live` and none of those paths could be seen. Otherwise it refuses before anything is read further ("… skipped the browser modes and the wake replay beside the live commit …, but X changed since then, which they could see"). A deploy that measures an outcome refuses every such summary, since the outcome's checks read every step.

A unit check also holds every machine-read check source in `tools/pipeline/checks.json` to a step here: each is read from its own steps (`SOURCE_STEPS`) and from no other, so a check cannot be seeded that no step produces.

In the native harness most modes run in (`tests/reader_persistence_native.mjs`, `navigation` among them), every call to the browser and to its fixture has a bound, set in one place, `tests/native-calls.mjs`: 10 s for a browser command; 60 s for a screenshot, which is answered only once the browser has drawn the page's next frame and which a busy runner's GPU can hold past ten seconds; and 60 s for a fixture control, a view read from the fixture's server, and Chrome's and the fixture's exits. A call with no answer by then fails the case it is in, naming the method and the page it was sent to (`CDP timed out: Page.captureScreenshot on page creation-departure, no answer in 60 s`). It is never sent again, and an answer that comes later is dropped. A page or browser context that will not close at the end of a case fails that case the same way, naming each one (`cleanup: closing page …`), the rest of its cleanup still runs, and the next case runs in a fresh context of its own; a case that arranges such a refusal on purpose names it (`cleanupRefuses`), and it is kept on that case's record as `cleanupRefused`. A teardown step that fails is listed under `teardown` in `native.json`, which is written all the same. The step's own cases check each of these on a real browser and fixture on every run: `navigation harness a page that stops answering …` makes a page stop answering mid-call; `navigation harness cleanup refused: …` gives a case a page and a context that will not close, and the case after it finds both named and the page after them closed; `navigation harness a fixture control and a view that get no answer …` leaves a control unanswered and holds a view's read, each through the harness's own `control()` and `view()`, with the bound lowered for that one call. The teardown's bounds, Chrome's exit and the fixture's, are held by `tests/native_calls.test.mjs`.

That harness writes two lines per case to the step's log: `{"case": NAME, "started": TIME}` the moment the case starts, written synchronously so that it survives a cancelled run, and the case's result with `started` and `finished` added once its cleanup is done. A run cancelled mid-case, as a job's time limit cancels one, leaves that case's start line with no result after it, so the log alone says which case was running and since when. The release check holds every step of that harness to these lines: a step passes only when its log has, for each case in `native.json` and in its order, the start line and then that case's result as `native.json` has it with the same `started` and a `finished` no earlier, and no other case lines (`case_lines` in `tools/release_check.py`; `tools/native.py` lists what is missing as `FAILED case lines: …`). The case `navigation harness case lines: …` sees its own start line already written when it begins.

Every step runs with its own `PYTHONPYCACHEPREFIX` and log. A step passes only when it exits 0 and its own report agrees: unittest's `OK` with at least one test, TAP's `# fail 0` and `# cancelled 0` with at least one test, or a harness results file with at least one case, every case passed and the browser closed. One failing step does not stop the others, so one run shows everything; it does fail the run (exit 1).

Chrome for Testing comes from `--chrome`, else `AIM_CHROME_FOR_TESTING`, else the one version under `~/Library/Caches/aim-chrome-for-testing/chrome/`. It refuses when there are none or several. The WebKit modes load playwright-core from `--playwright`, else `AIM_PLAYWRIGHT_CORE`, else the one version under `~/Library/Caches/deno/npm/registry.npmjs.org/playwright-core/`; it refuses when there are none or several, or the directory is not playwright-core.

`--out/summary.json` records the commit, every step's command, exit, counts and log, and whether the checkout was still at that commit and unchanged afterwards. `passed` is true only when every step it ran passed and the checkout did not change; a run that skipped steps says so in `skipped` (above). A refused run writes a summary with `refused` and `passed: false`, unless `--out` is the reason, so a refusal never changes the checkout.

The summary also names its `tools` (3.5): the blobs of `tools/release_check.py` and of every harness, the replay tool, its queue and its traffic file, and the Python, Node and Chrome versions. The deploy compares a measure only with a rerun the same tools produced (D32).

- `--only STEP,STEP` runs only those steps. Such a summary is marked `only` and never ships a commit; trials use it.
- `--base --cli LIVE/bin/aim-next --profile P` reads the live release's commit with the live CLI, takes its code from this repository (`git archive`, nothing written to the repository), and reruns the wake replay on it, alternating base and candidate, with this commit's harnesses and traffic. The summary's `base` holds that commit, its tools and its steps.
- `--report OUTCOME --cli … --profile P` (D35, D36) enters the outcome's release ([pipeline.md](pipeline.md#the-release)) into `checks` (its next round, held, when it is already there) and notes after every step the steps so far and the one running, which the outcome page shows beside the live release. A note that cannot be written is printed and changes nothing.

### The wake replay: `tools/wake_replay.py`

`tools/wake_replay.py run --file tests/fixtures/replay/wake-2026-11-05.json --out DIR --code CHECKOUT` replays a captured window of traffic against a fresh copy running CHECKOUT's code: the server, the effects runner and the wake broker, with each routed agent's queue a stand-in (`tools/wake_standin.py`) for the codex app-server that records when each hint arrives. It posts the file's messages on their schedule, with idle gaps longer than 5 s cut and turns kept, reads each agent's work when its wake comes (after the turn the file keeps for it, if any), and writes `replay.json`: per agent the median time from a commit to its wake reaching the queue, the wakes and the offsets of any message whose wake never came (lost, which fails the reading). Everything runs in a temporary directory removed afterwards, and every child is started and waited on by PID.

`tools/wake_replay.py capture --db BACKUP --from ISO --to ISO [--limit N] --out FILE` writes such a file from a read-only copy of a backup: who wrote to whom and when, the topics' participants, the routed agents and any hosted turns, with people named `person-N` and no words. The record keeps no turn spans for broker-routed agents, so the committed file has none: its replay measures the commit-to-queue time with every wake read at once.

For development, `tools/native.py --out DIR STEP [CASE_FILTER]` runs one native step (`journal`, `live`, `colors`, `openings`, `reader-keyboard`, `webkit-device`, ...) and lists each failed case with its most common failure kinds. It takes `--playwright` as the release check does.

## Deploy: `tools/deploy.py`

```sh
tools/deploy.py --config INSTANCE/deploy.json --release-check EVIDENCE/release-SHA/summary.json SHA EVIDENCE_DIR \
  [--release N] [--live-since TIME] [--no-items] [--known-reds FILE] [--dry-run]
tools/deploy.py --config INSTANCE/deploy.json --train TRAIN.json MERGE_COMMIT EVIDENCE_DIR [--release N] [--live-since TIME] [--no-items] [--dry-run]
```

The deploy ships only a commit that was checked: one the release check passed, or the merge commit of a train merged into the release branch, which GitHub judges (below, "A merged train"). `SHA` must be the full 40-character commit, and the summary must name exactly that commit, show every required step passed and the checkout unchanged during the run. A summary that skipped the browser modes and the wake replay (`--live`, above) is taken only for a change whose paths since the live HEAD, read by the deploy itself, none of them could see, and never with an `outcome`; `00-release-check.json` keeps its `skipped` words. A summary that is unreadable, of another commit or of a checkout that changed is recorded in `00-release-check.json` and refused before anything is read. One of this commit whose steps failed is measured first (below) and refused after the checks, before anything stops, unless every failure in it is a known red (below). Run it from the release-check worktree at `SHA`, so the deploy's list of required steps is that commit's own.

With `outcome` in the config, the deploy measures the summary as a run of that outcome's checks before anything stops ([targets.md](targets.md#what-got-worse)), as `reporter_profile`'s actor through the live CLI: `02-checks` reads the checks, live baseline, allowances, fix topics and release piece (`checks OUTCOME --live SHA`) and refuses a reporter who is the coordinator or not a member, and, when a check reads a replayed measure, a summary whose `base.commit` is not the live head ("the replay was measured beside …, but release N is live; run the release check again"); `02-worse` posts each worse check into its open fix topic or starts one (`post … --operation fix-post-CHECK-SHA12`, `start … --operation fix-CHECK-SHA12`); `02-run` writes the run with `bin/aim-next-admin record-checks --as REPORTER` and notes "Held: … got worse." on the release piece. The verdict follows: anything worse refuses first, then a summary that did not pass. After `02-release`, `03-stage` moves the outcome's release, the one `02-checks` read ([pipeline.md](pipeline.md#the-release)), from `checks` into `deploy`; its gate reads the readings `02-run` linked to that piece, whatever commit the piece was combined with (or none). When the live code keeps no outcome checks, `02-checks.json` says so and keeps the run, which the checks import writes from the release record.

Before stopping anything it also works out the release records it will write (docs/releases.md) and writes them to `02-release.json`. This release's record holds the pipeline items named by `Pipeline:` trailers (the last paragraph, as git reads trailers) in every commit from the live HEAD to `SHA`, merges included and oldest first; each commit and the items it named; the release check's counts; and the release number, one past the latest release. The latest release is found from what the system keeps, so the number is never typed:

- The live instance's records.
- The records the repository keeps at `SHA` in `tools/pipeline/releases/` (releases recorded afterwards, such as 18 and 19), when they are this instance's: it records one of them, or, while it records none, the newest is the live HEAD or one of its ancestors. Those it lacks are written into the instance first, under `before` in `02-release.json`, below or above its own. Together with the instance's records they must be one line: numbers one after another, one commit per number, each commit after the one before; otherwise the deploy refuses.
- When the latest record's commit is not the live HEAD, releases went live without their records (a deploy stopped after the restart, or one was finished by hand). Each commit a server run record (`launch.json`) started after the latest record's commit is one, recorded in the order they started, each at the first time a server started it, so a restart at the same commit is not a release of its own. Its items are those named from the commit before it. The live HEAD is the last; when no run record started it, `--live-since TIME` names when it went live, and the deploy refuses without it. A live HEAD that does not descend from the latest record's commit is refused, and so is a run record that started a commit neither before the latest record's commit nor on the way to the live HEAD, or that started a commit after one it comes before: the releases since the latest record are then recorded by hand (docs/releases.md).
- Only when nothing kept places the live HEAD does `--release N` name the number, which is then the instance's first.

A deploy of the live HEAD itself is a restart: it ships nothing, so it needs neither `--no-items` nor `--release`, and it writes no record of its own, only those the instance lacks (above). `02-release.json` then holds `"record": null` and `restart_of`, the release the live HEAD is (null when nothing records it). Running a deploy again at a commit that went live without its record is such a restart, so that commit is recorded once, from its server's run record.

It refuses, still before stopping anything, when a `Pipeline` trailer does not name item numbers; when no commit names an item, unless `--no-items` says the release ships none; when whether the live code keeps release records, the live release records, those the repository keeps, the commits and their trailers, a server run record, or whether one commit comes before another cannot be read; when a record names an item an earlier release shipped; when `--release` is missing where it is needed or does not follow the latest release, or is given to a restart; when `--live-since` is missing where it is needed or given where a run record already says, or where the live HEAD is recorded; when one commit would be two releases; or when any record would not pass the store's own checks.

It then stops the instance's runner and then its server, by the PIDs their own run records captured, waiting on each exit. The runner runs under its supervisor (`bin/aim-next-runner supervise`, see [effects-runner.md](effects-runner.md)), so the deploy stops the supervisor, which passes the stop on and exits after its runner; a bare runner started before supervision is found and stopped directly. A runner is found by its own arguments (`aim-next-runner --profile … --runner-id … --routes …`), however its interpreter and checkout path are spelled, so one a killed supervisor left behind is seen and refused. It backs up the database with the code that wrote it, fast-forwards the live checkout to `SHA`, runs `bin/aim-next-admin migrate`, restarts the server and waits for its ready line, restarts the runner under its supervisor and waits for the runner to acquire its guard, and then checks the reader, `/api/bootstrap` and the CLI. It writes each record to `release-N.json` in `EVIDENCE_DIR`. When the reader answers 200, the CLI exits 0 and both processes are still running, it writes the records into the instance in order with the new code's `bin/aim-next-admin record-release`, this release's stamped with that moment, and keeps them and each write's result in `11-release.json`. A release that does not verify is not recorded: the refusal says the commit is live and gives the commands that record it once it works (the next deploy also records it, from its server's run record). A record the instance refuses stops the deploy with the release live, and nothing after it is tried; the refusal gives the commands for it and every record after it, which are safe to run again. Each step writes `NN-step.json` into `EVIDENCE_DIR`, and the first failure stops the run (exit 1, `refused: <why>`). It refuses before stopping anything when the live processes are not exactly one server and at most one runner (a supervisor with at most one runner of its own, or one bare runner), matching their run records, or when the live checkout has tracked changes or `SHA` is not a fast-forward of its HEAD. It also stops after the stop step if a runner was running and did not end with `"status": "stopped"`: a paused runner needs a deliberate resume. `--dry-run` writes `00-release-check`, `00-plan`, `01-live`, `02-checkout`, `02-checks` (with an outcome) and `02-release` and changes nothing: it posts nothing and writes no run. It exits 1 when a check got worse or the release check has not passed, after showing the live processes, checkout and checks.

The restarted server serves the new release as a new build (`aim_next/web_build.py`). A page a person opened on the old release keeps its modules until its next move, which loads the place on the new build, or, while its writing is not yet safe or has changed as the move waited, stays and says "Theseus updated." with Reload ([rails.md](rails.md#one-build-per-document)).

The record is written after the verify, not before the stop, because it states that a commit is live: before the restart the new code, its schema and its admin verb are not there yet, and a deploy that fails after stopping has not put the release live. Everything the records need is read and checked before anything stops, so the only step left at the end is the writes. A release that goes live without its record is not lost: the next deploy finds that the live HEAD is not the latest record's commit and records it first.

### A merged train: `--train FILE`

A train is a pull request that merges approved heads into the release branch the config names (`release_branch`, on GitHub). GitHub's hosted runners judge it: the Checks workflow produces the evidence and the Verdict check reads it. For an ordinary item the hosted judgment comes after the merge, so the deploy takes the merged train in place of a local release check, and its record says the judgment is pending until it lands. `FILE` is an absolute path to a JSON object:

```json
{"pr": 31, "merge_commit": "FULL_SHA", "merged_tree": "FULL_TREE", "kind": "ordinary",
 "items": [{"item": 481, "approved_head": "FULL_SHA", "review": "m-… or the review round"}],
 "hosted_run": null,
 "judgment": null}
```

`kind` is `ordinary` or `judged-first`. `hosted_run` is the id of the Checks run on the merged head once GitHub lists it, or `null` until then: the deploy never waits for it. `judgment` is `null` or `{"producer_runs": [RUN_ID], "verdict_checks": [CHECK_RUN_ID], "audit": "m-…"}`: the workflow runs that produced the evidence, the check runs that gave the verdict, and the message that audited them.

Before it lists a process, the deploy reads each fact again, from the live checkout's git and from GitHub through `gh api` (GET only, `repository` in the config), and refuses at `00-train`, with one line naming the first fact that does not hold or could not be read ("train: …; nothing was stopped"). A read that fails refuses: it is not an answer.

1. The file is well formed: exactly those keys, a pull request number, full object names, at least one item with its approved head and review.
2. `SHA` is the train's `merge_commit`: the deploy ships the merge commit, nothing else.
3. The merge commit is on `release_branch` as GitHub holds it now: GitHub's compare of the merge commit with the branch (`repos/REPOSITORY/compare/MERGE...BRANCH`) says the branch's tip is the merge commit or follows it (`identical` or `ahead`, none behind), with the merge commit as their merge base. The live checkout's `refs/remotes/origin/BRANCH` is not read: it is only what its last fetch saw, so a branch force-pushed since then without the merge would still seem to hold it. The merge commit itself must be in the live checkout (fetch it before the deploy), or reading its tree refuses.
4. Every approved head is the merge commit or one of its ancestors.
5. The merge commit's tree is `merged_tree`.
6. The merge commit is the pull request's own merge: it has two parents, and GitHub's `pulls/PR` says the pull request is merged into `release_branch`, names this commit as its `merge_commit_sha`, and names the commit's second parent as the pull request's head. A commit that only carries the merge's message, or the branch's tip copied in after another pull request merged, is refused.
7. When `hosted_run` is given, GitHub lists that run with the merge commit as its head. Its status and conclusion are recorded as GitHub gives them at the deploy.
8. An `ordinary` train changes none of the deploy tool (`tools/deploy.py` and every `tools/` module it loads: `tools/release_check.py`, `tools/known_reds.py`, `tools/releases.py`, `tools/train.py`, `tools/checks.py`, and GitHub's classifier `tools/ci_known_reds.py` with its input-read audit `tools/ci_input_reads.py`, which the known reds reuse), the files that classifier requires to equal the event base (those modules and `tools/ci-input-reads.json`), the controller (`.github/`) or the service's data migrations (`aim_next/migrations.py`, where every schema step is a row of `STEPS`), read as the paths that differ between the live HEAD and the merge commit, so an earlier train merged but not deployed counts too. `tests/test_tools_train.py` reads the modules the deploy loads and the classifier's pinned files from the code itself, so one that starts being loaded is guarded or that test fails. The service's own modules (`aim_next/`, apart from its migrations) are what trains ship, and are not guarded. Such a train is `judged-first`. An ordinary train's `judgment` may be `null`; when it is given, each run and check must be completed and name the merge commit as its head.
9. A `judged-first` train comes with its judgment: every listed run and check is completed and names one head, a parent of the merge commit whose tree is the merge commit's. Each conclusion is recorded as GitHub gives it, beside the audit that read it, whatever it is (train 1 merged with the App check red, on its audit).

The deploy prints one line for the train and writes what it read to `00-train.json`. The live HEAD the paths were read from must still be the live HEAD when the deploy reads the checkout again before stopping anything. Everything after that is unchanged: the processes, the checkout, the release plan, stop, backup, fast-forward to the merge commit, migrate, restart and verify, then the record. A deploy that measures an `outcome`, and `--known-reds`, are refused with a train: both stand for a local release check's summary.

The release record keeps the train in `measurements.train` ([releases.md](releases.md#the-record)) and none of a release check's counts, so it never claims a local check passed when none ran. An ordinary train's `judgment` there is `"pending"` beside its `pr`. When the hosted judgment lands, attach it:

```sh
tools/releases.py attach-judgment RELEASE --config INSTANCE/deploy.json --runs RUN_ID[,RUN_ID] --checks CHECK_ID[,CHECK_ID] --audit m-…
```

It reads the release's record through the live CLI and refuses unless the record says its judgment is pending; reads each run and check from GitHub and refuses unless each is completed and names that release's commit as its head; and attaches the judgment, each conclusion as it is, through `bin/aim-next-admin attach-judgment`. The judgment is a fact beside the record, written once; nothing else in the record changes.

### Known reds: `--known-reds FILE`

GitHub's aggregate classifier is a separate, stricter consumer of complete
evidence: see [CI expected browser failures](ci-known-reds.md). It uses policy
and validator code from the PR event's exact base SHA, verifies producer
run/attempt receipts and case identities, and preserves raw failures. Its
initial inventory has zero failure admissions; step-wide deploy acceptances do
not populate it.

A release ships with its own regressions fixed. A browser case that the live release's policy already admits, or that already fails on the live release, is not this release's regression, so it does not hold the release, but it is never counted as a pass either: it stays a failed case in the summary, in the release check's step evidence and in the record's counts, and the record names it as a known red, with what took it. `FILE` is an absolute path to a JSON object:

```json
{"live_commit": "FULL_SHA",
 "reds": [{"step": "native-colors", "case": "the exact case name", "live_summary": "/abs/live-check/summary.json", "why": "one line"}]}
```

A red the policy admits needs no live summary: its `live_summary` may be `null`.

Without the flag nothing changes. With it, a summary that did not pass is taken only when all of these hold; otherwise the deploy refuses at `00-release-check`, before it reads the live processes, stops or changes anything, with one line naming the first condition that fails ("known reds: …"):

1. The file is well formed: exactly those keys, `live_commit` a full commit, at least one red, each red a `native-*` step of this commit's release check, a case, an absolute `live_summary` or `null`, and a `why` of one line (at most 300 characters), no step and case listed twice.
2. `live_commit` is the live checkout's HEAD, as the deploy reads it (and still is when it reads the checkout again before the fast-forward).
3. Every step the summary should have run is in it, once.
4. Every step that failed is a browser step. A failed `python-units`, `node-units`, `deploy-refusals` or `wake-replay` is never a known red.
5. Each failed browser step shows its harness ran to the end, read from the evidence beside the summary (`native/NAME/` and `native-NAME.log`): it exited 1, its results file is readable and lists its cases, the summary's counts for the step are the ones its results file gives, the browser closed, and the harness reached its end. For the harnesses that write `native.json` with their fixture's exit, that exit is 0 and the log holds the harness's last assertion (`see native.json for exact failing assertions`), which it reaches only after the browser and fixture are closed. `tests/reader_native.mjs` serves its page itself, so it has no fixture; its log ends with the results it prints last. `tests/reader_compose_native.mjs` attests its end in `native.json` instead of its log: `fixtureExitCode` is 0 and `fixtureExitSignal` is null (both the fixture's own, held from its launch), `plannedPhases` and `completedPhases` are both exactly `run:chromium`, `run:webkit`, `runAnswering:chromium`, `runAnswering:webkit`, `runSending:chromium`, `runSending:webkit` (a phase is completed only once it returned and its browser closed), and `harnessCompleted` is true, which it sets only after every planned phase. An interrupted run still closes its browsers and writes `native.json`, so it is refused on these fields however many cases it holds. At least one case failed, and each failed case's name occurs once among the step's cases.
6. Every failed case of each failed step is listed for that step, by its exact name: no prefix, pattern or case folding, and a case with a suffix such as an engine is its own name.
7. Each needed red is taken by one of these, tried in this order:
   - The policy at the event base admits it: `.github/check-baseline.json` at `live_commit`, the live checkout's HEAD that the deploy fast-forwards from, read from the live checkout's git, admits this failure as GitHub's classifier (`tools/ci_known_reds.py`) would. The classifier reads the policy at the pull request's event base, never the candidate's copy, so the deploy never reads the policy at `SHA`: an admission the candidate adds or changes does not count for the candidate, and one it drops still stands until it is live. The policy must be one the classifier's own `load_policy()` takes, its sources read from the live checkout's git; one it would refuse refuses. As the classifier does, the policy then picks the plan whose reviewed test sources are the ones at `SHA`, with `live_commit` as the approved base, so what `SHA` retires from the live commit must be the plan's reviewed `retired_sources` (`select_plan()`); when no plan matches, because a reviewed test changed, it admits nothing there, and refuses nothing either: each red then needs its live summary or an owner's acceptance, as at a commit that keeps no policy, and a refusal when neither takes it says the tests at `SHA` are not ones the policy reviewed. The case's identity (the name, phase, engine and expectedFailure from its row in the results file) must be an admission's, and so must the fingerprint of its failure: the row's error, its assertion and values with the summary's `checkout` taken out, and the test-source chain its stack names, read at `SHA`. The same case failing for another reason (another value, assertion, call site, or a stack with no test source) is "different assertion, values or source chain", as the classifier calls it, and is refused unless a live summary takes it. The runner profile is the one fact not compared: a local release check does not run on GitHub's runners. A live commit that keeps no policy admits nothing; a policy that cannot be read refuses.
   - Its `live_summary` is a release-check summary (full or `--only`) whose `commit` is `live_commit` and whose checkout did not change while it ran, in which the same step ran once, ended as in 5, and has that exact case among its failed cases. A composer run from before its harness wrote the end-of-run record (a `native.json` with none of `fixtureExitCode`, `fixtureExitSignal`, `plannedPhases`, `completedPhases` and `harnessCompleted`) counts when its `native.json` names the case failed and its browser closed; a run with any of those fields is read as in 5.
   - Its `live_summary` is an owner's acceptance file (below).

The summary must still describe exactly `SHA`: one of another commit, of a checkout that changed, or made with `--only` is refused as before, flag or not. A listed red the candidate did not fail is not needed; the deploy says so and goes on. With an outcome in the config its checks still read the summary as it is, failures included.

An owner's acceptance stands in for a live summary when the owner has taken a case on their word. It is a JSON object with exactly these keys:

```json
{"owner_acceptance": true, "cases": [{"step": "native-compose", "case": "the exact case name"}],
 "by": "warp", "message": "m-…", "why": "…"}
```

It takes only a step and case it names exactly, in `cases` (each `{step, case}`), and only with a non-empty `by` and `message`; otherwise the deploy refuses. The record names the file as the red's `live_summary`, and the printed line says an owner's acceptance took it, by whom and in which message.

The accepted reds (step, case, live summary, its commit, why, and `taken_by`: `policy`, `live` or `owner_acceptance`) are written into `00-release-check.json` under `known_reds`, beside `passed: false` and the failed steps, with the reds not needed; the refusal is written there too. They go into the release record's `measurements.known_reds` ([releases.md](releases.md#the-record)). The deploy prints one line per accepted red and per red not needed. `--dry-run` shows the same: what it would accept in `00-release-check.json` and the record in `02-release.json`; it exits 0 when the reds are taken.

To make a live summary, run the release check of the live commit on a clean detached checkout of it, for just the steps you need:

```sh
git worktree add --detach ~/aim-worktrees/live-check LIVE_COMMIT
~/aim-worktrees/live-check/tools/release_check.py --only native-colors --out ~/aim-worktrees/evidence/live-LIVE12-colors
```

Its `summary.json` is the `live_summary`, and the evidence it names stays beside it, where the deploy reads it. Remove the worktree afterwards (`git worktree remove`); the evidence directory is outside it.

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
| `release_branch`, `repository` | optional; needed for `--train` and `tools/releases.py attach-judgment`: the branch trains merge into (on GitHub, such as `release/live73`) and GitHub's `owner/name` of the repository that branch, its runs and its checks are read from |

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
