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

```json
{
  "instance_id": "I",
  "items": [
    {"id": "W", "owner_id": "A", "title": "Outcome", "title_truncated": false, "version": 1}
  ],
  "next_cursor": null
}
```

Each title is a literal prefix of at most 1024 UTF-8 bytes, ending at a code-point
boundary. `title_truncated` reports whether more text exists; selecting the
ordinary `workspace` detail view retrieves the full title. Stored titles are
unchanged. SQL retrieves at most 1025 bytes of each title, and the complete compact
UTF-8 JSON response fits the existing 131072-byte summary limit, including escapes
and the continuation cursor.

Only `next_cursor: null` means the list has ended. A byte-limited page can contain
fewer than `limit` items and still continue. The cursor names the last returned
visible ID, so retrying from it does not skip the next item. Each request reads
current membership; this is not a snapshot across requests. A new item sorting
before the current cursor appears when the reader starts again at the first page.
An actor with no memberships receives an empty terminal page. Reads create no
operations or work, and the list carries no global revision or aggregate counts.

Creation remains a separate existing command. Retain the original workspace ID,
operation, authority and payload until `workspace.create` is reconciled. The first
topic then uses its own private `new_topic` draft, preparation and
`topic.create_and_send`. Canceling that opening leaves any already-created
workspace intact. The list query introduces no creation, deletion, team-management
or lifecycle behavior and makes no change to `workspace_topics` title handling.
