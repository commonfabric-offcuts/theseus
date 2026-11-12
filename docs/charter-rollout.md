# Charter rollout and current delivery roadmap

Owner: auditor. Source: Tony's New Charter topic,
`t-314359e63ef84d59ace7349c3a167221`, especially 2448, 2450, 2453 and 2455.
Implementation tracking: Building Theseus item **405**, created and read back.
Snapshot: 12 November 2026. Update this record when evidence changes; do not
interpret a planned step as installed behavior or infer approval from silence.

## Finish the existing delivery commitments

Fable retains ownership of the active UX work and live deployment. The last
verified live release is 64, `e710d88`, at 05:12 Pacific. Current scoped work:

- 379, keyboard selection margin: waiting to combine; not yet live.
- 355, move dossiers below More: the board's stage label says Build round 5,
  while its latest note describes round 7 and an independent re-review. Report
  that inconsistency rather than inventing a clean completion status.
- 396, Notebook cards in composer: feel accepted, production work still active.
- Remaining agreed UX feel batch: 376; 377/381/388/390/393/394;
  385/386/387; 382/384/389. Some are represented by grouped work rather than
  separate stage records. Scope is the agreed batch, not the whole Now list.
- 402, agent replies stay in the request stack: final candidate `7c88d23`
  independently approved and pushed; Fable has the handoff for after the current
  UX batch. Auditor owns post-deploy instruction and actual-task verification.

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
new hosting build. On 12 November its separate sign-in remained valid after the
desktop account switch, but the account reported 100% weekly usage, resetting
16 November at 15:00 Pacific. Evidence:
`auditor/2026-11-12/account-switch-worker-check.json` under the local Theseus directory.

To use another account's capacity sooner requires a separate hosted-runtime sign-in
with Tony. Do not infer that desktop login changes or permission to inspect authorize
credential copying or a worker account migration. Preserve the existing context
and binding; after an authorized login, prove a real turn completes on the same
thread. Changing accounts is not a prerequisite for writing the skill or rollout
record. Automatic cross-model team provisioning and migration of existing seats
come after a successful bounded trial, not before UX delivery.
