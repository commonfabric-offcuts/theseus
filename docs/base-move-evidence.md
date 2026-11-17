# Reviewed base move (candidate contract)

A judged-first train may optionally name `base_move: {path, sha256}`. Without it,
the direct-parent/same-tree rule is unchanged. The referenced JSON and every
artifact use strict, duplicate-rejecting JSON; file references are absolute paths
and SHA-256 digests. This is evidence consumption, never a test producer.

The assembly is exactly a two-parent merge of the original judged head and the
new live commit, in that order. The release merge's parents are exactly the live
commit and the assembly; its tree equals the assembly. Both original and new
bases are explicit. Paths changed only on one side retain that side's exact git
entry. Only paths changed on both sides may be resolved, and the review must
name all of them. No extra feature commit may intervene.

The evidence binds a complete original hosted run, its downloaded summary,
provenance and shard artifacts, a frozen named-case inventory, the exact new live
release, assembly and tree, and three passing receipts per own case in each
required engine. The independently recorded review binds all those bytes and
the full binary diff from the original judged head to the assembly. The tool
checks raw counts, case identities, clean snapshots, source hashes, completion,
cleanup and run/check bindings; the original run's conclusions stay unchanged.

The auditor judges inventory completeness, which cases belong to affected
pieces, preservation of intent in overlapping paths, and whether the named
review was actually independent. A reviewer's name is an attribution, not a
cryptographic identity. Missing authentic source artifacts, snapshots, engine
coverage or a recorded independent review blocks this form. Do not manufacture
receipts or substitute an audit string. See the review report for the exact JSON
schema and construction example.

## Wire format

`Ref` means exactly `{"path":"/absolute/file", "sha256":"64 lowercase hex"}`.
All new envelope fields below are required, with no others. Duplicate object
keys, non-JSON constants, booleans in number positions and duplicate obligations
or receipts refuse. Original producer documents keep their existing formats;
their existing raw-evidence validators are reused, with duplicate-key rejection.
The train's existing seven keys are unchanged, plus optional `base_move: Ref`.
It is accepted only for `kind: "judged-first"` with its original judgment.

The referenced base-move document is:

```json
{
  "version": 1,
  "source_head": "40-hex judged commit",
  "original_base": "40-hex exact merge base of source_head and live_base",
  "live_base": "40-hex current live commit",
  "live_release": 91,
  "assembly_head": "40-hex merge with parents [source_head, live_base]",
  "assembly_tree": "40-hex actual assembly/release tree",
  "source": {
    "run": 12345,
    "attempt": 1,
    "files": {
      "release-check/summary.json": {"path":"/evidence/run/release-check/summary.json","sha256":"DIGEST"},
      "release-check/provenance.json": {"path":"/evidence/run/release-check/provenance.json","sha256":"DIGEST"},
      "check-0/summary.json": {"path":"/evidence/run/check-0/summary.json","sha256":"DIGEST"},
      "check-0/run.json": {"path":"/evidence/run/check-0/run.json","sha256":"DIGEST"}
    },
    "inventory": {"path":"/evidence/reviewed-source-inventory.json","sha256":"DIGEST"}
  },
  "receipts": [
    {
      "snapshot": {"path":"/evidence/own-case/clean-snapshot.json","sha256":"DIGEST"},
      "step": {"path":"/evidence/own-case/step.json","sha256":"DIGEST"},
      "report": {"path":"/evidence/own-case/native.json","sha256":"DIGEST"},
      "log": {"path":"/evidence/own-case/step.log","sha256":"DIGEST"}
    }
  ],
  "review": {"path":"/evidence/independent-review.json","sha256":"DIGEST"}
}
```

The example is deliberately incomplete: add **all** original shards and their
native reports, logs, unit logs and replay artifacts to `source.files`, under
the relative paths of the downloaded run. No focused or scoped source summary
is admitted. Every required step must occur exactly once across the shards,
with the same original run/attempt, clean source and actual source tree. The
shard summary digest must equal its original `run.json` receipt. Raw tool and
harness git blob hashes must equal the original head's git entries. Unit and
replay steps must pass; browser failures must be completed cases with successful
teardown. Raw aggregate and shard verdicts must agree with their steps. The
GitHub producer is exactly the one original `judgment.producer_runs` entry,
completed with success/failure, workflow `Checks` at
`.github/workflows/checks.yml`, and the recorded attempt. Each completed judgment
check has the original head and a success/failure conclusion, and its GitHub
`details_url` names that producer run (`/attempts/N`, or the bare run URL only for attempt 1). Standard
`/job/ID` links (with optional `?pr=N`) must additionally match the check's API
URL in the exact original attempt's paged GitHub jobs inventory (bounded at
1,000 jobs). Other check linkage is not inferred; absent linkage blocks this form.

