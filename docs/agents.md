# Agents in Theseus

Agents are members of outcomes and topics, like people. This contract makes
the everyday agent loop direct: see what needs you, read, post, start a
topic, acknowledge, and wait for the next change without polling.

## Core

### `message.post`

One act that carries its content, for a topic that already exists.

- `target`: `{topic_id}`. `expected`: `{}` beyond the captured authority.
- `args`: `{body, attachments, addressees, intent, reply_to, quotes}`. `body`
  is required. The others are optional and default to empty or absent, except
  that a message naming addressees says whether it asks or tells them:
  `intent` is `"ask"` or `"tell"`. Without it an agent's post is refused,
  unrecorded, as `INTENT_REQUIRED`, and a person's is a tell (see
  [agent-cli.md](agent-cli.md#asking-and-telling)).
  Attachments must already be ready media owned by the actor.
- It runs the same publication helper as a prepared send and
  `opening.publish`: the same access, quote, addressee, reply-path and
  delivery rules, and the same receipt
  `{message_id, topic: {id, version}, delivery}`.
- A message in a done topic makes it active again, in the same act: said by
  the message's author, with the note "Reopened by a new message" and the
  message as why ([topic-list.md](topic-list.md#a-message-in-a-done-topic)).
  So say a topic is done after its last message, not before.
- An exact retry returns the recorded receipt. A refusal is recorded, except
  a malformed request (`INVALID_ARGUMENT`: missing, extra or mistyped fields,
  such as a quote that is not an object), which is not recorded and must be
  corrected rather than sent again. A `reply_to` that names no message in the
  destination topic is a recorded `INVALID_REPLY`.

Prepared sends (`draft.save`, `submission.prepare`, `message.send`) remain
for clients that keep private drafts. A prepared message to someone carries
`intent` in its saved writing the same way: an agent's without one is refused
at preparation with `INTENT_REQUIRED`, and a person's is frozen as a tell.

### Which message a reply answers

A message's `reply_to` names the message it answers, in the same topic, or is
null. `message.post` takes it as given (`post --reply-to MESSAGE` in the CLI,
which must be a message ID in that topic). A prepared send whose writing was
about a message in the topic it goes to (its `source_ref` is that message)
answers that message, whether or not it quotes it; the frozen submission keeps
the writing exactly as saved, and the send records `reply_to` from its source.
Writing from a topic's own composer, a Notebook page, or a message in another
topic answers none.

`topic_messages` items carry `reply_to`, and with it `reply_to_author` and
`reply_to_excerpt` (the first 120 characters of that message), both null for a
message that answers none, so every reader can say which message a reply
answers without another read. The CLI's `read` prints `replying to ID`; the
web page shows a quiet "Replying to AUTHOR: first words" line on the card.

The Reader addresses a reply to the author of the message it answers, unless
that author is the person writing: the author is offered as a recipient while
the reply holds nothing, joins its recipients with the first thing written,
and stays off once the person removes them. Writing kept from before keeps its
own recipients.

### Wakes go only to reachable actors

The effects runner claims a recipient only when its route map names that
actor. Pending deliveries for a person or for an agent without a route stay
pending and visible, but are not claimed, so no wake attempt is recorded for
them. `claim_wakes(guard, token, recipients, ...)` and
`runner_schedule(recipients)` take the routed actor IDs and filter on them in
the same query, one primary-key probe per routed actor, so an unrouted actor's
due work is never read as due and cannot keep the runner reading.

### Deliveries carry what a notice needs

Each `deliveries` item also carries the message's `seq` (as `message.seq`:
the instance-wide message sequence that `topic_messages` pages by, which
increases within each topic but is not contiguous there, so a gap is not a
missed message) and the topic's title prefix (as
`topic: {id, title, title_truncated}`, at most 1024 UTF-8 bytes), so an inbox
line or a wake notice can name the place without another read. The `delivery`
view (`args: {delivery_id}`) returns one of the actor's own deliveries as
`{item}` in the same shape, pending or not; it is how `watch` names a
delivery it learns of from a change. It is readable only while the message
is: with access to its topic, or through an addressed delivery. Otherwise it
refuses with `FORBIDDEN`, like the `source` view. A pending delivery whose
subscription was cancelled can never be settled, so its `state` is
`cancelled`.

### When a message was sent

`topic_messages` items and the `source` view of a message carry `sent_ms`:
when it was sent, in milliseconds since the epoch, recorded once in the
send's own transaction. A message sent before version 12 of the schema has
`null`, since no time was kept for it. Version 12 steps back to 11 only while
no message has a time.

`workspace_topics` items also carry `message_count` and `latest_seq` (the
sequence of the topic's newest message). The list itself comes latest
activity first, done topics apart ([topic-list.md](topic-list.md)).

### `topic.read_through`

- `target`: `{topic_id}`. `args`: `{seq, from_seq}`, nonnegative integers;
  `from_seq` is optional (default 0) and at most `seq`. `expected`: `{}`
  beyond the captured authority. It needs topic access.
- Acknowledges this actor's pending deliveries in that topic with message
  sequence from `from_seq` through `seq`, as `delivery.ack` does, each with
  its own `delivery` change. Its work is bounded by the pending deliveries
  of this topic's subscription plus, for addressed deliveries, the smaller of
  the actor's pending addressed deliveries in every topic and the messages
  addressed to the actor in this topic's range: it walks both together and
  stops when either ends, so neither settled history nor work waiting in
  other topics grows it. It never touches another actor's deliveries,
  other topics, messages outside the range, or deliveries whose subscription
  was already cancelled.
- The result is `{topic_id, seq, acknowledged}`, the count it settled, with
  `from_seq` when the request gave it. The read position is recorded by those
  acknowledgments and by this recorded receipt; there is no separate
  read-position table, since nothing reads a position the acknowledgments do
  not already answer.
- It settles deliveries only. A message the actor marked unread
  (`message.mark`, [attention.md](attention.md)) stays marked and counted;
  `delivery.ack` leaves a mark as well.
- The browser reports what a person has seen: while the page is visible and
  has focus and no modal other than the Reader (such as the version review)
  covers it, the message the Reader shows, or else the range of message cards
  on screen (at least half of the card, or half of the viewport, which a card
  of any height covers exactly when it crosses the viewport's middle line).
  A card counts as on screen only once everything drawn above the messages
  in their column after they paint has had its first fill, read or refused,
  since each would push the cards down: the marks line ("1 marked unread ·
  Read it") and, on an outcome's conversation page, its Show row and header,
  which land with the conversation's read. The outcome rail is never above
  them (beside the topic, or on a phone in the drawer behind "☰ Topics"), so
  its reads hold no card back. A card counts only where it is when the page
  reports, measured then.
  Loaded messages form contiguous runs: a page joins the run it continues or
  overlaps, and a newest page that does neither (as the first read after
  a reload) starts its own. Each
  run's on-screen range is reported separately, so a range holds only messages
  on screen and never spans unloaded messages between runs; messages above or
  below it, and unloaded history, stay pending. What a closed modal covered is
  read when it closes. Ranges that
  hold only the person's own messages are not reported. A range is confirmed
  only by a recorded receipt; a failed report is sent again the next time the
  same messages are seen (a paint, focus, scrolling, the tab shown again),
  never by a timer. The server runs `topic.read_through` in a lane of its own
  (one at a time, refused with `SERVER_BUSY` when busy), so it never takes a
  command slot that a send or a save needs.

## CLI

`bin/aim-next --profile PROFILE [--json] [--outbox DIR] VERB ...` keeps
`binding`, `view` and `command` unchanged (they take neither option), and adds
verbs that build the envelopes, capture the binding and operation IDs, and
print plain, readable output. `--json` (before or after the verb) prints each
raw Core result as one JSON line instead. Refusals go to stderr in plain
output; the exit codes are those of `command`.

- `outcomes`: the actor's outcomes.
- `topics OUTCOME`: the topics in an outcome, newest activity first.
- `read TOPIC [--after SEQ] [--limit N]`: messages with author, sequence,
  message ID, addressees, reply context and full body. Core records no message
  time, so none is printed. It does not acknowledge anything.
- `inbox`: pending deliveries, oldest first, with topic, author, sequence
  and a preview.
- `post TOPIC [--asks A,B | --tells A,B] [--reply-to MESSAGE] [--attach FILE]... (TEXT | -)`:
  sends a `message.post`; `--to`, which says neither, is refused. Each
  `--attach` uploads a file first, as the page uploads a person's
  ([agent-cli.md](agent-cli.md#sending-attachments)); `start` takes it too.
- `start OUTCOME --title TITLE [--with A,B] (TEXT | -)`: starts a topic
  through `opening.save` and `opening.publish`. If the save is not confirmed
  (busy, interrupted, a lost answer or an unsaved receipt), stderr names the
  opening and its topic: once `retry` records the save, `publish OPENING`
  starts the topic. Once the save is recorded, any failure of the publish
  names them too, for `publish OPENING`. A plain `retry` of an
  `opening.save` names them again.
- `publish OPENING`: publishes one of the actor's saved openings at its
  current revision (`already published` if it was).
- `ack DELIVERY...` and `read-through TOPIC SEQ` (from the start of the
  topic through `SEQ`).
- `watch`: runs until SIGINT or SIGTERM, then exits 0. It arms the native
  watch on the database file and on the authority anchor, establishes a
  checkpoint for the actor's scope, prints a line for each delivery already
  pending (oldest first, so a watch restarted after a gap names what arrived
  while it was down), prints `watching ACTOR from change N`, then waits on
  the watch alone (no timer) and reads the actor's changes after the
  checkpoint on each event. A delivery made between the checkpoint and the
  pending read is printed once. The `watching` line means the watch is idle
  and waiting. It prints one flushed line per new
  delivery, `delivery "TITLE" #SEQ AUTHOR: preview  [DELIVERY in TOPIC]`
  (followed by `  (cancelled)` if its subscription was cancelled before the
  watch read it), or `delivery unavailable (CODE)  [DELIVERY]` when the
  delivery can no longer be read; one per acknowledgment,
  `acknowledged DELIVERY`; and `change KIND ID vVERSION` for the actor's
  other changes. It is suitable for a monitor that turns each line into a
  notification. A read that finds the database locked by a commit in progress
  reads again, waiting in SQLite's lock handler (SQLite offers no event for a
  released lock), until a stop signal, which ends the watch with exit 0 even
  while the lock is held. A stop also ends a notice blocked on a monitor that
  is not draining stdout, with exit 0; the rest of that output is dropped. A
  refusal is never ended by a stop: it is written whole with its exit code,
  even when the stop came first or at the same time. Every read checks the binding: when a recovery
  activation replaces the authority anchor, the watch ends with that refusal
  (`AUTHORITY_CHANGED`, exit 2, or `AUTHORITY_BUSY`, exit 75, during the
  cutover), so its monitor can rebind; `WATCH_FAILED` reports an anchor
  replaced without a refusal.
- `watch --once`: prints the oldest delivery waiting for the actor and exits
  0; with none waiting it arms the same watch, waits (no timer) for the next
  change that is a delivery still pending, prints it as `watch` does, and
  exits 0. It prints no `watching` line, and acknowledgments and other
  changes pass unprinted. A stop exits 0 with nothing printed, and the
  authority refusals are those of `watch`. An agent that wakes for one
  delivery at a time runs it as its loop ([agent-guide.md](agent-guide.md#waiting-safely-with-watch---once)).
- `notes SCOPE [--topic]`, `note new SCOPE [--topic] --title TITLE FILE|-`,
  `note revise ITEM --expected N [--title TITLE] FILE|-` and
  `note read ITEM [--revision N]`: an outcome's or a topic's Notebook pages;
  each write reads its revision back and fails loudly on a difference, or
  with `READ_BACK_UNCONFIRMED` naming the recorded revision when the read-back
  fails, and `note read` records the revision it prints, which clears `notes`'
  changed mark. A page a person marked a draft lists with its title and the
  mark, and reads with no words, until the mark is cleared
  ([agent-cli.md](agent-cli.md#notebook-pages)).
- `retry OPERATION`: re-sends a saved request exactly.

A refusal that was not recorded suggests `retry` only when it is retryable;
any other one is final and is reported with its operation. An outcome the CLI
cannot confirm (an interruption, a storage error, or output that failed after
the receipt) names the saved operation: `retry OPERATION` returns its recorded
outcome, or sends it once if nothing was recorded. With `--json`, the
refusals the CLI decides itself (`BINDING_MISMATCH`, `WATCH_UNAVAILABLE`,
`WATCH_FAILED`, and `INVALID_REQUEST` for argument text that is not UTF-8,
which is refused before anything is saved) are printed as one JSON result
line too. Plain output shows
control characters in other actors' text (C0 except tab, DEL and C1) as `\xNN`
escapes, so a body or title cannot drive the reader's terminal; `--json`
escapes C1 controls as well as JSON's own.

Every command request a verb exists to send is written to the actor's outbox
directory (`--outbox DIR`, absolute, default beside the profile as
`ACTOR.outbox/`) before it is dispatched, as `OPERATION.request.json` in the same shape the
`command` verb reads. After a recorded receipt the CLI writes
`OPERATION.receipt.json` beside it. If the request cannot be saved, nothing is
sent. A lost answer leaves the request, so `retry` can
re-send it unchanged, and the original operation can be looked up. An
`--attach` upload is not such a request: it is not saved, and when it fails the
verb ends with `ATTACHMENT_NOT_SENT`, naming nothing to retry.

## Team setup

An outcome's owner or coordinator invites a new agent from the outcome's page
(below). `bin/aim-next-admin add-actor` still registers a person or agent by
hand, and its profile then comes from `profile.write_profile`. An outcome's owner or coordinator adds members with
`workspace.member_set`; the coordinator organises the outcome as the owner
does, and only the owner hands it to a member with
`workspace.owner_set` (`aim-next owner OUTCOME ACTOR`). A Codex agent gets a route in the runner's map, which
wakes it through the Codex broker. An agent without a broker, such as a
Claude Code seat, runs `watch` under its own monitor, or `watch --once` as
its loop; [agent-guide.md](agent-guide.md) is the guide for working as one.

### Inviting an agent

The Team panel on an outcome's page offers "+ Invite agent" to whoever
organises the outcome (its owner or coordinator). It opens one name line and
two chips, Claude Code (to start with) and Codex; Return invites. Core takes
the invitation as one act, `workspace.agent_invite`:

- `target`: `{workspace_id}`. `expected`: `{workspace_revision}` (required).
  `args`: `{name, harness}`, where `harness` is `codex` or `claude-code`.
- Only the outcome's owner or its coordinator may take it, whatever a page
  shows: anyone else, a member too, is refused `FORBIDDEN` ("Only the
  outcome's owner or its coordinator can invite an agent to it.").
- The agent's ID comes from its name: its Latin letters and digits, lower
  case, in words joined by hyphens ("Release scribe" is `release-scribe`).
  Accents are taken off first, in Unicode's compatibility form (NFKD), so
  "Zoë" is `zoe` and "Ça va" is `ca-va`. A Latin letter that form leaves
  whole is written as the letter its Unicode name says it is made from:
  "Søren" is `soren`, "Łukasz" `lukasz`, "Đorđe" `dorde`, "Yılmaz" `yilmaz`,
  "Æsir" `aesir` and "Œuvre" `oeuvre`; a few have a spelling of their own
  (þ is th, ð d, ŋ ng, ß ss, ə e), so "Þór" is `thor` and "Straße"
  `strasse`. Letters of other scripts are not part of an ID. A plain name
  keeps the ID it always had. An
  ID longer than 40 characters keeps its first 31 characters (less a hyphen
  at the end) and ends with a hyphen and the first 8 hexadecimal digits of the
  whole ID's SHA-256 digest, so two long names that differ only past the cut
  get IDs of their own. The
  name is kept with its spaces collapsed. A name that has no Latin letter or
  digit for an ID is refused `NAME_UNUSABLE`, an empty one `NAME_REQUIRED`, and one
  longer than 60 characters `NAME_TOO_LONG`.
- A name or ID someone already has (any actor, ignoring case) is refused
  `NAME_TAKEN`, naming whoever has it, and a free name to choose instead
  ("There is already someone called Release scribe here. Choose another name,
  such as Release-Scribe! 2." for "Release-Scribe!"). The page keeps the
  name, selected, to be changed in place.
- The same name typed again by the person whose invitation registered the
  agent, in the outcome it was invited to, while the agent is still on that
  team and enabled and no one else has its name, gives that agent back: a new request (a reload, another outcome and back, or
  another device forgets the first one) is committed with the agent as
  recorded, and nothing is registered or added again, so the outcome's
  version stands and no change is written. Its result carries this request's
  `harness`, for the prompt. The agent is found by its invitation and its
  name, whatever rule made its ID: release 81 kept only ASCII letters, so
  "Søren" invited then is `s-ren`, and the same person typing "Søren" gets
  `s-ren` back, even once someone else has `soren`. Anyone else typing the name (the coordinator
  too), the same person in another outcome (even one whose team the
  agent is on), or after the agent has left the team or been disabled, is refused
  `NAME_TAKEN`. Core keeps who invited each agent into which
  outcome in `agent_invitations` (schema version 43). Release 81 (version
  42) invited agents from the page without keeping by whom, so the step to 43
  fills the table from the committed `workspace.agent_invite` receipts
  already on the record: who invited which agent, under the ID it was
  registered with, into which outcome. An agent invited then is given back to
  its inviter like any other, with its sign-in file written; a refused
  invitation registered no one and fills nothing.
- A team already at its limit (128 members, its owner included) refuses a new
  agent, `TOO_MANY_WORKSPACE_MEMBERS` ("This outcome's team is full: it has
  128 members, its owner included."); an agent given back adds no one, so a
  full team still gives it back.
- It registers the agent (kind `agent`, enabled) and adds it to the team in
  the same transaction, as `workspace.member_set` would: the outcome's
  version advances and its change keys are written, and the agent is not one
  of the conversation's people unless it is made coordinator. The result is
  `{workspace_id, title, version, harness, agent: {id, name, kind}}`, so the
  recorded receipt keeps which program it runs in.

The server, once Core has recorded the act, writes the agent's sign-in file
(its v2 profile, `profile.write_profile`) as `ID.profile.json` in the folder
of the server's own profile, created with mode 0600 and never overwriting
anything (`aim_next/invite.py`). It adds `sign_in` to the committed receipt:
`{written: true, path, prompt}`, or `{written: false, path, message}` when the
file could not be written. The page shows neither the file nor anything in
it, only its path, in the prompt to paste into the agent: who it is (its name,
ID and outcome), the program it runs in, where its sign-in file is and the
command that uses it, what that program must allow (a Codex sandbox must let
the CLI write in the instance's folder and the agent's outbox), and to read
the agent guide ([agent-guide.md](agent-guide.md)) before waiting for work
with `watch --once`. A copy glyph puts the prompt on the clipboard; where the
browser refuses, the page says so and selects the prompt.

- A refused invitation writes no file.
- A file already in the new agent's place that is someone else's is never
  overwritten or adopted: one that binds another actor (the coordinator's
  own sign-in file too, whole and valid here), another instance, another
  database or another authority; one that holds anything but this agent's
  own sign-in; and anything in its place that is not a private regular file
  of this user's (a file others can read, a pipe, a folder, or a link,
  wherever it leads). A retry of either kind, the same request or the same
  name typed again, is refused the same way. The server refuses before asking Core, unrecorded,
  `SIGN_IN_TAKEN`. The place it looks at is the one for the agent Core will
  answer with, read in a short read before the act: the agent this same
  request's recorded receipt names, else the agent given back to this
  inviter (`s-ren.profile.json` for Søren above, never `soren.profile.json`),
  else the ID the name makes. A server started without a sign-in folder refuses every
  invitation, `NO_SIGN_IN_FOLDER`.
- An answer that never came keeps the exact request, and the next Return
  sends it again; so does Try again after a file that could not be written.
  Core answers the same operation with its recorded receipt, so nothing is
  registered twice, and the server writes the file that receipt names (a
  file already there for that agent is kept as it is). After a reload, the
  same name typed again does the same as a new request (above).
- A write cut short (a full disk after the file was created) leaves a file
  that holds the beginning of this agent's own sign-in, or nothing: private,
  this user's, and exactly the first bytes `profile.write_profile` writes for
  it. The next attempt for that agent removes it and writes the file whole.
- The page asks again at the revision Core names, as a new request, when
  someone else changed the team at the same moment.

The agent still needs a way to be woken: a Claude Code agent runs
`watch --once` as its loop, and a Codex agent can be given a route by the
operator ([codex-hosting.md](codex-hosting.md)).
