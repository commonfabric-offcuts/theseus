# Server-owned openings, team membership and schema upgrades

Theseus keeps every durable product fact in Core. This document is the
contract for three pieces that make several outcomes usable by a real team:
private opening drafts that publish a new topic in one act, owner-managed
outcome membership with operator actor registration, and versioned schema
upgrades for an existing instance.

The browser is a cache and an outbox. It may hold writing that Core has not
yet acknowledged and the exact command envelopes it has sent or is about to
send. It never decides that a save, publication or refusal happened.

## Schema version 9

`SCHEMA_VERSION` becomes `"9"`. Version 9 adds one table and one index:

```sql
CREATE TABLE openings (
  id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  topic_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','published','discarded')),
  payload TEXT NOT NULL,
  publish_operation_id TEXT,
  message_id TEXT REFERENCES messages(id),
  PRIMARY KEY(actor_id,id))
CREATE INDEX open_openings ON openings(actor_id,workspace_id,id) WHERE state='open'
```

`payload` is canonical JSON `{title, participants, body, attachments}`.
Attachments are stored as `{id}` references while drafting. An opening is
private to its actor; nobody else can read it, list it or receive a
delivery for it.

## Commands

All commands use the existing envelope (`v`, `instance_id`, `operation_id`,
`kind`, `target`, `expected` with the captured `authority`, `args`), the same
transaction, deduplication by actor and operation ID, and receipt shape.
Refusals are recorded unless the code is `INVALID_ARGUMENT`.

### `opening.save`

- `target`: `{opening_id}`. `expected`: `{opening_revision}` (required).
- `args`: exactly `{workspace_id, topic_id, title, participants, body, attachments}`.
  Every save carries the whole writing; nothing is merged.
- Creation is `opening_revision: 0` for an ID this actor has not used. It
  checks that the actor can access `workspace_id` and that `topic_id` names
  no existing topic and no other opening (`REVISION_CONFLICT` otherwise).
- A later save must keep the same `workspace_id` and `topic_id`
  (`INVALID_ARGUMENT` otherwise) and match the stored revision
  (`REVISION_CONFLICT` with `current_versions.opening_revision`).
- A published or discarded opening refuses with `OPENING_CLOSED`.
- `title` and `body` are bounded text and may be empty while drafting.
  `participants` is a list of distinct actor IDs, at most
  `topic_participants - 1`, each naming an existing actor. Attachments go
  through the existing attachment reference check; pending media is allowed.
- Result: `{opening_id, opening_revision, state: "open"}`. The change feed
  records `("actor", actor, "opening", opening_id, revision)`.
- A duplicate participant is `INVALID_ARGUMENT`, an unknown one
  `INVALID_RECIPIENT`, and too many `TOO_MANY_PARTICIPANTS`. Another actor's
  media is `FORBIDDEN`.

### `opening.publish`

- `target`: `{opening_id}`. `expected`: `{opening_revision}` (required).
- `args`: `{}`. The saved revision is the content; the request cannot
  supply or override writing.
- In one transaction Core checks that the opening is open and at the
  expected revision, that the actor can still access its workspace, that
  `topic_id` is unused, that the title is not blank, that every participant
  is enabled, that every attachment is ready, and that the body or an
  attachment is non-empty. It then creates the topic, its participants (the
  author plus the saved participants), the summary, the opening message and
  the deliveries, exactly as an ordinary publication does, and marks the
  opening `published` with `publish_operation_id` and `message_id`.
- Result: `{opening_id, opening_revision, topic: {id, version}, message_id,
  delivery: {queued, unavailable_subscribers}}`.
- A retry with the same operation ID and envelope returns the recorded
  receipt. A different operation ID on a published opening refuses with
  `OPENING_CLOSED`, recorded, and the `opening` view links the result.
- A recorded refusal leaves the opening open and unchanged. The person can
  correct it, save, and publish with a new operation ID. The refused
  writing is not kept separately: nothing was delivered, and the next save
  replaces the private draft on purpose.
- Refusal codes, all recorded: an unknown or another actor's opening is
  `FORBIDDEN`; lost workspace access `FORBIDDEN`; a used topic ID
  `REVISION_CONFLICT`; a disabled participant `INVALID_RECIPIENT`; a blank
  title `EMPTY_TITLE`; an unready attachment `ATTACHMENT_NOT_READY`; no body
  and no attachment `EMPTY_MESSAGE`. Participants are checked before the
  title, because the creation step is shared with the earlier prepared
  openings.
- Publication and discard each advance the opening revision by one, so the
  change feed records `("actor", actor, "opening", opening_id, revision)` with
  a new version when the opening closes. The result's `opening_revision` is
  that closing revision.

### `opening.discard`

- `target`: `{opening_id}`. `expected`: `{opening_revision}` (required).
  `args`: `{}`.
