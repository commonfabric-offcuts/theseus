# Reviewed base move v4 — candidate, not cleared

This consumes retained evidence; it never runs candidate code. Only an explicit
`base_move: Ref` on a judged-first train uses this form. The no-record
parent/same-tree guard, ordinary path and deploy sequence stay strict.

`Ref` is exactly `{path, sha256}`: absolute path, lowercase SHA-256 of retained
bytes. New envelopes reject extra/missing/duplicate fields, invalid constants,
boolean numbers and duplicate identities. All artifacts are digest checked.

The manifest is exactly `{version: 4, source_head, original_base, live_base,
live_release, assembly_head, assembly_tree, source, receipts, review}`. Object
names are full Git OIDs. Git must prove assembly parents `[source_head,
live_base]`, release parents `[live_base, assembly_head]`, exact release/assembly
trees, the exact common original base, and approved ancestry. Entries changed
only on one side retain that side's exact entry. Every overlap is reviewed;
no extra feature work is permitted in resolutions. Review covers the entire
binary source-head-to-assembly diff, including clean merges.

`source` is exactly `{run, attempt, tested_merge, base_at_run, files, inventory,
audit, controller}`. Run and attempt are positive integers. `tested_merge` is
exactly `{sha, tree, first_parent, second_parent}` and `base_at_run` exactly
`{ref, sha}`. Git proves the tested merge parents are `[base_at_run.sha,
source_head]` and its tree matches exactly. **The producer API head is the PR
source head; summary.commit is the tested merge. They are distinct facts.**
The original producer API must be a completed Checks pull_request run at
`.github/workflows/checks.yml`, with the exact head/attempt/conclusion.

`files` maps safe relative downloaded artifact names to Refs. Include
`release-check/summary.json`, `release-check/provenance.json`, every assigned
`check-N/run.json`, `check-N/summary.json`, native reports, ordered case logs,
unit logs and replay reports/logs. The actual producer's plan, head, base,
base_at_run, checked merge, shard assignment, tools, summary digests and full
required-step union must agree. Source tool/harness blob OIDs are checked at
the **tested merge**. Every additional native `hashes` claim is checked against exact Git file bytes;
fields absent from original producers stay absent. No focused/scoped aggregate, omitted result, abnormal
exit, dirty checkout, missing completion or failed teardown is admitted.

`inventory: Ref` is the independently reviewed original complete plan, keyed
by every required step. Native/unit entries list exact identities (`name`,
optional `phase`, `engine`, `expectedFailure`); replay holds `routed` actors.
Exact unit inventory is checked, including red outcomes. It must not be built
by selecting only results that happen to exist. For Python, the verbose listing
ends at unittest's first error-report separator; failure blocks are then read
separately. This avoids interpreting assertion tuple diffs as test names.
This is a documented parsing transformation, not a new measurement.

`controller` is exactly `{run, attempt, current_base, verdict_artifact, published_artifact}`.
`current_base` is exactly `{ref, sha}`, the archived controller-observed current
PR base. Both it and `source.base_at_run` are required: branch refs must be valid
short Git branch names and SHAs full lowercase 40-digit OIDs. The latter stays
bound to original merge parents, provenance, original plan and every shard; the
former must equal the authenticated archived producer PR base and the archived
check API PR base (same PR number and source head), plus the shape-specific
publication binding below.
They need not be equal. Unknown, missing or inconsistent base facts refuse.
Each artifact is exactly `{id, archive: Ref}`. GitHub artifact metadata must
bind archive digest, exact producing controller run/head and the original
`verdict-RUN-ATTEMPT-cCONTROLLER_ATTEMPT` / `published-...` name. ZIP members are
read by exact name, never extracted. The verdict archive holds `producer.json`,
`check-run.json`, `refusals` (and may hold validator output); the published
archive holds `published.json`. Producer and controller identities are checked
against their separate API runs. The authenticated controller producer PR head
matches the original source; its
base is the current observed base, never substituted for original provenance.
The controller ref must exactly match its API run head branch.
The check must come from trusted App id 5763648 (`theseus-verdict`), be named
exactly `Verdict` for the equal-base early-refusal shape, or exactly
`Verdict for BRANCH` for the branch-named shape, where BRANCH is authenticated `current_base.ref`,
bind the producer via external_id, match the published check ID and
controller attempt, and match retained check output and refusal bytes. API
summary may append only the known `Published by controller run ... attempt ...`
line. A refusal may have no tested-merge field in producer.json; the raw source
receipts and Git independently establish that merge. Its real refusal ground
is retained verbatim; it is never rewritten as a test pass. No same-URL
producer/controller assumption is used.

