# 740 — fit-first planning under warp9266

The default is `browser-120m-fit-first-v1`: 120 minutes per browser job,
5 minutes reserved for setup/upload, and 1.25 times the maximum retained timing
by step name. These are policy capacities, not ETAs or platform guarantees.
This supersedes the earlier 90-minute refusal proposal.

Item734 selects conservatively through its existing committed input graph.
Timing does not grant scope, source equivalence, acceptance or cleanup authority.
Tested-merge availability and current complete-input equivalence are not timing
selection gates. Different source/runtime/inventory observations stay visible.
The next run replaces stale timing inputs; missing or stale timing never refuses
an otherwise valid plan. Raw failed results and interrupted shards keep their
original verdicts.

Pack whole steps deterministically, longest first. Add bins as needed. Steps
longer than half the usable measured-time capacity (46 minutes), steps with a
partial observation, and unknown steps run alone. Every unknown bin receives the
full 120-minute capacity, with null measured/budget minutes, until its first run
supplies a measurement. No median is assigned. Every selected step appears
exactly once. A padded observed step exceeding 120 even alone causes an explicit
refusal naming that step and its duration; no shortened inventory is emitted.

`.github/check-weights.json` retains the night's original step observations:
completed summary/report timings, completed result-log intervals (including
preflight/transition), and explicitly marked partial case-time lower bounds.
The maximum is taken across these retained planning inputs. Every row includes
source, runtime provenance, inventory count/hash where available, original
artifact/log hashes and qualifications. A partial case-time sum excludes overhead
and error paths without timings. It is never a completed whole-step upper bound.
Its planning budget is arithmetic on that lower bound, not a completion promise.
The original compose progress is incomplete; no completed82-minute compose
measurement is asserted. Own-case 650/721 job walls are context only.

`browser_observation(summary, report, step, identity, evidence)` formats a finished
step after authenticating its original artifact separately. Identity may be null
when complete input equivalence is unavailable. It retains `(phase, name)` case
identity, wall duration and cleanup; a failed completed step can inform timing
without becoming green. `browser_identities` remains available for provenance,
but the fit-first planner does not require it. Original partials without a final
summary retain `complete:false`, `kind:partial-lower-bound` and their raw hashes.
Completed log intervals use `kind:completed-log-interval`; a missing full named
inventory remains explicitly null, never manufactured from a count.

To refresh timing after the next run, authenticate its exact summary/report and
runtime/inventory, format its observations, archive the old ledger, then assign
`weights['browser_observations'] = replace_browser_observations(old, fresh)` in a
reviewed metadata change. Supply all observations to retain for each refreshed
step; the helper replaces those steps only, preserving every other step. The
planner uses their maximum. This is an explicit metadata refresh, not a new
scheduler, automatic dispatch or a new acceptance path.

Python retains the existing four-way whole-file allocation, import-free inventory,
discovery/load hooks, timing and exact collector union. Each partition runs
`python-units` alone at a 49-minute job capacity (`python-49m-partitions-v1`),
including Python4. Historical file estimates including setup are diagnostic;
they are not substituted for the 49-minute capacity. The old allocation fallback
is unchanged to preserve partition membership and makes no new-file duration
promise. Node, deploy-refusals and replay retain their independent limits.

Install planner, timing weights and workflow together into the source used for
future train cuts after independent review. Existing jobs and frozen continuation
wrappers remain untouched. See REPORT.md for exact source, evidence, full plan,
original cut truth and coordinator install/revert mechanics.
