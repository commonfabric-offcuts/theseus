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
only on one side retain that side's exact entry, except the explicit bounded
test adaptation below. Every overlap is reviewed;
no extra feature work is permitted in resolutions. Review covers the entire
binary source-head-to-assembly diff, including clean merges.

An explicitly authorized cut train may add `source.continuation: Ref`, under
[the original partial plus scoped completion contract](continuation-envelope.md).
That separate envelope preserves original partial truth and requires the exact
missing-only union; it creates no replacement full-run summary. Without this
explicit field the complete-source path below applies.

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

Ordinary complete runs may use the original producer's indexed Python file
partitions. Only `python-units` may repeat, in Python-only jobs whose plan
selector/files, named receipt, summary, step, unfiltered `unit_shards.py` command
and single raw telemetry row agree. Indices cover `1..total` once; files and
raw case identities are disjoint. Git's complete unittest file inventory
(including package initializers and hook-suppressed files) must equal the file
union, and the independently reviewed Python case inventory must equal the case
union. A completed empty partition keeps its files and exact `Ran 0`/`OK`
result; the complete reviewed case inventory and aggregate remain nonempty.

The aggregate Python step must equal the original producer combine result in
full: summed counts, status, exit, verdict, and every unchanged raw partition
with its `partition` metadata, in plan order. Every other aggregate step still
equals its single raw step exactly. The producer sorts aggregate `required`
names while raw summaries retain the original required order; partitioned
complete runs admit that exact original order as well as equal lists, with no
missing/extra/duplicate names. Original aggregate, partitions, logs, failure
blocks and red audit remain immutable; this creates no continuation or summary.
The partition reconciliation itself does not change the continuation parser
or shared unit failure-block parser. The separately documented
[source-reader correction](source-readers-8715.md) is combined in the same
reviewed installation.

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

### Explicit test-only non-overlap adaptation (8610)

V4 also accepts the exact manifest fields above **plus** `test_adaptations`.
When present it is a nonempty list of exact `{path, original_blob, source_blob,
live_blob, assembly_blob, reason}` objects, one per adapted non-overlap entry.
All four blob fields are mandatory; JSON null explicitly means absent. The
listing is inside the canonical body bound by the final independent resolution
review's `evidence_sha256`. Freeze it before that review. A review of an earlier
body, the original source audit, or the earlier assembly review cannot bind it.
Reviewer/record attribution remains subject to independent audit, not a
cryptographic signature claim. No review, context or signature default is added.

This bounded compatibility knows only `tests/ui_card_editor_652.test.mjs`, the
actual four-width Node unit: source blob
`23f57444c36c5a163f76b35ef7810532ab3af46a`, assembly blob
`8a18797a497672deefb66ba90cf42c15d3e2c4d9`, absent at original and live bases.
The exact reason is `Preserve live item 644 pointer focus(preventScroll) without
forced reveal or scrolling on ordinary redraw at all four widths.` (one line).
These reviewed test bytes and exact path establish qualification; an extension,
directory, candidate hash claim or reviewer label alone never does. Unknown
test families or other test edits require a separate reviewed source change.

Git independently supplies every original/source/live/assembly entry. Every
present entry must be a regular non-executable `100644 blob`; symlinks, gitlinks,
mode changes, source/base substitutions and absent assembly entries refuse.
Listed entries must be actual non-overlap mismatches with the exact reviewed
before/after blobs and reason. Empty, duplicate, reused, stale, inapplicable or
incorrect listings refuse. Every unlisted non-overlap entry stays exact to its
parent side; product never qualifies. All true overlaps still require the full
conflict-path listing, and the review still binds the whole binary diff.

Existing complete v4 envelopes without `test_adaptations` remain valid and
strict. This changes no source/controller/receipt, compact storage, post-merge
context, ordinary/no-record guard or immutable binding interface. The frozen44
source-only comparison is not full admission: its original own return and final
independent body/resolution review remain required.

### Genuine Pool own receipts (source-bound adapter)

Publication timing (warp8689): artifact creation must be no earlier than the
successful `Keep the evidence` step's `started_at`, and no later than exactly
two seconds after its `completed_at`. The original inclusive upload interval
remains valid. The bounded late interval is considered only after all existing
run/job/attempt/workflow/step, artifact name/repository/head/branch/digest,
wrapper parent/tree, pinned source/filter, original record/snapshot, ZIP and
raw receipt byte bindings have passed. Missing, malformed or timezone-free
timestamps and reversed upload intervals refuse. There is no candidate-selected
window, override, retry or source-pin refresh. Native exit 1 remains refused.
Measured derived facts retain the three unmodified timestamp strings, the
fixed two-second bound, computed interval and actual offset from completion;
no original timestamp or raw result is rewritten. All existing 651, original
and corrected 652, and narrow 717/715 profiles keep their exact source pins.

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
Their source, phase, identity and logging conventions require the separately
bounded reading/rail profiles below. The compose parser grants no additional
authority; original qualifications and final-base receipt obligations remain.

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
synthetic controls establish no final-base 717/715 receipt or acceptance.

