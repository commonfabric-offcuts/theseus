# Whispers

A person can whisper to one agent. Only the two of them ever see it, in every
read, and the agent's answer is a whisper too. Two rules decide what a whisper
counts for:

- A person's whisper counts as their Tell. The agent acts on it as on a Tell
  from them, and it does what a Tell does in the topic: it is writing there,
  answers the question of the agent it goes to that it replies to, reopens a done topic, and
  may be where a topic, a pipeline item or a problem came from, Notebook
  evidence, or the owner's word a move is made on. Only who can read it stays
  private.
- An agent's whisper only answers a person's whisper. It changes nothing
  anyone else can see and is never a source, evidence or the word a move is
  made on.

A whisper never asks, so it never makes a topic wait on anyone.

A message with someone named starts as Ask, so it waits on them until they
answer (item 848). With nobody named it stays Send to the topic. The person's
explicit Tell or Whisper choice wins. Nothing goes private by default except
a reply to a whisper, to the one agent in it, which starts as a whisper and
continues the private exchange; the person can still choose Tell.

## Writing

`message.post` and `draft.save` take `whisper` (true or false, default false)
beside `body`, `addressees`, `reply_to`, `quotes` and `attachments`; a draft
carries it into `submission.prepare` and `message.send`. A whisper names
exactly one addressee, its other person, and no `intent`.

Before item 281 the page showed writing that names exactly one agent in a
topic, with no choice of the person's, as a Whisper, and sent it so. Every
draft `draft.save` keeps since is stamped `tell_first`, so a draft saved before
keeps what it showed: when it names one agent in a topic, by its addressees or
its leading @names, and says neither `whisper` nor `intent`, `editor_state`
reads it, and `submission.prepare` freezes it, as the person's Whisper. A draft
in the conversation showed a Tell under that earlier default. The stamp stays
inside the stored draft; reads leave it out. Item 848 changes only the page's
undecided default: a current draft with no explicit choice and someone named
shows Ask before it is sent, including recovered writing. Explicit saved
choices and the old private-draft interpretation remain intact. No draft is
rewritten or backfilled, and agents' CLI choices are unchanged.

| Code | When |
| --- | --- |
| `WHISPER_SHAPE` | Other than one addressee; a person whispering to a person; an agent whispering other than to answer a whisper sent to it, to the person who sent it; a whisper answering a whisper between a different pair; a whisper with an intent; a whisper on writing that opens a topic (`opening.save`, or `draft.save` with a new-topic source or an `opening`). |
| `WHISPER_STAYS_PRIVATE` | A message on the record replying to a whisper; quoting a whisper other than into a Tell by the person in it, or into a whisper between the same two; an agent's whisper as a topic's source, as Notebook evidence, as where a pipeline item or a problem came from or what an item is still gathering (`pipeline.item_add`, `pipeline.source_add`, `pipeline.item_edit`, `problem.file`, the imports), or as the word a move is made on; a person's whisper named by number in an import for someone outside it. |

A reply, quote or source the writer cannot see is refused as one that does not
exist, so no refusal names a whisper to anyone outside it. Writing in the
Reader about a whisper that is sent as a Tell goes as a new message, quoting
only what was selected; it answers nothing.

## What a whisper counts for

A whisper reaches its one other person as an addressed delivery and wakes
them as any addressed message does. Each of the two gets an actor-scoped
change `whisper` whose `resource_id` is the topic and whose `version` is the
message's sequence; the topic page reads its reader's own scope on each commit
to show a whisper as it arrives.

A person's whisper then does what their Tell would, and others see only the
effect, never the whisper:

- Its writer has written in the topic, so they may say where it stands.
- A whisper replying to an ask to its writer, sent to the agent that asked it,
  the one who can read the answer, answers that ask alone, as the person's 👍
  on it would (item 307): the ask stops waiting on them and "Waiting on you"
  goes out. When the topic's wait on them is from that ask, it moves to their
  oldest ask that nothing has answered, or ends; when it is from an older
  ask, it stays there, and the answered ask is passed over when the wait
  moves on. A whisper that replies to nothing, or to a message that is not an
  ask to its writer, answers nothing, even sent to an agent that asked them
  something, and so does one replying to an ask but sent to anyone other
  than whoever asked. An ask an open record holds (a proposed target, an
  owner-gated stage) keeps waiting, as it does after a reply on the record.
  In an outcome's conversation, a whisper replying to an ask answers it when
  it goes to whoever asked, by the same rule.
- It reopens a done topic and moves the topic up the list. The topic's version
  moves, and whoever stopped waiting gets a `waiting` change. Its two people
  read the whisper's id in the topic's `state_message_id`; everyone else reads
  the reopen (state, who, when and the note "Reopened by a new message") with
  `state_message_id` null.
