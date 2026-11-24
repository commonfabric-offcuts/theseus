# Fresh agent boot plan review

All eight reviewers read the complete immutable draft
`3d27c16fe8da77c8b33360b839289ba578cc393f`. The findings below are reconciled in
plan commit `7d184caad4231a44123768916e021ac96bcf4ed0`; section names refer to
[the plan](fresh-agent-boot-plan.md). This is document reconciliation, not each
reviewer's approval of revised operational claims, runtime readiness or a trial.

Tony subsequently clarified the whole-system objective (23423), physical reboot
and lost scratch (23438), and hosted Fable/Auditor target (23442/23459, Warp23486).
Those changes supersede the original observer/exclusion and external-Fable
trial proposals. Focused whole-system review is tracked below; none of the
eight first-round replies is relabeled as that review.

## First-round sources

Every response below is revision 1 in the Releases topic
`t-9e76576dce8d4e6082f163ddb3697490` and reviews the same draft above.

| Reviewer | Full response | Result |
| --- | --- | --- |
| Warp | 23397, `m-168c3a278efe4b91a7838a6b2c1a6450` | Seven findings reconciled below. |
| page-lane5 | 23398, `m-1b76df6bf8b74d32a903ef70887a3e8d` | Two findings incorporated. |
| Fable | 23400, `m-5ffed2e3799f46218ba8d7ba8ac4967e` | Four findings reconciled. |
| page-lane6 | 23403, `m-09f63d0a61604c2d89e5f68108c1c1d0` | Three findings incorporated. |
| core-lane8 | 23404, `m-60ad6f15664246a980e89623d2bfa3d2` | Three findings reconciled with Core7's chosen contract. |
| test-steward | 23408, `m-0bda923ae8524c329eac7e5888196e8b` | Three proof corrections incorporated. |
| core-lane7 | 23412, `m-125eb520383e449d8be1bbf218b84b26` | Four implementation boundaries incorporated. |
| Auditor | 23415, `m-8209a8d7c4a3464c8486a7cdaaf011b1` | Six findings incorporated. |

## Finding dispositions

“Required” means the plan now states the condition and its execution owner. It
does not mean implementation or live proof already exists.

