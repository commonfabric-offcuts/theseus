# Historical authority publication intent (1324)

`aim_next.relocation_publication.prepare_publication_intent(request)` verifies
a completed 1322 preparation against the actual active source and durably records
the observation. `inspect_publication_intent(request)` only reads that journal.
These are internal operator APIs. They do not invoke a live authority, retire a
source, publish a destination, alter metadata, choose an epoch, save a profile,
start services or dispatch saved operations.

The exact request is `{v: 1, preparation: PREPARATION_REQUEST, journal_root: PATH}`.
PREPARATION_REQUEST is the complete unchanged 1322 request. PATH is an existing
canonical private directory, separate from the bundle, staging tree and both
actual/proposed instance directories. Identity is `(journal_root, move_id)`;
there is no global reservation. Records use the existing canonical JSON encoding
(UTF-8 plus newline); request digests bind those exact bytes, not arbitrary JSON
spellings. The helper captures independent input values before doing work.

Before claiming a new journal the helper verifies the complete candidate under
its preparation read lock, including its manifest, payload and completion marker.
The short source observation uses `RecoveryFence(..., 'readback')`: authority SH,
both stable lock identities, exact active anchor DB pathname and actual DB
device/inode. A read-only SQLite transaction with the existing `live` policy reads
the fixed metadata; instance, authority path/ID/epoch and both commit fields must
match the candidate. SQLite closes before the fence. No hashing/copying occurs
inside that transaction. Readback does not take runner EX or establish quiescence.

The journal claims its exact request before observation. Its final marker binds
the immutable intent, request and actual journal directory/lock identities.
The intent retains the complete predecessor anchor and its byte digest, observed
metadata, actual DB/authority-lock/runner-lock pairs and observation time, plus
the verified candidate identity/digests and proposed destination/UIDs. There is
no successor epoch, successor kernel identity or usable destination binding.

| Interruption / observation | Result |
| --- | --- |
| No journal | `not_started`, unconfirmed; inspection creates nothing |
| Bad candidate or invalid input | Refusal; no source or candidate write |
| Bad source path/inode/lineage/epoch/commit or lock replacement | Refusal; any claimed journal stays incomplete |
| Authority EX, SQLite busy or journal contention | Typed retryable busy; no inferred absence |
| Claim exists without final marker | `intent_incomplete`; create refuses to reconstruct or overwrite |
| Marker exists but flush/close failed | Uncertainty; read-only `intent_observed` does not confirm durability |
| Complete exact retry | Fresh checked full flush of the same journal; `intent_recorded`, confirmed |
| Changed request under the same identity | Request mismatch; original bytes remain |
| Replaced journal directory/lock or corrupt records | Refusal; no adoption or repair |

Completed retry and inspection validate retained records without reopening the
source or candidate. They never refresh the observation or recopy a payload.
Every file/directory uses existing actual-owner private no-follow rules and
checked Darwin full flush, with no weaker fallback. Partial records are retained.
Errors retain the journal/move identity and chained cause; a failed return is
never a claim that nothing happened.

This is historical evidence, not a lease or a move-ready result. Source writers
can advance after observation. A later, separately bounded retiring/publishing
operation must compare these predecessor facts again under exclusive cutover
fences, prevent old/new writers from both being enabled, and retain uncertainty
after any attempted destination publication. Route/control/managed-plan adoption,
lineage-bound original-operation readback and actual ownership/service/account
transition are separate work. Human owner, Stop/Continue, revisions and exact
old operation bytes remain unchanged; absent old results stay unknown/held and
do not authorize new-ID replay.
