# Hosted unit jobs (item 665)

Python remains one required release step, run by multiple hosted jobs. A job
runs whole test files. The planner deals files longest first into the least
loaded shard, using measured file wall times in `.github/check-weights.json`;
the existing historical fallback keeps partition membership stable until the next refresh. This allocation is not a duration promise for new files. This keeps added files in the
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
added to a shard's receipt. Package files retain the same historical allocation fallback as any
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

Under warp9266, every Python partition runs alone with a 49-minute job
capacity (`python-49m-partitions-v1`), including Python4. The planner keeps the
exact existing file deal and exposes its historical estimate including setup as
diagnostic metadata. Discovery, imports and load hooks remain within the runner's
wall time; setup/upload consume the same job capacity. No new timing guarantee
is inferred from file estimates. Node remains 5 minutes and deploy-refusals 3.
The earlier 19/18/18/18-minute Python capacities came from
`ceil((measured minutes + 0.902 setup minutes) * 1.5)` and remain historical.
Original Python4 cuts remain incomplete even though a separate 49-minute
completion later returned. The 737 55-minute cut remains a prefix. See
[shard-budgeting.md](shard-budgeting.md) and REPORT.md for retained evidence.

A subsequent train measures whether every partition finishes within its capacity
and that their counts total the same suite as one process (3,005 tests at
release 90, plus this piece's new checks). Adding files retains the existing allocation fallback and deals them with the existing files; refresh the weights from the
next run's `timing.files` without claiming that a historical estimate bounds new work. The runner is guarded
with the other producer tools: an ordinary train cannot alter it without
producer review, and the tool-record parser excludes it from ordinary tool
ownership through its matching closed list. Python retains `run_step`'s per-process bytecode cache, also
used by nested child checks; isolation flags must not discard it.

The protected Verdict is expected to refuse this producer change until its
source is reviewed; these receipts do not claim the old Verdict approved it.

The second instrumented Python receipt ran 3,017 tests. It caught the matching
tool-record exclusion missing from that closed list (corrected), plus the
unchanged start-line racing-open case using real time to open a line and a
fixed November 17 cut time. That race was reproduced on the release-90 source
and now supplies the fixture's `T0` to both writers, retaining its concurrency
assertions without a calendar deadline. No start-line product code changed.
