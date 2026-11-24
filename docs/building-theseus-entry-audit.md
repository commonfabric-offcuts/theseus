# Fresh-agent entry audit of Building Theseus

Keep this outcome and clean its entry surfaces. Candidates and Later are not
an automatic work queue. The main revival risk is a fresh coordinator mistaking
old Build/approved pieces or dated instructions for current assignments.
A new outcome would move that ambiguity while introducing a release-identity
migration. This audit is Tony23525's request, not a new runtime or shipping gate.

## What was read

Bound workspace, full paged structured pipeline, stages, topic listing, all11
outcome Notebook pages at their current revisions, current-rule4 / Notebook40,
workspace members/links and tools. Source was installed420
`1e6c6d788ed49c82e75b32b62361e2475cd882c6`. The boot review separately reads
frozen1218 `0e665717` and1213/1216 contracts. Repo entrypoints inspected include
AGENTS/VISION, agent-guide, onboarding, landing/kit and seat files. No private
profile contents, refused records or direct live database reads were used.
This examines entry context, not every historical message or dormant feature's
current correctness. Other actors' unread/private work cannot be inferred from
Flex's inbox.

The [snapshot](evidence/fresh-agent-entry/pipeline-snapshot.json) pins pipeline
revision12559 / workspace23384:12 visible Now items,44 Next,322 Later,157
Candidates,10 open pieces. Stored section counts include shipped items and
are not active backlog counts (`pipeline._view_pipeline` filters shipped rows).
The visible topic listing has574 unarchived topics:60 active,293 review,221
done. Many review rows say an old release is live; that is not current review
work. This is a dated inventory; later transitions must be read afresh.

## What actually starts work

`runner.py` claims routed, enabled recipients with pending deliveries whose
retry time is due, subject to execution controls. It does not select pipeline
Candidates or Later. `pipeline.py` requires an explicit move to Now before a
piece can start, refuses already-shipped items, and requires an explicit piece
start/stage/combine. Moves/stage writes update facts and can trigger ancillary
source-cover notifications; that does not execute an item. A message, correction
or unresolved ask can still wake an agent about old work independently of its
section. Read its current source and disposition; an ACK alone neither answers
nor stops it. Existing private/external goals or scheduled watchers are separate
execution mechanisms and need their named owner to retire them.

Moving an item to Later is therefore not a Stop control. Archiving a topic is
not an operation reconciliation or proof that a producer stopped. Conversely,
clearing deliveries or closing a goal would lose current obligations without
repairing the pipeline. Keep actual Stop/Continue and uncertain operations intact.

The coordinator's reviewed1218 role still says to bind the next queued item
when a lane hands off. That makes Next and old approved pieces consequential
for agent judgment even though the runner is not an automatic backlog consumer.

## Concrete findings and changes

| Surface | Finding | Disposition |
| --- | --- | --- |
| Notebook Release pipeline78 | Hand-maintained release34-era queue says every next feature is on that page. | Relabeled historical at79, current-pipeline pointer added; all old words retained. |
| Adjacency map37 |96-item snapshot recommends where to aim and labels old work Next. | Historical label/pointer at38; no old recommendation assigns work. |
| How we work19 |November23 override sits above older Fable-deploys, train/browser-gate, old heavy-lane and hand-updated-pipeline instructions. | Historical workflow label at20; sourced original words preserved, current-rule owns execution policy. |
| Measurements8 / in-flight8 |Release18–22 measurements and November14 release73 flight plan look operational. | Historical labels at9/9; current evidence/queue pointers added. |
| Architecture1 |Old repository name, all-Codex queue route and60-second wake description are not a current route inventory. | Reference label at2; selected source and bound Health are authority for installed state. |
| GitHub setup1 / edit acceptance2 / experience7 |Proposal, product acceptance and timeless principles are easy to confuse with an assignment or live proof. | Reference labels/pointers at2/3/8, with original text retained. |
| Flex plan16 |Long personal current-plan page duplicates old transient source/queue facts. | Replaced at17 with a short durable request/source index;16 remains history. |
| Generic agent-guide |Starts with interactive invitation/goals/watch instructions, while new hosted readers must end turns for runner wakes. | Repo patch adds route selection before those instructions;1218's corrected hosted seat files still need installation. |
| Owner onboarding formatter |Installed `onboarding.py` still says no rules setting exists; at >100 release records it omits Now; it lists old open topics. Its ask example omits current quote/choice flags. | Real product follow-up: read current-rule through its supported contract, bound meaningful current work and modern examples; preserve owner/privacy limits. This audit does not claim a product fix. |
| Tools list |Six home tools, no adopted `used` tools; several names sound like the current shipping route. | Listing is availability, not adoption, a test result or gate. Installed landing kit/current rule remain the execution entry. |