`audit: Ref` is exactly `{version: 1, reviewer, record, run, attempt,
source_head, tested_merge, inventory, files_sha256, summary_sha256, reds}`.
`record` equals original judgment.audit; reviewer/record are nonempty durable
attributions. Bind the exact original run/head/merge/attempt, inventory Ref,
canonical files-index digest and raw source-summary digest. `reds` contains
**every** observed raw red once, exactly `{step, case, observed, attribution,
ground, evidence}`. `case` is normalized to all four identity fields, and
`observed` must equal the verified raw result (native row, Python status plus
exact failure block, Node status plus full raw failure log, or replay run with
its raw counts/exit). Attribution and ground are nonempty; evidence is a
nonempty list of digest-verified retained Refs. Missing, changed, duplicate or
extra reds refuse. This audit places failures; it does not relabel them.
Reviewer identity and semantic attribution still require independent audit.

Each `receipts` entry is exactly `{snapshot, step, report, log}`, all Refs.
The snapshot is exactly `{head: ASSEMBLY, tree: ASSEMBLY_TREE, changes: "",
inputs: {path: GIT_BLOB_OID}}`. Its entire tree binds product inputs; its
harness blob is mandatory. This version supports exact assembly snapshots;
other-head input equivalence without a verified complete binding is a concrete
blocker, not an assertion. Commands retain actual tool/argv/mode/filter.
Results retain exact case/phase/explicit engine, normal exit, raw counts and
browser/fixture completion. Expected failures cannot count as own-case passes.
Require **one** passing execution per case in each engine, never three.
A dual-engine receipt can satisfy both engines. Duplicate executions/identities
refuse. No counts, engines, commands or historic snapshots may be invented.

`review: Ref` is exactly `{reviewer, record, judgment_audit, evidence_sha256,
diff: Ref, conflict_paths, obligations}`. Its record is distinct from the
original audit, judgment_audit equals that audit, and evidence_sha256 binds
canonical manifest excluding review. Diff is the exact bytes of
`git diff --binary --full-index --no-ext-diff --no-textconv --output=FILE
SOURCE_HEAD ASSEMBLY_HEAD`. Conflict paths name every overlap. Obligations list
exact `{step, case, phase, engine}` rows for all affected own cases, both engines.
The auditor judges that these obligations cover the affected pieces, that the
review is independent, and that overlap resolutions preserve scope and intent.

Canonical JSON uses `json.dumps(value, sort_keys=True, separators=(',', ':'))`
with default ASCII escaping, UTF-8 encoded. Freeze source/audit/receipts/body
first, then resolution review, then manifest, then train Ref.

Release measurements keep original GitHub conclusions, controller identity,
actual refusal/output, source-summary Ref, all failed-step names and every
failed step's raw passed/exit/counts (all green counts remain in the bound summary), plus audit/inventory/provenance/index digests.
Large individual failures stay in digest-bound audit and source artifacts.
The normal Core measurements bound is unchanged; oversize refuses.
Exact new live head/release is rechecked against the normal plan before stop.
No full run on the assembly is requested or claimed. Missing genuine evidence
is a blocker. Coordinator installation/use waits for independent review of
this new freeze in a dedicated checkout; v1 was not cleared.

V4 admits two authenticated publication pairs. The plain early-refusal pair is
`published.json.name == "Verdict"` and `base == ""`; it additionally requires
equality of the complete `current_base` and `base_at_run` facts (both ref and SHA).
The branch-named pair is `name == "Verdict for " + current_base.ref` and
`base == current_base.ref`; it applies to both same-base and retargeted receipts.
A branch-named receipt does not imply that the base changed. The empty
publication base is not a base fact: producer PR and trusted check API PR must
still bind the full current ref/SHA, source head and PR number in both shapes.
All three published/API/archived check names must equal the selected name.
Names and publication base fields cannot cross shapes; absent fields refuse.
Selection checks the publication pair and authenticated base facts, never the
supplied name alone, and all API/archive identity checks remain required. Original
merge facts absent from an early refusal remain absent; full-source provenance
and Git must independently bind the original merge. Nothing is relabeled.

