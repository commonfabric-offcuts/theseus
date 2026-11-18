# 740 — bounded browser planning (proposal; not installed)

Source: live98 `851471193d72f88312d428bb9e0383dae887a4e0`.
This change is for future plans only. Existing jobs, wrappers, receipts, verdicts,
continuation unions, cleanup and item734's conservative selection stay intact.

Contract: select through the existing item734 input graph first. Budget whole
native steps using the maximum completed, source/inventory/runtime-fitting
observation, never a median. Bind measurements to the exact committed input
manifest for that step and its command, plus a complete named case inventory
fingerprint and normal browser cleanup. A failed completed step is timing
information, never a passing verdict. A partial prefix is neither completion nor
an upper bound. Preserve observations and their provenance rather than overwriting
older maxima. Old scalar weights remain historical information only.

Chosen default: `browser-90m-refuse-unmeasured-v1`, a **configured capacity** of
90 minutes/job, with 5 minutes reserved for checkout/browser installation and
upload, and 1.5 times measured step wall time. This is a conservative planning
policy, not an ETA, measured setup guarantee, or GitHub platform limit. The old
76/77-minute browser and 18-minute Python cuts match our configured job limits;
the retained records do not establish a universal hosted cap. The one-off 7/147
continuation allowance is not a default. Coordinator/warp must resolve any desire
to use 100/147 instead of this proposed default before installation.

Pack deterministically within that capacity; the requested shard count is an
initial parallelism preference, not permission to overfill. More whole-step bins
may be needed. Refuse any unmeasured/stale/new step or a single step whose padded
wall time plus reserve exceeds capacity, naming the whole blocked inventory.
No automatic timeout escalation, arbitrary case splitting, prefix acceptance,
coverage omission or failure rewrite. The named conservative fallback is refusal
until an independently authorized complete measurement or trustworthy full-step
completion boundary exists. No orchestration or new continuation acceptance path.

Evidence: train45 start/result log deltas include preflight and are conservative
observations, not exact inner step times. PR86 finished summaries carry actual
step timestamps; train49 check0/1 are complete and check2/3 partial reports do not
certify their unfinished modes. Train49 includes cases absent at live98, so its
measurements cannot be represented as unchanged live98 source. 650/721 own-case
job wall times are capacity context, not whole-compose measurements. Compact
source-bound observations and original artifact hashes will be retained in the
evidence directory; no large artifacts enter Git.

Python4 PR86/train49 and 737's 55-minute Python cut remain unresolved by this
browser correction. Whole-file Python weights and discovery timing need their
own bounded follow-up; this change must not claim all hosted timeouts solved.
Validation here is focused CPython3.9 planner/collector/selection contracts,
genuine red/green and applied/caught/restored mutations. No browser, full suite,
runner, dispatch, install, PR or push is authorized. Missing hosted source-fitting
measurements will be returned explicitly for the next bounded phase.

## Measurement record and fit

`tools.unit_shards.browser_identities(ci_input_reads.source_files(root, commit))`
computes a SHA-256 manifest for every native step through item734's complete
input graph. It includes command definitions, imported case generators, fixture
reads, product bytes, policy and the workflow's runner/runtime selection. Only
`.github/check-weights.json` is excluded from this fingerprint; item734 still
selects all native steps when that metadata changes. Source or workflow changes
invalidate earlier observations unless the complete manifest remains equal.
The fingerprint does not promise an unchanged future macOS image or machine load.

For an independently authenticated final summary and final native report,
`browser_observation(summary, report, step, identity, evidence)` retains seconds,
source commit, input fingerprint, case count and SHA-256 of the full sorted
`(phase, name)` inventory. Reader mutation/restored phases remain distinct.
It accepts finished failed steps as timing data without changing their verdict.
It requires final summary completion and normal reported browser/fixture cleanup.
`evidence` names `run`, `artifact`, `summary_sha256`, and `report_sha256`; retain the
original ZIP and independent source proof beside the measurement. This API is a
measurement formatter, not an artifact authenticator or a passing-run validator.
Only independently checked records enter `browser_observations` in the weights.
Same-input observations with different complete case inventories refuse.

There are deliberately no seeded eligible observations in this proposal. The
retained PR86/train49 summaries provide 59 completed step observations, but their
exact tested merge objects are unavailable in this clone. Source and complete
case inventories are recorded in the external evidence ledger, with input fit
unproven. None becomes a live98 bound by copying its scalar duration. The current
full browser plan therefore refuses before producing matrix output. Installation
requires a separately authorized source-fitting measurement phase and independent
review; no current release waits for it.
