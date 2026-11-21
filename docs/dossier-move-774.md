# Move a dossier to another topic (item 774)

## Contract and privacy admission — written before implementation

Base: live 99, a34f72f0b3555a274fd4ae5adb07123ff89c3a85. Tony's
9410 and 9729 request a whole dossier move; 9737 approves Warp's menu proposal.
The supplied 9806 and 9822 rulings order this build straight through. This is a
stored-data and permission change: independent judgment precedes deployment.
The builder neither deploys nor approves its own work.

A dossier is its canonical root plus current reply/join descendants, including
whispers invisible to the mover. This differs deliberately from a reader's
visible stack walk. No text, message, attachment, personal act or cover is
copied. Identity, sequence, attribution, exact words, revisions, reply/join edges,
stars and cover history remain. Only current topic membership and its routing
indexes change. All changes and the operation receipt commit in one transaction.
A bounded membership walk admits at most 1,000 messages and 4,000 delivery records; larger dossiers refuse
without a partial move. A move neither sends old messages to new subscribers nor
adds participants. Migration is explicit, never a read/server side effect.

Core's current admission is important: `_topic` admits the outcome owner, members,
topic creator and active participants; the coordinator alone is not a reader.
`_message_access` additionally admits an original addressed recipient to that
single source. Every path additionally applies the exact whisper pair, including
source, attachments, acts and covers. A whispered root's cover is private to
that root's readers. Joined/replied descendants may contain private exchanges
that the mover must neither read nor disclose in a receipt or pointer.

Before mutation, under the write lock, Core checks:

* The mover reads the root's topic and the root. The mover is the outcome's
  owner or the dossier's first agent author (root included, otherwise earliest
  agent reply in the complete dossier). A named dossier keeps this ownership.
* Source and destination are distinct ordinary topics in the same open outcome;
  neither is replaced or archived. The mover reads both. Conversation topics
  are excluded because they have different item/wait semantics.
* Every destination topic reader was already a source topic reader. This finite
  comparison uses owner, creator, outcome members and active participants, not
  message text or all instance history. Otherwise `MOVE_WOULD_EXPAND_ACCESS`.
  This protects public messages, attachments, names and public covers from a
  new audience. It does not change any whisper pair or turn a whisper public.
* Authors and named addressees of each moved message still read the destination.
  Otherwise `MOVE_REPLY_PATH_UNAVAILABLE`: there is no silent enrollment, no
  broader topic access granted by the move and no stranded reply path.
* The supplied source topic and move revision still match, and the target is
  still the canonical root. Otherwise `STACK_CHANGED`/`REVISION_CONFLICT`.

`stack.move` target is `{message_id: ROOT}`; args are
`{topic_id: DESTINATION}`; expected is `{source_topic_id: SOURCE,
move_revision: N, authority: ...}`. Same operation identity and exact envelope
returns the identical receipt after commit, even after later moves. A changed
retry refuses. Independent concurrent moves from the same revision have one
winner. A reply serialized before a move is included; one sent to the old topic
after the move refuses `INVALID_REPLY`, preserving the exact frozen writing.
A reply explicitly sent to the new topic joins the same root. No automatic
retargeting of writing or replay of refused operations occurs.

Result: `{root_id, topic_id, from_topic_id, move_revision, changed: true}`.
It contains no member count, hidden ids, private text or cover. Changes wake
scoped readers of both topics to reread membership; private roots produce only
actor-scoped notices to their pair. Old links resolve the same message through
its current admission; an old topic is never a grant to its moved content.

The old topic gets a separate, paged `dossier_moves` view of one-line pointers:
“Dossier moved to TOPIC”. No dossier title, text, waits or attachments is retained
there. A pointer is shown only if its current root and destination topic are
readable to the requester; repeated moves resolve to the current destination.
Pointers to whispered roots are invisible outside their pair. Returning a dossier
to a topic suppresses its pointer there.

