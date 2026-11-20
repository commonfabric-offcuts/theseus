# Outline counts without a list reread (933)

`workspace_counts` takes `workspace_ids`: one to `limits.page_max` distinct
outcome IDs already loaded by the reader. It rechecks outcome membership for
every ID and returns one atomic `{instance_id, items}` answer. Each item has
only `id`, `unread`, `addressed`, `build`, `cover_waiting` and `light`, using
the same Core rules as `workspaces`. There are no titles, list order, cursors
or message bodies. Invalid IDs/bounds or any inaccessible outcome refuse the
whole read. The normal summary byte bound applies without truncation.

The outline merges these fields into its loaded rows after relevant scoped
delivery, mark, waiting, act, topic, pipeline or check changes. It leaves row
identity, paging, order and folds with their existing owners. More than one
maximum page of loaded outcomes uses bounded serial chunks. A failed chunk
does not publish a partial count update or accept the change checkpoint;
retry still owes it. A retired page cannot publish a late answer.

Full navigation, visibility, explicit retry and 904's actual Live outcome-list
key keep their existing list reads. Topic-page fallback, which has no shared
OutcomeChanges owner, refreshes counts on its existing commit reload. No new
Live key, schema, timer or background list scan is introduced. The existing
lamp rules still determine time-based changes when another commit/read occurs.

Checks use isolated scratch Core records and the real page/outline owners
through their read ports; they make no native-input or elapsed-time claim.
