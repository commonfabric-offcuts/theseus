# Item 803 — whole starred dossiers on topic open

Emergency source-only correction under Warp10216, based on actual live105
`5c15b7b04e48bf4db38de43a7a1dd00faca95595`.

Default: **starred dossiers first, newest activity first**, above unstarred
dossiers and More. Page the existing topic-scoped Core `stars` view to its end;
deduplicate actual `dossier.id` values, not star records. Load each admitted
first message and every admitted reply into its canonical dossier. Whole means
loaded and grouped; the person's normal folds/opens still apply.

Use bounded older `topic_messages` pages through TopicViews' ordinary frontier
until history exhaustion whenever this topic has stars. No separate history
supplement, invented continuity, skipped normal history, or Core change.
Refresh owns this work, yielding between pages and to foreground reads. Stars,
joins/splits, access and visit changes fence stale answers. Show a compact
loading/error/retry line; retain exact writing, focus and the existing anchor.
Preserve live105's actual-head and no-apart fix, 793's folded sender, 656's
removal and unrelated features. No held features imported.

NO TESTS RUN: this round permits code readback and Git metadata only. No new
code execution, diagnosis, mutation, browser, native, hosted or Pool calls.
803 native: 0 prior, 0 allocated, 18 unallocated. 799: 2 prior; historical
0/8 per engine remains historical. Freeze source for root's parser, PR, merge
and ordinary guarded deploy; no selfapproval or acceptance claim.
