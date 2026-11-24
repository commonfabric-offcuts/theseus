# Wake diagnostics and recovery

A pending-delivery read is an observation, not a delivered wake. Its bounded
result distinguishes complete and partial pagination, a returned Core refusal,
malformed output, and a transport failure. A failure names its page and the
canonical cursor used for that page. Invalid cursor bytes are never retained.
The named budget remains five pages of at most 100 items. Empty pages with an
advancing canonical cursor are valid. Exhausting that budget without a visible
item is partial/unavailable work, never proof that the inbox is empty.

Diagnostics contain only fixed categories, allowlisted Core codes and phrases,
boolean retryability when known, counts, and actual actor/attempt identifiers.
They contain no message/error body, credential, profile path or token. Unknown
codes and exception text are withheld. Binding refusals stop the affected
operation under the original binding; a diagnostic is never permission to
change identity or retry an uncertain mutation.

Core writes a versioned metadata observation under the actual unexpired claim,
before reading and again when the read returns. This does not settle the wake.
The latest recipient pointer uses Core observation time; a stale claim cannot
replace it. Health joins the immutable wake result and actual hosted turn by
attempt primary key. A live claim without a wake result is pending intent, a
handed open hosted turn is running, a recorded result is terminal, and an
expired unfinished claim is unknown. These are not inferred from inbox success.
Health reads that exact record and shows the safe cause beside its existing
wake result. Successful reading never changes accepted/handed, seen, completed,
or answered facts. Existing hosted controls and owned-child cleanup retain their
owners. No schema change or new scheduler is introduced by this storage shape.

If a read throws with unconfirmed storage cleanup, or returns/raises a binding
refusal, no post-read observation write or optional context read is attempted:
the safe transport observation is emitted with the actual attempt, the runner
stops, and Health keeps the unfinished read as unknown after its lease. The
event is not a durable Core result. Other clean Core refusals retain category, known
code, typed retryability, page index and requested canonical cursor in Health.
The original binding-refusal object stays on the calling fault boundary; its
arbitrary error body is not copied into diagnostics.

Recovery keeps pending intent, running, terminal, committed but unseen, and
unknown distinct. An existing immutable operation result is reconciled by its
original bound operation identity before retry. `reconcile OPERATION` reads the
saved exact request and Core result without sending it. A missing local receipt
with a recorded Core outcome is committed_unseen; a matching receipt is terminal;
a saved request with no Core result at that read is pending_intent. Malformed or
refused reconciliation stops as unknown and sends nothing. `retry` first makes
that same bound read, then returns the immutable result or sends the unchanged
saved request with the original ID. It never runs a producer itself.
The operation view's optional `expected_fingerprint` is a lowercase SHA256 of
the normalized command envelope, using the same canonical JSON as command
deduplication. Core checks it before returning the existing immutable receipt;
a changed saved payload returns `OPERATION_PAYLOAD_MISMATCH`. Unknown or malformed
receipt/error shapes stop before caching a receipt or sending a command.
No-ID, unrecorded busy ACKs keep
the separately specified idempotent ACK behavior. A source revision already
answered by the recipient presents the existing answer as acknowledgment work;
a later source revision is new work. A private or no-longer-readable answer is
never exposed outside its existing access rules.

The reply transaction writes an exact metadata key for answering actor, source
ID and the immutable reply basis's source revision, including replies without a
quote. Redelivery validates that basis by message/operation primary key and
checks current source/answer access and withholding before returning an answer
ID. The notice reads that answer's exact sequence rather than paging from its
older source, and retains whisper privacy instructions. Explicitly partial
conversation replies do not enter this answer index. A reply hint is not a
declaration that all work completed; any other owed work remains active. A
deliberate later reply remains possible and becomes the current hint.
Missing legacy keys explicitly return unknown/exact_key_only. A known legacy
operation or answer ID still supplies its original immutable basis; arbitrary
older answers are not discovered or backfilled. There is no history scan and
unknown never means unanswered. The original incident's cause remains unknown; these records
make a future failure observable without diagnosing that incident by correlation.
