# Scoped pull-request checks (item 734)

`tools/unit_shards.py --plan` computes a version 2 input coverage record with
`tools/ci_input_reads.py` from the exact event base and tested merge. It reads
committed files only, including product files and both trees' read declarations.
It never trusts a caller-selected changed-path list. The source head, tested tree,
base, every changed path, per-step input digest and changed-input intersection
travel with the plan. Every omitted step must have an empty intersection.

Shared imports, literal reads, dynamic read declarations, discovered unit files
and native harnesses contribute readers. Product inputs conservatively reach all
steps. A declaration classifying generated/system/product reads never makes a
product input external. Added/deleted files use the union of both trees. Unknown
changed files and undeclared reads refuse scope. Declaration/discovery changes
select all steps; neither tree may bypass the read audit. More than five changed
files is supported; the legacy local small-fix format retains its separate bound.

Units, deploy refusals and replay remain mandatory. Native modes run whole.
Browser shards deal selected modes longest first across actual97's four measured bins, omitting empty
jobs. Four measured Python partitions, independent Node and deploy-refusal jobs,
and replay retain their existing limits and completeness checks. Missing, dirty,
cancelled or partially completed jobs cannot become green. Raw failures remain
failures. Push/manual events and unavailable PR scope receive the full run.

The aggregate retains the complete `required` inventory and marks omitted modes
in `scoped`, never as passed. The protected validator independently recomputes
version 2 coverage. Its existing authority policy, authenticated workflow/run
binding, raw case checks and refusal rules still apply. A changed policy does not
approve itself.

Deployment of this new format requires an explicit `scoped` evidence reference
on a judged-first train. `tools/train.py` checks authenticated PR source,
base, tested merge/tree, workflow head/ref, producer/controller run and attempt,
App publication, archive digests, independent reviewed inventory, every raw
result/log and cleanup. It recomputes the coverage from the actual live base.
Direct local version 2 summaries cannot authorize deployment. The checkout and
recorded live release are re-read before stopping. Missing/no-record/stale/dirty
or partial evidence refuses. Existing ordinary trains and legacy summaries keep
their existing rules; there is no inferred exception without the explicit record.

The historical nightly proposal stays in the retained source archive. This
composition adds no schedule or controller and retains the installed job layout.

Full schema and build-only boundary: [scoped-inputs.md](scoped-inputs.md).