Nine actual Notebook label revisions were committed and exact body/title readback
verified; [receipts](evidence/fresh-agent-entry/notebook-label-receipts.json)
retain operation IDs and before/after revisions. No historical body or attachment
was deleted. Start here page `n-7b1ef83c9a5a4644a1e1043433304904` routes current work without
copying policy into another authority. Repository changes require their own named carry;
current live420 is not relabeled as having them installed.

## Pipeline reconciliation for Fable

The bound pipeline says Flex `you_steer=false`; only Tony/Fable can move its
items or edit stages. The following is a concrete reconciliation request, not
an executed move or authority to resume old source. Preserve original events,
source, approvals, clocks, private asks and raw evidence.

| Items | Observed state | Required disposition |
| --- | --- | --- |
|1213,1216,1218,1215 |Current boot work;1215 retains deliberate freeze hold. |Keep current source/sequence/holds, read crossing handoffs. This audit does not alter them. |
|1100,1126,1131 |Old353-era/357-era/366-era heads still appear approved waiting to combine. |Reconcile actual installed/shipped work versus remaining product. Remove obsolete approval from the ready queue by a supported set-aside when no longer current; do not carry these heads on sight. |
|1028,1106,1136 |Older open Build pieces with dense historic stage notes. |Name one current owner/next action or set aside with a reason and explicit re-entry trigger. A historical Build is not a present lane binding. |
|1149,1150 |Now, no open piece; old repair/install instructions and sources. |Reconcile installed repairs and residual obligations; move unassigned remainder out of Now without declaring it shipped. |
|44 visible Next rows |Several old tool repairs, prior queue plans and current follow-ups mix. |Publish a short current Ready queue selected by Fable; park unselected rows with provenance. Do not mass-drop Tony's requested features. |
|322 Later /157 Candidates |Dormant, no open piece in this snapshot;1200/1201 explicitly Later,1130 explicitly unstarted Candidate. |Retain backlog as parked, with current-scope review before promotion. Do not flush it to solve a wake problem. |

Stages are also misleading. Feel preview says nothing is tested/reviewed until
Tony's decision, while scoped waivers/current rules may differ. Waits to combine
sounds like mandatory batching. Browser checks still carries an actual
`units,browser-checks` gate; changing a label alone does not change that guard.
Fable should rename preview/Wait/Combine/Checks for the current workflow and
reconcile the gate against the installed landing tool and sourced current rule.
No guard is removed or bypassed by this audit. Preserve IDs and old stage events;
current definitions apply prospectively.

Do not bulk archive574 topics: current asks, unread gaps and operations need
reconciliation first. Old live-review rows can be classified from their actual
release/item facts and archived with a pointer when no obligation remains.

## Why a new outcome is the wrong first fix

This instance allows one release-shipping pipeline. Release records name bare
item numbers, not `(outcome,item)` identities. `pipeline_state.read_facts` reads
those global numbers, and `pipeline.py` rejects an item any release already
names. Starting a second shipping outcome with reused numbers can therefore
misclassify work as already shipped. `docs/pipeline.md` documents the limitation.
No safe transfer of item numbers, original Build clocks, holds, current-rule,
team/coordinator bindings and installed kit configuration has been established.