- An open opening becomes `discarded` and leaves the unfinished list. Media
  is not deleted. Discarding a published or discarded opening refuses with
  `OPENING_CLOSED`.
- Result: `{opening_id, opening_revision, state: "discarded"}`.

### `workspace.member_set`

- `target`: `{workspace_id}`. `expected`: `{workspace_revision}` (required).
- `args`: `{actor_id, present}` with `present` a boolean.
- Only the workspace owner may change membership (`FORBIDDEN` otherwise).
  The owner cannot be removed (`OWNER_REQUIRED`). Adding requires an enabled actor and respects
  `workspace_members`. A no-op still advances nothing and returns the
  current state.
- A change bumps the workspace version and records
  `("workspace", W, "workspace", W, version)` and
  `("actor", member, "workspace", W, version)`.
- Removal ends workspace access. Topic participation that the member holds
  separately is unchanged. Removing the workspace's coordinator also clears
  `coordinator_id` in the same change, so the workspace never names a
  coordinator who is not a member.
- A topic waits only on someone who can read it. Each of the workspace's
  topics that the removed member can no longer read, and that waits on them,
  stops waiting on them in the same change: the topic version advances, with
  its usual topic and workspace change rows, and the member gets
  `("actor", member, "waiting", T, topic_version)`. The workspace version
  then advances once more, so it can rise by more than one.
- Result: `{workspace_id, actor_id, present, version}`.

## Views

- `opening` with `{opening_id}` returns `{instance_id, opening: {id,
  workspace_id, topic_id, revision, state, title, participants, body,
  attachments, publish_operation_id, message_id}, publish_receipt}`.
  `publish_receipt` is the recorded receipt of `publish_operation_id`, or
  `null`. Another actor's opening is `FORBIDDEN`.
- `openings` with optional `{workspace_id, cursor, limit}` lists this actor's
  open openings ordered by ID, with `{id, workspace_id, topic_id, revision,
  title, title_truncated}` and a 1024-byte title prefix, bounded by
  `summary_utf8_bytes`. With `workspace_id`, the actor must have access to
  it. `next_cursor` is the last returned ID or `null`.
- `workspace_members` with `{workspace_id, cursor, limit}` lists member actor
  IDs, kinds and names for anyone with workspace access, ordered by actor ID,
  as `{actor_id, kind, name, name_truncated, enabled}` with a 1024-byte name
  prefix, bounded by `summary_utf8_bytes`, with `relevant_versions: {workspace}`.
  A disabled member stays on the team but cannot be sent to.
  `next_cursor` is the last returned actor ID or `null`.
- `actors` with optional `{kind, cursor, limit}` lists the instance's enabled
  people and agents, ordered by ID, as `{id, kind, name, name_truncated}`
  with a 1024-byte name prefix, bounded by `summary_utf8_bytes`. Anyone in
  the instance may read it; `kind` is `human` or `agent`. It is the list a
  team or topic picker offers. The command that adds a name decides whether
  it may be added. `next_cursor` is the last returned ID or `null`.

## Earlier prepared openings

`submission.prepare` and `topic.create_and_send` with a submission stay
unchanged for existing records and their exact retries. New clients start
topics only through `opening.save` and `opening.publish`.

## Operator tools

`bin/aim-next-admin` is a local operator program. It needs the same profile
binding as the server and is never exposed over HTTP.

- `migrate --db PATH --instance ID --binding PROFILE` upgrades the database
  to the current schema. It refuses to run while the authority's runner
  guard is held, takes `BEGIN IMMEDIATE`, verifies instance and binding,
  applies each registered step from the stored version to
  `SCHEMA_VERSION` in order, writes the new `schema_version`, advances the
  commit sequence and commits once. A failure commits nothing. A database
  already at the current version reports so and changes nothing. A newer or
  unknown version refuses. Reads and the server never migrate. Because older
  code accepts only its own version, a committed upgrade fences every older
  writer.
- `migrate ... --to VERSION` moves to an earlier version through the same
  guard, transaction and checks, and is the rollback for a deployment. A
  step back runs only while the newer version holds no records the older
  one cannot keep: version 9 steps back to 8 only while `openings` has no
  row in any state, otherwise it refuses with `RECORDS_WOULD_BE_LOST`. The
  commit sequence advances on a step back too, so a backup taken before the
  upgrade stays older than the instance; rollback and backup activation are
  separate acts.
- `add-actor --profile PROFILE --id ID --kind KIND --name NAME` registers an
  enabled actor in one recorded transaction. An existing ID refuses.
