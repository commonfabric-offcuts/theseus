# Unsend and Retract (151)

> Current carry: schema **59**, after 932's schema 57 and 625's schema 58.
> The original approval below used schema 57. Current composition and evidence
> are in [Removal carry 151+924](removal-carry-151-924-59.md).


Fresh Build 1 on live 162, `f41d682691c5a99c177538a87a30f04916ed6e1e`,
schema 56. Tony 11760 and Warp 11846 / 11915 / 11937 / 12091 / 12095 govern. This contract
precedes implementation. The existing 829 request and 863 shared menu owners
remain the owners of their paths.

Only a human author can remove their message. `message.unsend` and
`message.retract` target one `message_id`, take no args, and use the ordinary
authority and operation identity. Agents continue to edit. There is no Undo
or confirmation. An unseen message offers Unsend; one Core cannot prove unseen
offers Retract. The author sees this choice in the single shared message menu
in the feed, dossier, rail and Reader. Other readers see neither action.

Unsend requires a post after the complete-exposure boundary, no exposure to
anyone except its author, and no reply by anyone, including the author.
Queued or held delivery rows are not exposure. A stale Unsend that loses to
exposure/reply refuses `MESSAGE_SEEN`, unrecorded, and offers a fresh Retract
choice; it never silently performs a different act. Exact committed retries
still return their original receipt. Retract is also safe when explicitly
requested for an unseen message. Both terminal states are permanent.
Readable source/feed items carry `removal` (null or `{kind,by,at_ms}`) and
`removal_action` (`unsend`, `retract`, or null for an unauthorized/terminal
message). Command results carry the recorded `removal` and message/topic ids.

Warp 12126 adds one conservative boundary: a message ever opened in an author
edit session offers Retract only, including an open session on another device.
The indexed session row answers this; no operation-history scan is permitted.
Its prior edit receipts retain their original words and stay byte-exact. A human
`message.send` receipt contains identities, versions and delivery counts, not
its body (`_send` → `_publish`; human replies have no `reply_basis`). Agents'
reply-basis receipts can quote a parent, but agents cannot Unsend and any reply
already makes that parent Retract-only. Published submission snapshots still
need terminal projection filtering; unsent private writing remains separate.

Warp 12171 adds the published-quote boundary: a message quoted in another
published message offers Retract only. `message_quote_sources(source_id,
message_id)` has that composite primary key, foreign keys to both messages,
and immutable rows. A message-insert trigger records its validated structured
quotes in the publication transaction. Eligibility seeks the source key, never
scans message history. Historical messages are already Retract-only, so the
upgrade needs no quote backfill. The relation is part of this unlanded 56→57
step and its empty rollback. The release names: a message you've quoted
elsewhere can only be retracted. Private writing stays private writing.

Core retains the immutable message and one immutable terminal act. Unsent
messages have no readable card, placeholder, source, delivery, search result,
Starred entry, Notebook reference/quote, attachment, unread or reply count.
Retracted messages retain readable original words, struck through and dimmed,
with `Retracted` and the act's time on every message surface. A retracted
message no longer answers, asks or holds a wait. Both acts remove that ask's
linked waits and restore only waits that the removed answer cleared and that
no later surviving answer settled. Withdrawal and unrelated explicit or other
question waits keep their meaning. Subsequent thumb/reply/retry cannot revive
a terminal question or reapply a terminal answer.

Warp 12367 names the smaller topic default: when an unsent message is the
topic's `state_message_id`, clear that pointer, `state_by`, and the automatic
`Reopened by a new message` note. Leave the topic active; its `state_ms` and
`activity_ms` stay raised. The author can mark it Done again. A later explicit
state and unrelated notes are unchanged. The existing pointer is indexed in
57 so this also clears the original topic after a dossier move. No activity
floor, prior-state snapshot, or message-activity history is added.

