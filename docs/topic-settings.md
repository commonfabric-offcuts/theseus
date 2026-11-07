# Topic settings: fields set in place

Topic settings (the gear beside a topic's title) has no form and no Save.
Four chips say where the topic stands, and Waiting adds a chip for each of
its people. The note, the reader's own part ("Your part") and, for whoever
organises the outcome and the topic's creator, the title are one line each. A tap
saves at once; a line saves on Return or when the person leaves it, by Tab,
by a press elsewhere, by ✕ or by closing Topic settings. Escape in a line
puts back what is saved.

## The rule for each field

Each control is a field, and every field follows the same small model
(`TopicStatePanel` in `web/topic-state.mjs`): the note, Your part, the
title, the state chips, the people chips and Archive. A field holds where
the person's change began (each key as Core held it, with the topic version
it was read at), its one save that is out, and whether the person asked for
another. A line's change begins at its first key; a chip's or Archive's at
the tap, and it means what the control showed when pressed.

1. A save sends only what that field changed. A chip sends the state, or
   who the topic waits on, and never the note or another line's words.
2. A save is fenced on where the change began. When someone else changed
   that field since, Core refuses it; the panel reads the topic once, the
   line keeps the person's words, and the notice shows the newer words
   beside them ("Someone else changed the note first … It now reads “…”:
   press Return to save yours in its place"). The newer words become where
   the change begins, so the next Return, made once they show, goes in
   their place. If Topic settings was closed, it opens again. The notice
   stays until those words are saved or put back (Escape). A save the
   person asked for while the refused one was out is dropped: it was made
   before they saw the newer words.
3. When Core commits the person's save, every field's start that was read
   before that commit, on the value the save was fenced on, moves to what
   Core saved, so the person's next save is never refused as someone
   else's. A start read at the commit's version or later already shows it,
   or what came after it, and stays.
4. Words equal to where the change began, or to what is saved now, are no
   change: Return, leaving or a tap sends nothing for that field, and it
   follows fresh data again.
5. Fresh data updates a line nobody is editing, and never the words in one
   being edited. The chips always show the topic as it stands.

Each field has at most one save out. A Return, leaving or tap while it is
out waits for its answer, and then only the latest words or tap go, fenced
on the start that answer leaves. Fields are otherwise independent: a tap
never waits for the note. A field whose save would be fenced on a key that
another field's save changes waits for that save: a tap on a topic a
message reopened clears the note, and the state and people chips both set
the state.

### A lost answer

Nothing is guessed from later reads. Every save names its operation id, and
Core runs an operation once and answers the same id again with what it
stored, a refusal too (`view operation` reports the same). When an answer
is lost (the connection failed, or Core answered without an outcome), the
panel reads the topic once to show where it stands and keeps the save as it
was sent. It goes again, as the same command, when the connection is back
(the page's live feed returns, or the browser comes back online), at the
person's next act on that field or on a field waiting for it, or straight
away, once, when the person had already acted again while it was out. Core's
answer to it is the answer: its stored outcome, or, when the first attempt
never reached Core, the outcome of running it now. A first attempt that
reaches Core late runs nothing.

### Limits

Fences compare values, so a change by someone else that puts a field back
to the value a start holds is not seen as a change.

## Core: `topic.update`

Besides `topic_revision`, a `topic.update` can be fenced on fields:
`expected.topic_fields` maps one or more of `title`, `archived`, `state`,
`note` and `waiting_on` to the value the sender read. Core refuses it with
`REVISION_CONFLICT` (`current_versions: {topic_revision}`) when any of them
now differs; `waiting_on` compares as a set. A change to a field it does
not name never refuses it. `expected` names `topic_revision` or
`topic_fields`, never both.

`args.keep_note: true`, given with a state and without a note, keeps the
note someone said across a new state. A note a message wrote when it
reopened the topic is cleared, as it is without `keep_note`. Without it a
new state still starts with its own note, as agents and the CLI say it.

The page fences each line on its own field, Your part on its
`responsibility_revision` (see [responsibility.md](responsibility.md)), a
state tap on `state` and `waiting_on`, and the note as well when the topic
was reopened by a message, since Core then clears it.