- Each prints one JSON object. Success is `{ok: true, ...}` with exit 0; a
  refusal is `{ok: false, error: {code, message, retryable}}` with exit 2, or
  75 when retryable, and 1 when the outcome is unconfirmed. `migrate` returns
  `{instance_id, from_version, schema_version, migrated}`. Its codes are
  `BINDING_MISMATCH` (the profile names another database or instance),
  `RUNNER_GUARD_HELD`, `INSTANCE_MISMATCH`, `AUTHORITY_CHANGED`,
  `SCHEMA_UNSUPPORTED`, `RECORDS_WOULD_BE_LOST`, `MIGRATION_FAILED`, and two retryable codes:
  `DATABASE_BUSY`, and `AUTHORITY_BUSY` while a recovery activation or
  cutover holds the authority. Each of these changed nothing. A storage
  error from the commit itself, other than busy, is unconfirmed (exit 1,
  code `UNCONFIRMED`), because SQLite can report one after its commit point;
  running `migrate` again is safe and reports `migrated: false` when the
  upgrade had landed. It reads the
  profile's binding without opening the store, because the store refuses an
  older schema. `add-actor` opens the profile's store at the current version;
  `KIND` is `human` or `agent`, `NAME` is non-blank text, and a used ID is
  `ACTOR_EXISTS`.
- New actor profiles use the existing `profile.write_profile`.

Take a backup with the recovery API before migrating. Recovery and backup
validation accept the current schema version only, so a backup taken before
an upgrade is activated by the code of its own version and then migrated.

## Client behavior

- Outcome pages list the person's unfinished openings in that outcome from
  the `openings` view. Any device can resume one.
- New topic preallocates opening and topic IDs and saves revision 1 on the
  first change, then saves on edits with the expected revision. The status
  shows Saving, Saved, or Not saved yet. A `REVISION_CONFLICT` keeps the
  person's writing visible and offers the server's current revision; it
  never overwrites either side silently.
- Writing that Core has not acknowledged is kept on this device until a
  save is acknowledged. It is labelled as on this device only. Until Core
  has saved an opening, no page lists it, so leaving the page or closing it
  asks for a second choice.
- Send saves any pending writing, then stores the publish envelope on this
  device before dispatching it. A committed receipt opens the new topic. An
  unknown result keeps the envelope; Check reads the operation, and Send
  again re-sends the identical envelope. A recorded refusal shows its reason
  and returns to editing; the next Send uses a new operation ID. When Check
  finds no record and the envelope carries an authority the runtime has
  since replaced (a restore), Core can never accept it: the envelope is
  dropped and the opening returns to editing.
- If Send's own save finds the opening already published or discarded,
  Send stops there and dispatches no publish.
- Further writing after Send is a new opening or, once the topic exists,
  an ordinary reply.

The browser client (`web/opening.mjs`, `web/opening-view.mjs`,
`web/opening-store.mjs`) also does the following:

- The `opening` view answers `FORBIDDEN` both for an opening this actor has
  never saved and for one that is not theirs, because opening IDs belong to
  their actor. The client reads `FORBIDDEN` on its own link as "nothing
  saved yet" and starts at revision 0. Until the first save is
  acknowledged, the status reads Not saved yet.
- The device copy lives in its own IndexedDB database, `aim-next-openings`,
  keyed by instance, actor and opening. Each row records the revision its
  writing was based on and, while one is unconfirmed, the exact save whose
  answer was lost. On load, a kept lost save captured under the current
  authority is re-sent first with its operation ID, and its receipt decides
  whether Core's newer revision was this device's own. Otherwise the device
  writing is restored only when that base equals Core's current revision.
  If Core has moved on, the conflict view opens. If the opening is already
  published or discarded, the writing stays visible as leftover until the
  person removes it. Rows written before the lost save was kept omit it.
- A save whose answer was lost is re-sent with the same operation ID before
  any newer writing is saved. Nothing retries on its own; the next edit,
  Send, Discard or load sends the save again. When Send settles such a
  save, it then saves the newer writing before publishing.
- A first save refused with `REVISION_CONFLICT` while Core holds no opening
  for this ID means the link's topic identity is already used, as on a link
  from the retired prepared-opening flow. That is not a conflict: the page
  says the link can no longer start a topic, sends nothing more, and offers
  to move the writing to a new opening with fresh opening and topic IDs.
- Keep my writing saves over the exact revision the person was shown. Use
  the saved version takes Core's writing without sending a command.
- A publish whose committed result names a different opening, topic or
  message is treated as unknown, and its envelope is kept.
- Images are attached with `media.begin` and then published through the
  upload route under the reserved publish operation ID. The opening stores
  only `{id}` references. The image bytes stay in page memory, so after a
  reload an unfinished image shows "Upload not finished" and must be
  removed and chosen again. Send refuses, with the reason, until every
  image is ready.
- Discard asks for confirmation on the page, not in a browser dialog. A
  pending save is settled first. An opening Core never saved is discarded
  on the device alone, without a command.
- Outcome-creation forms are still listed per browser on the Outcomes page.
  Browser rows from the retired prepared-opening flow are skipped and never
  replayed.
