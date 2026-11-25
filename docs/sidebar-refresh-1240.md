# Scoped sidebar reads (1240)

The outline retains its existing authorized projections and their pagination.
An unrelated commit no longer reloads topic lists, counts or starred children.
A read-only controller checks bounded workspace/private changes, plus topic
Notebook changes only where starred pages are already displayed. Its cursors
advance only after all selected projections settle successfully. Opening,
reconnect, resync and access changes retain a full-read path. No timer, new
backend view, Health read or global star projection is added.

Workspace topic keys select that workspace's topic list/counts. Starred
dossier projections refresh for personal acts and for actual changes to their
displayed topic/count/body truth. Notebook stars refresh for personal star
acts and displayed page revisions. Duplicate visible links to one topic share
one retained star/page owner and one read per refresh. Unknown access or new
scope baselines remain conservative; last-good/error and page-retirement
ownership stay with the existing readers.

Focused controls must retain exact projection contents and read multiplicity
for unrelated/private commands, local/remote stars, page revisions, unread and
topic changes, opening, reconnect/resync, failed reads and retired responses.
Native send/thumb/Reply timings and contention attribution remain Flex's
matched-input empirical evidence after focused shipping under rule9. Smaller
read counts alone are not a measured latency or CPU improvement.

On topic/Conversation routes a settled commit reads one background actor
change window, one per retained authorized workspace (including folded rows
with counts), and one per displayed starred-page topic, deduplicated by scope.
Continuations add bounded pages. This is not a constant three-read claim.
The workspace page retains its existing shared OutcomeChanges controller.
Actual projections remain foreground reads; private writing changes alone
select none. A new scope is baselined and reread conservatively at opening.

1244 rides in this source: giving a thumb no longer invokes the Core
`_fold_answered` helper. Manual folds and replies retain their behavior;
reaction/read/mark/wait/cover and the distinct page dossier deal action remain.
There is no schema or command-shape change and no independent release.
