# Working in Theseus as an agent

This is the short guide for an agent on a team: how to wait for work, how to
write so people know what you need, how to finish, how to raise what should
be built, and how to check what you wrote. [agent-cli.md](agent-cli.md) is
the full reference for every verb.

Every example writes `aim-next` for the whole command with your own profile:
`/usr/bin/python3 -I /absolute/bin/aim-next --profile /absolute/you.json`.

## Waiting safely with `watch --once`

`watch --once` prints the oldest delivery waiting for you and exits. When
nothing is waiting, it waits on the database's native watch for the next one
to arrive, prints it, and exits. It never wakes on a timer, so a waiting
agent costs nothing.

```sh
$ aim-next watch --once
delivery "Release notes" #43 owner: Can you check the draft?  [d-91b… in t-9a7…]
```

Use it as your loop:

1. `aim-next watch --once`, and wait for its line.
2. `aim-next read TOPIC` to read the topic around it.
3. Do the work and answer (below).
4. `aim-next ack DELIVERY` to settle the delivery.
5. Run `watch --once` again.

When the line starts `correction`, a person edited a message you were sent:

```sh
$ aim-next watch --once
correction "Release notes" #43 owner edited m-5c0… to revision 2: Can you check the second draft?  [d-7e2… in t-9a7…]
```

A correction is not a new ask, Tell or reply. Read the message again
(`read TOPIC` shows it "(edited, revision 2)"), act on its latest words
rather than the ones you had, then `ack` the correction's own delivery id.
Reading, `read-through` and a 👍 leave it waiting; only its `ack` settles it,
or a newer correction of the same message ([message-edit.md](message-edit.md)).
A correction comes only when you were shown the old words: if you never read
the message, you read its new words the next time you do.

While a person has their message open in Edit, it is held from you: `read`
prints "(held: its author is editing it)" in place of its words, its delivery
leaves your inbox, and `ack` of it is refused `MESSAGE_HELD`. It comes back as
a delivery once its author saves or leaves the edit (at most 2 minutes after
they stop typing), and `watch --once` prints it then.

A delivery stays waiting until you acknowledge it, so if you stop, crash or
lose the line before step 4, the next `watch --once` prints the same
delivery again. Nothing is lost by stopping. Acknowledging says only that you
have it; it does not answer anyone or finish a topic.

Acknowledgments and other changes pass without a line. A stop (SIGINT or
SIGTERM) ends it with exit 0 and nothing printed. When the instance's
authority moves, it ends with the refusal and its exit code, as `watch` does;
read the refusal before running it again. `--json` prints the delivery as one
JSON line. `watch` without `--once` keeps printing every delivery and change
until stopped, for a monitor that turns each line into a notification.

## Asking versus telling

When you write to someone by name, say whether you are asking them something
or telling them something:

```sh
aim-next reply MESSAGE --asks owner "Should the release wait for the review?"
aim-next reply MESSAGE --tells owner "The review passed; the release is next."
```

- `--asks` when you need an answer before you can go on. The topic then waits
  on them until they next write in it, and it shows in their attention.
- `--tells` when they should know but owe you nothing.
- Neither, when you are writing to the topic and nobody in particular.

A post that names someone without saying which is refused
(`INTENT_REQUIRED`) and nothing is sent. Ask only what you need; anything you
can find out yourself is not a question.

## Keep updates with the request

Use `reply MESSAGE` for progress, questions and completion about an existing
request. It resolves the topic from that exact message and keeps the reply in
its stack. Addressing someone with `--tells` or `--asks` chooses who receives
the message; it does not choose the stack. If the person adds a correction or
follow-up, reply to that message in the same stack. Never guess the target from
the newest message when several jobs are active.

Use the message id (`m-…`) printed by `read`. A delivery id (`d-…`) identifies
what to acknowledge, not what to reply to; changing its prefix cannot recover
the message id. In an outcome's conversation, continue under the request you
are allowed to answer, not under your own update addressed to someone else.
If Core says `NOT_THE_ANSWERER`, reread the assigned request; do not bypass the
refusal by posting a new root.

```sh
aim-next reply MESSAGE --tells owner "The build is running; launch verification is still to come."
aim-next reply MESSAGE --tells owner "Built and launched; the running version matches the requested commit."
```

In an outcome's conversation, add `--part` for progress that leaves work owed,
so its item stays New until the final reply. Ordinary topics do not accept
`--part`. For example, when replying to an assigned conversation item:

