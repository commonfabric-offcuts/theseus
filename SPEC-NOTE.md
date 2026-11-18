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

Final fit limitation: the external ledger retains 59 completed observations and
all named `(phase, name)` inventories from PR86/train49. Their ephemeral tested
merge objects are absent in this clone, so no complete-input equivalence is
asserted and no eligible observation is seeded. Current full browser planning
refuses, as designed. Train44's original summary was located and independently
read: 1694.395223 seconds, source4b565b2a,259 cases. The 90-minute proposal can
refuse even train45's64-minute reading step (1.5x+5 >90); it never silently raises
that bound. Original 100-minute and one-off147-minute allowances do not resolve
this future-default choice. Coordinator/warp owns that ruling and the next
bounded measurement phase. See docs/shard-budgeting.md for the record API.
