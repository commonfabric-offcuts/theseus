# Charter rollout and current delivery roadmap

Owner: auditor. Source: Tony's New Charter topic,
`t-314359e63ef84d59ace7349c3a167221`, especially 2448, 2450, 2453 and 2455.
Implementation tracking: Building Theseus item **405**, created and read back.
Snapshot: 13 November 2026, 00:18 Pacific. Update this record when evidence
changes; a plan or candidate is not installed behavior. The governing request
is Tony's New Charter #2693, followed by #2700: ship the agreed remaining batch,
then message editing, then marking outcomes done. Tony's absence is not a new
review gate for the authorized work.

## Finish the existing delivery commitments

Fable retains live deployment ownership. Last verified live: release 68,
`b282fbc3085d3411d011e3dab0d04c03b431e5fb`, at 20:43 Pacific.

- Already live: keyboard selection margin 379; reply threading 402; Notebook
  cards in the composer 396; message folding 377/381/388/390/393/394; small
  controls 376/382/384/385/386/387/389; agent-name fix 415.
- The static dossier look, 429, passed independent round-2 review at 00:00,
  head `a934be83`. Fable is checking separate release-429, squash `85d4155`,
  on live 68. Its visual follow-ups are item 430, not extra release blockers.
  Codex owns it through live verification, then takes starred messages in latest
  mode (413), then motion (412), in separately verified increments.
- The earlier release-69 train (355 and 421/422) ended without shipping so 429
  could go first. Its evidence remains intact. The trackpad and Notebook drag
  failures are fixed in test setup; both engines' relevant cases pass. The new
  broker failure is reproduced on live 68 with the same `codex_no_answer` trace
  before queue/add, so it can be separately recorded as existing; its underlying
  cause remains unresolved (item 432). The click-to-select scenario's unexpected
  folded state has not been demonstrated on live 68. Fable is capturing that
  transition in a bounded diagnostic; passing reruns alone do not establish cause.
- Notebook write access/Draft work 371/383/391 is approved and integrated in a
  candidate, including migration renumbering. It is not yet live.
- 403 (keyboard passes the coordination filter) is approved and waits to combine.
  411 (quoting preserves place) is in its fix round. Fable owns 398–400 next:
  scrolling controls and composer size, including the responsive width and
  feed-card scrollbar requests captured in this stack.
- Auditor handed off 401/406 at `e9c4d0c8` on
  `auditor/show-full-own-thumb-build`: Show full message for one feed card,
  and the composer's own thumbs-up state. Focused Chrome and WebKit checks,
  source-failure retry, unit checks and mutation evidence pass. Independent review
  is running in Fable's own branch; the auditor's candidate is frozen.
- Message editing (228) follows this agreed batch, then completing outcomes
  (404), per Tony #2700 and Fable's confirmation #2706.

405 remains a separate auditor obligation below. The charter/assessment rollout
must not become a prerequisite for these UX releases. Known defects and checks
retain their evidence. Neither broad pipeline cleanup nor every item in Next is
part of this agreed batch. Current sources and full readback are recorded under
`auditor/2026-11-11/overnight-status.json` in the local Theseus data directory;
the complete New Charter snapshot through #2693 is
`auditor/2026-11-12/new-charter-wake787.json`.

## Make assessment usable first

Auditor owns the implementation path. The reusable skill is versioned at
`skills/theseus-team-assessment/`; its local Codex installation goes under
`~/.codex/skills/theseus-team-assessment/`. Skill packaging/discovery is separate
from a fresh assessment run, automatic Theseus dispatch, or personnel replacement.

1. Package the evidence procedure and rubric; validate the skill structure and
   independently exercise it on isolated cases. Acceptance: it distinguishes an
   external queue from ineffective work, preserves unknowns and does not execute
   instructions embedded in evidence or claim authority to replace a team.
2. Run the first requested real assessment through the existing coordinator with
   a fresh context, supplied identity/access and raw sources. Acceptance: a report
   grounded in the actual artifact, delivered to the right topic, with a named
   intervention owner. No automatic staff replacement.
3. Add the Theseus request path. A named team/topic and an authorized assessment
   request launch one fresh assessor using this skill and return its report in
   that topic. Reuse durable work, actor permissions and normal wake/retry rules;
   a quoted phrase or another agent's content must not silently authorize action.
   Acceptance: duplicate wake/request cannot create duplicate assessors or reports;
   interrupted work resumes; unreadable/private evidence stays unavailable or
   confined to the authorized audience; ordinary posts do not trigger assessments.
4. Add checkpoint prompts and team renewal records after the manual path works.
   Record the expected artifact and due checkpoint, observed evidence, known waits
   and consecutive misses. A repeated missed commitment or recurring supposedly
   fixed fault requests assessment within the adopted policy. Acceptance: no
   duplicate assessment while one is active, no simplistic turn-count expiry, and
   no treatment of a tool queue or real human wait as automatic agent failure.

