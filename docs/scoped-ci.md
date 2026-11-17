# Scoped pull-request checks (item 664)

`tools/check_plan.py` reads the event, its exact base and tested head. Only a
pull request whose `release_check.scope` choice can be read and whose changed
paths pass `small_fix_problems` gets a scoped plan. That uses the same selector
and small-fix boundary as the deploy. Six changed paths require a full run;
`SMALL_FIX_FILES` is five in the shared rule. Pushes, manual events and any
unreadable/refused scope get every required step.

The plan contains `shards`, `scoped` (the release-check scope record, or null)
and `why`. Browser shards contain only chosen native modes, dealt longest first
by the measured weights; empty browser shards are omitted. The units and deploy
refusals remain together and the wake replay remains separate, beside them.
`release_check.judge_summary` requires the replay even for scoped summaries.
Nothing depends on the replay finishing before the units or browser shards.

The workflow passes the scope alongside the shard matrix to combine. The
aggregate retains the complete `required` inventory and marks omitted browser
steps in `scoped`, never as passed. Missing chosen or non-browser steps keep it
red. The validator independently chooses the scope from the authenticated PR
base and tested commit; a scope is never accepted on a push. Full summaries still
require the complete inventory. Scope metadata never licenses missing chosen
steps, incomplete modes or missing units, deploy refusals or wake replay.

Local dry run (no tests or browser launched):

```
python3 -I tools/check_plan.py --event-name pull_request --event /path/event.json --head FULL_SHA
```

The JSON event contains `pull_request.base.sha` and `pull_request.head.sha`.
Only committed revisions are read. This item's own `.github/` and `tools/`
changes require a full train. Post-landing acceptance is Warp's next scoped
train: its jobs show units, deploy refusals, the chosen native modes and the
required parallel replay only, and elapsed time ends at the slowest shard.
There is no changed page or browser acceptance case for this item.