V3 envelopes refuse under v4. This changes only controller receipt compatibility;
Train38 stays red/held and original39/40 retain their original judgments.
No same-tree acceptance, item719 change or normal-path change is made.
Independent review must include #7715's measured geometry tolerance rule; no
measured layout case is expected for this change.

### Genuine Pool own receipts (source-bound adapter)

An own receipt may instead have exactly `{snapshot, step, report, log, pool}`,
all Refs. This is selected only by the explicit `pool` field; an invalid Pool
receipt never falls back to the legacy shape. Legacy receipts retain their
strict command/engine contract. No controller or full-source rule changes.

`pool` holds exactly `{version: 1, run, attempt, wrapper, artifact, api, record}`;
`record` is the original local `*.pool.json` Ref, checked against the API and spec;
`artifact` is `{id, archive: Ref}` and `api` maps exactly `run`, `workflow`,
`jobs`, `artifact` to retained API response Refs. The validator GETs those
identities independently and compares the complete parsed responses. Preserve
original API bytes and the original ZIP, authenticated by GitHub's digest.
ZIP members are read by name, never extracted: `cases.json`, `c1.log`,
`c1/native-compose.log`, `c1/evidence/native.json`. The latter three must equal
step/report/log bytes exactly. Only one execution/filter per archive is admitted.

This adapter knows one exact source schema: Pool's executed workflow, native.py,
release_check.py, compose harness and thumbnail helper, pinned by reviewed SHA-256 constants.
Unknown source bytes refuse. Wrapper parents must be `[assembly]`; every tree
entry except the two genuine Pool workflow/spec entries must equal assembly.
Spec is exactly `{step: "compose", cases: ["item 651"], label, snapshot: assembly}`.
The raw snapshot is the original pool tree record, with exact assembly head,
clean before/after, no changed files, and `where: "pool"`. Source input Git OIDs
are derived from the exact assembly, never supplied as new raw measurements.

Raw stdout has only name/exit/passed/counts; it stays raw. The pinned workflow
and source establish command/mode/filter, with dynamic executable/output paths
reported symbolically as derived facts, never as a recorded argv. The adapter
checks raw PASS lines in row order, final counts, normal exits, both fixtures,
browser closure and all six planned/completed engine phases before interpreting
names. Only exact `chromium ` and `webkit ` prefixes are recognized; removing
one prefix yields the internal engine-neutral case identity. Raw rows have no
engine or phase fields. Internal phase remains null; no case-to-phase assignment
is invented. Both engines must have identical nonduplicate neutral inventories,
matching the independently reviewed obligations exactly, once each. The
normalized identities, command and input OIDs are labeled `derived`, separately
from raw counts and original Refs. Geometric measurement schemas are unsupported
here and refuse; #7715's tolerance checklist still applies to independent review.

### Current check association after the train merges

GitHub may return `pull_requests: []` for the original check after a normal
merge. Only the explicit reviewed base-move path may consume that empty list.
The train reader forwards the actual merged PR API answer, train PR number and
release ref; after validating the exact ordered source/assembly/live/release
parents, equal assembly/release tree, independent body review, overlap scope
and approved ancestry, the base-move reader forwards that context to full-source
and controller validation. The archived producer must name that same PR and
source head, with the release ref and an archived base equal to the original
or live base. The original source base must equal the manifest's original base.
The actual PR must be merged at the requested release merge, with assembly as
head and the exact live base/ref. The source is not a direct release parent.
All archive/App/publication/output/full-source/receipt checks still apply.

Missing or non-list associations refuse. A nonempty association still takes
only the original exact PR/head/base check; a wrong association never falls
back to merged context. No manifest field selects or overrides this behavior,
and no context default authorizes empty associations. Original artifacts and
red/refusal output remain unchanged. Ordinary and no-base-move guards retain
their existing behavior.

