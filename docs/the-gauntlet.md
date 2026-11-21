# The gauntlet

A change to the data layer, which is a migration, the deploy tool or the
controller, lands judged: a hosted run of the producer's checks on the
exact head, the Verdict's check runs on that head, and an audit message,
and the guard refuses an ordinary landing for those paths. The run takes
the better part of an hour. The Verdict insists that the judged head be a
parent of the merge and that the merge carry the head's tree, so any
landing between the run's start and the merge makes the run worthless.

## The rule

A judged change pays its own gauntlet, and nothing waits on it.

- An ordinary approved head lands as it is approved, on whatever live is,
  whatever judged run is in flight.
- A judged head is carried onto live and its run started when nothing
  ordinary is waiting. When live moves under it, it is carried again and
  rerun. The rerun is its cost, never the others'.
- A judged item is never combined with another item into one landing, and
  nothing is chained behind it.
- At freeze, the actual head's diff against its release base marks a piece
  judged when its files touch the gauntlet's paths. The card and combine
  read that one Core record; before freeze, the card shows no mark.
  Warp adds the gauntlet's hour on its cover, rather than an ETA in code.
- The landing tool refuses the other order: it will not start a judged
  head's run or landing while an ordinary approved head is unlanded, and
  combine will not put a judged item in a landing with anything else
  (item 987).

## Why

The gauntlet protects the data layer, so its cost belongs to the change
that touches the data layer and to nothing else. Holding ordinary work
behind it turns one change's hour into everyone's hour, and the people
waiting for releases see nothing land. Bundling is the smell: whenever a
plan puts anything behind a judged run, the plan is wrong, not the run.

## The rules beside it

- A boundary, which is a deploy that restarts the runner, is called once
  per queue. From the boundary post to the resume, nothing goes to any
  seat and nothing goes in Landing, because a post in Landing reaches
  every seat whatever it is addressed to. A web-only head deploys as
  "keep compatible" and needs no boundary.
- A carry merges live into the approved head. Its delta over live equals
  the approved delta over its base, per file. A carry that must be judged
  carries no `[skip ci]`.
- The Verdict judges only a run's first attempt, on a head that is the
  merge's parent. Never rerun a workflow; push a new commit.
