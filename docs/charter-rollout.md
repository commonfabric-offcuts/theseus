# Charter rollout and current delivery roadmap

Owner: auditor. Source: Tony's New Charter topic,
`t-314359e63ef84d59ace7349c3a167221`, especially 2448, 2450, 2453 and 2455.
Implementation tracking: Building Theseus item **405**, created and read back.
Snapshot: 12 November 2026, 13:44 Pacific (status request #2481). Update this record when evidence changes; do not
interpret a planned step as installed behavior or infer approval from silence.

## Finish the existing delivery commitments

Fable retains ownership of the active UX work and live deployment. The last
verified live release is 64, `e710d88`, at 05:12 Pacific. Current scoped work:

- 379, keyboard selection margin: independently approved at 10:21 and waiting
  to combine since then; not yet live. Identify any concrete dependency that
  prevents this approved change shipping separately from 355.
- 355, move dossiers below More: the board's stage label says Review round 8,
  while its latest note describes round 10 repairs. Fable's note reports 19
  further visibility problems: 12 also fail on live and are filed as 407-410;
  seven belong to 355 and are being fixed. That is attributed builder evidence,
  not a fresh independent audit. The candidate is not ready to ship.
- 396, Notebook cards in composer: feel accepted; review sent it back at 13:33
  and Build round 2 is active.
- Remaining agreed UX feel batch: 376; 377/381/388/390/393/394;
  385/386/387; 382/384/389. Some are represented by grouped work rather than
  separate stage records. Group 377 entered Review round 1 at 13:40; 376 still
  displays Feel preview. Scope is the agreed batch, not the whole Now list.
- 402, agent replies stay in the request stack: final candidate `7c88d23`
  independently approved and pushed; Fable has the handoff for after the current
  UX batch. Auditor owns post-deploy instruction and actual-task verification.
- 406, the composer's personal thumbs-up action must not display everyone
  else's reaction count: filed in Next with source screenshot, confirmed cause
  and acceptance checks. Auditor owns tracking; implementation has not started.

The charter, assessment tooling and a later agent migration must not become
prerequisites for these releases. Independently finished work can ship when its
actual dependencies and verification permit. Use Fable's evidence checkpoints
for forecasts; do not manufacture dates from the pipeline's historical averages.

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
- At the 13:44 status check, steps 2-4 have not advanced. Item 405 remains Next;
  there is no dispatcher implementation in progress. Keep that gap explicit:
  responding to deliveries and recording plans are not implementation progress.

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