### Bounded item 652 Pool fallback (8571)

This is the explicitly narrow fallback, **not a general item adapter**. Item 651
keeps its exact reviewed source profile and `item 651` filter. The second profile
is the compose harness at assembly `10c4ca6ecfa8e77e0986b0b16838c60a5a9cacc4`
(tree `16d1cd391839b66e2cd2927200ecacaecca7542c`) plus
`tests/card_editor_652.mjs`, both pinned by reviewed SHA-256 constants. The
workflow, native driver, release reader and thumbnail helper retain the original
651 pins. Only those exact bytes authorize the exact `item 652` filter; a spec
cannot select a profile or supply trusted hashes. The helper is included in the
derived assembly input OIDs and source digests. No candidate code is executed.

The reviewed 652 source uses the same `check` function, engine prefix, six
phases, raw report envelope and PASS/count output as 651. Its four mutation
checks record their trails in evidence files and emit no CAUGHT lines. Thus the
existing ordered log parser applies unchanged: 651's five exact CAUGHT lines per
engine remain required; invented 652 CAUGHT lines refuse. Every 652 neutral name
must start with the exact `item 652 ` boundary (or equal `item 652`), and still
match independently reviewed obligations once in each engine with null phase.
No command, ZIP, attempt, API, tree/parent, raw-byte, phase or cleanup check is
relaxed. No additional mutation-trail/archive/runtime proof is claimed.

Unknown harness/helper bytes, steps, filters, row fields or log conventions
refuse. This deliberately does not interpret arbitrary candidate JavaScript or
trust a source digest merely because a candidate reports the same digest.
A safe general adapter does not fit this bounded extension: 717's source uses
`stack_native.mjs`/`dossier_promises_native.mjs`; 715 uses
`outcome_rail_native.mjs`/`outline_stars_native.mjs` and other engine entry points.
Their source, phase, identity and logging conventions need a separate reviewed
parser design. They remain unsupported here, with their original qualifications
and future final-base receipts untouched.

`tests/test_tools_own_receipt_652.py` supplies synthetic parser controls using
frozen 652 source and stubbed API answers. These are not authenticated hosted
receipts or native behavior evidence. The genuine 651 package remains a separate
control. Actual final-base 652 acceptance requires its original Pool return and
live API comparison; a local parser control cannot establish that acceptance.

### Bounded reading/rail fallback for both 717 and 715 (8607)

This is the named **717-and-715 narrow fallback**, not an arbitrary-source
adapter. The shared Pool authentication/archive/snapshot reader also accepts
`reading` and `webkit-reading` with exactly `item 717`, and `rail` and
`webkit-rail` with exactly `item 715`. Each execution is one engine, at the
step recorded by the producer; obligations retain those separate step names.
No dual-engine prefix or phase is invented for these reports.

Schema authority is independent of receipt claims: the complete `tests` Git
subtree must equal frozen producer f31e319994ecc96c5565828a53fde75c01bd3386
(717) or 5903d8b8fac63b8b4e6d191dbc8d59db5094d9b0 (715). Named reporters,
helpers and cleanup code have additional exact SHA-256 pins. The original
workflow/native/release pins still apply. This intentionally conservative
subtree binding also covers imports and fixture code without executing it.
Unknown source or conventions refuse. Future assembled 717/715 sources with
changed harness imports, or any changed tests subtree, need an explicit
independent schema binding. Candidate self-hashes cannot authorize them.

Chromium's rows have only name/passed; its log has ordered start/result pairs
with matching ISO timestamps. Its original phases.json is required in the ZIP,
with every case's action and cleanup complete before reporting. WebKit's rows
carry engine=webkit and nonnegative integer ms, and its ordered log contains
exactly those rows. Both retain null phase; names must begin `reading item 717 `
or `rail item 715 ` (the item alone is also permitted after the mode prefix).
Counts, normal exit, fixture/browser cleanup, exact independent identities and
all claimed source hashes are checked. No failed raw row is accepted, including
the historical 717 intended-assertion/restore red and four WebKit Tab reds, or
715's twelve phone drawer reds. Synthesized controls are parser evidence only;
no final-base 717/715 receipt exists or is implied by this change.
