# The Theseus working charter

Proposal for Tony, 12 November 2026. Not installed policy. No active build,
permission, owner, release protection or human approval changes by this file.

## The core

**Two hands-on peers. One accountable owner. One useful result.**

Use a Claude/Codex pair by default where both have suitable access. Different
reasoning habits are a deliberate asset. Give both access to the artifact,
tools and evidence needed for their job; document any actual access difference.
Choose the owner for the work, rather than assigning permanent model-based
professions. A simple task can use one agent, with a peer called in when useful.
Both see the original request and the working artifact directly. Neither has
to depend on the other's summary to understand what the person needs.

The owner builds, investigates and resolves problems through delivery. The peer
challenges the hardest assumption, independently inspects critical evidence,
and can reproduce, prototype or fix a bounded part. They are collaborators,
not a manager and a subordinate. A contribution is checked by someone who did
not author it when independent verification is required.

Each pair pursues one active result. Unrelated work starts from a clean base.
An extra helper needs a bounded independent job and an expected reduction in
elapsed time. The owner keeps doing substantive work. No recursive management
tree, standing coordinator-only seat, or delegation merely to keep agents busy.
Existing authorization rules still govern spawning and tool access.

## How the pair works

1. **Make the job legible.** In one working topic record the intended result,
   what will demonstrate it, the owner and peer, relevant authority and limits,
   and the next useful artifact or decision. Use the information already there;
   do not require another form. The backlog supplies context, not an obligation
   to implement every adjacent idea.

2. **Act within the authority already granted.** The owner chooses routine
   implementation, tools and investigations, removes unnecessary dependencies,
   and challenges assumptions that obstruct the result. Ask the human for a
   product decision, a genuine tradeoff beyond the brief, or new authority.
   Unresponsiveness is never approval. A required decision does not prevent
   useful independent work.

3. **Put something real in front of its user early.** For UX, show a usable
   preview and obtain the required feel decision before production review and
   test expansion. For research, show the decision-relevant evidence; for an
   operational job, show the actual result. Basic checks needed to make a
   preview usable must not turn into release certification. There is no
   compulsory UI preview for work whose uncertainty is elsewhere.

4. **Work the problem together.** The peer starts with the riskiest assumption
   or observed failure and returns a concrete case, evidence or useful change.
   The owner stays responsible when a check fails. Resolve technical disagreement
   against evidence; surface product disagreement to the human. Do not summon
   a committee to approve ordinary decisions or relay one another's summaries.

5. **Keep completion bounded.** Once the intended behavior is agreed, finish
   it. New ideas normally become later work. A finding joins the current job
   when it prevents the promised result or makes delivery unacceptable. Name
   the reason and the change in scope. Shared files alone do not make two jobs
   dependent. Large work uses useful increments with one overall owner, not an
   ever-growing set of mutually blocking branches.

6. **Change the approach when the same problem keeps returning.** A recurring
   failure class, growing list of prerequisites, or repeated ownership collision
   calls for the pair to examine the design and responsibility boundary. Find
   the shared rule that is missing, reduce the problem, or identify the actual
   unresolved decision. Do not automatically order another identical review or
   patch round. Record the changed approach in the working topic.

7. **Use evidence proportionate to the risk.** For software, protect durable
   writing, permissions, retries, migrations and plausible user paths with
   meaningful checks. Reuse passing evidence only when its relevant source,
   dependencies, inputs and environment still apply. A repeat names what
   changed, failed or remains uncertain. Tests for retired behavior change with
   that behavior. A demonstrated existing failure stays visible with its
   accepted disposition; an unexplained failure is not silently waived. Repeated
   failures should improve the design or detector, not merely enlarge a checklist.
   The peer independently checks changed behavior and consequential claims;
   harmless changes need not trigger another whole-job investigation. A blocking
   finding names a plausible scenario, its harm, and the evidence that clears it.

8. **Deliver and verify the result.** Use the established deployment or execution
   protections, then verify what the recipient actually receives. The owner
   remains accountable through that check. For Theseus, retain one live deployer,
   backups, exact source/evidence identity, authority checks and runtime checks.
   The deployer performs a controlled operation; the builder owns fixing a
   failed candidate. For other work, completion may be a supported decision,
   usable document, launched application or confirmed external action.

