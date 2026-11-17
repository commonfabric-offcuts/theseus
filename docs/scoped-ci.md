# Scoped pull-request checks (item 664)

`tools/check_plan.py` reads the event, its exact base and tested head. Only a
pull request whose `release_check.scope` choice can be read and whose changed
paths pass `small_fix_problems` gets a scoped plan. That uses the same selector
and small-fix boundary as the deploy. Six changed paths require a full run;
`SMALL_FIX_FILES` is five in the shared rule. Pushes, manual events and any
unreadable/refused scope get every required step.

The plan contains `shards`, `scoped` (the release-check scope record, or null)
and `why`. Browser shards contain only chosen native modes, dealt longest first
by the measured weights over four shards; empty browser shards are omitted.
Python uses four measured whole-file partitions, Node units and deploy refusals
each have their own job, and wake replay remains separate beside them. Each
job carries its measured limit ([unit-shards.md](unit-shards.md) and the browser
measurements in [tools.md](tools.md#browser-shard-minutes-item-666)).
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

`tests/test_tools_check_plan.py` also executes the workflow's plan shell block
in an isolated Git fixture, with the real planner and selector. It supplies
GitHub's event file, event name and tested head through the environment and
reads both `shards` and `scoped` from `GITHUB_OUTPUT`. Docs-only and CSS changes
must produce their exact scoped coverage; missing or malformed events,
non-PR events, forbidden paths, six files and unreadable committed rules must
produce full coverage and a null scope. Explicit CLI arguments and plain JSON
output are checked against the workflow output. The ledger has independent
breaks for ignoring the event and dropping either workflow output, so these
command-boundary regressions cannot pass on dealer-only coverage.