`source.inventory` is the existing independently reviewed full-run plan, frozen
as a JSON object keyed by every required step: native values are full case
identity lists (`name`, optional `phase`, `engine`, `expectedFailure`), unit
values are their full check identity lists, and `wake-replay` is its existing
traffic object with `routed` actors. Copy these facts from the original reviewed
plan; do not discover a plan by listing only cases that happened to run. The
machine requires exact native inventory coverage and all planned unit identities;
the auditor verifies that this plan is the original complete obligation set.
No source classifier verdict is rewritten or bypassed by claiming a new pass.

Each own-case receipt consumes an existing native step row, raw native report,
raw log and recorded clean source snapshot. The snapshot is exactly
`{"head": ASSEMBLY, "tree": TREE, "changes": "", "inputs": {"tests/harness.mjs": GIT_BLOB_OID}}`.
The whole tree binds all repository inputs, including product code; `inputs`
additionally requires the actual harness's git blob hash and checks every listed
input hash. These are git blob object IDs (40 hex), not file SHA-256 digests.
Only snapshots at the exact assembly are supported; no assertion of unchanged
inputs from a different head is accepted. Runtime/system inputs still depend on
the original runner receipts and the auditor's comparison.

The step row must retain its original `tool` and `argv`, naming the expected
harness and mode flags, with at most one case filter. A result-only stdout
fragment without its recorded command cannot stand for that binding.

Receipt results must have exact case name, phase and explicit engine, pass,
nonempty counts, normal exit, and the harness's browser/fixture completion.
Expected failures do not stand for own-case passes. Chromium-only harnesses
cannot attest WebKit. Dual-engine harnesses may report both. A single-engine
harness must already report an engine explicitly; no engine is invented from a
filename. Each obligation needs exactly three distinct executions. Distinct
artifact digest tuples prevent reusing one receipt three times; the auditor
checks actual execution provenance rather than trusting three copied timestamps.

The review document is exactly:

```json
{
  "reviewer": "independent reviewer's attribution",
  "record": "independently recorded resolution review ID",
  "judgment_audit": "original judgment.audit ID",
  "evidence_sha256": "SHA256 of canonical base-move JSON excluding review",
  "diff": {"path":"/evidence/resolution.diff","sha256":"DIGEST"},
  "conflict_paths": ["path/changed-on-both-sides"],
  "obligations": [
    {"step":"native-compose","case":"exact own case","phase":null,"engine":"chromium"},
    {"step":"native-compose","case":"exact own case","phase":null,"engine":"webkit"}
  ]
}
```

Canonical JSON is UTF-8 `json.dumps(body, sort_keys=True,
separators=(',', ':')).encode()`, with default ASCII escaping. `diff` is the
exact output file of `git diff --binary --full-index --no-ext-diff --no-textconv
--output=FILE SOURCE_HEAD ASSEMBLY_HEAD`. This freezes the entire base movement,
not just conflict markers. `conflict_paths` names exactly every tracked entry
changed on both sides since `original_base`, even when git merged it cleanly.
Modes, deletions and gitlinks count as entries. All other entries must equal
the appropriate side byte for byte through their git entry identity. The auditor
checks intent preservation inside overlapping files and that each affected
piece's own named cases is listed. Both engines are required for each case and
phase; separate engine steps may be named when the exact case names agree.

Freeze receipt files and the body first, have the independent review bind its
canonical digest and exact diff, then hash the review file and freeze the final
manifest. Finally hash that manifest for the train's `base_move`. This ordering
avoids a circular hash. A coordinator may index/copy existing artifacts and
freeze a review; it must not backfill missing measurements or source snapshots.

## Reporting and limits

`00-train.json` and `measurements.train` retain the original GitHub judgment
unchanged, plus a compact `base_move`: exact heads/tree/base/release, manifest
reference, review reference, original raw verdict, source summary/provenance/
inventory references, artifact-index digests, receipt count and obligations.
The full frozen manifest holds every artifact digest. Keep that manifest and
its referenced files through release review; a digest without the retained file
is not usable evidence. No full run on the assembly is requested or claimed.
The live release number and commit are checked against the normal release plan
before any process stops. The existing PR identity, release-branch comparison,
approved ancestry, live-head recheck and deploy mechanics continue to apply.

This form supports exactly the merge structure above and the frozen tool's
required step set. Different merge structures, incomplete artifacts, renamed
cross-engine cases, absent engine annotations, missing clean snapshots, a
check without producer linkage or a source plan that cannot be independently
recovered are blockers. They require real evidence or a separately reviewed
contract change, never a boolean override.