9. **Tell the truth with little ceremony.** Say “being built,” “available to try,”
   “verified,” or “live” only with the corresponding artifact. Name limitations
   and correct a mistaken claim where it was made. Post on a material result,
   changed approach, blocker or decision; avoid progress chatter and duplicate
   replies. The next checkpoint says what evidence should exist, with an honest
   estimate of uncertainty. The owner communicates before a missed commitment
   becomes a surprise.

## What the pipeline becomes

Keep it as the backlog, a place to consolidate related intentions, and a record
of active commitments and delivered evidence. It may show queued work, who owns
current work, a real wait and its reason, the artifact to try, and what shipped.
Those are facts about work, not a sequence of staff handoffs.

Use one working topic and one current candidate per result. Link the existing
items that explain it. Capture build, test and deployment facts from the tools
where possible. Do not require humans or agents to narrate a second copy of the
work. Multiple related changes may ship together when that makes the result
coherent; an independent finished change need not wait for unrelated work.

Do not rebuild the pipeline UI before trying this model. Its existing records
and history remain valuable. Stop making movement through stages the agent's
objective, and remove workflow dependencies that serve only that movement.

## Adopt cleanly

Begin with the next unowned, bounded job after its applicable product decision.
Do not take over Fable's active 355, the feel batch, or composer preview 396.
Record the selected job, named pair, authorization and charter revision in its
topic. For the first software trial, Fable remains the live deployer; the pair
owns the candidate and fixes. Hosting and agent migration are separate choices.

Before starting that trial, make one explicit policy replacement with Tony's
adoption of the charter. Do not leave two conflicting operating contracts:

| Existing instruction | Replacement for the selected trial |
| --- | --- |
| Vision mixes purpose with mandatory review/check cadence | Short Vision here; this charter holds the operating rules. |
| How we work rev17: fixed phase/stage/review/train handoffs | One owner and peer carry the job through its actual uncertainty and delivery; keep the mechanical release record. |
| Every change requires mutation testing and every miss adds a rule | Checks match the failure risk; automate stable, load-bearing invariants. A new rule names the demonstrated failure it prevents and when it can be retired. |
| Every bug joins active work; previews never wait versus explicit feel approval | Scope rule above; distinguish a recorded follow-up from a blocking regression. Preserve actual human approval requirements. |
| Auditor can never build; coordinator is the route for routine decisions | Roles belong to the selected job. The peer may build; independent checks cover the other author's work. |
| An audit finding must become a tool gate before another phase | Make the smallest effective correction; a detector or better design may suffice. An audit does not automatically create another prerequisite. |

Update the selected agents' actual briefs together with the proposed Vision,
the How we work note and applicable AGENTS instructions. A new document alone
does not change their behavior. Archive superseded instructions with the date
and scope; preserve prior evidence and unfinished work.

The adapter work is narrow: inspect launch/build/review briefs in
`fable-tools/build-pipeline.py`, `flight.py` and `workflows/review-loop.js`, plus
their handoff and heavy-run admission rules. Let the selected owner invoke the
needed existing operations without starting a mandatory relay or repeated
whole-job review. Keep concurrency locks, evidence attribution and release
records. Keep `tools/deploy.py`'s protections. If a mechanical refusal still
requires the old ceremony, change that adapter explicitly; do not bypass it,
falsify a stage or discover it only after the candidate is ready. No Core/schema
or pipeline UI redesign is a prerequisite for the experiment.

## Learn whether it works

Select the first three eligible jobs in advance: a bounded UX change, a fault
with an uncertain cause, and a non-code deliverable or operational task. Pick
comparable recent work as a baseline before seeing the results. Larger work
gets a subsequent trial; success on three small jobs is not universal proof.

For each, keep a short evidence row: start, first useful artifact, usable result;
human-decision wait separately; time in coordination and tool queues; repeated
reviews/checks and why; token or cost totals including helpers when available;
and defects, rework and the recipient's judgment. Keep raw elapsed time too.
Unknown measurements are unknown, not zero.

Proposed target: halve avoidable coordination and queueing on comparable small
jobs, reduce time to useful feedback and completion, and retain the required
protections without an observed rise in consequential regressions. Check the
result again after a week of use. Three cases can expose failure and justify
the next experiment; they cannot establish a reliable long-run defect rate.

If the owner mostly routes messages, finished work waits for administrative
approval, or another loop repeats without learning, the charter has failed its
own test. Fix the operating model or remove the rule causing that behavior.
Do not respond by merely requiring everyone to reread the Vision.
