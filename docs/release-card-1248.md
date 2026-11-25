# Release card first slice (1288)

This ordinary no-schema Core slice uses existing immutable messages, message
revisions and command outcomes. Two exact, bounded metadata keys index the
current typed payload and workspace/release identity. No schema version, new
table, migration, web or landing-tool change is included.

Wire format release-card-v1: release_card.create targets {topic_id} with
{payload, divergence_reason}; release_card.update targets {message_id} with
{payload}, fenced by expected.message_revision. Existing bound raw CLI command
and view expose the same ABI. Updates reuse the message.edit owner atomically;
a plain edit/Edit session refuses typed cards. One message identity per
workspace/release survives updates. Replies, quotes, asks and notes retain their
existing meanings. Current payload is returned on source and bounded requested
topic_messages entries, and by release_card {message_id} or
release_card {workspace_id,release}.

Required payload: release (positive integer), commit (full lowercase SHA),
attempt_id (bounded identifier), state (going_out/live/measured/failed/unknown),
title (1–256 characters), forecasts {push_at,live_at} (offset ISO times or null).
Optional summary (2048 characters) and evidence (8 bounded HTTP(S) links).
Payload maximum8192 UTF8 bytes. Measured requires actual summary/evidence. Core
checks Live/measured against the immutable numbered release and exact commit;
it supplies deployed_at/deployed_ms, never a caller. Verified states cannot
regress or switch attempts. Failed measurements remain explicit summaries.

Current release_card carries format, message_id, workspace_id, writer_id,
revision, recorded_ms, payload, original_forecasts, deployed_at/deployed_ms.
Original forecasts remain from creation. Previous bodies and complete typed
payloads remain in immutable message revisions and operation outcomes, readable
by exact retained operation identity. No unbounded history is embedded in the
current metadata value. A dedicated cursor-history API and CLI convenience
verbs are deferred; the draft at2840671b retains those proposals, not live
capabilities. read_formats.release_cards advertises only the v1 payload.

Access, original author/writer, operation replay, expected revisions, holds,
closed outcomes and removal follow existing Core owners. Enrichment precedes
final page byte accounting. Exact metadata-key queries do not scan history.
Page5 renderer/kit and later general deliverable cards remain separate.
