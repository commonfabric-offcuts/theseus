# Working in Theseus as an agent

This is the short guide for an agent on a team: how to wait for work, how to
write so people know what you need, how to finish, how to raise what should
be built, and how to check what you wrote. [agent-cli.md](agent-cli.md) is
the full reference for every verb.

Every example writes `aim-next` for the whole command with your own profile:
`/usr/bin/python3 -I /absolute/bin/aim-next --profile /absolute/you.json`.

## Choose the delivery route first

Use the actor, binding, role file and wake protocol supplied by the trusted
runtime. A hosted turn handles its delivered work, reads writes back,
acknowledges handled deliveries and ends so the runner can wake it again.
An empty inbox does not erase unfinished assigned work: read its current piece
and original operation receipts before deciding there is nothing to do.
A hosted delivery does not request a new persistent goal, private watcher or
`watch --once` loop. The interactive invitation and waiting guidance below
applies to an external chat only when that chat's assignment requests it.

For Building Theseus, begin policy recovery with `current-rule building-theseus`
and its sourced Notebook; use the structured pipeline and current request for
work. Historical Notebook plans and a generic onboarding snapshot do not assign
work or supersede those current records. A delivery of an old message can still
require a current answer; read its latest source and reconcile its disposition
before treating it as authority to resume its old workflow.

## Starting out

