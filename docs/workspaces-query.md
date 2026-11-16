# Accessible workspaces

The shared `workspaces` view lists only the bound actor's workspace memberships.
Workspace creation includes its owner in that membership set. Topic participation
alone does not confer workspace access. HTTP and the [CLI](agent-cli.md) use the
same view and cannot override the actor through its arguments.

Arguments are optional `cursor` and `limit`. Cursor is an exclusive workspace-ID
lower bound, initially omitted or `""`. Limit defaults to 50, with a maximum of
100. Items use workspace-ID order; titles need not be unique. Every page also
carries `order`, the reader's own order of their outcomes, which the page
places them in (docs/outline-order.md).

A reached outcome is left out, and listed alone with `reached: true`; an
outcome its owner archived or completed is left out too, and listed alone with
`ended: true` (docs/targets.md, "Archived and completed"). Asking for both is
refused. Every page carries `reached_count` and `ended_count`, how many of the
reader's outcomes each line holds, whatever the page lists. Each item carries
`end`: `{state: archived | completed, by, ms}`, or `null` while it is open.

```json
{
  "instance_id": "I",
  "items": [
    {"id": "W", "owner_id": "A", "title": "Outcome", "title_truncated": false, "version": 1,
     "conversation_id": "T", "unread": 4, "addressed": 1, "build": {"unread": 3, "addressed": 1}, "end": null}
  ],
  "reached_count": 0, "ended_count": 0,
  "next_cursor": null
}
```

Each title is a literal prefix of at most 1024 UTF-8 bytes, ending at a code-point
boundary. `title_truncated` reports whether more text exists; selecting the
ordinary `workspace` detail view retrieves the full title. Stored titles are
unchanged. SQL retrieves at most 1025 bytes of each title, and the complete compact
UTF-8 JSON response fits the existing 131072-byte summary limit, including escapes
and the continuation cursor.

Each item counts what is new to the reader inside the outcome: `unread`, and
`addressed`, the part sent to them by name, neither counting an archived topic.
`build: {unread, addressed}` is the part of those in the outcome's open Build
topics (item 297, docs/topic-list.md): the topics a piece of its pipeline is
built in, while it is on, that are neither Done nor archived. The outline lists
no row for them, so an open outcome's row counts them (docs/rails.md, "Counts");
they are zero for an outcome with no pipeline on.

`conversation_id` names the topic that holds the outcome's Conversation, or is
`null` while it has none (an outcome made before the Conversation existed), so the
Outcomes home can open an outcome's Conversation with one press and its page when
it has none.

Only `next_cursor: null` means the list has ended. A byte-limited page can contain
fewer than `limit` items and still continue. The cursor names the last returned
visible ID, so retrying from it does not skip the next item. Each request reads
current membership; this is not a snapshot across requests. A new item sorting
before the current cursor appears when the reader starts again at the first page.
An actor with no memberships receives an empty terminal page. Reads create no
operations or work, and the list carries no global revision or aggregate counts
beyond each item's own.

Creation remains a separate existing command. Retain the original workspace ID,
operation, authority and payload until `workspace.create` is reconciled. The first
topic then uses its own private `new_topic` draft, preparation and
`topic.create_and_send`. Canceling that opening leaves any already-created
workspace intact. The list query introduces no creation, deletion, team-management
or lifecycle behavior and makes no change to `workspace_topics` title handling.