- In a conversation, the coordinator's whisper replying to an item, to the
  item's author, answers the item. Others see "Answered" with who and when,
  and no link (the take's `ref` is null and `readable` false for them). A
  person's whisper is never an item itself, since the team sees items listed
  and counted.
- It may be a topic's source, Notebook evidence, where a pipeline item or a
  problem came from, what an item is still gathering, and the owner's word a
  move is made on, by either of its two people. Everyone else reads each of
  these as a message they can't open: no id, number, topic or words. A topic
  started from it has `source_message_id` null for them, in the `topic` and
  `workspace_topics` views alike.
- The person who wrote it counts the agent's pending work for it, and how long
  its wakes have gone unanswered, as they would for a Tell.

It never moves what points at the message itself: the topic's count, latest
message and latest by someone else stay as they were, and the loop's account
of a worse check and the work ring read only messages on the record.

An agent's whisper changes nothing anyone else can see: the topic's version,
latest message, count, activity and order, a done topic's state, who waits on
whom, who has written in the topic, items and takes, and the work ring.

## Reading

The saved draft records a person's choice, so `draft.whisper` is absent or
null before they choose. The existing **reply-to-whisper default** derives
Whisper when replying to a whisper with its one agent named (`defaultChoice`
and `choiceOf`). `Reader.send` makes that effective choice explicit through
`sending` before the editor freezes the writing. Item 704 changes no default,
preference, recipients or privacy rule. Its helper checks the undecided saved
quote and the exact body, recipients, quote revision and privacy at Send.
Owned intercepted commands release and await their continuations and response
bodies before unroute or closing the context, including refused and error paths.

A whisper keeps the existing dotted-line outline (the UI's dashed stroke)
everywhere it is drawn: the feed, a dossier's sheets and header, the source
above a composer's quote, and a phone. Its selection rectangle is dashed too;
no solid spread rim is added around it. Keyboard focus on its source, writing
and who chip keeps the normal visible focus ring, with the dashed stroke.
Public messages keep their ordinary frame and selection. No words, recipient,
quote revision or privacy rule changes for this drawing (item 704).

The drawing branches are a standalone card, a dossier sheet (whole or folded
to its row), and a dossier head drawn as a folder and its tab. Each has a
resting and a selected drawing. The Reader's source has its resting and
keyboard-focus drawings; its line is kept with empty writing, a quote, a save
in flight and a refused save with its review control. A missing source removes
the `whispering` class and its words (`Reader.hideUnavailableSource`); an
empty feed draws no message frame. Read-only writing uses the same stroke:
the rule changes no admission or disabled state. No asynchronous act is added.

`tests/whisper_outline_native.mjs`, called by `native-reading`,
`native-webkit-reading` and `native-compose`, checks the `item 704` cases at
320, 375, 390 and laptop widths in both themes. The reading cases cover both
the person's and the agent's cards. The composer uses native Tab for focus
and a pressed passage and Quote for the exact writing. Source mutations turn
the dashed strokes solid; each runs in a fresh page on a restarted isolated
fixture, verifies the served CSS snapshot, fails the frame check and restores
the exact source bytes before its passing control. Geometry checks allow 2px
for page edges and .25px for the 2px ring, so absent or solid rings fail in
either engine. Another actor's private note is seeded and must never appear.

`topic_messages` items carry `whisper` and, for a whisper, `private_to`; the
viewer's own whisper with no whisper reply yet carries `no_answer: true`. A
reply whose parent the viewer cannot see has no `reply_to_author` or
`reply_to_excerpt`. `source` carries `whisper` and `private_to`, and a quote of
a whisper read by someone outside it keeps its excerpt with `source: null`.
Delivery items carry `message.whisper`. `wakes` and `health` count, for every
reader but the agent itself, only deliveries on the record and the reader's own
whispers, and leave out an agent whose pending work is others' whispers alone.

An agent is told in Core's words, on each whisper delivered to it and under it
in `read`, that a person's whisper counts as a Tell from them: it acts on it,
never repeats or quotes it where others can read it, and answers with a
whisper. Its acts (a move, an item, a commit) are seen as usual and may name
the whisper as their source or reason, which others read as a message they
can't open.

## What anyone outside it can learn

Core gives someone outside a person's whisper exactly this: that a topic
changed (its version, activity and order), was reopened and by whom and when;
that an ask waiting on the writer ended; that an item was answered, by whom
and when; that a topic, item, problem or move came from a message they
can't open; and that a dossier's payload was accepted by the owner's word,
when the word its cover names was a whisper ([dossier-covers.md](dossier-covers.md)). A
whispered dossier's cover is read only by its two people, and a whisper is
never the payload of a dossier on the record. No view, refusal or
command answer gives them the whisper's id, number, topic, words, excerpt or
attachments: `state_message_id` and `source_message_id` on a topic, a take's
`ref`, a pipeline source or because, and a problem's message are null or
unopenable for them, and a reply, quote or source naming it is refused as one
that does not exist. A Notebook revision's references are the agent's own
writing and keep any id it wrote (see Limits).

## Limits

The database file is outside this boundary: anything that opens the SQLite
file directly reads every row, as it reads drafts and private notes. A
Notebook page is free writing, so Core cannot stop an agent paraphrasing a
whisper there, or naming its id among a revision's references, which a reader
outside it sees as written but cannot open.

Schema version 27 adds `messages.private_to`, the `message_reply_links`
index and the `whisper_shape` trigger. Stepping back to 26 is refused once a
whisper exists, since release 22 would show it to everyone.