Routing updates cover message_addressees, deliveries and reasons, message acts,
marks, blocks, summary counts/latest/other, and ask waits. Original addressed deliveries keep their identity and grants. Correction deliveries
keep their identity; pending corrections whose recipient loses current source
admission settle, as they do when participation ends. Subscription deliveries
move to the destination's current participation epoch only for an active
participant there; otherwise outstanding subscription deliveries settle and
stop waking the old subscription. No delivery is created. Topic-level said
waits remain with the topic; ask waits tied to moved messages follow those asks,
merging by oldest ask while retaining source said waits. Cover waits and stars
follow their unchanged message ids. Drafts and prepared submissions are exact
writing to their captured topic and are never rewritten.

`dossier_move_targets` is a bounded same-outcome topic list for an authorized
mover, with a cursor and More topics. It delegates to `workspace_topics`' active
list, accepting the same optional `build` filter used by the left rail. It
returns that page unchanged (including its position cursor and personal
`order`), plus `workspace_id`, `root_id`, `topic_id` and the move fence. The
client uses `TopicPages` and the rail's shared order book, then omits the source
topic from the arranged choices. Keeping the source in the raw page preserves
the canonical cursor even when it is the last row on a page. Done and archived
topics are never choices; Build topics are left out wherever the rail keeps
them apart. Command admission is authoritative and
rechecked after the picker opens. Feed stack positions and source dossier
metadata carry `can_move` and `move_revision` from Core. The default message and
dossier overflow shows “Move to topic…” to the owner and dossier agent, on
unnamed singletons and named dossiers alike. The picker supports touch, pointer,
Tab, Return, arrows and Escape, with plain busy/refusal/Retry states. A transport
retry retains one exact operation; a new destination is a new request. The old
feed rereads after a committed move and the one-line pointer opens its new place.

## Whole verification specification (before tests)

Focused real Core controls use an isolated temporary authority, CPython 3.9,
without live data or profiles. They assert complete membership, literal words,
message ids/sequences, cover revisions and values, personal stars, attachments,
ask waits, links and current topic routing, plus unrelated topics staying put.
They test named/unnamed/joined/private dossiers; each access refusal and absence
of leaked private words/attachments/covers/pointers; same/cross outcome, closed,
archived, unreadable, source-only/destination-only participants; changed retries,
exact retry after later acts, concurrent moves, concurrent reply before/after,
stale prepared submissions, new-destination replies and bounded reads.
Migration controls prove 47→48 preservation, immutable content, authorized
membership-only mutation, rollback and occupied downgrade refusal.

Real applied mutants must be caught for transaction rollback, complete member
routing, admission, whisper pointer redaction and current links. Each mutation
is asserted to apply once, tested with a unique effective PYTHONPYCACHEPREFIX,
then byte-restored and checked under another unique prefix. Retain full stdout,
exit status, source before/mutated/restored SHA and exact commands.

Own native cases are wired into native-reading and native-webkit-reading, all
matching ^reading item 774. Enumerate actual names without a browser and compile
all generated evaluate expressions below the browser. They use native taps,
pointer and keyboard inputs, never forced focus or direct handler invocation.
Cover 320/375/390 phone and laptop in light/dark, normal named/unnamed move,
owner/agent admission, busy/refusal/exact retry, old pointer/link and older reply
arrival, private refusal and unchanged unsent writing. Geometry has named
edgeTolerancePx=2 and minimumTouchPx=44; negative geometry controls must fail.
Screenshots and look geometry, served helper hashes and fixture/browser cleanup
are retained by the existing harness. Browser.close owns Chromium cleanup.

No whole suite, local browser or local native launch. Native starts: 0 prior;
2 allocated, maximum one Chromium then one WebKit, 16 unallocated. Commit a clean
freeze, request Chromium only, inspect its raw receipt, and request WebKit at the
same head only if no own product fault requires editing. No retry. Independent
coordinator review follows the final report; no self approval, push or deployment.
