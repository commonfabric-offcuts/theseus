# Hosted unit jobs (item 665)

Python remains one required release step, run by multiple hosted jobs. A job
runs whole test files. The planner deals files longest first into the least
loaded shard, using measured file wall times in `.github/check-weights.json`;
new files take the median until the next refresh. This keeps added files in the
plan and avoids one alphabetical directory accumulating the expensive tests.
Node units and deploy-refusals each have their own job. Browser and replay
selection retain their existing rules.

Each Python process writes its partition (index, total and files), count, wall
time, file times and 25 slowest tests. Its unittest names and result lines stay
compatible with the release evidence readers. The combined summary holds one
`python-units` result: counts sum across disjoint files, and passing requires
every planned partition. It also names every planned job and every missing job
or required step, including a job cancelled before publishing a summary.
Missing work never becomes a passed result or a quarantine success. The deploy
continues to read the ordinary required steps and refuses incomplete Python.

The historical controls measured Python at 42m and train 33 at 43m39s. Their
captured unittest logs have no individual timings. The first instrumented
hosted run supplies file measurements; a subsequent train checks that every
shard finishes inside about 20 minutes and that their counts total the same
suite as one process (3,005 tests at release 90, plus new checks). Timeouts are
rounded-up measured minutes plus half; their sources are recorded with them.
The protected Verdict is expected to refuse this producer change until its
source is reviewed; these receipts do not claim the old Verdict approved it.
