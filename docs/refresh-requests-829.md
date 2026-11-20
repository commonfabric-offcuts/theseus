# Refresh requests are acts, not messages (829)

On schema56 a new `stack.cover_refresh` or `message.refresh` records the
existing pending refresh act and one typed request in the existing delivery
queue, atomically. It publishes no message, reply, subscription delivery,
unread mark, fold or question. Existing generated request messages and their
deliveries are unchanged. The command shapes, recipient rules, observed
revision fences, coalescing and exact-operation replay remain.

The addressed agent receives the same instruction words as before, with the
requester, exact source message, dossier root and observed revision. Only that
agent's delivery view contains these words. Ordinary source/message reads do
not acquire instructions, and requesting or receiving one grants no reach.
The existing inbox, watch, ack, delivery sequence, pending counters, scheduler,
hosted wake transport and retry owners serve requests. CLI lines begin
`request`, not `change`, `watching` or `acknowledged`. Failed routing keeps the
request pending; acknowledging its delivery does not complete the refresh.

Schema55→56 adds an immutable `refresh_requests` fact table (request id,
request act id, source message, root, topic, kind, requester, recipient,
observed revision, instruction body and creation time). `deliveries` gains a
nullable unique request reference. A row names exactly one message or request;
new request rows have no message id. The old message/recipient/revision unique
key stays identical, as do all old ids, sequences, reasons and group records.
SQLite requires a preserving table rebuild to allow the new nullable variant;
this is not a replacement queue. Requests use their own group kind, so message
unread/attention and read-through behavior cannot count or acknowledge them.
The explicit migration preserves sqlite_sequence and all existing records.
Empty rollback is allowed; any request fact forbids rollback. Reads never
migrate. The migration fixture starts with actual153's schema55 source.

The page uses the Core-owned refresh state to draw one small timed line for
the latest request on each target: `Tony asked warp to refresh the cover ·
5:20 PM`, or the equivalent message-update words. Repeated pending presses
coalesce into that same line. A qualifying changed cover write or ordinary
edit updates it to `warp refreshed the cover · 5:21 PM`. Pending/completed
history remains in the act ledger. Instructions are never in that projection.
The same line renderer serves the dossier and Reader; existing activity dots
and exact-envelope recovery keep their owner. Legacy request links remain
valid for pre56 requests. Late reads/receipts cannot revive completed state.

The existing completion rules remain: only a later qualifying agent content
write on the exact target completes; a reply, thumbs-up, delivery ack, no-op,
empty cover, human cover edit, owner's Done change or unrelated write does not.
Completion and its new act commit with the write. No timer completes work.

Evidence must include real temporary Core records for both commands,
permissions/privacy, no-publication side effects, exact replay/coalescing and
restart, atomic rollback, qualifying completion and negative controls; actual
CLI inbox/watch/ack output and hosted notice through the same queue; actual153
upgrade/empty rollback/occupied refusal; focused shared page controls and late
receipt recovery; and applied assertion-failing mutations with exact restores.
Native/browser/full-suite/hosted-CI checks are not authorized for this build.

Existing738/840 tests retain their recipient, privacy, retry, completion,
rollback and refusal assertions. Their new-request publication expectations
are intentionally changed to typed request/delivery facts and unchanged message
counts under11937. The historical47→48 guard still exercises an occupied48
refresh act directly; new requests now occupy56, whose guard is proved separately
with actual153 source. Legacy published request cards are verified unchanged by
that migration fixture and the page's old-link control.
