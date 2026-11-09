# The pipeline

An outcome may keep a pipeline: every piece of work it delivers, numbered,
from the message it grew out of to the release that shipped it. It is a record
in Theseus (schema version 29), not a page anyone keeps by hand. The tables
and commands are `aim_next/pipeline.py`; the rules it shares with the outcome
light (the glyph, stage names by round, typical times) are
`aim_next/outcome_rules.py`; the page is `web/pipeline.mjs`, with its words in
`web/pipeline-words.mjs`.

## What it holds

- **The pipeline** (`pipelines`): on or off, its title, its unit ("item",
  "items"), whether items are sized small, medium or large, whether it ships in
  numbered releases, and the words for its four sections.
- **Stages** (`pipeline_stages`): the outcome's own, in order, each with what
  done means, what gates it (checks by name, the owner's word, or words), its
  rounds (`none`, `together`, or `split`: the first round apart) and whether a
  piece or a whole release passes through it. A change applies to items that
  enter a stage after it; past times stay with the stage they were measured in.
- **Items** (`pipeline_items`): a number that never changes, a title, words, a
  size (optional, even in a sized pipeline: an item can be added by its title
  alone and sized later), who raised it, its section (`now`, `next`, `later`, `candidates`,
  `dropped`) and place, its candidate group, the items it waits for, and, when
  it is still gathering context, the reply thread or Notebook page that holds it.
- **Where an item came from** (`pipeline_item_sources`): messages, Notebook
  pages or notes. A message is shown only to someone who can open that message,
  each message asked on its own (someone a message named can open it after leaving
  its topic, and no other message there); others see "a message you can't open".
- **Pieces** (`pipeline_pieces`, `pipeline_piece_members`): the work on one or
  more items in one topic, and a release's piece combined from approved ones.
  Each stage a piece enters is a row in `pipeline_stage_entries`, with when it
  entered and left, who left it and how (approved, sent back, passed, held,
  done, combined, dropped).
- **Events** (`pipeline_events`): every change, with who made it and the place
  before and after. Undo is a new event naming the one it undoes.
- **Message subjects** (`message_subjects`): `message.post` may name the items
  a message is about (`subjects: [{kind: "item", ref: 92}]`). An open ask about
  an item is what makes it "Waiting on you"; nothing else does.
- **Release notes** (`release_notes`): the smaller changes a release shipped
  with no number of their own.

Shipped is read from the release records (`releases`, written by
`record-release`): an item a recorded release names has shipped in it.

## Adding an item

Each section of the page (Now, Next, Later, Candidates) opens with one line,
"Add an item…": a title and Return adds the item there, last in the section.
Words (a sentence or two) and the size (three chips, S, M and L) are optional
and set on the item afterwards, in place, through `item_edit`; tapping the
chosen size again clears it. A message in the Reader offers Add to pipeline
while its outcome's pipeline is on: the same line, its title the message's first
line, adds the item to Candidates with the message as its source, so Core
records the message's author as who raised it.

## Who changes what

Anyone on the outcome (its owner or a member) adds an item, adds a source to
one, and changes an item's title, words, size, group, what it waits for and
where it gathers; only the owner and the coordinator change who raised it. The
owner and the coordinator steer together: they move, drop and restore items,
change the stages, and turn the pipeline on or off. Its title, units, sizing,
releases and section words (the rest of `configure`) are the owner's alone. An item the
owner placed is moved only by the owner (`OWNER_PLACED`), or by the coordinator on the
owner's go-ahead (below). An item being built
stays in Now (`ITEM_IN_PIECE`) until it is dropped or its piece is done, and
dropping it needs a confirmation (`ITEM_UNDERWAY`), whether by a move or by an
Undo: on the page, each item on a piece card has its own ⋯ with Open its record
and Drop…, and Drop… asks first. Only the owner gives a stage their word, takes
it off, or removes a stage that waits on it (`FORBIDDEN`); a retired stage keeps
the word it had.

A stage gated on the owner's word is entered only with an ask to the owner,
written by whoever enters it, in the piece's topic (`ASK_REQUIRED`), and left
only by the owner (`STAGE_GATED`), however it is left: to the next stage, as
done, dropped with its last item, or combined into a release. The database
keeps this rule where every stage entry is opened and closed, not each command,
so no way of moving a piece steps around it.

A stage gated on checks is left only when each one's newest reading passed: for a
release piece, a reading at its commit (`STAGE_GATED` otherwise). The deploy
writes those readings for the candidate before it moves the release piece from
`checks` into `deploy` ([targets.md](targets.md#what-got-worse)).

### The release

An outcome whose pipeline ships in releases has at most one release at a time:
its open release piece. A release piece is open until an event ends it, and is
never read as ended from other records. Everything that means "the release" asks
that one rule (`_the_release`): `combine`, taking items back from a held release,
the piece an item is in, which candidate run is the release's, the head's Next
release, the deploy's read (`checks --live`) and its move into `deploy`, the
release check's `--report`, and which piece a candidate's readings name.

- Its number is not stored: it is the last release a record names, plus one, so a
  number is spent only when a deploy records it.
- `combine` makes a release only while there is none (`RELEASE_OPEN` names the
  one being put together); approved pieces wait in their last stage. Its
  optional `release_number` must be that number (`RELEASE_NUMBER`).
- While it is open, the pipeline stays on and keeps shipping in releases:
  `configure` refuses turning either off (`RELEASE_OPEN`), so the settings never
  change what is in it.
- It ends when no item is left in it, or when the record of its release is
  written. Emptied, it is left `dropped` when every item was dropped, else
  `held`, saying what took its items: "Every item went back to building", "Its
  last items shipped in release N" (older releases), or each of them ("Its
  items went back to building or were dropped"); its topic is as it was. Its
  record is a release record whose number is the next one, since that is the
  number the release ships as.
  Any deploy that records the next release ships it, from whatever stage it is
  in, a stage that waits on the owner's word among them (the end is the
  record's, nobody's): the release being put together, even a hotfix of
  another commit naming none of its items. `record-release` then leaves its
  entry `shipped` ("Shipped in release N") in the transaction that writes the record; an item it holds that
  no record names has not shipped and goes back to building (`returned`). A
  record written again ends nothing. A piece that ended never held a number, so
  the work combined next is that same release.
- What a record names has shipped wherever it is still being built: it leaves
  every piece still under way. A record of any other number, such as an older
  release recorded late (a backfill, or a deploy writing a record the instance
  lacked), ships no release, so an item it names that is in the release leaves
  the release, and nothing else changes. A release it leaves with no item has
  ended as an emptied release ends, never as shipped, and the work combined
  next is that same release. An item a record names in a piece of work still
  being built (a trailer naming it on another release's commit) leaves that
  piece the same way, and the piece builds the rest, so combining it never puts
  a shipped item in a release. Turning releases on makes the records already
  written the outcome's, so what they name leaves its pieces under way the same
  way.
- What shipped is never built again: `piece_start` refuses an item a release
  record names (`ITEM_SHIPPED`), whichever record named it, and what shipped in a
  release stays in that release. Dropping an item leaves only a piece under way
  (D25), and a shipped item is never dropped (`ITEM_SHIPPED`).
- A record overtakes the acts it makes impossible. The deploy takes a record's
  items from its commits, so a record can name an item someone already dropped,
  or took back from a held release to build again: that item shipped, and both
  acts would have been refused after the record. An item's pieces, in the order
  they took it, are one line of work (combined into a release, gone back to
  building) until it is dropped or ships; a piece that takes it after a drop
  starts new work, and a drop leaves its mark where the item was, in a piece or
  last left one (dropped while no piece holds it, after its release shipped
  without it). **A record naming an item ships it in that release**: the item is
  listed under that release, and the record counts as if it had come before the
  acts it makes impossible. A drop of the item that no piece took it after, its
  last, counts for nothing, and so does the combine that drop kept it out of:
  the item went on with the piece it was dropped from, into the release that
  piece was combined into. For the release the record ships, so does a return to
  building: the release takes the item back, and whatever was building it again
  has shipped it. A piece that finished keeps its items, and a record names no
  item another record shipped, so what shipped in a release stays there.
- **What a release ships.** The record of the next release ships one release
  piece: the one open, the release being deployed, or with none open the release
  emptied while it was the next one, if it would hold an item the record names
  had the record come first (a record naming none of its items finds it emptied,
  as it is). That release holds each item its record names that it holds, or
  would hold but for the acts the record overtakes; an item it held that the
  record does not name has not shipped and goes back to building (`returned`).
  So a release's contents are what its record names that came to it through its
  pieces, and every item a record names, wherever it was, is listed under that
  record's release. A release combined after the record was not open when it
  was written, so a record made while none was open (a hotfix, a deploy's
  record of the commit already live) ships none, and the release combined next
  is the number after it.
- **The derived state.** What each piece holds, how each piece ended and which
  topics the pipeline holds Done are derived, not decided by whichever command
  ran last. The facts are each outcome's log, in the order things happened
  (`pipeline_facts`, which keeps its past): every `piece_start` (a return to
  building among them), `combine`, drop (by a move or an Undo), `piece_finish`,
  release record, and turning releases on or off; with each piece's kind and
  topic and the items each record names. One pure function of the facts alone
  (`pipeline_state.derive`) plays the log in order and applies the rules here
  when it reaches each record, so facts that commute (a backfill, a drop, a move,
  a combine, a start) give one state in every order. Two families of orders
  differ by design, because in them the later act is not one the record
  overtakes: a drop that empties the open release before the next release's
  record names none of its items leaves that release emptied, where the record
  written first ships it; and a return to building is taken only while the
  release is held, so where the record comes first the return is refused and an
  item the record does not name has gone back to building with no piece holding
  it. Every
  pipeline write appends its fact and then writes only what differs between
  that state and what is stored (`_settle`), in the same transaction.
- **The end of a piece.** A piece of work still under way ends once it holds no
  item: it has shipped if any of its work shipped (an item it held, or combined
  from it into a release, that a record named before a drop ended its part),
  "Shipped in release N" with N the newest such record, and was dropped
  otherwise. A release ends shipped by its record (above), and otherwise once it
  holds no item: `dropped` when every item was dropped, else `held`, saying what
  took its items ("Every item went back to building", "Its last items shipped in
  release N", or each of them: "Its items went back to building or were
  dropped"). When it ended, and whose act it was (nobody's for a record, and for
  the records turning releases on takes), stay as first written; an end that is
  nobody's leaves even a stage that waits on the owner's word, and the database
  allows that only at a record, or at turning releases on, in the outcome's
  facts; a later record can change only how it ended, to `shipped` or
  to what took a release's items, and the database allows that rewrite and no
  other on a left stage entry. A combine (`combined`) and a finish (`done`) end
  a piece by their own act.
- **A topic the pipeline holds Done.** The pipeline holds an ordinary topic
  (never the outcome's conversation) Done, "Shipped in release N" (D1), while
  none of its pieces has work left (an item still in one, or combined from one
  and still being built, that no record names and no drop ended), no release in
  it is being put together, and some of its work shipped, N the newest release
  that shipped any. The pipeline writes the topic's state itself, by nobody, in
  the transaction of the write that changed what it holds (`_settle`), at three
  moments and no others. Starting to hold a topic sets it Done, "Shipped in
  release N", whatever it stood at (active after a person's reopen, waiting or
  in review), unless someone has said it is Done: for a topic it starts to hold,
  the pipeline's rule wins over every word but a Done. Holding it with a newer N
  rewrites the note, while the Done is still the pipeline's own (Done by
  nobody, and no reopen since). Work for it appearing again (a piece started or
  a release combined there, or an item going back to building from a piece
  there) withdraws the hold, and the topic goes back to active with no note,
  again only while its Done is the pipeline's own. A person's word given while
  the pipeline holds a topic stands: a reopen (a message in a done topic, or
  `state active`) keeps the topic active until the pipeline lets it go and then
  starts to hold it again, and a person's Done stays Done through a newer N and
  the end of the hold.
- Upgrading to version 30 writes version 29's pipeline as facts, in time
  order; the first pipeline write after the upgrade (the deploy's record is one)
  writes the state they derive.
- The gate (D18) reads a release piece's readings at its commit: the newest
  commit checked for it, else the one `combine` was given.
- Only the release check's own run of a candidate reads for the release:
  `record-checks` names the release on the run's readings and refuses a run that
  names a piece itself, and a member's report, a trial or a base rerun names none.
- A candidate run's release is the one after the release live when it ran, so a
  candidate that never shipped keeps its number.

### The owner's go-ahead

A move names the message it is made on as `because_message_id` (the CLI's
`--because`): one the mover can read, and never a whisper
(`WHISPER_STAYS_PRIVATE`, since a whisper stays private). For an item the owner
placed last, a move by the coordinator goes through only when that message is
the owner's go-ahead for this move:

- it is the owner's own message,
- in a topic of this outcome the mover can read,
- written after the owner's last placement of the item,
- and it names the item (its number standing alone in the words, "#92" or
  "92" but not the 92 in 192, 9.2 or 2:30, or the item as the message's
  subject), or it replies to a message that proposed this move: one naming the
  item and the section it goes to (its name or the pipeline's word for it;
  "drop" for Dropped).

The move's event records the message and `go_ahead` (the owner it was
theirs), and the item's record says "Moved to Later by fable on tony's word",
the word linking to the message for a reader who can open it (another reader
sees whose word it was and no link, nor the message's id). A word that is not a
go-ahead refuses the move and says why, and nothing moves:

| What is wrong | Code | Words |
| --- | --- | --- |
| none named | `OWNER_PLACED` | "tony placed this item at …. Say so once in this outcome's conversation; Theseus does not move it back. Once tony says go ahead, move it with that message as because." |
| a message the mover cannot read, or none | `FORBIDDEN` | "You can't read a message m-…, so it is not a word to move on. Nothing moved." |
| a whisper | `WHISPER_STAYS_PRIVATE` | "m-… is a whisper, and a whisper stays private: it is never the word a move is made on. Nothing moved." |
| in another outcome | `OWNER_PLACED` | "tony placed this item at …, so it moves only on tony's word, and m-… is not that: it is in another outcome. Nothing moved." |
| not the owner's | `OWNER_PLACED` | "…: it is fable's message. Nothing moved." |
| older than the placement | `OWNER_PLACED` | "…: it was written before that placement. Nothing moved." |
| not about this move | `OWNER_PLACED` | "…: it does not name 92, nor reply to a message that proposes moving 92 to Later. Nothing moved." |

The owner's own moves need no go-ahead; a move of an item the owner did not
place records its message with no `go_ahead`.

## Turning it on and changing its stages

Turn on is one tap, for the owner or the coordinator: the pipeline starts as
"Pipeline", with items sized (or, if it was on before, as it was). The owner then changes the title where it stands
in the page header (Return or clicking away saves it, Escape puts it back) and
whether items are sized with one chip under it.

Change stages turns each stage into its own line, edited in place: its name and
what done means save on Return or when you click away, and Escape puts them
back. Rounds is three chips (no rounds, rounds together, the first round apart)
and the owner's word one chip, each saved on its tap (the coordinator sees the
owner's word on a stage but has no chip for it, and no cross on that stage); the arrows move a stage
and the cross removes it, with Undo. A new stage is one line, "Add a stage…".
Every change sends the whole ordered list through `stages_set`.

## Commands and views

Commands, each with the revision it checks:

| Command | Target | Expected |
| --- | --- | --- |
| `pipeline.configure` | `{workspace_id}` | `pipeline_revision` (0 to create) |
| `pipeline.stages_set` | `{workspace_id}` | `pipeline_revision` |
| `pipeline.item_add` | `{workspace_id}` | none |
| `pipeline.source_add` | `{workspace_id, number}` | `item_revision` |
| `pipeline.item_edit` | `{workspace_id, number}` | `item_revision` |
| `pipeline.item_move` | `{workspace_id, number}` | `item_revision` |
| `pipeline.piece_start` | `{workspace_id}` | none |
| `pipeline.stage_enter` | `{piece_id}` | `piece_revision` (optional) |
| `pipeline.stage_note` | `{piece_id}` | `piece_revision` (optional) |
| `pipeline.combine` | `{workspace_id}` | none |
| `pipeline.piece_finish` | `{piece_id}` | `piece_revision` (optional) |

A source is `{message_id}`, `{message_seq}` (a message by its number,
as people say it), `{memory_item_id}` or `{note}`; never a whisper
(`WHISPER_STAYS_PRIVATE`), since the whole outcome reads the pipeline. When a
message source is an item of the outcome's conversation, `item_add` and
`source_add` write its pipeline take in the same act (docs/conversation.md),
and `part: true` keeps that item new. `item_move` takes `section`,
`above` or `below` (a number in the same section), `undo_of` (an event),
`underway_confirmed`, and `because_message_id` (the message the move is made
on; [the owner's go-ahead](#the-owners-go-ahead)).

`combine` takes the pieces waiting in the last stage a piece goes through (the
approved ones; `PIECE_NOT_APPROVED` otherwise) into a new release piece in the
first release stage, with `ask_message_id` when that stage waits on the owner.
It makes the release, numbered as [the release](#the-release) says.

Views:

- `pipeline {workspace_id, section, cursor, limit}`: one section's items, in
  order, paged by an offset cursor. Section `now` also carries the head: the
  facts boxes, the banner for the live release until a stage is entered after its deploy, the release
  being put together ([the release](#the-release)), what waits on the reader, the pieces in Now and the
  table of typical stage times. Section `shipped` gives groups, newest first.
- `pipeline_item {workspace_id, number}`: one item with every source, piece and
  event.
- `pipeline_row {workspace_id}`: the rail's row (title, how many asks wait on
  the reader, the newest work seen in a Now piece's topic), `you_own`, and
  `you_steer` (the owner or the coordinator, who may turn it on). The
  `pipeline` view says `you_steer` too, also while there is no pipeline yet.
  The pipeline page's rail is a topic page's: the conversation, the Pipeline
  row, the topics and the Notebook pages.

## The import

`tools/pipeline/export_seed.py` reads the hand-written Release pipeline page
(as `view source` returns it), `tools/pipeline/items.json` and a file of
gathered sources, and writes one seed. `bin/aim-next-admin pipeline-import
--profile P --seed S --as fable` writes it in one transaction: the pipeline,
its stages, every item with its number, sources and progress, and the release
notes. It refuses when the outcome already has a pipeline, when the page has
moved on since the seed was built, when a source cannot be found, or when the
seed disagrees with a release record, or when a source is a whisper. A question or a 🔨 on the page is not
carried: a question comes only from an open ask, a stage only from a tool.

## Not yet

- Release records name bare item numbers, not an outcome's. When another outcome
  takes over shipping in releases, its items numbered like ones a release
  already shipped read as shipped and cannot be built (`ITEM_SHIPPED`).