A fresh Unsend after an existing Retract refuses `MESSAGE_SEEN` without recording
a new receipt or effect; retrying the original committed operation keeps its
exact receipt. A dossier move retains all stored membership, including unsent
history, but counts and chooses latest messages only from visible words. It
cannot revive a removed ask's wait. Removing a Conversation answer keeps its
immutable take history while removing that answer from the active takes; the
item is New only when no other non-part take still settles it. A removed item
itself remains terminal. A null prior decision does not make the next generated
reply say it changed an answer. Readable retracted words cannot authorize a
coordinator's item move or piece set-aside on the owner's behalf.

## Exposure and bounded owners

On 162, `topic.read_through` settles pending deliveries in its exact range but
writes no exposure or per-person read horizon. `message.mark` is a reminder;
an already-read no-op creates no record. Some delivery rows start acknowledged.
Therefore those records cannot prove historical absence. Existing messages at
or below the new boundary are Retract-only, including image-only messages.

Warp 12091 chooses conservative fetch-is-seen: once loaded for another person,
even off screen, or handed to an agent, only Retract remains. Record only the
first non-author exposure per message, at one content-projection boundary.
This means person-authored content actually returned, not an identity in a
reader's private note or draft, and not an agent-authored message. Existing
agent revision exposures still cover the words each agent actually receives.
There is no new acknowledgment protocol or per-path exposure write. Existing
screen-read and Mark read behavior continues; never scan historical operations.

Content already passes `Store._hand_over`: a growing agent read reruns under
`BEGIN IMMEDIATE`, records exposure, then returns. Extend its coverage to
image-only/attachment projections and raw media reads. The Unsend transaction
and the recorded hand-over serialize: hand-over first makes Unsend refuse;
Unsend first prevents content leaving the second read. Pending and held
deliveries cancel in the Unsend transaction and cannot be released later.

The common path with all content already exposed or owned by the reader must
remain read-only: no `BEGIN IMMEDIATE`, write or commit. Enumerate every public
view and the raw media return, with positive fixture evidence for every content
producer; an uncovered bypass forces Retract-only. Add human race controls in
both orders, alongside the existing agent race controls.
The view retains the `commit_seq` it read before recording exposure; the read's
own commit must not replace that snapshot sequence. Word markers remain
agent-only and are removed at the existing return boundary.

The topic-message response keeps its existing131072-byte limit after all
reaction, removal, private-writing and reading metadata is attached. Ordinary
traversal trims only its far end and continues from the last returned message;
discarded rows are not exposed. An exact `message_ids` request returns every
requested message or refuses `VIEW_TOO_LARGE` before exposure, at either the
preliminary or final size check. It never returns a partial named result or an
unusable cursor. One decorated preview that cannot fit also refuses.

Warp 12095 explicitly preserves the existing per-agent, per-revision
`message_exposures` writes needed by 452/614 edit corrections.
The new 151 first-exposure fact is separate and writes once per message. The
fully read-only proof holds for human opens and agent reads whose existing
revision exposures are also already known. Where 452/614 already records a
first hand-over, 151 records its first-exposure fact in that same transaction,
with no additional write transaction.

## Additive 56 to 57

Add `message_removals(message_id PRIMARY KEY REFERENCES messages(id),
kind CHECK(kind IN ('unsent','retracted')), by REFERENCES actors(id), at_ms,
operation_id, UNIQUE(by,operation_id))` with update/delete refusal triggers.
Add immutable `message_first_exposures(message_id PRIMARY KEY REFERENCES
messages(id), by REFERENCES actors(id), at_ms)` for the first non-author
projection, and a single immutable `message_removal_horizon(seq)` initialized
to the current maximum message sequence (zero in a new empty instance).

Add nullable `retraction_id REFERENCES message_removals(message_id)` to the
existing typed delivery representation, with exact-one identity among
`message_id`, `request_id`, and `retraction_id`. Keep ordinary
`UNIQUE(message_id,recipient_id,revision)` and request `UNIQUE(request_id)`
unchanged; add `UNIQUE(retraction_id,recipient_id)`. Retraction notices use
revision 1, their own queue identity and group, never a fabricated word edit.
The insertion guard requires a retracted terminal act and its readable agent
recipient. Only agents previously exposed to the words (or historically
counted exposed) receive the short correction. Normal inbox/watch/ack and
hosted/tool delivery use that same queue and retain recipient scoping.