| Finding | Disposition and implementing section |
| --- | --- |
| W1: Last-activation clock hides startup delay; idle agents need mail before activation. | Accepted: **Authority, admission and partial results**, **Execution sequence**, **Shipping and prediction acceptance**. Earliest owner act includes shutdown/reboot; acceptance→delivery→activation is explicit. Warp23419 and Fable23422 resolve the revised clock. |
| W2: Unchanged Warp can land a preapproved piece without testing recovery. | Accepted and strengthened by Tony: all agents including lander/coordinator fresh; causal act plus post-boot forecast cohort in **Execution sequence** and **Shipping and prediction acceptance**. |
| W3: Fable needs a real fresh launch, not continued chat. | Original external-chat procedure superseded by hosted target; supported same-actor migration and single-owner handoff required in **Every actor and its route** and execution steps6–7. |
| W4: Owner CLI/page transport is unverified. | Accepted: **Current capability and prerequisites**, **Authority** and prerequisite table require actual Tony-bound entry; no borrowed profile. |
| W5: Activation must be available through supported reads. | Accepted: **Evidence, acceptance and reconciliation** separates owner status, Health receipt/24-hour retention and actual first command. Core7 supplies fields; no SQLite substitute. |
| W6: Intervening runner-policy landing could interrupt the trial. | Accepted as execution-bundle freeze and readiness sequencing; all required runtime landings precede physical boot. Changes during the trial remain visible. |
| W7: Page5 is building and cannot be assumed idle. | Accepted: execution step2 selects from live controls/work/producer ownership; no actor named idle in advance. |
| P5.1: Refresh loses dirty-tree/operation/clock knowledge. | Accepted: **Correct startup and work recovery** and **What may survive** require durable branch/head/evidence/operation references; scratch pointer alone insufficient. |
| P5.2: Empty inbox is not proof of child cleanup. | Accepted: execution steps2–3 require manifests, exits and PID/profile/port absence; no basename cleanup or replacement producer. |
| F1: Auditor queue reuses its thread. | Corrected current-route fact; target is hosted after1216, queue consumer retired through supported migration. Exclusion no longer satisfies Tony's whole-system scope. |
| F2: New Fable chat does not transfer coordinator/watch responsibility. | Accepted as required ownership transfer, now to hosted Fable; old consumer/watch relieved, no duplicate coordinator. |
| F3: Stored historic roles conflict with seat pointer; file changes after launch. | Accepted: separate1216 role-source assembly plus reviewed effective input, expected versus actual file-read hashes. **Correct startup**; Core8/Fable own implementation/configuration proof. |
| F4: Retain first→last activation and first activation→landing. | Accepted in **Shipping and prediction acceptance** with every route's request/action time; primary change separately sourced. |
| P6.1: Relative role path fails from real hosted cwd. | Accepted: actual absolute selected-CLI-root path in serialized kickoff, no cwd/search fallback; unreadable file remains diagnosis. |
| P6.2: Empty mail can strand acknowledged but unfinished work. | Accepted: recover piece/queue/worktree/original operations even with no mail; wait only without warranted work. |
| P6.3: Generic watch/goals and stale tasks conflict with hosted turn rules. | Accepted: end hosted turn for runner wake;1216 and role-owner document fixes required before boot. Flex's own seat patch removes private-checkpoint dependence. |
| C8.1: Duplicate/overlapping/manual-versus-automatic intents can create twice. | Resolved with Core7: exact replay retains mapping; same unresolved manual intent coalesces only with unchanged pin/control; conflicting automatic intent/guard refuses whole batch. **Authority**; focused overlap/late-callback proof required. Whole-request refusal for every new manual overlap was a recommendation, not the chosen contract. |
| C8.2: Waiting for activation before providing pending work deadlocks idle refresh. | Accepted: acceptance then delivery before activation. Physical start adds explicit admission-before-dispatch prerequisite; Core7 verifies supported order. |
| C8.3: Partial batch needs executable status/phase/authority recovery. | Accepted: A committed/adopt, B known-ID same-intent phase, C opaque/no second start; Tony relays owner-only result if needed. **Evidence**; actual installed commands remain required. |
| S1: Stop/nonowner tests can fail before valid setup. | Accepted: positive managed and operator fixtures through real host activation/delivery first, inherited1104/binding and same-pin restart controls retained. **Evidence**. |
| S2: Correct-looking post proves neither role read nor first command. | Accepted: actual kickoff, file read, first command and new-thread action attribution distinct. Missing telemetry explicitly unverified. |
| S3: Idle mail proves no lost-write/corrected-source recovery. | Accepted: focused synthetic lost-response+correction case and positive unfinished-work case, with actual live coverage limits recorded. |
| C7.1: Specify concurrency disposition. | Incorporated the implementer's guarded manual coalescing rule and duplicate/conflict refusal; see C8.1. |
| C7.2: No immediate idle activation. | Accepted: named delivery after acceptance, positive zero-pending fixture, distinct open-turn/accepted/activated times. |
| C7.3: Pointer assembly preserves role; hash collection is extra evidence. | Accepted:1213/1216 scopes separate, no inferred file-read hash from thread/start. Fable owns actual collection. |
| C7.4: Status authority and committed receipt differ from incomplete continuation. | Accepted: owner result access, Health retention, separate incomplete phase status and no second opaque create. |
| A1: Queue continuation and Fable handoff need concrete mechanisms. | Incorporated with target hosted migrations; old external/exclusion option superseded. Missing mechanism blocks full trial. |
| A2: Unconditional inbox conflicts with paged auditor wake. | Accepted: trusted actor/wake protocol, exhaust cursors without old-generation filter, current sources/privacy/snapshot boundary. |
| A3: Role baseline/hash and actual-read mismatch need reconciliation. | Accepted: authorized effective baseline, actual startup bytes and separately observed actual role read before correctness claim. |
| A4: Reconcile metric conflict and earliest external owner action. | Accepted: sourced earliest initiating owner act, now physical shutdown/reboot; retain older definitions and all intervals. |
| A5: Trial hold must retain original1215 clocks and count waiting. | Accepted: hold application/release and originals explicit; no reset or all-idle labor claim. Canonical revised forecast remains separately owned. |
| A6: Eight replies do not approve materially revised operational claims. | Accepted: this source/commit/section map plus a separate focused whole-system review. Document completion remains distinct from implementation and actual boot. |

## Whole-system additions and open execution decisions

Tony's physical-reboot requirement adds fresh Warp, durable boot entry, no
private memory/scratch dependence, all eleven actors and post-boot prediction
measurement. Warp23462 supplies `/Users/commonfabric/warp-seat`, the launch
command and kickoff; those are copied into the plan. Warp23471 reports the
local KICKOFF.txt copy. Runtime assembly, role files, supported migrations and
cold-start invocation still require their own proof.

The prerequisite table assigns runtime, migration, installed-document, memory,
purge/preserve and execution-evidence owners. Current fast-lane rule4 / Notebook40
records Warp23514's two reported results. These are sourced measures, not new
landing gates. Runtime readiness and physical reboot remain unobserved here.

