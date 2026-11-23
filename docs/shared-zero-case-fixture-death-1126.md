# Shared zero-case fixture death (1126)

Owner: fable (codex), under Warp Landing18696 and18714. This is a judged
controller change on `codex/aim-next`, based on
`7b2a8ea6575afefb6b0b8ed90330a8506464591f`, following1124 and1125.

A fixture that exits before any case is a recorded mode end state. Do not
discard that state by refusing during case extraction. Retain zero cases,
the actual fixture exit code, and the source-verified body error normalized
by the existing1125 rules. Raw errors and the earlier refusal remain intact.

An exclusion requires a nonempty authenticated selected base set, every
selected record present and valid, every record having zero cases, and the
candidate and all those records having the same fixture exit and normalized
body error. A base that reached a case, an unlike end state, missing or
malformed evidence, or a failed cleanup defeats the exclusion. Preserve the
current refusal in those situations. An excluded mode is named and disclosed,
without fabricated passes or a claim that its real behavior was exercised.

The strict observation of an excluded mode may accept its matching fixture
error; it still validates cleanup, raw counts, source and all remaining
evidence. Existing all-zero preparation-error handling, reached failures,
shared incomplete modes and unrelated modes keep their own rules.

Extend the existing judge units for the shared zero-case fixture death,
candidate-only death, and a selected base that reached cases. Keep the diff,
exact command, source identities, output and direct exit for the auditor.
Serialize the bounded unit run with the active unit lane. Deliver to the
controller branch only after the auditor reads the exact source and output.

The fixture import-path repair is separate queued1127, and canonical-write
contention is separate queued1128. No fixture/browser run, old producer
rerun, application deployment or rewrite of past evidence is authorized by
this controller task. The next357 carry push waits for reviewed1126 delivery;
its newly restored source approval epochs precede that push.
