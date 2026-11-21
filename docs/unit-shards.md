# Hosted unit jobs (item 665)

Python remains one required release step, run by multiple hosted jobs. A job
runs whole test files. The planner deals files longest first into the least
loaded shard, using measured file wall times in `.github/check-weights.json`;
new files take the median until the next refresh. This keeps added files in the
plan and avoids one alphabetical directory accumulating the expensive tests.
Node units and deploy-refusals each have their own job. Browser and replay
selection retain their existing rules.

The planner and runner share an import-free inventory matching unittest's
filesystem rules: valid `test_*.py` modules under `tests/`, descending only
through packages with `__init__.py`. Package initializers are also planned
files, since discovery can load tests or a `load_tests` hook from them.
Non-package subdirectories and invalid module filenames are excluded. The
runner assigns each discovered suite to the file or initializer that produced
it, including failed imports, module skips and custom test identities. Hooks
still control their suites as in ordinary unittest discovery; planned files
suppressed by a hook contribute no tests. No unplanned synthetic filename is
added to a shard's receipt. Package files use the same measured median as any
new file, and their partition receipts combine with exact coverage checks.

A planned partition may discover zero tests: an empty initializer, an empty
module or a file suppressed by a package hook still belongs in the inventory.
It completes with unittest's `Ran 0 tests` / `OK`, its exact file receipt and
timings. Only partitioned Python accepts that result; an unpartitioned empty
run still refuses. Combining requires every planned receipt, disjoint exact
file coverage, successful partitions and a positive total test count. An empty
partition is completed work; an absent partition remains missing, and an
entirely empty suite cannot pass.

Each Python process writes its partition (index, total and files), count, wall
time, file times and 25 slowest tests. Its unittest names and result lines stay
compatible with the release evidence readers. The combined summary holds one
`python-units` result: counts sum across disjoint files, and passing requires
every planned partition. It also names every planned job and every missing job
or required step, including a job cancelled before publishing a summary.
Missing work never becomes a passed result or a quarantine success. The deploy
continues to read the ordinary required steps and refuses incomplete Python.

The historical controls measured Python at 42m and train 33 at 43m39s; train
30's unittest time was 29.4m. Their captured logs have no individual timings.
Pool run [44112970996](https://github.com/commonfabric-offcuts/theseus/actions/runs/44112970996)
at snapshot `4345c9b16d5283e29820273b2603c0553591d4ba` measured every file in
43m37s. Its 3,016 tests were the base's 3,005 plus 11 new checks; three reds
exposed the new runner's lost bytecode prefix and its missing train guard,
both corrected before handoff. Four longest-first bins now measure 11.58,
10.67, 10.67 and 10.67 minutes. The slowest file, `test_tools_start_line.py`,
runs alone; `test_codex_host.py` is the next largest at 7.36 minutes.

The calculated timeout is `ceil((measured minutes + 0.902 setup minutes) * 1.5)`
for each unit job. The initial plan gave Python 19/18/18/18 minutes, Node 5,
deploy-refusals 3. Node's 124.887s
and the 54.113s setup/upload overhead come from pool run
[44112985174](https://github.com/commonfabric-offcuts/theseus/actions/runs/44112985174).
Deploy-refusals' 65.290s comes from train 30's completed step in run
[44007172971](https://github.com/commonfabric-offcuts/theseus/actions/runs/44007172971);
the later control was cancelled during it. Exact intervals and file weights
are recorded beside these settings in `.github/check-weights.json`.

A subsequent train checks each shard's actual time and that their counts total
the same suite as one process (3,005 tests at release 90, plus new checks).
Adding files uses the measured median and deals them with the existing files;
refresh the weights from the next run's complete `timing.files`. The runner is guarded
with the other producer tools: an ordinary train cannot alter it without
producer review, and the tool-record parser excludes it from ordinary tool
ownership through its matching closed list. Python retains `run_step`'s per-process bytecode cache, also
used by nested child checks; isolation flags must not discard it.

Item 1016 adds a **30-minute minimum for Python jobs**, preserving larger
calculated limits, all four partitions and every other job's limit. The
[1002 shard](https://github.com/commonfabric-offcuts/theseus/actions/runs/44912268547/job/136870458446)
took 18m53s, only seven seconds below its 19-minute cap. The corresponding
[1015 shard](https://github.com/commonfabric-offcuts/theseus/actions/runs/44918716681/job/136889902421)
was cancelled under that cap; its total job interval was 19m24s, including
cancellation finalizers. The latter is a lower bound, not a completed suite
time. Thirty minutes rounds up a 50% margin over that observed interval;
the old file weights do not justify the former 19-minute ceiling. Receipt
and evidence publication still succeeded after cancellation and remain
unchanged. Failure and missing-partition reporting remain unchanged too.
The bounded planning check is not a hosted completion claim: a later judged
candidate's own run measures the new cap's actual result. Source timestamps
and the contract are in [python-shard-headroom-1016.md](python-shard-headroom-1016.md).

The protected Verdict is expected to refuse this producer change until its
source is reviewed; these receipts do not claim the old Verdict approved it.

The second instrumented Python receipt ran 3,017 tests. It caught the matching
tool-record exclusion missing from that closed list (corrected), plus the
unchanged start-line racing-open case using real time to open a line and a
fixed November 17 cut time. That race was reproduced on the release-90 source
and now supplies the fixture's `T0` to both writers, retaining its concurrency
assertions without a calendar deadline. No start-line product code changed.
