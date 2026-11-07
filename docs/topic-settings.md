# Topic settings: fields set in place

Topic settings (the gear beside a topic's title) has no form and no Save.
Four chips say where the topic stands, and Waiting adds a chip for each of
its people. The note, the reader's own part ("Your part") and, for the
outcome's owner and the topic's creator, the title are one line each. A tap
saves at once; a line saves on Return or when the person leaves it, by Tab,
by a press elsewhere, by ✕ or by closing Topic settings. Escape in a line
puts back what is saved.

## The rule for a line

Each line is the same small model (`Line` in `web/topic-state.mjs`): what
is saved now, and, while the person edits, the saved value they began from.
Each Return, leaving, tap or press is an act, fenced field by field on what
the person saw when they made it: for a line, the value its edit began from;
for a chip or Archive, the topic as shown when pressed.

1. A save sends only what that control changed. A chip sends the state, or
   who the topic waits on, and never the note or another line's words.
2. A save is fenced on the value the person began from. When someone else
   changed that field since, Core refuses it; the line keeps the person's
   words, and the notice shows the newer words beside them ("Someone else
   changed the note first … It now reads “…”: press Return to save yours in
   its place"). If Topic settings was closed, it opens again. The notice
   stays until those words are saved or put back. Every act made before the
   refusal was shown, fenced on the same value (a Tab or ✕ just after
   Return, a second Return, a second tap), is not sent: it was made before
   the person saw the newer words. Their next act, made once those words
   show, saves theirs in place of them.
3. A save of the person's own moves where the line begins, and every act of
   theirs made from the same value, to what Core saved. When its answer is
   lost, the panel keeps a record, for each field it changes, of what it
   read there and what it would have left there; every such change is kept,
   not only the last. Any read of the topic settles each record: while the
   field still holds what the change read, it may yet land and the record
   stays; when the field holds what the change would have left, the change
   is found saved and moves the line and the acts as a confirmed save does;
   otherwise someone else has changed the field since, and the record goes.
   When a change is refused and the read after it finds one of the person's
   own lost changes saved, with every field it was fenced on then as it
   expects, the change is worked out again from what Core saved and sent if
   anything is left to change; nothing is called someone else's.
4. Words equal to what the line began from, or to what is saved now, are no
   change: Return, leaving or a tap sends nothing for that line, and it
   follows fresh data again.
5. Fresh data updates a line nobody is editing, and never the words in one
   being edited.

Acts go one at a time, in the order made. A tap means what the control
showed when it was pressed: Archive archives, and a person chip shown unlit
adds that person. One that is already so when its turn comes sends nothing.
An edit ended before a line's act has its turn (Escape, or its words found
saved) sends nothing.

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
