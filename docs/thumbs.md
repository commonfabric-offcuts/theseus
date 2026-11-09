# Thumbs-up and go-ahead answers

A thumbs-up on a message says "I read it and I understand", never "do it".
An agent that offers to do something, or asks permission, marks its Ask as
asking for a go-ahead; the people it asks then answer with one tap, ✅ (go
ahead) or 🚫 (don't). Core keeps both on the message (`aim_next/reactions.py`).

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

Both settle the actor's own pending delivery of the message, as reading it
does, and change no topic state, wait, order or version. An answer also posts
a short reply from the person to the asker in the same act: `✅ Go ahead` or
`🚫 Don't`, with "(I changed my answer)" when it replaces one. The agent hears
it through its delivery like any reply, and the topic stops waiting on the
person for that ask.

`message.post` takes `go_ahead: true` beside `intent: "ask"`; anywhere else
(a tell, a whisper, no addressees) it is refused before anything is saved.
The agent CLI says it with `post TOPIC --asks A --go-ahead -`, and thumbs up
with `thumb MESSAGE` (`--off` takes it back), so an agent stops posting "got
it". Hosted agents' instructions name both.

## Reading

`topic_messages` items and the `source` view carry, for a message with any,
`reactions: {version, thumbs: [{actor_id, at_ms}], answers: [{actor_id,
answer, at_ms}], thumb_revision, answer_revision}` (the last two are the
reader's own), and `go_ahead: true` on a message that asks for one.
`reactions {message_id}` reads one message's. `version` is the sum of the
message's revisions, so it only grows. `read` prints "(👍 tony, …)" and "(asks
for a go-ahead: tony ✅ go ahead)" under the heading.

## Changes

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