A new outcome would also keep the same generic onboarding formatter, runtime
roles and external watchers. Preserve Building Theseus's release/history ledger,
make current entry unmistakable, then consider a new product outcome only for
a genuinely new scope with an explicit identity/config migration. A clean page
alone is not a clean execution state.

## Current handoff

Fable23641 completes the supported queue/stage reconciliation and names the
remaining owners.1223 Now is this PR513 seven-path document carry: Flex source,
Fable exact-head review, Warp actual-live carry/landing.1222 Next assigns Flex
the onboarding formatter repair;1221 Next assigns Core7 the post-reboot guarded
queue-to-hosted transition.1220 remains Next for the host-fixture repair. None
of those three Next items has a piece/Build/producer in the readback. This carry
adds no third prerequisite to the1216/1218 single-seat dry run.

Repository installation still needs its actual carry/landing receipt. The
separate boot plan owns provisioning, purge/preserve manifest, input isolation,
actual file reads, dry run and physical-test evidence. The external Auditor
delivery/native-wait handoff remains Warp-owned under23601/23637. No tests,
producers, route changes, migrations, starts/stops or physical reboot ran for
this audit. A named later repair is not permission to start its producer now.


## Coordinator disposition after the snapshot

Fable23589 proposes the concrete moves; Warp23592 rules them; Fable23641 supplies
completed operations and per-item readbacks.1100/1126/1131 and1106/1136/1149/1150
are now Later with history/residual triggers; five old pieces are set aside with
their complete stage histories retained. The original535-row snapshot above
is deliberately unchanged and cannot assign current work.
1131's guard9377283e is recorded as in use, not an invented app shipment.
1028 keeps original Build4, with Fable owning re-entry after the dry run and
current-live scope/proof reconciliation, now sourced in rule6/Notebook42. The44
old Next rows are Later with provenance; every pre-move owner was Fable or Warp,
so no Tony placement was overridden.1220 stays queued.
This preserves clocks instead of treating all six old pieces identically.

Stage IDs/events stay: Product preview, Ready for landing, Prepare release,
Landing checks. Warp maps the checks to installed preflight/approved-head/guard,
own carried tests, whole-Node actual-live comparison, paired affected files,
deploy exit and publication readback. It explicitly removes browser-checks from
the gate under Tony's November23 rule; Units maps to those deterministic
proofs. A product preview Tony requested retains his actual word before test work;
the old universal preview prohibition is narrowed. Fable's pipeline12608 readback
records the applied definitions. Flex independently reads the same stage IDs,
scope/owner flags and `units`-only Landing checks gate at12659, plus Next containing
only1220/1221/1222. Its paged Later read verifies all51 named moved rows. Placement
does not itself prove each underlying feature is correct, shipped or stopped.

Current selection at23641:1216's control was finishing; its later tested handoff
23644 and Fable23647 approve exact422 carry92e552ed in Ready1.1218 is approved
Ready2 onbbb8f548 under23646, retaining the replaced freezes as history and
landing immediately after1216.1215 keeps its original Build/open post-reboot hold;
1028 keeps original Build4/after-dry-run ownership.1213/1219 are shipped421/422.
Read the actual current records before acting rather than replay this dated list.

Fable's raw operations/readbacks are under
`fable-tools/coordinator-20261117/records15245/`: `queue23592-move-*-read.jsonl`,
`queue23592-next-move-*-read.jsonl`, `stages23592-read.jsonl`,
`rule23610-update-read.jsonl` and1221/1222/1223 item reads. The
[read identities](evidence/fresh-agent-entry/read-identities.json) also retain
Flex's separate bound-read hashes and reconciliation. Canonical source approval
and actual PR513 carry/publication remain the named owners' next work.
