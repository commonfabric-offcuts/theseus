# Python shard headroom (1016)

Producer base: release 303, `bf98f3449b42374de868cf4a2f60ad22412a2dbd`.
Work is confined to the producer planner, its settings/workflow comments,
documentation and focused checks. This contract precedes implementation.

Choose the permitted timeout increase: Python jobs retain their existing
whole-file longest-first partition and measured timeout calculation, with a
30-minute minimum. A larger calculated timeout still wins. Node, deploy
refusals, browser and replay limits stay as they are. No file weight is
fabricated from an interrupted run, and no historical run is replayed.

Reason: the completed predecessor shard took 18m53s; 1015's corresponding
job was cancelled under its 19-minute limit. The complete GitHub job interval
includes its cancellation finalizers and is a lower bound on time needed to
finish all tests, not a completed measurement. Thirty minutes rounds up a
50% margin over that observed interval. Old per-file weights understate the
current work; raising the cap provides bounded headroom without claiming
that redealing incomplete measurements speeds up the suite.

Every planned test file still appears exactly once. The Python runner,
summary combiner, failures, missing-shard and timeout reporting remain intact.
The receipt and evidence steps still run after cancellation, byte-for-byte.
Tests retain the actual source job timestamps/outcomes, fail the old plan's
margin, exercise the published matrix and larger calculated caps, and run
the existing partition/combiner and workflow checks. Raw records and logs
stay in the review evidence. This local proof tests planning; a later judged
candidate's own hosted run establishes its actual completion time/result.

The GitHub source intervals are 2026-11-21T14:07:32Z–14:26:25Z
(1002, job136870458446: 1,133s) and
2026-11-21T15:21:27Z–15:40:51Z
(1015, job136889902421: 1,164s). The latter's annotation explicitly says
its maximum execution time was19m0s. Receipt and upload then succeeded.
The source fixture retains these timestamps, conclusions and step records;
full job JSON, annotations and logs accompany the review.