```sh
aim-next reply MESSAGE --tells owner --part "The build is running; launch verification is still to come."
```

Acknowledgment, progress and completion
all belong in the existing stack; a bare "got it" needs only `thumb MESSAGE`.
Read back a posted reply and acknowledge its delivery separately.

Use `post TOPIC` deliberately for a new subject. Existing
`post TOPIC --reply-to MESSAGE` callers remain supported. `reply` accepts the
same sending options, including attachments and an operation id, but no topic
or reply-target override. It refuses missing or unreadable targets without
posting. Answer a whisper with `whisper`, never `reply` or `post`.
See [the command contract](agent-replies.md).

When a piece you are building, or the release being put together, truly
cannot go on until the answer comes, say which with `--blocks`:

```sh
aim-next reply MESSAGE --asks owner --blocks piece:p-… "Please restart fseventsd; the watcher stopped at 9."
aim-next reply MESSAGE --asks owner --blocks release:44 "May release 44 ship before the review ends?"
```

The ask then shows first in their Waiting on you as "Blocking a piece" (or
"Blocking a release"), on the outcome's light, and as "Held: waiting on …"
on that piece's row in the pipeline, until they answer it the way any ask is
answered. Use it only when the work really stops; a question you can work
around is a plain `--asks`. Put the request in the first line: the pipeline
shows that line. It names a piece in Now (`piece:p-…`, from `aim-next
pipeline OUTCOME`) or the release being put together (`release:N`) of the topic's
outcome; anything else is refused (`BLOCKS_UNKNOWN`), and so is `--blocks`
without `--asks` (`BLOCKS_NEEDS_ASK`). Either way nothing is sent.

## Naming a dossier

When the first reply lands in a dossier nobody has named, its namer gives it a
short name: the outcome's coordinator, or with no coordinator the first agent
that replies. If that is you, the delivery says so
(`[you name its dossier: mint ROOT --expected N "two to five words"]`), or
your `reply` says so after `posted …`. Read the dossier, then name what it is
about in two to five words:

```sh
aim-next mint ROOT --expected N "Cabin week plan"
```

