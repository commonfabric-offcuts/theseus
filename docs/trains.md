# Trains

The current standing rule is [Landing a change](landing.md): ordinary approved
pieces open a PR immediately, receive an independent combined-diff read, and
deploy through the guards with broad judgment pending, followed by the immediate
live surface check and broad checks. Judged-first changes complete judgment
before deployment. That page also owns classification, source identity,
recovery, tool rollout and measurements.

The sections below preserve the **historical train process**, including its
hourly cuts, path-based routing, pre-push thresholds and next-train recovery.
Those descriptions explain earlier trains; they do not impose waits, establish
ordinary eligibility or delay recovery under the current landing rule.
The pipeline record is in [pipeline.md](pipeline.md). The deploy's mechanics are in
[tools.md](tools.md#deploy-toolsdeploypy), the record it writes in
[releases.md](releases.md), and the known reds and the quarantine in
[ci-known-reds.md](ci-known-reds.md).

## The cut

- Trains cut hourly. An item never waits for another item, and a train never
  waits for an item: what is approved at the cut boards, and what misses it
  rides the next cut.
- A train's list is fixed at its cut by default, and a fix that arrives later
  rides the next train. The release's owner may name an exception before the
  push, such as an item allowed to join a cut train if it is approved before
  that train pushes; the exception is stated when it is made. Once a run is in
  progress, nothing is pushed to it.
- A train of check or test fixes alone never cuts. Those fixes board the next
  cut that carries something a person sees.
- A defect the owner hit, or asked after, boards the next cut if it is
  approved by then; if it misses it, it cuts its own train at its approval
  instead of waiting for the clock.
- Each item's head carries its `Pipeline:` trailer ([releases.md](releases.md)).
  A follow-up fix to an item already shipped carries its own item's trailer,
  never the shipped item's, since the deploy refuses an item an earlier
  release shipped.
- The next train may cut on the tree of a train not yet live. It runs its
  pre-push checks during that train's deploy and pushes when that release is
  live. Deploys are serial.
- A small defect that should not ship alone rides inside the next piece that
  touches its surface, with its item line kept for the record.

## Two kinds of train

`tools/train.py` decides the kind from the paths the train changes since the
live head ([tools.md](tools.md#a-merged-train---train-file)).

- **Ordinary**: it changes none of the deploy tool, the controller
  (`.github/`) or the migrations (`aim_next/migrations.py`). It merges onto the
  release branch at its cut, one push run judges the merged head, and the
  deploy follows on the comparison of that run. No pull request run comes
  first.
- **Judged-first**: it changes one of them, so the tool that judges is not the
  one being judged. Its pull request run judges it before the merge: a source
  review of the merged tree and a comparison of its receipts against the live
  release's push run. The classifier's refusal of changed producer files is
  recorded as expected.
- A judged-first train whose deploy needs a run on its own commit merges once
  its source review is in and its reviews are approved. The merge only starts
  that push run; nothing deploys on a merge.
- A merge made under a ruling is never undone by a hold that arrives after it
  while nothing has deployed on it: a revert costs a run and moves nothing a
  person sees.
- A run on a tree already judged is never waited for. When the merged head's
  tree is the tree the pull request's run tested, the merged head deploys on
  that run, and its own push run is attached to the record later
  ([tools.md](tools.md#a-merged-head-its-pull-requests-run-judged)).
- A train with a migration does not touch the live store before a complete
  run judges it and clears the comparison. Clearing it means every red is
  matched as known or placed; it need not be free of reds. The migrate step
  then exits 0 and the live schema is read before the record is written
  ([The deploy](#the-deploy)).

## Before the push

- A train with more than eight selected steps (steps, not commits) runs none
  of them on the pool before the merge. No file in this repository holds the
  threshold: it is the coordinator's train tooling outside the repository
  that enforces it (its constant `LONG_TRAIN = 8`), refusing a pre-merge pool
  run for such a train. It merges on its items' reviews and
  their own green target cases, and the merged head's push run is both the
  check and the judgment. A train with eight or fewer runs its steps before
  the merge. On a train of more than eight, the Python and Node units run
  beside the push, not before it.
- A unit red at the head is fixed by its own commit on the train branch, and
  the train merges that commit's head.
- When the cut resolved files by hand, the pieces' own named cases run on the
  merged tree, three of three in each engine, beside a review of the
  resolution. A red found there is found on the merge; that alone does not
  show the merge caused it. It is run at each item's own head: red there too,
  it is that item's own fault (the case may be order-dependent at the item's
  head), fixed in its item or as a test-only passenger; green there and red on
  the merged tree, it is the merge's, fixed in the train before the push with
  both items kept, and the fix's diff is read against each item's own head. If
  there is no way to run those cases, the train pushes, and the record says
  the condition was not met.
- A single red at the merge is judged at the item's own head first. A case
  that passes three of three there and shows the same fault in the live
  release's push run is known by its signature. Otherwise it runs eight times
  at the merge and eight at the base, and is placed by the eight-run count
  below.

## Judging the push run

The push run is compared against the live release's push run and its list of
known reds. Units, the deploy's refusals and the wake replay must be green;
none of them is ever a known red.

- **Known reds match exactly.** A red is known, with no base run, only when its
  engine, step, case, normalized assertion, observed values and test-source
  call chain match the earlier receipt exactly. A matching name with a
  different assertion, value or call site gets its base run. A red matching an
  earlier hosted run's diagnostics byte for byte is the quarantine's, whatever
  the train touched.
- **Acceptance by rule.** A check that meets the train, such as a test still
  expecting words another item on the train changed, goes on the release's
  list by acceptance, named with its signature. Its test-only fix rides the
  next train, so the next release clears it. Such an acceptance is carried for
  one run. A red that appears on the push run only, and passes eight of eight
  at both heads, goes on the list by acceptance as not reproduced.
- **Outcomes before counts.** A red's outcomes are written down before its runs
  are counted. There are two forms of the count:
  - *Three runs a side* reads a case: a pre-push case, or a new red on the
    push run. Red three of three at the head and none at live is the train's
    own; red at both heads, or once in three at the head, is the quarantine's,
    by its signature; any other count is placed before anything deploys.
  - *Eight runs a side* places a single red. Red two or more of eight at the
    head and none at live is the train's own; any other count is the
    quarantine's, by its signature.
- **A fault's unit is its mechanism**, read from the logs, not the strings of
  its assertions. Two assertion lines with one mechanism are one class. A
  deciding run is read per step to notice a pattern, but the fault is placed
  by its mechanism.
- **A fault live shows too.** A fault the candidate shows that the shipping
  head shows as well is filed as its own defect against live, never a hold on
  the train.
- **What holds a deploy.** A red still unplaced when the run ends holds the
  deploy only if it is a page fault on a phone or a wrong state a person sees.
  An unplaced timing or request-count red goes to the quarantine's list by its
  signature ([ci-known-reds.md](ci-known-reds.md#the-quarantine)).
- **The train's own red.** Before the train ships, a red that is two items
  meeting in a check is fixed in the check; a page fault reverts the item that
  causes it, by a revert commit on the release branch with its
  `Train-Item: Revert N` trailer. A train gets one fix round. After it, a
  further red reverts the piece it names, with no further round.
- **After it ships.** A judged-after train's own red reverts its item on the
  next train. Before the item's return is built, the revert's attribution is
  run again at the base with the item's change applied: if the attribution was
  wrong, the return is a re-ship, not a fix.

## A complete record

An explicitly reviewed [continuation envelope](continuation-envelope.md) can
retain a cut train's authenticated completed steps and add only its missing
modes from an authorized run. It retains both runs and partial-shard limits;
it does not turn a partial shard into a complete original run. The stock
single-run combine and no-envelope guards below remain unchanged.

- A step whose harness did not reach its end makes the record incomplete. The
  stock deploy refuses it (`tools/known_reds.py`, "the harness did not reach
  its end") before it reads any case. A ruling or an isolated rerun can settle
  the case's attribution but cannot complete the record; only a complete run
  does.
- Every shard receipt must come from one run attempt: the combine job in
  `.github/workflows/checks.yml` refuses a shard from another run or attempt.
  Rerunning only the failed jobs leaves the passing shards on the older
  attempt, so it cannot make a record; run the whole workflow again.
- A local patch to the deploy may change only what the record says, never the
  deploy's mechanics, and is verified against the real range first. The
  permanent change is filed as a tool item.
- A train pushed and not deployed may fold into the next train; folding is
  the release owner's decision, taken when the hour a complete run costs is
  better spent judging more. The next train's head carries it whole, one
  complete push run judges both, and the release names both trains' items.
  That run is compared against live's push run, and every red carried over
  from the first train's list is matched again or placed again; nothing is
  known merely because the first run had it. The first run stays in the audit.

## The deploy

The deploy goes the minute the comparison clears, with the known reds built
from the push summary (`--known-reds`,
[tools.md](tools.md#known-reds---known-reds-file)), whose `live_commit` is the
live head. For a train with a migration, the migrate step exits 0 and the
health view reads the new schema ([health.md](health.md)) before the record is
written. After the deploy, the live head and the store's schema are read back.

The deploy's word is given in advance, with the conditions the run must meet,
so a landing waits on no seat. The owner gets one line per release, by what a
person sees, from the seat that holds the release.

## Test-only fixes

- A fix that changes no product rides the next train as a passenger. It does
  not restart a run in progress and never earns a cut of its own. It is red
  first on its case, green in both engines, its mutant red, and reviewed on
  its diff alone.
- A check fix needed at the merge lands as its own commit on the train branch,
  and its diff is read before the merge; it needs no second review loop.
- A test-only change that makes a known intermittent red fire more often does
  not board until runs with and without it read the same, three of three each.

## In the item, or Later

- A regression a person sees is fixed in the item before it ships: something
  the page did for a person taken away, prior behaviour coming back late, or
  the item's acceptance not met.
- Anything else a review finds is a follow-up: one item in Later, filed with
  the commit it was reproduced at, unless a person hit it.
- A defect a person hits boards on its own account at its approval.

## Red first

A red is first only when it is seen before the fix is written. A red seen after
the fix exists cannot show that the fix is what turned it green. A finding
names the commit it was reproduced at, and that commit is the head under
review.

## Estimates

- A time given to the owner is the measured duration of the run it waits on
  (a release's push run takes about an hour), plus the prerequisite the train
  is waiting on, such as the release before it going live. A guessed duration
  is not an estimate.
- When either the run or its prerequisite slips, the owner is told again, with
  the new time and its reason.

## Speaking to the owner

- One voice. The agent the owner addressed answers. Facts another agent holds
  go to that agent in the coordination topic, and it folds them into its
  answer. Times in a thread the owner addressed to one agent are that agent's.
- A choice with a sensible default, where either answer is a quick fix, is not
  asked. The default ships, and the release line names the choice. Only a
  choice that is costly to reverse, or one the owner has spoken to on both
  sides, is asked.
- An item waits on the owner only while the store shows no answer of theirs. A
  thumbs-up on a message that says what a thumbs-up means is their word.
- When a build departs from the owner's own words for a surface, its preview
  says so in one line and shows the old beside the new.
