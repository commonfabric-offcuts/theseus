# Typed Release cards (1248, Core support 1288)

Wire version `release-card-v1` keeps one ordinary message per workspace/release.
Its generated Markdown body remains readable by clients without typed rendering.
Existing immutable release records remain the only authority for verified Live.

`release_card.create` targets `{topic_id}`; args are `{payload, divergence_reason}`.
`release_card.update` targets `{message_id}`; args are `{payload}` and expected
includes `message_revision`. Both use the ordinary authenticated operation
transaction. Creation refuses an existing workspace/release identity; a retry
reuses its original operation. The writer is the original message author.

Payload fields: required `release` (positive integer), `commit` (full lowercase
Git SHA), `attempt_id` (bounded identifier), `state` (`going_out`, `live`,
`measured`, `failed`, `unknown`), `title` (1–256 characters), `forecasts`
(`push_at`, `live_at`, each offset ISO8601 or null); optional `summary` (up to
2048 characters), `evidence` (up to 8 HTTP(S) links, each up to 2048 characters).
The whole payload is at most 8192 UTF8 bytes. No caller supplies actual Live T.
`measured` requires evidence and a nonempty result summary; failed measurements
are reported in that summary without undoing verified Live.

Live/measured requires a numbered immutable release row with the same commit;
Core adds `deployed_at` and `deployed_ms`. A card that has verified Live cannot
regress or change commit/attempt. Before Live, retry attempts may change source;
all previous snapshots remain. First forecasts come from revision 1 and are
returned separately as `original_forecasts`; later forecasts never replace them.

Creation publishes the generated body and typed revision 1 in one transaction.
Updating appends matching typed/message revisions through the existing edit
owner; corrections, exact historical quotes, replies, asks and delivery meaning
stay with that owner. A plain edit or Edit session on a typed card refuses with
`TYPED_CARD_UPDATE_REQUIRED`; writing a note or reply remains unchanged.
Every write checks existing access/closed/removal/held/writer rules first.
Generated body changes on every revision, including a visible update number.

`release_card` reads `{message_id}` or `{workspace_id, release}`; optional
`revision` selects an exact historical snapshot. `release_card_history` reads
`{message_id, cursor?, limit?}` newest first; cursor is an exclusive revision.
Both return `release_card` or `items` with format, message/workspace identity,
writer, revision, recorded_ms, payload, original_forecasts and canonical Live T.
History respects the ordinary 100-row and 128KiB response bounds. Reads enforce
message access, holds and removal at the shared source boundary. An exact lookup
does not grant topic history. A history cursor always has a continuation when
the byte bound cuts the result.

`source` and requested `topic_messages` entries carry an optional `release_card`
object; plain messages gain no field. Typed payload enrichment occurs before
final response-byte accounting. Current/history reads use indexed identity and
revision queries, never a release/topic-history scan.

CLI: `release-card create TOPIC FILE --divergence-reason TEXT`,
`release-card update MESSAGE FILE --expected N`, `release-card read MESSAGE
[--revision N]`, `release-card history MESSAGE [--cursor N] [--limit N]`.
Write verbs accept `--operation`; retain the exact saved request on uncertainty.
Write success requires a fresh independent typed-state readback matching the
committed revision. JSON mode uses ordinary raw Core view/receipt envelopes.

Schema 69→70 adds indexed card identity and immutable revision tables. An empty
step may roll back; occupied rollback refuses. No historical message conversion
or release-row rewrite occurs. Database judgment and real-data rehearsal remain
required. Page5 owns renderer/kit integration; Core support is independently
readable and shippable. General deliverable cards and 1236 remain separate.
