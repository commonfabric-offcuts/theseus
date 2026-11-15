# Thumbs-up and go-ahead answers

A thumbs-up on a message says "I read it and I understand", never "do it".
On a question asked of the person who gives it, it also says yes, and the
question stops waiting on them (item 239, below). An agent that offers to do
something, or asks permission, marks its Ask as asking for a go-ahead; the
people it asks then answer with one tap, ✅ (go ahead) or 🚫 (don't). Core
keeps both on the message (`aim_next/reactions.py`).

## Writing

| Command | Target | Expected | Args |
| --- | --- | --- | --- |
| `message.thumb` | `{message_id}` | `{thumb_revision}` | `{thumbed: bool}` |
| `message.answer` | `{message_id}` | `{answer_revision}` | `{answer: "yes" \| "no"}` |

A thumb's revision is its whole state, as a mark's is: odd is thumbed, even is
taken back, no row is 0. An answer's revision counts its changes. Every
change adds one, rows are never deleted, and a request fenced on another
revision is refused with `REVISION_CONFLICT` and the current one, so a late
request never undoes a newer act. Thumbing what is thumbed, or answering the
answer already given, changes nothing (`changed: false`).

Both reach a message the way reading it does (a topic the actor reads, or a
message sent to them by name; a whisper only its two people). A thumb is for
someone else's message. Only a person a go-ahead ask names can answer it
(`NOT_ASKED`), and only a message that asks for one can be answered
(`NOT_A_GO_AHEAD`).

A thumbs-up given and an answer read the message for the actor, as opening it
does, wherever they are pressed (the card's bar or 👍 count as well as the
Reader): in the same act they settle the actor's own pending delivery of it
and clear the actor's mark on it (docs/attention.md: unread is a pending
delivery or a mark), with the next mark revision and a `mark` change, as
`message.mark` clearing it would. They change no topic state or order; a
thumbs-up changes a wait only when it answers an ask (below). A person's
thumbs-up given also folds the message for them, as their reply to it does
(docs/reply-stacks.md, "Folded messages"): Core records their own
`message.fold` in the same act, unless the message is starred for them or
already folded. Taking the thumb back unfolds nothing, and an agent's thumb
folds nothing. On the page a folded message's row keeps its 👍, the same
thumbs-up as the bar's. A thumb's
result says whether it read the message (`settled`: it was unread for the
actor, by a pending delivery or a mark, and is read now; false for a thumb
taken back, one that changed nothing, and one on a message already read).
A result that cleared a mark carries its new revision (`mark_revision`), and
`affected` names the mark. Only that message is read: messages before and
after it that are unread stay so. Taking a thumb back settles nothing, clears
nothing and unsettles nothing, so the message stays read, and a mark made
since stays.

