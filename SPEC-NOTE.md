# 740 correction under warp9266 (future cuts only)

This supersedes the inherited 90-minute refusal proposal. Default policy:
`browser-120m-fit-first-v1`: 120-minute capacity, 5-minute setup/upload reserve,
1.25 times the maximum retained observation by step name. Timing selection does
not require tested-merge objects or current complete-input equivalence. Retain
source, runtime, inventory and original receipt provenance; timing is never
acceptance. A partial elapsed interval is a lower bound, never a completed upper
bound. Failed results remain failed. No case is removed, split or truncated.

Unknown steps run alone at full capacity and supply their first measurement.
Stale timing is used for planning and replaced by the next observation, never a
reason to refuse. Long steps (more than half the usable measured-time capacity)
and steps with partial observations run alone. Deterministic longest-first packing
adds bins when necessary and checks exact coverage. An observed step whose padded
time plus reserve exceeds 120 refuses explicitly, naming its data; no silent
omission or invented duration. Capacity is policy, not an ETA or guarantee.

Python keeps the exact existing four-way whole-file deal, discovery/load hooks,
wall timing and collector coverage. Every Python partition has a 49-minute job
capacity and runs only python-units, including Python4 alone. Historical file
weights retain their allocation role; no new median-based duration promise.
Node, refusals and replay retain independent limits. Raw verdict, continuation,
cleanup and conservative item734 scope semantics remain intact.

Install requires the coordinator's independent auditor reading this corrected
contract. Carry planner, weights and workflow together into the source used for
future train cuts; change no live product or running job. This builder installs,
dispatches and pushes nothing. REPORT.md will name exact install/revert mechanics,
original receipts, full runnable plan and focused red/mutation evidence.