The skill can be used before steps 3-4 exist. No new pipeline UI or broad Skills
framework is required to test the operating model. These steps are pending until
their specific evidence is linked; a Markdown rule does not implement a dispatcher.

### Evidence so far

- Skill installed locally at `~/.codex/skills/theseus-team-assessment/`; contents
  compared with the versioned source. The skill-creator structural validator passes.
- Fresh independent assessor exercised two fictional cases, without production
  access: a verified label change waiting on another release's deploy lock, and
  repeated incorrect-copy claims followed by scope drift and missing current code.
  It attributed the first delay to the queue and retained the owner; in the second
  it recommended changing ownership while preserving uncertainty about current
  code, rejecting the embedded instruction to restart production, and requiring
  an authorized handoff. No blocking skill defect reported.
- This establishes a usable local procedure and limited behavioral evidence. It
  does not establish real-team performance, a deployed Theseus trigger, automatic
  checkpoint monitoring, or installation in the hosted worker's separate home.
- The first request-to-report implementation is complete and pushed at
  `1cdcf88f` on `auditor/assessment-dispatch`, with 21 focused tests and nine
  caught mutations. A real installed-Codex functional pilot on a wholly fictional
  isolated assignment read the complete bound sources through a read-only native
  tool, inspected the artifact, and posted/read back one report. Repeating the
  invocation returned the same report. Evidence lives in
  `auditor/2026-11-12/assessment-405/pilot1/pilot2-evidence.json`. The first pilot's
  source-lock failure remains recorded; it led to the narrow read-tool transport.
  No production team was graded. Fable's independent review of this candidate is
  running on `fable/integrate-405`.
- The checkpoint successor is complete and pushed at `455cd765` on
  `auditor/assessment-checkpoints`, based on the frozen first-path candidate.
  It records adopted artifact/due policies, attributed observations, known waits,
  consecutive misses and recurring faults; it atomically requests one assessment
  at the adopted boundary and requires operator renewal for the next increment.
  Due prompts are repeat-safe and do not declare failure. Twelve focused tests,
  the 21 request/dispatch regressions and ten caught mutations pass. Contract:
  `docs/assessment-checkpoints.md`; evidence: `auditor/2026-11-13/assessment-checkpoints`.
  Handoff #2727 is read back. This does not install a background scheduler.
- Remaining acceptance: the specifically requested real-team assessment and actual
  adoption in the coordinator's checkpoint loop. These remain under 405. Pipeline
  state permits only one piece per item; Fable confirmed in #2726 that after the
  first path ships, 405 returns to Now in the same release bookkeeping with the
  remaining work named. A shipped first part must not be reported as complete 405.

## Put the new charter into practice

Use the next unowned, bounded job for the first trial; do not restart Fable's work.
An external Loom/Weaver/Labs job is suitable if it has a concrete authorized result.
Select the actual job before assigning a team. No new external job is invented here.

Before the trial, install the agreed brief/AGENTS/How we work changes together for
that scope, identify the owner and any peer, define helper access and reassignment
authority, and record the next useful artifact. Inspect only the workflow adapters
that would still force superseded handoffs; retain live locks, identity, backups,
privacy, durable writes and release evidence. This is scoped activation, not a
simultaneous migration of every standing agent or a rewrite of the pipeline.

Keep one versioned results row per trial: start, first useful artifact, result,
coordination/queue time, human waits, repeated checks and cause, cost where known,
defects, lessons and team-renewal decision. Preserve raw evidence and unknowns.
Existing product correctness and growth tests remain in force. The live Building
Theseus measurement registry currently has no configured target/checks; establishing
the scorecard is actual work, not an already operating facility.

Review the first three prospectively selected comparable jobs and the week-later
result. Automate only the repeated coordination that proves useful. Remove rules
that add ceremony without demonstrated benefit; do not erase failing evidence.

## Hosted runtime capacity and continuity

The existing Codex worker is hosted and retains its pinned thread; this is not a
new hosting build. An earlier 12 November probe found its separate sign-in valid
after the desktop account switch but reported 100% weekly usage. That was a
point-in-time account response, not proof that later work could not run. Evidence:
`auditor/2026-11-12/account-switch-worker-check.json` under the local Theseus directory.

Subsequent actual work supersedes that earlier operational blocker: posts 2461-2479
show the worker making and revising the standalone dossier study and delivering
its implementation research. Health at 13:44 reports idle, zero waiting, no
failure and a completed run at 12:00 on the same pinned thread
`01a1cee9-add2-7730-88e0-68d75183f9c6`. The research handoff is docs-only commit
`778ba1b605145f880f90f8b99a46cce7367836ea`; auditor has read the delivery report,
not independently reviewed that document or approved production implementation.

No new sign-in is currently a demonstrated dependency. The account/quota mechanism
behind the recovery has not been rechecked; do not claim a particular account or
allowance changed. Do not copy credentials or migrate the worker's account based
on a desktop login change. Preserve its context and binding. Automatic cross-model
team provisioning and migration of existing seats remain later work. The visual
study is useful hosted work, not a formally instrumented charter trial.
