# Lane lock (1195)

Lane test runs and landings on one Mac share kernel locks in place of hold and FREE posts. `tools/lane_lock.py` holds them.

- A lane wraps each test run: `python3 tools/lane_lock.py run --label "1174 green" -- node --test ...`
- A landing wraps its whole suite and deploy: `python3 tools/lane_lock.py landing --label "398 1160" -- bash land-ordinary.sh ...`
- Anyone can see who holds what: `python3 tools/lane_lock.py status`

## What it guarantees

- At most three lane runs at once. A fourth waits for a free slot and says so once.
- A landing first marks itself pending, so no new run starts. Then it waits for the runs already open to end, and runs alone. Runs that arrived while it waited start once it ends.
- Each lock is an flock on an open file under `~/.local/share/theseus/locks` (`THESEUS_LOCK_DIR` overrides it). The kernel releases it when its holder exits for any reason, including a crash or `kill -9`, so a lock is never left behind.
- The wrapped command's exit code is the wrapper's exit code, and SIGINT, SIGTERM and SIGHUP are forwarded to it.

## What it does not do

It covers this Mac only. A lane on another Mac is outside it.

Tests: `tests/test_lane_lock.py` drives the real command in five cases: three slots with a fourth waiting, a landing that waits for an open run and holds a later run until it ends, a killed run freeing its slot, a lone landing starting at once, and exit-code passthrough with status.
