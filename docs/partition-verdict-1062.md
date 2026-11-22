# 1062: Partition-aware protected Verdict

The protected controller is the only executable authority. This change reads
producer data without importing or running candidate/base modules. Raw verdicts,
source binding, artifact digests, profile checks and unrelated refusal rules keep
their existing authority.

## Intake

Own branch `core-lane8/1062-partition-aware-verdict`, own worktree
`/Users/commonfabric/aim-worktrees/core-lane8-1062-partition-aware-verdict`.
Fresh origin `codex/aim-next` and local protected base both resolve to
`a932e98ddcb535f8dde78875f8024fe064109b1f`, tree
`343240c2949cd6531931aa0b53894a17419dbe17` (2026-11-21 intake).

Executable owner: `tools/ci_known_reds.py`. Relevant consumers are
`history_missing_steps`, `read_evidence` / `_read_evidence`, `unit_evidence`,
and fresh-compose `f779_plan` / `f779_validate`. The first four diagnosed sites
reject repeated step names or compare each part against the aggregate. Intake
also found `f779_plan`'s ordinary-step multiplicity check, which rejects the
same Python partitions when fresh compose groups coexist. It must use the same
partition authority while keeping exact compose-group validation.

Producer format owners (read as data/source, unchanged by this work) are the
newer release branch's `tools/unit_shards.py`,
`tools/release_check.py::combine_unit_results`, and
`.github/workflows/checks.yml`. Existing protected tests are
`tests/test_verdict_history.py`, `test_verdict_git_base.py`,
`test_verdict_base_tree.py`, `test_verdict_summary.py` and
`test_tools_release_check.py`.

## Admission and source coverage

Legacy whole-step plans remain accepted exactly once. The supported existing
partition format is a job containing only `python-units`, `python_shard` as
canonical `INDEX/TOTAL`, and its `files` list. Distinct indices must cover
1..TOTAL exactly once; all totals agree. A whole Python job cannot coexist with
partition jobs. Other repeated ordinary steps, unknown steps, unsupported
partition metadata, unknown/out-of-range/duplicate/missing parts, duplicate files
and an incomplete source-file union refuse. No hardcoded four-part default:
four is the current producer plan, while the declared complete total governs.
The file union is checked by reading the judged commit's Git tree and matching
unittest's import-free package/file discovery, never executing its tests.

## Per-part evidence and aggregation

Every planned artifact still needs its original receipt and SHA256-bound summary,
correct run/attempt/source, tool/harness hashes, profile and actual log outcomes.
A Python part's top-level and step `python_shard` metadata must match its assigned
index, total and exact source files; its job name must match the plan. A validated
partition may contain zero tests (package initializers/empty bins); the completed
aggregate must contain positive tests. Legacy whole-step zero tests still refuse.
Candidate non-browser failures and skipped/todo/incomplete outcomes still refuse.
History may retain only the same fully evidenced failures it accepted before.

Recompute one Python receipt from the complete parts: add test/failure/error/skip
counts, derive status/verdict/exit, keep each original step and its partition
metadata in `shards`, and require exact equality with the producer's combined
receipt. Preserve failure identities in the raw per-part logs; duplicate executed
identities across parts refuse. No claimed summary count replaces log evidence.

## Final coverage and historical selection

After every part is verified, its complete union contributes Python exactly once
to final required-step coverage. Legacy ordinary steps remain exactly once;
fresh compose retains its separate exact grouped union. Missing/cancelled
artifacts, inconsistent or forged metadata, duplicate/extra artifacts, altered
aggregate counts/shards, and incomplete final coverage refuse for both current
and historical readers. Historical selection recognizes a structurally complete
partition plan rather than mistaking it for duplicate whole steps; genuinely
missing required results remain named as missing and never become passing proof.

## Verification and delivery

Before product edits, retain actual red output for four-part admission through
current and historical reading, aggregate tampering, and fresh-compose coexistence.
Keep refusal cases for three-of-four, duplicated whole, duplicate/unknown part,
wrong files, cancelled/missing evidence, changed digest, failed candidate units,
legacy behavior and final union. Use isolated scratch repositories/evidence only.
Run the focused controller tests and the affected existing owner files on base
and head, retaining full diagnostics and source START/END hashes. Apply actual
admission/aggregate/coverage faults, observe failure, restore exact source and
rerun with a unique Python cache per phase. One workload under load <=12/18;
no browser or live/runtime/tool installation changes.

Deliver the exact new commit/tree, whole diff, contract, raw evidence and remote
branch as a PR against `codex/aim-next`. Auditor reviews; Warp merges and operates
it. This assignment does not deploy or prove a later 1021 Verdict passes.
1038 Build2 then1043 Build1 remain preserved behind1062.

## Second head: source inventory correction (auditor16418 / Warp16420)

The first head and published packet remain immutable. Git path output is a
byte-delimited protocol: request `ls-tree -r -z --name-only` and split on NUL,
using the filesystem decoder so valid Unicode paths are retained and unrelated
non-module byte names do not break discovery. Never parse C-quoted display names.
The filename gate is the producer's case-sensitive `Path.match('test_*.py')`
followed by unittest's valid-module-name pattern; `.PY` and non-test prefixes
remain excluded. Retain the same package traversal and initializer ownership.

Before product edits, reproduce a correct complete Unicode plan being refused,
its omitted-file plan being admitted, and the uppercase `.PY` false positive.
Add direct package/discovery checks including Unicode and a newline in a package
name, so the NUL boundary and package rule are tested independently of a display
configuration. Keep all25 existing checks and their assertions intact. Recheck
the five existing controller owners and retained325 inventory; apply the actual
C-quoted-name and suffix-rule regressions and verify exact restores.

The protected base remains a932e98ddcb535f8dde78875f8024fe064109b1f. The new own
branch/worktree starts at first head82b13e6c. Warp16427/Fable16436 resolve the
initial wait-for-lens hold into the concrete corrections below; freeze only once
they are incorporated and evidenced. Auditor clean head2 review precedes merge.

## Producer format and isolated refusals (16427 / 16437 / 16439 / 16446)

The exact325 producer is cce9aeea87050f08097b6577b3de74be937e5926.
Its unit_shards.py writes both plan and observed partition file lists sorted;
its release_check.py combiner553-606 copies each original step with `partition`
metadata and builds exactly the aggregate fields used here. Sorted file equality,
exact aggregate equality (including original shards), and import-free discovery
matching are that producer's contract. A producer format change breaking any of
these equalities remains a refusal requiring a reviewed controller change.
The retained325 probe checks these exact current shapes; it is not raw shard-log
verification or a passing Verdict.

A supported empty partition has selected files but no cases (for example package
initializers or a discovery hook suppressing cases), a completed `Ran 0` line,
literal `OK`, exit0 and a passed producer verdict. unit_shards.py explicitly allows
a chosen partition with no cases; release_check.py judges `code == 0 and judged`
and enables its allow_empty parser only for python_shard. The full union must
still have positive tests. A missing Ran line or `NO TESTS RAN` is not a passing
empty-part receipt under this producer/parser and must refuse. This reading does
not claim any retained325 partition was empty or admit every unittest format.

The missing-fourth-part and whole-Python-plus-parts tests now construct independent
plans with complete matching receipts/artifacts from their factory inputs. The
missing-part fixture assigns all source files across its three present parts, so
only the fourth part is absent. Both full readers and historical selection must
name the exact intended partition/plan refusal. No shared post-write plan mutation
or generic exception can stand in for this evidence. The newest-three selector
and dirty-history policy remain unchanged and outside this correction.
