# Judged admission from deterministic evidence

Warp18843/18852/18890 replace the required successful Verdict. This guard is
built from installed source e3aaf7bc/tree520f3a8f. Fable installs the independently
reviewed guard; Warp selects its caller. Existing installations are untouched.

The judged train's `judgment` has `version: 1131`, `carry`, `node_comparison`,
`core_cohort`, `browser_cells`, `audit`, and optional `verdicts` and
`python_comparisons`. The latter three kinds of evidence keep actual failures;
there is no successful-Verdict requirement. Ordinary admission is unchanged.

`carry` names full `base`, `head`, `tree`, and `created_at_ms`. The source head
must descend from actual live, and its tree must equal the requested landing
tree. A landing merge has exactly live and carry as parents. Git's committer
time is retained as authored metadata, never as independent ordering proof.
Canonical source freezes and approvals are reread before effects: each approved
source must be contained in the carry and approved before the recorded actual
carry start. The independent reviewer must explicitly accept that ordering from
the retained carry capture or an independently recorded witness, not infer it
from Git time. Milliseconds are preserved. A witness after the Core audit's own
sent time refuses. This is an audit obligation, not cryptographic attestation
of a machine clock. Approved ordinary work still lands first; there is no
late-waiter bypass. Warp18837 revision1 sets the retained maximum of three
Pipeline items per judged train.

An artifact reference is an absolute `path` and `sha256`. JSON has no duplicate
keys or non-finite numbers. `node_comparison` points to `base` and `carry` runs.
Each run names its `run`, positive `attempt`, full `head`/`tree`, unchanged
`inputs_before`/`inputs_after` snapshots and every root `tests/*.test.mjs` file.
The run contains either `files` (per-file execution records) or `grouped` (one
actual whole command with `files`, absolute `cwd`, `argv`, direct `exit`, raw
`stdout`/`stderr` references and counts). Existing grouped Node commands can be
wrapped without another execution; do not concatenate per-file logs or relabel
their commands as a grouped run. `node --test --test-concurrency=N
--test-reporter=tap FILE...`, absolute file arguments, a captured `nice -n N`
wrapper, and isolated Python `-I -B -m unittest -v FILE...` or verbose root
discovery with an explicit pattern are supported. The command's actual file
selection must equal its declared coverage. Unknown filters refuse.

The guard recomputes case ancestry, multiplicity and outcome distributions.
TAP suites are typed summaries and cannot inflate test pass/fail/skip counts;
Python FAIL/ERROR/skips must match their aggregates. Whole TAP does not locate
every passing case: those identities retain names, ancestry and multiplicity;
every failing file must be unambiguously located in its raw diagnostic. No
passing location is invented. Every live file/case must remain
represented on carry; no added failing case/file or incomplete deterministic
run is accepted. New passing tests are allowed. A snapshot names every tracked
file's actual captured Git blob identity; the guard compares it with Git.

`core_cohort` names the exact carry, each frozen piece's `piece_id`, source
`head`, named Python test files, and passing verbose unittest runs covering
their union plus `tests/test_migrations.py` and changed migration test files.
The audit binds these named cohorts to the frozen sources. Selection of the
appropriate additional tests remains an explicit independent review obligation;
Core's existing freeze has no machine-readable test inventory. No new Core
schema or page-only authority is introduced.

The read-only CLI accepts `admit SHA --config FILE --judgment ABSOLUTE_JSON`;
the landing caller passes the same judgment to `deployment.admit` before merge
and in its train file. Legacy judgment records remain readable; they do not
authorize a judged admission through this guard.

Each browser cell names a changed `web/` path, `page`, `cell`, exact carry/tree,
`completed: true`, and its raw record reference. Every changed web path must be
covered by a completed real-browser case. Whether those paths share a page and
whether the recorded case used native gestures are audit obligations, not DOM
timing inferences. Other browser-suite failures/completeness never block.

`audit` names a Core message and revision. The guard reads it through the same
bound CLI as the pipeline, rejects removed/withheld/stale/private sources, and
requires an entire affirmative decision, rather than a substring in a quotation
or rejection. The message's full body is `(codex) auditor —1131 ` followed by
one JSON object with exactly `decision: "accept"`, `evidence_sha256`,
`approval_before_carry: true`, and `carry_started_at_ms`. The digest is SHA256
of canonical JSON of the judgment without `audit`; it binds all source/run/raw/
cohort/browser references, including optional Verdicts. The carry time must
equal `carry.created_at_ms` and not exceed the audit's Core `sent_ms`. Quoted
decisions, trailing rejection prose, a negative decision and an unaccepted
ordering witness refuse. Supporting review prose and capture references remain
in the dossier; the exact decision is a separate affirmative act. This is an
attributed review of captured evidence, not attestation that a builder's
machine cannot lie. Material environmental limits belong in that read.

Optional Python comparison runs use the same file/case identity rules. Their
new deterministic reds block. Verdict objects retain their run/check/conclusion
and raw reference; they do not supply an independent Boolean veto. A Verdict
claiming a deterministic new red supplies its raw base/carry comparison here;
broken harnesses, unavailable APIs and browser-mode consistency errors remain
attributed monitor evidence. Push/release producers and morning monitoring
continue separately.

Focused checks cover actual old-guard refusal, absent/failed Verdict admission,
new case/file red, missing coverage, wrong run/attempt/head/tree/raw digest,
late approval, missing Core/migration run, stale audit, missing changed-page
cell, quoted/negative acceptance, future-dated and same-second carry ordering,
actual grouped command shapes, raw count distributions including suites and
Python errors/skips, both deploy admission boundaries and unchanged ordinary behavior. Tests
use scratch Git repositories and synthetic logs only. A live deployment,
browser or producer is not part of this guard's test entry.