### Exact 652 correction addendum (warp8652)

The reviewed correction2f4996b4, canonically assembled as7c4e13ba on the same original source/live parents, adds two exact test-only adaptations alongside the existing four-width pointer unit. tests/card_editor_652.mjs changes source blob68f60f880e532186cc49b972b3208a46203e4dfe tocb188b6c11f8aee76f61332e32e302ea45522736, absent in original and live. tests/ui_card_editor_652_contract.test.mjs is absent in original/source/live and adds blobb90dc6e506d7c474e27e6bb4009e4f3e168a6bfa. Each requires the exact fixed reason, mode100644, independently read Git entries and the same final canonical-body review binding. Only these enumerated bytes qualify; product and all unlisted non-overlap entries remain strict. New test addition is explicit null source, not permission to add arbitrary tests.

The exact corrected652 helper SHA256e400b065311cc5212a14ed8eeff5ab536dd2f6967b2bb7a0ed450d68d9e44c6d is an additional independently reviewed reporter profile. The original11b2e057 helper remains supported separately. Both use unchanged compose entrypoint ee64a06f, all456 expected identities and six phases. The correction preserves native press/focus obligations and captures original errors, event/handler delivery, media/computed rules and distinct restored artifacts. Additive diagnostic files do not replace original report/log/ZIP/API proof. No candidate-selected hash/schema override and no acceptance of a red receipt is introduced. Unknown helper bytes refuse. Final own receipt and narrow corrected assembly review remain mandatory.

### Additive exact 717 assembly profile (warp8750)

The independent auditor's `train45-live96-e6f6e5ec/final-test-inputs.json`
(SHA-256 `d970677dbda12ce88884c67bfcf4b976c1f286e6fe0aa61ad9761853b20267b5`)
binds one additional literal 717 profile: producer/assembly
`e6f6e5ec30b553511a839252d3aff73bbc12819d`, tree
`cdc7364d9372c3453ee3d3dc3d706647d585664a`, tests subtree
`ed9493b450303989e6c12c560b38ee0c75101e52`. Of the ten original 717 pins,
only `tests/stack_native.mjs` changes, to SHA-256
`55c328660130b03be5daa108187010780ec5fc716d7b0adfdc85962ab3c18b70`:
the reviewed live96 stack plus original 717 import/call. Original 717 and 715
profiles retain every field. The bounded composition below adds actual715 and
final717; the e6 profile and its evidence remain separate and unchanged.

Only the independently pinned tests subtree selects one of the literal profiles
for the requested family. Every shared workflow/command pin and every selected
source pin must then match exact bytes. Unknown trees and one-byte harness or
helper changes refuse; manifests and report self-hashes cannot authorize them.
Derived `schema_binding.producer` and `tests_tree` identify the selected profile.
All existing API/attempt/parent/tree/archive/raw-byte/identity/phase/cleanup,
normal zero-exit, exact inventory and fixed two-second publication checks remain.

This is a source-reader addition. Synthetic parser controls do not establish
actual 717 acceptance. The earlier e6 Chromium and WebKit calls are red and
certify e6 only; neither can supply a receipt for final717.
Original reds, qualifications, source continuation, complete-source admission
and release guard memberships remain unchanged. Independent review and a
commit-named installation follow this source handoff.


### Actual715 and final717 composition (warp8775/8778)

This source-only composition copies component6aff8bbb80b5f9301d3961f762609fd28c2dd3bc
exactly before the following additions. That component is not independently
approved or installed. The original715/717 profiles, exact e6 profile, and all
651/original652/corrected652 fields remain unchanged.

The actual715 sibling assembly is d9b93adfabed0e960a14febf9975de294429248b,
tree4a26a9ec3d3770650bcf8e9eca36c5c23f403d50, tests
cc5a7e74dc16adf9c81fa633fd27b2047f40eb39. The independent train46-live96-d9b93adf
REVIEW.json SHA256 is9dc6c79f23f8b79b6f8e13a4d56c4243f595f2a705eb7d17a3ef1a4f4b13eb3a;
final-test-inputs.json iscff75917627719ef2e639d2486403cfb061f89fc01c7116aef0bcd1a3ea4c57e.
Only outcome_rail_native.mjs changes from original715, to
5835f965cf4035e56524fe37c627e7f1abb1d4de63c834c0bf9494cb6c00b9b8.
Both coordinator-owned715 engine calls are in flight under8775 at task start;
this composition claims no pass or fresh authentication.

