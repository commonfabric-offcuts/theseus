# Judged train admission (1087, including former1092)

Pre-edit contract, revised under Warp17467 and Fable17484, 2026-11-22.
Item1087 alone is Build1 piece p-710c104257c344c8bcd8b233.1092 is merged
into its words. The historical two-item draft/publication17458 is retained.

Source intake remains actual345934e1ccba797dae9498ff2a68e2b2648dac5f49b,
tree1525414089f31b1286ab524b69032d21d6205a09, in the own branch/worktree
core-lane7/1087-1092-admission-345 under /Users/commonfabric/aim-worktrees.
Actual347 is now live. Reconcile actual live explicitly at freeze; never
replace the red/old/restored inputs silently. The supplied installed313 guard
has eighteen matching pinned files; admission/deploy/judgment match345.
Its unit_shards.py and ci-input-reads.json differ from345. Publish a whole
landed checkout later, never an overlay onto that active installation.

## Source owners and behavior

Only three production owners change: tools/gauntlet_admission.py,
aim_next/pipeline.py and tools/deploy.py, with supporting tests and this doc.
The unchanged classifier already guards admission.1087 is JUDGED and first
lands ALONE through today's guard and its own complete carry/run. No bootstrap
exception, classifier relaxation, active swap or stage workaround.

Carry approved judged heads in canonical approval order onto current live;
leave conflicting heads for another train. Core combine accepts a homogeneous
selection of approved frozen judged pieces with one explicit candidate commit,
retains the exact selected source freezes/approval identities in its immutable
combine fact and exposes that snapshot to admission after combine. It continues
to reject missing freezes, mixed ordinary/judged selections and unapproved work.
Core records the candidate plan without running Git or network inside its
transaction. Actual admission is the source boundary: every selected frozen
head must occur in the candidate's own ancestry, all item identities must match,
and the tested source/tree/current-live identity must agree. A Core combine
record alone is never authorization to deploy that candidate.

For a multiple-item judged landing or later-waiter exception, authentication
reads GitHub's registered Checks producer, its exact attempt, the protected
Theseus Verdict App check, its separate Verdict workflow run and the current
PR/base/head. Require a complete non-cancelled run and successful Verdict,
with exact producer/check attempt binding and current live. The source head's
tree must equal the candidate's tree; an after-merge candidate must have current
live and that judged source as its exact parents. Preserve ordinary behavior
and all existing ancestry, freeze, classification and actual-entry refusals.

The read-only CLI gains optional selectors --producer-run N --verdict-check N
--pr N, supplied together. These select records to authenticate, not timestamps
or caller assertions of completion. The real deploy supplies those selectors
from its already verified train record to both admission boundaries. A bare
started_landing flag does not establish producer evidence. Absent context may
still admit existing single-head work with no ordinary blockers; it never
authorizes a multiple-item train or bypasses a waiting ordinary piece.

Read approval timing from canonical history for the current frozen source,
retaining the earliest approval after that freeze rather than erasing an older
approval through an administrative Review/Wait move. A waiter yields only if
it is explicitly classified ordinary, not an already open foreign release,
and its approval time is STRICTLY later than the authenticated run start.
Equal/earlier, absent/ambiguous timing, unclassified work, incomplete/cancelled
run, unapproved source and stale-live candidate refuse. Record every passed
piece/item plus approval/run identity in admission evidence at both real deploy
boundaries and in the release's train evidence. Those ordinary waiters go next;
by their earlier approval time they block another new judged run until shipped.

## Evidence and publication

Meaningful checks use isolated scratch Git repositories/Core stores and fake
executable remote adapters; no real account/test records or network effects.
They cover the real Core combine command, read-only admission CLI and both
actual deploy boundary calls. Retain exact input/source/entry/runtime identity,
raw red exits, corrected cohort, entire actual old owners applied, observed
failures and exact restored controls, with unique pycache/temp roots each time.
Cover multiple frozen heads, mismatch/missing/foreign source, approval ordering,
later/equal/earlier/missing timing, stale base/tree, incomplete/cancelled producer,
foreign Verdict identity, mixed/unfrozen/unapproved Core combine, and refusal
before downstream effects. Existing assertions unrelated to changed behavior
remain. A replaced policy assertion must still test a meaningful refusal.

Bounded sequential Python/Core/Git checks run below the load limit; no browser,
HTTP listener or producer dispatch. Name every inherited failure and preserve
it unwaived. Freeze/push only the exact source branch once meaningful checks
pass; independent review is required. Actual-live reconciliation at freeze
must retain source/test inputs and any carry explicitly. Fable owns stages,
carry/guard publication after independent review AND shipment from the whole
landed checkout; Warp owns actual carry/SPEC adoption and the no-land-during-
judged-run rule. Tests here grant neither a shipment nor active guard adoption.

At this pre-edit publication only this contract differs; no production code or
tests have been changed or run.

## Review correction 17581

Keep the existing train-file judgment contract unchanged: producer_runs and
verdict_checks are nonempty lists of distinct positive IDs, not records. The
verified result from train.judge expands these IDs to listed GitHub records;
the admission adapter accepts that result as well as the raw ID lists. Select
the newest named producer and Verdict check by ID, independent of list order,
then authenticate their exact pairing through the existing admission reads.
That additional authentication is required when admitting multiple items or
passing a waiting ordinary piece. A single judged item with no blocker keeps
the existing train.judge validation and conclusion-recording behavior without
requiring the new exception's workflow/attempt fields.
Keep every listed run/check and its actual conclusion in release evidence,
including an older failed check followed by a successful controller rerun.
No train.py, installed guard or landing-driver format change is authorized.
The unchanged test_tools_train cohort and actual two-floor deploy with multiple
checks must pass, with red evidence on the reviewed e73c69ca deploy owner and
an exact restored control after applying that entire old owner.

## Selector correction 17612/17614

Omitting all producer selectors is the distinct legacy case. Any explicit
tuple must contain run, check and pr together as positive integers, including
on single-item/no-blocker and ordinary candidates. Validate that local shape
before Git, pipeline or remote reads, independently of whether the new
bundle/later-waiter exception needs remote authentication. Validate an explicit
argument before a verified train could replace it. Actual CLI omission and
complete context pass without extra remote metadata when no exception is
needed; partial, zero and negative tuples refuse. Direct admission also
rejects missing/null/boolean/wrong-type/extra fields without reading records.
Keep the prior approved ca7e345c packet and both exact old production owners;
publish the corrected head with named red/corrected/applied-old/restored
controls and the same eight-module independent-review cohort.
