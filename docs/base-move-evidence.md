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
exactly `Verdict` when current and original base facts are equal, or exactly
`Verdict for BRANCH` when they differ, where BRANCH is authenticated `current_base.ref`,
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

V4 selects exactly one authentic receipt shape using equality of the complete
`current_base` and `base_at_run` facts (both ref and SHA). When equal, the plain
shape requires `published.json.name == "Verdict"` and `base == ""`, exactly as
in the original early-refusal receipt. The empty publication base is not a
base fact: producer PR and trusted check API PR must still bind the full current
ref/SHA, equal to the original base. When unequal, the retargeted shape requires
`name == "Verdict for " + current_base.ref` and `base == current_base.ref`.
All three published/API/archived check names must equal that selected name.
Names and publication base fields cannot cross shapes; absent fields refuse.
There is no fallback based on which name happens to be supplied. Original
merge facts absent from an early refusal remain absent; full-source provenance
and Git must independently bind the original merge. Nothing is relabeled.

V3 envelopes refuse under v4. This changes only controller receipt compatibility;
Train38 stays red/held and original39/40 retain their original judgments.
No same-tree acceptance, item719 change or normal-path change is made.
Independent review must include #7715's measured geometry tolerance rule; no
measured layout case is expected for this change.
