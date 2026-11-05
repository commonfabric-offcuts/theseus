# Scoped changes

The shared `changes` view is available through the local CLI `view` and the
existing HTTP `/api/view` route. It does not subscribe, acknowledge, send, or
choose a browser notification/refresh transport. A request is:

```json
{"name":"changes","args":{"scope":{"kind":"topic","id":"configured-topic"},"limit":50}}
```

Exactly one `topic`, `workspace`, or `actor` scope is required. Topic/workspace
access is checked on every page, including continuations. An actor scope is
always the caller's own; workspace ownership grants no access to another
actor's private keys. A delivered-source grant alone does not grant topic access.

Omitting `cursor` deliberately establishes a baseline **before** fetching the
dependent initial views. The result has `baseline: true`, `items: []`,
`has_more: false`, `continuation: null`, a `checkpoint`, and `covered_versions`.
Save that checkpoint, fetch the initial views, then pass it as `args.cursor` to
catch changes that raced those views. Explicit null is not an omitted cursor.

Change items contain only `seq`, `resource_kind`, `resource_id`, and `version`.
The default page size is 50, maximum 100. The complete response is bounded by
the backend `summary_utf8_bytes` capability (131072). A SQL page materializes at
most `limit + 1` scoped keys, plus one global-head row. There is no offset scan.

Each catch-up window fixes the committed **global** maximum sequence and scope
versions in one read transaction. A partial page has `has_more: true`, a
`continuation`, `checkpoint: null`, and `covered_versions: null`. Retain the
previous completed checkpoint while draining continuations. Only the completed
window returns a new checkpoint and covered versions. Changes committed after
that window's upper boundary belong to the next window. An empty completed
window means no newer keys for this scope and still returns a checkpoint.

Cursors are JSON objects owned by the backend contract; pass them back unchanged.
Both kinds carry `v: 1`, `kind`, `instance_id`, `authority_id`, `authority_epoch`,
`actor_id`, exact `scope`, and `after_seq`. A `continuation` additionally carries
`through_seq` and the captured `covered_versions`. These fields are continuation
state, not credentials or signed evidence. Lowering a position can replay keys
but cannot grant permission. The explicit request scope must equal the bound
scope. Topic covered versions have `topic` and `notebook`; workspace versions
have `workspace` and `notebook`; actor scopes have no aggregate version (`{}`).
Continuation versions belong to the captured window, not later commits.

The `changes.seq` AUTOINCREMENT and insertion in the same serialized command
transaction as the effect establish commit order without reuse. Global sequence
gaps, including an empty scope at a nonzero global head, are normal. No pruning
or expiry exists. Any future pruning must introduce an explicit persisted
history floor; it cannot infer expiry from the oldest row in a scope.

Malformed cursors/limits refuse with `INVALID_ARGUMENT`. A cursor for another
binding, actor or request scope, or ahead of committed history, returns
`RESYNC_REQUIRED`. Lost permission returns `FORBIDDEN`, not an empty page or an
access grant. Existing authority-fence errors retain their original codes.
Explicit resync captures a fresh baseline and rereads permitted dependent views;
it must preserve writing and old operation identities through recovery.

At this revision, topic keys are topic versions and scoped Notebook item
versions. Workspace keys are workspace creation and membership, topic versions
and workspace Notebook items. Actor keys are private drafts, notes,
submissions, media, openings, participation, deliveries, workspace membership
(`workspace`, keyed by the workspace, when the actor is added or removed) and
`waiting` (keyed by the topic, at its new version, when a topic starts or
stops waiting on the actor, including when they lose the topic). A `waiting`
key does not say which; the `attention` view or the topic does. A send changes
the topic version; it does not emit a separate message change row. An actor's private draft or preparation emits no
topic/workspace key. Consumers invalidate affected lists/items and compare their
existing `relevant_versions`; they retain the current message/Notebook revision,
selection, quote and writing, offering a newer Notebook revision explicitly.
No UI freshness or background scheduling claim follows from this query alone.