Reuse `_rebuilt_deliveries` with explicit columns and restore its existing
indexes/trigger plus the 829 request guard. Prove every existing byte/value/key,
reason, group, schedule and sequence high-water survives. An actual 162/schema
56 fixture includes ordinary pending/acknowledged/held/correction deliveries
and an 829 typed request. Empty rollback restores 56; any terminal act or
notice refuses rollback. No guard-tool change. Unmigrated 56 is refused, never
silently upgraded by reads, commands or server startup.

## Focused proof plan

The first bounded red group is `tests/test_message_removal_151.py`: Unsend
projection/delivery exclusion; positive human content fetch; read-only repeated
topic open; author/kind/private
authority; agent hand-over before Unsend and Unsend between read phases;
immutable terminal act, injected failure, same-operation retry and restart.
It must fail on unchanged 162 before any product implementation.

Further focused families cover exact ask/answer wait recovery and no revival;
every readable projection including search, quotes, Notebook links and images;
actual temporary-store CLI inbox/watch/ack; retraction notice route/recovery and
stale receipts; actual-162 migration/rollback; and the current shared menu,
feed/Reader drawing, pending/refused/unknown retry identity below the browser.
The initial 366, message edit/exposure, and 829 controls were selected by changed
owners. Applied mutants must break record atomicity,
recipient scoping, Unsend hand-over exclusion, recovery and migration sequence
assertions, then pass byte-exact restored controls with unique CPython 3.9
`-I -X pycache_prefix=...` for each run.

The whole predecessor/candidate Python and Node comparisons required by
12318/12362 have run on live177 and the composed source. Their original failures
remain recorded; matching failure names do not establish matching predicates.
Warp12902 replaces the earlier leases and proof-packet workflow with relevant
green tests and one source/test review. Warp12904 additionally retains one
whole Python run on the corrected source before freeze, without repeating the
predecessor. No browser or native gesture is claimed by these checks.

## Source handoff

The fresh 162 red baseline, focused Core/CLI/migration runs, eight applied and
exact-restored assertion-failing mutants, and focused Node page controls are
recorded under `core-lane3-151-12083` in the coordinator's evidence directory.
`RUN-LEDGER.json`, `PROJECTION-INVENTORY.json`, `REPORT.md` and `FREEZE.json`
distinguish each tested source snapshot from the final frozen source. There is
no browser, native gesture, running server, hosted runtime or full-suite claim.

Retraction keeps separately published quoted words unchanged. A message you
have opened in Edit, or quoted in another published message, can only be
retracted. Historical messages also offer Retract only. Withdrawal remains a
separate act; personal withdrawal hiding is item 891 and is outside this change.
The parent carries this source onto the actual predecessor, retaining the
later menu and Edit-pencil changes, and owns independent review and landing.

## Page correction after the Build2 return

Supplemental dossier heads consult the same TopicViews terminal map as the
loaded page. They keep readable retracted words and discard unsent identities,
including when an older head read arrives later. The feed reconciles against
that combined view so a still-readable supplemental card keeps its identity.
No history is filled and no separate terminal authority is introduced.

Saved-fold, context-parent, Earlier-message and dossier-title rows put the
Retracted label and act time inside their visible row, outside the struck
original words. A typed or minted dossier name stays unstruck. This compact
reply-row correction does not add a removal field to the separate literal
“Replying to…” parent excerpt; that projection limitation remains explicit.

A withdrawal source's FORBIDDEN settles only that source refresh. The scoped
removal event still owns terminal learning, and topic availability still owns
actual topic denial. MESSAGE_SEEN updates only matching nonterminal Reader and
feed owners under the existing page fence, so the next explicit choice is
Retract. It does not send another command or change private writing.

The page baseline, failed construction, passing corrections and applied/restored
fault results are preserved in the Build2 evidence. The live177 composition
preserves the 886 batched-head owner, 890 Reader menu/Edit owner and 896 scroll
owner. The retired right-rail Starred path stays retired; the surviving outline
owner keeps its original-word decoration separate from the terminal label/time.