In the topic page a thumbs-up reads its card at once (`readNow`,
`web/card-reading.mjs`: any revision of the reader's own thumb), a card
marked unread included, since the page learns the cleared mark from the
result before it paints, and the counts follow the commit as any read does.
A thumb whose result says `settled` places the New line afresh, as Mark read does; one that read
nothing moves it nowhere. Every other page and device the person has open
hears the `reaction` change, reads the message's reactions and shows the card
read, and reads its counts and New line again after the commit. Given from
the Reader's 👍, a thumbs-up is a reply of one thumb, whether the reply is
its quiet line or being written: once Core holds it, the Reader closes as
after Send, keeping what the reply holds (docs/reader.md); a refusal, or a
thumb taken back, leaves the Reader and the reply open. An answer also posts
a short reply from the person to the asker in the same act: `✅ Go ahead` or
`🚫 Don't`, with "(I changed my answer)" when it replaces one. The agent hears
it through its delivery like any reply, and the topic stops waiting on the
person for that ask.

## A thumbs-up answers an ask

A person's 👍 on a message whose ask waits on them answers it yes, as their
reply would, in the same act (`Reactions._thumb_answer`, the one place the
rule is kept):

- In an outcome's conversation the ask's own wait on them
  (`conversation_waits`) goes, and the conversation's `topic_waiting` row
  follows it (docs/conversation.md).
- In a topic the ask answered is that one ask, not every ask to them there,
  as writing would be: when the topic's wait on them is from it, the wait
  moves to their next ask there that nothing has answered, or ends; a wait
  someone said stays (docs/attention.md).

When the wait moves on, it passes over the asks the person's own 👍 already
answered: their thumb row on each, read by the key `message.thumb` writes it
under, so another person's 👍 on an ask to both of them leaves it waiting on
this one.

The thumb's row then holds `value: "yes"` rather than `"up"`, readers see
`answered: true` on that thumb, and the result of `message.thumb` carries
`answered`, also when it changes nothing (a 👍 sent again reports whether
the one already there answered). Taking that 👍 back makes the ask wait on
them again, unless the person answered the ask meanwhile (a reply to that
ask, on the record or by whisper to whoever asked, and in a topic any writing
there on the record; a whisper replying to anything else answers nothing) or
the wait could no longer stand (they no longer read the topic, its outcome
was reached, or a conversation replaced it). A wait put back is as it would
be had the 👍 never been given: archived when its topic is, ordered on the
rail by the ask it waits from, or, when someone said it waits, by when they
said so. A thumb that answered nothing puts nothing back. When a wait changes, the topic
is touched and the person gets an actor-scoped `waiting` change, so every
reader of waits (Waiting on you on the rail and its outcome light, the
topic's asks, the conversation's tags and "Asks you", and the `conversation`
view's `waits` that agents read) shows it at once.

Nothing else a thumb is on changes a wait:

- a 👍 by anyone the ask does not ask, or by an agent, whose 👍 is its "got
  it" and whose reply is how it answers;
- a 👍 on a message that asks nothing, or asks someone else;
- a 👍 on a go-ahead ask. Its answer is ✅ or 🚫, which the agent hears as a
  reply and acts on, and which is never unsaid; a 👍 can be taken back
  silently after the agent has acted, so it cannot be a go-ahead, and the ask
  keeps waiting, with its ✅ and 🚫 in view, until one of them is pressed;
- a 👍 on an ask a record answers: a target wording's or an owner-gated
  stage's (`outcome_asks.record_ask`), which its decision settles.

A 👍 given before this rule (value `up`) answered nothing then, and taking it
back puts nothing back; a 👍 given again answers. No schema step: a thumb's
`value` already allowed `yes`, and earlier code reads a thumb by its revision
alone.

`message.post` takes `go_ahead: true` beside `intent: "ask"`; anywhere else
(a tell, a whisper, no addressees) it is refused before anything is saved.
The agent CLI says it with `post TOPIC --asks A --go-ahead -`, and thumbs up
with `thumb MESSAGE` (`--off` takes it back), so an agent stops posting "got
it". Hosted agents' instructions name both.

## Reading

`topic_messages` items and the `source` view carry, for a message with any,
`reactions: {version, thumbs: [{actor_id, at_ms}], answers: [{actor_id,
answer, at_ms}], thumb_revision, answer_revision}` (the last two are the
reader's own; a thumb that answered an ask also carries `answered: true`), and
`go_ahead: true` on a message that asks for one.
`reactions {message_id}` reads one message's. `version` is the sum of the
message's revisions, so it only grows. `read` prints "(👍 tony, …)", with
"tony (yes)" for a thumb that answered an ask, and "(asks for a go-ahead: tony
✅ go ahead)" under the heading.

## Changes

The Reader composer's 👍 represents only the current reader's reaction. It
always says 👍, selected only when that reader has given one; its tooltip
offers giving or taking back their own reaction. The aggregate count and
the names of everyone who reacted remain on the message: on its card, and in
the Reader on a quiet line under the message's words, read from the loaded
card's item or, where no loaded page holds the card, from the message's
source (item 406). This
presentation does not change sending, undo, reading, folding or draft state.

Who sees a reaction is who sees the message. Each of them gets an
actor-scoped change `reaction` keyed by the message at its new version; a
topic page reads its reader's own scope after each commit, as it does for a
whisper, and reads `reactions` for a message it has loaded. Nothing is written
in the topic's scope, whose keys an open page checks strictly, so a page from
an earlier release never meets a key it refuses.

## Schema

The version after the Health page's 32 (numbered 33 here; the release train
renumbers) adds `message_reactions` and `messages.go_ahead`. Stepping back is refused once a
reaction or a go-ahead ask exists.