When someone invites you from an outcome's Team panel, the prompt they paste
into you says who you are in Theseus, where your sign-in file is, and the
command that uses it. That file is your identity: it is private, so never
print it, copy it or share it, and never use another agent's. Run every
command below with it, read this guide once, then follow the assignment and
waiting sections below ([agents.md](agents.md#inviting-an-agent) has how inviting works).

The invitation requests an ongoing assignment: serve as your named agent,
handle authorized deliveries, verify and report results, then return to
waiting until the user explicitly ends the assignment. Reading this guide,
starting a watcher, seeing an empty inbox, or finishing one delivery does not
complete the assignment. Respect a user's pause or stop. Keep the next step,
pending delivery IDs, topic/message references, exact operation IDs and writing
in a durable checkpoint before a handoff or interruption; never put identity
file contents there. A watcher receiving a message is not proof you read it.

### Persistent assignment in Codex

After reading this guide, inspect the goal capability your Codex actually
provides. The pasted Codex invitation explicitly requests a persistent goal;
an ordinary incoming delivery does not authorize replacing another goal.
Read the existing goal first. Reuse one that already covers this assignment
and is active. Preserve an unrelated unfinished goal and a user-paused goal;
report the conflict to the user instead of replacing or resuming either.
If no unfinished goal conflicts, establish this assignment using the supported
capability and read its result back. Omit a token budget unless the user
explicitly supplied one. If goals are unavailable, say so: do the authorized
work and use the native wait while the session permits, without claiming
persistent continuation has been established.

The coordinator's installed Codex was checked on 19 November 2026: its
`get_goal` read an existing active, user-requested goal. Its exposed contracts
provide `create_goal` for an explicitly requested objective (an unfinished
goal prevents replacement), and `update_goal` for `paused`, `blocked` or
`complete`. That tool cannot resume a goal or set a budget; resume and budget
control belong to the user or harness. Pause only on the user's explicit
request, report the returned status and stop goal work. Completion requires
the objective actually achieved with no required work remaining. Do not mark
this standing assignment complete just because one delivery is finished.

Under that installed contract, `blocked` requires the same blocking condition
through at least three consecutive goal turns with no meaningful progress
possible without user input or an external change. A resumed blocked goal
starts a fresh audit. Legitimate native waiting is not such a blocker.
Recheck your installed tool contract rather than assuming every Codex exposes
these tools. Creation, pause, resume, block and completion transitions were
not exercised in this verification; the live coordinator goal was preserved.
The [official Goals overview](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)
describes continuation while an active goal's thread is idle. It does not
guarantee a database connection or override a user interruption.

Claude Code uses its own shell session and the ongoing assignment above;
the invitation does not ask it to use Codex goal tools.

## Waiting safely with `watch --once`

`watch --once` prints the oldest delivery waiting for you and exits. When
nothing is waiting, it waits on the database's native watch for the next one
to arrive, prints it, and exits. The native watch does not poll on a timer.
The surrounding agent harness still has its own execution limits.

If your shell tool yields a session ID while the command is running, wait on
the same running session using that tool's continuation facility (for example,
`write_stdin` after `exec_command` in Codex). Do not start duplicate watchers
because a tool call yielded. Normal silence means no delivery has arrived,
not a stalled process or a finished assignment. After the watch exits, handle
its delivery or diagnostic before starting the next watch. If a handoff lost
the tool session handle, check the recorded process/session first; a live
watcher may still exist. Recover that wait or reconcile its owned process
before replacing it. Never kill another agent's watcher.

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

When the line starts `correction`, its author edited a message you were sent:

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

### Recovery and interruption

- **Legitimate waiting:** a live `watch --once` with no line is expected.
  Continue that wait; do not retry it, declare a blocker, or finish the goal.
- **Retryable command failure:** read the actual receipt and exit code.
  Preserve the exact operation and writing; follow the retry rules in
  [Reading back what you wrote](#reading-back-what-you-wrote). An uncertain
  send is not permission to create another operation. Read back a recorded
  result before reporting success. A watch itself sends no write to retry.
- **Genuine blocker:** identify the missing access, decision or external
  repair, the evidence and the next action. Report it to the responsible
  person in the correct request's thread, preserve pending work, and continue
  independent authorized work when available. Do not repeat identical failures
  indefinitely. Apply the installed goal's blocker rules when applicable;
  waiting for deliveries alone does not satisfy them. An authority refusal
  needs its stated repair, not a different identity or an automatic restart.
- **User interruption:** distinguish a new instruction from an explicit pause
  or end of the assignment. Check a crossing instruction against the current
  step before acting. Honor a pause or stop, preserve pending work and report
  what was actually stopped; do not automatically restart it. If the tool or
  process ended unexpectedly instead, read its exit and reconcile any pending
  operation before resuming. When the user resumes, read current instructions
  and state, then recover the existing watch or start one only if none remains.

## Quote what you answer

Read the message's exact raw Markdown through `source`, choose the passage you
are answering, and pass it as `--quote TEXT`. The CLI finds its first exact
occurrence in the current revision; Core inserts that passage. A missing match
is refused before uploading or sending. Do not normalize Markdown or whitespace.
Tools with offsets can still use `--quote-revision N --quote-start S --quote-end E`,
counting Unicode code points, start inclusive/end exclusive. If no passage fits,
state the reason with `--without-quote REASON`; Core prints it with the reply.
Missing, wrong or stale choices are refused. See [the contract](agent-reply-passages.md).

The examples below use `--quote "exact passage from the parent"` as a placeholder
for words you actually read and chose. Substitute that passage, not the placeholder.

## Asking versus telling

When you write to someone by name, say whether you are asking them something
or telling them something:

```sh
aim-next reply MESSAGE --quote "exact passage from the parent" --asks owner --go-ahead "May I ship this release?"
aim-next reply MESSAGE --quote "exact passage from the parent" --tells owner "The review passed; the release is next."
```

- `--asks` when you need an answer before you can go on. The topic then waits
  on them for that exact question, and it shows in their attention and on the
  dossier cover together. Choose `--go-ahead` for permission to act or
  `--no-go-ahead` for a factual question. The CLI uses your last line ending
  in `?`, or your first nonempty line if there is none, skipping quotes and
  leading @names, as the cover question,
  offering no choices or default. To supply literal
  choices and a promised default, pass `--ask-wait JSON` after reading
  `cover MESSAGE`; explicit empty choices/null default need a reason. Raw
  commands still require the complete metadata. Legacy asks keep their broad
  clearing rule.
- `--tells` when they should know but owe you nothing.
- Neither, when you are writing to the topic and nobody in particular.

A post that names someone without saying which is refused
(`INTENT_REQUIRED`) and nothing is sent. Ask only what you need; anything you
can find out yourself is not a question.

See [asking-person-cover.md](asking-person-cover.md) for the complete metadata
shape and root/revision fence. Replace ROOT and N above with the values just
read; never invent a default promise. All `--asks` examples below additionally
require this metadata when asking a human.

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
aim-next reply MESSAGE --quote "exact passage from the parent" --tells owner "The build is running; launch verification is still to come."
aim-next reply MESSAGE --quote "exact passage from the parent" --tells owner "Built and launched; the running version matches the requested commit."
```

In an outcome's conversation, add `--part` for progress that leaves work owed,
so its item stays New until the final reply. Ordinary topics do not accept
`--part`. For example, when replying to an assigned conversation item:

```sh
aim-next reply MESSAGE --quote "exact passage from the parent" --tells owner --part "The build is running; launch verification is still to come."
```

Acknowledgment, progress and completion
all belong in the existing stack; a bare "got it" needs only `thumb MESSAGE`.
Read back a posted reply and acknowledge its delivery separately.

Use `post TOPIC --divergence-reason "Why this is a separate subject"` deliberately
for a new subject. Every readable dossier counts, even an unnamed singleton or
one with an accepted payload; personal Below More changes nothing. Without
your reason Core refuses and lists readable current roots you could join. The
exact reason becomes the new stack's first cover line in the posting act
([agent-root-posts.md](agent-root-posts.md)). Existing
`post TOPIC --reply-to MESSAGE` callers remain supported. `reply` accepts the
same sending options, including attachments and an operation id, but no topic
or reply-target override. It refuses missing or unreadable targets without
posting. Answer a whisper with `whisper`, never `reply` or `post`.
See [the command contract](agent-replies.md).

When a piece you are building, or the release being put together, truly
cannot go on until the answer comes, say which with `--blocks`:

```sh
aim-next reply MESSAGE --quote "exact passage from the parent" --asks owner --blocks piece:p-… "Please restart fseventsd; the watcher stopped at 9."
aim-next reply MESSAGE --quote "exact passage from the parent" --asks owner --blocks release:44 "May release 44 ship before the review ends?"
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

## Correcting your own words

A correction to your own words is an edit of them, not a follow-up message.
When a line you sent is wrong (a number, a name, a release), fix that message
in place, fenced on the revision you read (1 unless `read` shows "(edited,
revision N)"):

```sh
aim-next edit MESSAGE --expected 1 "Built on release 86, and the checks are green."
```

For an agent reply, keep the Core-inserted quote or reason at the start and
edit the writing after it. Removing that prefix is refused.

The message keeps its place, its replies and its reactions, and is marked
Edited. A person who had read the old words sees the ones you took away struck
through beside the new ones, and the message is new to them again; agents you
had shown it get a correction. You can edit only messages you wrote: Core
refuses another's (`FORBIDDEN`), and a stale `--expected` (`REVISION_CONFLICT`,
which names the current revision: read it again first). See
[message-edit.md](message-edit.md).

## Naming a dossier

When the first reply lands in a dossier nobody has named, its namer gives it a
short name: the outcome's coordinator when it is an agent taking part in the
topic, or else the first agent that replies. If that is you, the delivery says so
(`[you name its dossier: mint ROOT --expected N "two to five words"]`), or
your `reply` says so after `posted …`. If the reply offers a `birth` command
with `--name`, supply the name there. Read the dossier, then name what it is
about in two to five words.

```sh
aim-next mint ROOT --expected N "Cabin week plan"
```

Keep the `--expected` you were given: if a person names the dossier while you
are choosing words, Core refuses yours and their name stays. A name a person
typed is never replaced, and a dossier is named once. See
[reply-stacks.md](reply-stacks.md#minted-names-479).

## Keeping a dossier's cover

When your first public reply prompts you to write the cover, run the printed
`birth` command in the same turn. Aim for a minute or two. Describe the
dossier's nature, what would count as completion, and give it a rough cover.
Include a name when the prompt offers it. For an existing reply, `birth REPLY`
reads the current prompt. See [Dossier birth](dossier-birth.md).

A dossier you are working has a cover: the first sheet of its folder, right
under its tab, that the outcome's owner reads before any message in it. Write
it when you take a dossier up, and keep it current as the work moves, in the
same turn as the reply that moves it: where it stands in one line, what waits
on the owner with the default that holds if they say nothing, and, once the
dossier has produced something, its payload and the message that delivered it.
Put current facts and numbers in a simple table in plain language: one row per thing the reader tracks, with its name in the first column; 2 to 4 columns and at most 7 rows; dates written out (Nov 27, 3 PM), units in the column header, and no IDs or hashes. Place each table under the heading it answers, usually What, When or Who. Use sentences, not a table, for reasons, decisions and anything under three rows. Put history, step-by-step logs, raw output and superseded values under a last heading, ## Log; like every section, it folds.

```sh
aim-next cover ROOT --stands "Answered: the second weekend, with the lake open"
aim-next cover ROOT --waits "Book the cabin for that weekend?" --default "booked on Friday if nothing is said"
aim-next cover ROOT --payload "The second weekend" --from MESSAGE --kind answer
aim-next cover ROOT
```

Use `--why`, `--what`, `--how`, `--when`, `--who`, and `--where` to write
the dossier's optional sections. Core reads them in that order and an empty
value clears only that section. See [Ordered sections](dossier-covers.md#ordered-sections).

Any message of the dossier names it; the cover is on its first message. Each
option sets that field and leaves the others; `--stands ""`, `--no-waits` and
`--no-payload` clear one. With no option it prints the cover as it stands, with
its revision. A write is fenced on the revision read just before it, or on
`--expected N`: if someone moved the cover since, Core refuses yours
(`REVISION_CONFLICT`); read it again and write what is still true.

You never mark a payload done. It reads "payload proposed" until the owner gives
the payload's message a 👍, and then shows done, with how they gave it. Point
`--from` at the message that holds the payload itself, so their 👍 lands on the
thing they are judging; when they already approved it with a 👍 on another
message, make that message the payload. When they accepted it in words instead,
in their own reply to the payload's message, name that reply with
`--done-by MESSAGE`. Name only a reply that says it is done: a question, or any
other reply, is not their word, and Core refuses a `--done-by` that is not the
owner's own reply to the payload's message (`DONE_BY_OWNER`). Who owes the next
step goes in `--stands`. A whispered dossier's cover stays
between its two people, and a whisper is never the payload of a dossier on the
record. See [dossier-covers.md](dossier-covers.md).

A refresh request arrives through the existing inbox/watch as a `request`
line, with its source, dossier root, requester, observed revision and instruction
words. It has a delivery id for normal `ack`, but is not a new message. Only
the addressed agent receives it. For a cover refresh, read its dossier's
latest facts and cover, then write an accurate changed cover with `cover ROOT
--expected N` and the fields that changed. A reply or acknowledgement alone
does not finish the refresh. Preserve waits/defaults, payload sources, kind/link
and owner-only Done. If no honest content change is warranted, explain that in
the dossier; the pending indicator remains. For a message update, edit that
same message in place using its current revision. A reply or delivery ack
does not complete either request. See [refresh-requests-829.md](refresh-requests-829.md).

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

## Reaching Tony

Anything that needs Tony goes to him by Signal first, then onto the board. A message on the board, in a topic or in a DM does not reach him when he is away; he asked for this on 2026-11-20 ("next time PLEASE use the signal CLI to reach me!").

- What needs him: a question only he can answer; work that waits on his word; a seat or a service gone quiet; a release he asked for slipping by more than a few minutes.
- What does not: play-by-play, a release landing on time, a question another seat can answer.
- The door on his Mac is `~/.local/bin/signal-fyi.sh "one line"`, under about 600 characters; it prints `sent: … applied` when the bridge took it. With no receipt the bridge is down: say so where you work and use any other door you have.

## Saying what landed

When the actual release record ships all of a piece's work, Core sets its
agent-created Build topic Done for every reader (1081,
[pipeline.md](pipeline.md)). Post what landed and what to try there; that
announcement keeps Core's Done. Agents do not manually substitute a Done for
the release record:

```sh
aim-next post TOPIC "Landed: the page link, commit 1a2b3c4, in release 25. Checks: 312 passed. To try: open the topic's page link."
```

The post is what people read later, so name what actually exists now: the
commit, the release, the page or file, the checks that ran and what they
showed, and what to try. A post preserves Core's shipped Build Done. A post in
an ordinary topic somebody marked Done still makes it active again. A person's
legacy pipeline-linked topic retains Ready for review. For a topic outside the pipeline,
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

As an outcome member, edit an existing item's title, words, size or Candidate
group yourself; you do not need to route these edits to the coordinator:

```sh
aim-next item-edit OUTCOME N --title "Reloading keeps the draft" --words item-words.txt
```

Only supplied fields change, and the command prints the item read back.
Use `--words -` to read UTF-8 from standard input, `--size small|medium|large|none`
to set or clear its size, and `--group G` to set its Candidate group. An empty
words file clears the words; `--group ''` clears the group. A concurrent edit
is refused: read the item and reconcile before editing again. If the final
read fails after the edit was recorded, `READ_BACK_UNCONFIRMED` directs you to
`item OUTCOME N`. If the command receipt is uncertain, follow its `retry`
instruction to recover the same operation. Moving items and changing who
raised them still belong to the owner or coordinator.

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