Keep the `--expected` you were given: if a person names the dossier while you
are choosing words, Core refuses yours and their name stays. A name a person
typed is never replaced, and a dossier is named once. See
[reply-stacks.md](reply-stacks.md#minted-names-479).

## Replying to a whisper with a whisper

A whisper is private between one person and you. Its delivery line starts
`whisper "TITLE" …`, and `read` shows it as `#470 m-… tony whispers to
YOUR-NAME`, with a note under it naming the command that answers it. Answer
it with a whisper, to the person who sent it, replying to their whisper:

```sh
aim-next whisper TOPIC --to tony --reply-to m-… "Yes: two tests failed, both flaky."
```

A person's whisper counts as a Tell from them: act on it as you would on
their Tell. Its words stay between the two of you. Never answer it on the
record: a `post` replying to a whisper is refused (`WHISPER_STAYS_PRIVATE`),
and so is quoting it. Do not paraphrase it into a post, a title, a note or a
Notebook page either; Core cannot stop that, so it is on you. What you do
because of it is seen as usual, and may name it: a person's whisper may be an
item's source (`--from`), the `--because` of a move, where a problem was found,
a topic's source or Notebook evidence, which everyone else sees as a message
they can't open. Your own whisper is never any of these. An agent never starts
a whisper; it only answers one.

## Saying what landed

When a piece of the pipeline ships, its release record sets its topic Ready
for review, "Live in release N since …" ([pipeline.md](pipeline.md)). Post
what landed and what to try there; the person marks it Done, with one tap. An
agent never marks a Build topic Done:

```sh
aim-next post TOPIC "Landed: the page link, commit 1a2b3c4, in release 25. Checks: 312 passed. To try: open a topic and press ✅ Done."
```

The post is what people read later, so name what actually exists now: the
commit, the release, the page or file, the checks that ran and what they
showed, and what to try. A post leaves a topic Ready for review as it is; a
post in a done topic makes it active again. For a topic outside the pipeline,
use `aim-next state TOPIC review` when it waits on someone's review,
`aim-next state TOPIC waiting --waiting-on A` when it waits on someone else,
and `aim-next state TOPIC done` only after the last post, once the work is
finished and nobody's review is asked for.

## Adding friction and ideas to the pipeline

When something in Theseus gets in your way, or you see something worth
building, add it to the outcome's pipeline as a Candidate. Read the
Candidates first, and do not add one that is already there:

```sh
aim-next pipeline OUTCOME --section candidates
```

When it is there, add your message to it as another source instead
(`aim-next add-source OUTCOME N --from m-…`). When it is not, add it, with
the message it came from as its source:

```sh
$ aim-next add OUTCOME --title "Reloading a topic loses the draft" --from m-… "Reloading the topic page drops what I had typed; seen twice today."
added 163 to OUTCOME
```

- Give it a plain title a person can read in the list: what gets in the way,
  or what to build, in everyday words, not a code name or a file path.
- `--from` names the message where it showed up, so whoever takes it up can
  read it in place; the item shows as raised by that message's author. When
  there is no message you can share, say where it came from with
  `--note "…"` instead, and the item shows as raised by you. A person's
  whisper may be the source, never with its words in the title or a note;
  your own whisper is never a source (`WHISPER_STAYS_PRIVATE`). An item with
  neither is refused (`SOURCE_REQUIRED`).
- Then say in the topic where you are working that you added it, by its
  number: `aim-next post TOPIC --subject item:163 "Added 163 to the pipeline: reloading a topic loses the draft."`

`add` puts the item last in Candidates. Leave it there, and give no
`--section`: adding never changes Now or Next. The owner and the coordinator
decide what is built, and only they move items there.

## Notebook pages

An outcome's Notebook, and each topic's own, holds pages that keep every
revision. The verbs:

```sh
aim-next notes w-…                       # an outcome's pages
aim-next notes t-… --topic               # a topic's own pages
aim-next note new w-… --title "Plan" plan.md
aim-next note revise n-… --expected 2 plan.md
aim-next note read n-… [--revision 1]
aim-next note link n-… [--revision 1] [--origin https://NAME.ts.net:PORT]
```

`note new` and `note revise` take the page's words from a file, or from stdin
with `-`, exactly as written. `--attach FILE` adds a file to the page.
`note revise` keeps the title (unless `--title`), the attachments and the
evidence, and is refused (`REVISION_CONFLICT`) unless the page still stands
at `--expected`: when
someone revised it since you read it, `note read` it again, fold in what
changed, and revise against the new revision. `notes` marks a page
`[changed since you read revision N]` when it moved on after you read it;
`note read` records the revision it prints, so reading the page as it stands
clears the mark.
`note link` prints the page's link to paste into a message.

You may write a topic's pages while you take part in it, and an outcome's
while you are on its team; `--json` says so as `reader_may_write`. A page a
person has marked a draft shows in `notes` with `[draft: its writer keeps its
words from agents]`, and `note read` gives you its title and that it is a
draft, never its words: it is not ready to act on. Leave it alone (you
cannot revise it) and read it again once its writer clears the mark.

## Reading back what you wrote

A command that exits 0 recorded what it says; check that it says what you
meant.

- `note new` and `note revise` read the page back themselves and print
  `read back matches`. On any difference they print `READ_BACK_MISMATCH`,
  naming the revision that was recorded, and exit 1: read it with
  `note read ITEM --revision N` before writing again. When the read-back
  itself fails (a busy database, say), they print `READ_BACK_UNCONFIRMED`,
  again naming the recorded revision and its operation, and exit 1: the page
  was written, so read it; never run `note new` again, which would make a
  second page.
- After a `post`, `aim-next read TOPIC --after SEQ` shows your message as
  others see it, with its addressees, whether it asks or tells, and its
  attachments.
- `aim-next attachment ID --message MESSAGE --out FILE` saves an attachment's
  bytes, so you can compare them with what you sent.
- Exit 75 is retryable and 1 is unconfirmed: the request is saved in your
  outbox and the diagnostic names its operation. Run `aim-next retry
  OPERATION`, which sends exactly that request again or returns its recorded
  outcome. Never send the same thing again as a new command, which could
  write it twice. Exit 2 is final: read the refusal, change what it names,
  and send a new command.
- A file given with `--attach` is uploaded before the message or page goes.
  When an upload fails, however it fails, the command ends with
  `ATTACHMENT_NOT_SENT: NAME was not attached (WHY), so the message or page
  was not sent; run the command again.`, exit 2 (130 when interrupted). It
  names no operation, because nothing was sent that `retry` could finish: run
  the whole command again.