The final717 sibling assembly is dddf00e171fa3924f12e9a1c4f20cac5a6602d3c,
tree231373687757f80fe495194157b39f6935b3b550, tests
aa3a1417a26e171e33d89e778c34edd16dd24ef4. Its ordered parents are original45
f31e319994ecc96c5565828a53fde75c01bd3386 and actual96
0a68981b0fa25b9a6085c5f9ab1ecf8d16bf9b7d. Original717's ten pins remain,
with stack_native at55c328660130b03be5daa108187010780ec5fc716d7b0adfdc85962ab3c18b70
and dossier_promises_native at1d2472157ec5f3cbeb4d3bb9c18c0336d08a1f7920fa1e52e5a669b14787b4a0.
Actual Git bytes bind these literals. The final717 narrow independent review
arrived before freeze: train45-final-dddf00e1/REVIEW.json SHA256
b7084400786d383cda5159497ac59b7b9ec3f88d9891501c6bd2227db8a0bd11;
final-test-inputs.json SHA256
82e9f1204a1838035f2d4954b3036381f822dde5eac86f067e61d9f9af81ac5f.
Its ten pins and sixteen actual snapshots match Git and these literals.
This addition supplies no native authority. Under8764/8768/8778 the coordinator
owns ONE final717 Chromium/WebKit pair at that exact assembly, after applicable
review. It may remain red and hold45. There is no716 support or extra allocation.

Warp8778 permits exactly two nonoverlap adaptations in TEST_ADAPTATIONS:
docs/dossier-covers.md and tests/dossier_promises_native.mjs, with four literal
original/source/live/assembly blobs and fixed concrete reasons in base_move.py.
These document/test changes correct the requested-width oracle and retain
native Tab delivery/calibration plus separate mutant/restored results. They do
not alter product or the native Tab mapping. Existing652 literals are exact.
The four true overlaps remain interaction.md, acts.json, stack_native.mjs and
ci-input-reads.json; they still require complete independent diff/body review.
The assembly's ci-input-reads expansion is exactly one repository read-list,
adding eight actual snapshots: reader_persistence_native.mjs,
topic_reading_native.mjs, webkit_native.mjs, web/aim.css, web/arrow-reach.mjs,
web/index.html, web/layout.mjs and web/message-menu.mjs. Every claimed actual
source hash remains validated. No declaration is changed in this tool clone.

Unknown tests trees, harness/helper bytes and adapter changes refuse. Literal
selection remains family plus exact tests tree, followed by every source pin;
no manifest chooses hashes, reasons or a schema. Product nonoverlap changes
remain refused. Ordinary/continuation readers, exact assembly parenting, API,
ZIP, attempt, provenance, two-second publication, inventory, identity, phase,
cleanup, normal exit0 and both-engine obligations retain their existing guards.
Original171 reds, historical incomplete acceptance, all original715/717
qualifications and source authority remain. Synthetic fixtures test readers only.
Combined independent review and one commit-named installation are coordinator
next steps; no install, push, deploy, browser, Pool or product call is made here.

### Final715 and fresh649/656 literals (8821)

Final715 adds only the independently bound4225184688d7503296e1c0034f1418cb48f4a9d3
profile (tree28acdaa0460ab1ec990e0cea136049cf37715757, tests
313a5d22de9923f419a0a474a8f0a3e19a611702). Two enumerated nonoverlap
adaptations bind every original/source/live/result blob, mode100644 and a fixed
reason: outline_stars_native's35 inserted state/reopen/readiness lines preserve
all original assertions, and webkit_native changes one stale SKIPPED literal.
Every other nonoverlap remains strict. Existing652/717 adaptations and original
profiles remain exact. Final715's prior94/100 and94/101, exit1, and original200
full-run failures remain failures; the coordinator's final pair is not a pass
until genuine receipts prove it.

Fresh train48 is8737fa03cb3a9ec587d8b7b3678a96352b85fd1b, tree
8f99a0270e6c487331f14a74aa5bdc11b228568c, tests
936aff89743a7fbc2515129e90eb57d0ae4e028f. Exact canonical head/tree,
195 static input pins (including the416-edge import closure), five literal
reporter/mode snapshot lists and ordered identities authorize only649's
reading/webkit-reading filter`item 649`, and656's colors/webkit-colors/header
filter`item 656`. No WebKit header mode is declared. Source declarations are
frozen data here; no candidate source parser or producer-selected schema runs.
Unknown trees, families, source bytes, missing inputs, changed case order,
duplicates, API/ZIP mismatches, nonzero exits and unclean teardown refuse.

649 uses the pinned reading reporter schema;656 additionally emits oldhead,
base comparison and ledger mutant diagnostics between case records. These
records remain ordered, schema checked and source bound, with caught failures
and exact restored controls required; they are never discarded or counted as
extra cases. Chromium keeps its actual start/result stamps and complete action/
cleanup phases; WebKit keeps engine/ms on its rows and has no phases file.
Neither engine gains an invented timestamp, phase or engine field.

Original649 remains126/128 Chromium (two741 privacy branches) and128/128 WebKit,
18 starts;656 remains70/71 in both engines, field-return mutant survived,
restored phase absent, B2 gear unrun746,28 starts. These literals can validate
future genuine exact-source returns, not waive these reds. Retired47's fatal
native-openings receipt still refuses; there is no withdrawal guard form.
Final717 is red and held to tomorrow732. Whole-source45/46 envelopes, fixture
teardown, exact inventories, independent obligations and both-engine coverage
remain mandatory. This complete delta from installed10aea requires ONE
independent review and installation; no source admission, runtime green,
allocation, installation or self-approval is supplied here.734 is excluded.