## Whole-system follow-up received

Warp23494 identifies the service→owner refresh receipt→runner order, Tony-only
submission and1213→1216→seat-docs→dry-run dependency. Core7 23495 confirms
stopped-runner admission in two executed own cases and distinguishes idle old-pin
attachment from an old model turn. The plan now uses that concrete order and
installed request/status syntax. This closes the ambiguity in C8.2/W4 at contract
level; actual deployed/native boot remains unproved. Warp's follow-up reviews the
whole-system revision; it is not attributed to the original immutable draft.

Steward23510 read plan/log at7d184caa and supplies a separate whole-system review.
Its log was still the old Pending table at that exact head; commit6a707ade fixes
that defect with all eight source/disposition entries. Its strict-clock finding
is accepted:15:35 after15:15 is exactly20 minutes, not under20, and earlier
shutdown adds elapsed time. The plan now says so explicitly. Neither forecast
nor scripted startup proof establishes actual-model/physical boot success.

Fable23512 read the wider plan, flags the exact-eight-actor manifest and private
checkpoint wording (fixed by standalone Flex5250350c, merged into1218), and
requests a sourced cohort/threshold disposition. Warp23514 adopts the first
five landings, whatever their type: all within45 minutes of the first one's
Build and at least four predictions within15 minutes, reported as a second
result rather than a gate. The plan now states that exact definition, preserves
original pre-boot Builds/forecasts and explains that the1215 hold can make the
45-minute total miss; it never resets the clock to improve it.


## Focused whole-system review at f328a643

The explicit second request is23519, `m-84fd5c90092c4e4384938957824a8afb`.
It pins complete plan/log at `f328a643443a64ee453090e2c5d1842c2c4806b5`.
Earlier Warp, Steward and Fable whole-system responses remain separately sourced
above; none is inferred from silence or an original-draft reply.

| Reviewer / source | Disposition in this revision |
| --- | --- |
| Page6 23523, `m-f6c1975f663444e6b478c0ef1f0e05ca`, r1 | Initial three findings closed. Step5 now pins frozen combined1218 `0e665717fadebaaca8d0c8cf2640e2dee05728b6`, superseding early-start `cfdf6102`; no unresolved dispatch-order question remains. Actual installed carry, file bytes, durable helpers and cold invocation still require evidence. Warp23524 independently requests the same correction. |
| Core7 23526, `m-cfb5a2f23c3b4a5492f1e7fe01c70a92`, r1 | Evidence section now gives exact reconcile/retry/latest-status semantics, durable original request bytes/order, JSON receipt fields and coalesced mapping. Guarded runner owns partial adoption/continuation; operator status is observation. `committed_ms` is distinct from native adoption/action. Lost-write-plus-correction and actual model file read remain owed, outside17 own cases. |
| Core8 23527, `m-3da6fac6d9fe432484e3d26af3226e85`, r1 | Capability/startup now distinguishes regular-file selection, unreadable-regular pointer failure and absent/nonregular exact legacy fallback. No unavailable-file branch counts as correctly prompted; actual serialized/read evidence remains required. |
| Page5 23540, `m-475b718874b94af3b9c185c948b02fd9`, r1 | Original1215 Build/deadline makes the selected45-minute result a necessary miss if reboot15:15. Added raw-byte purge/preserve manifest, owner outbox survival and durable reconstruction; refreshed exact native handoff/cleanup/hold state. First-push machine field stays unknown until supported recording. Footer419 is historical. |
| Auditor23550, `m-66294bb20f5444f0be638f2373303488`, r1 | A7 accepted: original trial ID/time precedes the first included shutdown in step3; Fable names an offline-readable persistent record, UTC/offset, clock source and uncertainty. A8 accepted as prospective literal-live interpretation pending Warp confirmation: first publication ends result1, canonical first_live/deployed_ms scores result2. Retain both endpoints and missing evidence. Existing fallback/partial-state/startup findings corroborated. |

All eight whole-system reviewers have responded (Warp, Fable, Steward,
Page6, Core7, Core8, Page5, Auditor); their findings are incorporated or explicitly assigned
as execution evidence. No review here proves actual migration, installed role
read, physical reboot or publication. Fable23529 independently exposes the
existing-seat migration gap: seat-add refuses an existing invitation and operator
provisioning can create before discovering an incompatible pin. The plan now
requires Warp's supported concrete transition before any attempt.

Auditor23550 is the wider complete-file response atf328a643, not a reuse of its
original draft review. Its timing fixes are incorporated. Warp's explicit
endpoint disposition is the remaining policy clarification; actual execution
prerequisites and installed-document carry remain separately owned.
