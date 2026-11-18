# Bounded original-source readers (warp8715)

Starting from installed 8bb185fe2de3a7a8b42725ac11e2d38b851ad306,
Python FAIL/ERROR header identities stop at the newline even in DOTALL mode.
The exact raw failure block, separators, listing inventory, duplicate/missing
identity checks, counts and raw verdict remain authoritative. Two failures stay
two failures; acceptance of a readable red log never means the tests passed.

Continuation wake-replay has no aggregate wake-replay.log in the original ZIP.
Only that named step uses its original step record plus every indexed candidate's
replay.json and wake-replay-candidate-N.log, authenticated against source files
and ZIP bytes. replay_results retains actor, count, completeness and exit checks.
All other execution logs remain required. Unknown conventions refuse.

Focused checks use the auditor's frozen train45/46 forms, inventories, audit and
original ZIP bytes. They execute the actual raw-reader loop extracted by AST
without changing its body, and the actual unit/replay readers. This is a bounded
source-reader check, not full-envelope/controller authentication: the forms lack
controller facts. A separate reconciliation checks all 52 required steps and
all 171/200 raw failures against the unchanged audits. It creates no native
measurement, passing aggregate, independent review or release clearance.

Run only the named source-reader module with CPython 3.9, a fresh
PYTHONPYCACHEPREFIX and SOURCE_READERS_FIXTURES pointing at the frozen
source-forms-8702 directory. Fixture reads are digest checked; temporary copies
preserve raw bytes. Synthetic negatives are labeled separately. Actual code
mutations must fail their named assertion and exact restores must pass with
separate cache prefixes. Independent exact-head review and coordinator-named
installation remain subsequent handoff requirements. Warp8729 moved that gate
to before97 reaches its ordinary release guard;96 used the installed8bb185fe.
This component is combined with the ordinary Python-partition reader under
warp8719 for one frozen review and one commit-named installation.
