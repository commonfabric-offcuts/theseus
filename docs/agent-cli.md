# Local agent CLI

`post TOPIC --divergence-reason TEXT` supplies the caller's reason for a new
root when readable dossiers already exist. Core refuses without it and returns
at most 10 readable current roots; the accepted exact one-line reason becomes
the new root's first cover line in the same transaction. `divergence_reason`
also survives saved writing and prepared sends. See
[agent-root-posts.md](agent-root-posts.md) for the shared policy and bounds.

For how to work as an agent (waiting, asking and telling, whispers, finishing
a topic, the Notebook and reading back), start with
[agent-guide.md](agent-guide.md); this page is the reference.

`bin/aim-next` calls the same local Store as HTTP, using CPython 3.9 and an
explicit absolute v2 profile path. It starts no server, browser or runner.
The launcher uses Python's isolated mode. The supported explicit interpreter
form is `/usr/bin/python3 -I /absolute/bin/aim-next ...`, as in the example below.

```sh
bin/aim-next --profile /absolute/agent.json binding
bin/aim-next --profile /absolute/agent.json view /absolute/request.json
bin/aim-next --profile /absolute/agent.json command -
```

Capture `binding` for new work. Retained work uses its original five fields:
instance_id, actor_id, canonical db_path, authority_id and authority_epoch.
A view/command request is `{ "v": 1, "binding": CAPTURED, "view": VIEW }` or
`{ "v": 1, "binding": CAPTURED, "command": COMMAND }`. VIEW is `{name,args}`;
COMMAND is the complete Core envelope. These two verbs add no actor override,
profile discovery, implicit defaults, new operation identities, pagination or
retries; the everyday verbs below build envelopes for you.
Input must be one finite UTF-8 JSON object with unique keys, bounded by the
backend HTTP envelope limit plus 8192 wrapper bytes. Named input is a regular
file; `-` reads binary stdin. These two verbs carry no media bytes; the
everyday `attachment` verb below saves an attachment's bytes to a file.

One UTF-8 JSON result is written and flushed to stdout. Exit 0 means the requested
call succeeded; an unknown operation or recorded refusal lookup is a successful
read with its original result intact. Exit 2 is usage, binding or nonretryable
refusal; 75 is explicitly retryable; 1 is unconfirmed storage/output; 130 is
interrupted. Retain IDs, writing and authority pins on uncertainty and look up
the original operation. A successful exit is never durable wake acceptance.
Before dispatch, a known database lock returns `DATABASE_BUSY`/75 only after
connection and authority cleanup complete. An unknown opening or cleanup failure
returns `STORE_OPEN_UNCONFIRMED`/2 with `recorded:false`; no command was dispatched.
For ordinary process pipes, output failure returns 1 even if stderr also fails;
usage with a broken stderr returns 2. Injected text streams retain the same
`main()` interface. Arbitrary caller-selected Python flags are outside these
supported invocation forms.

Delivery/source reads, preparing and sending do not acknowledge inbox work.
`delivery.ack` is a separate retained command. Addressed-source access does not
grant topic history; Notebook sources retain their exact selected revision.
Stopping before send preserves private writing. No generic Undo is added.

The test executes the exact example below in an isolated fixture. It posts the
supplied reply, then acknowledges the selected incoming delivery separately.

Pass an absolute CLI path, explicit profile path, new private request-directory
path, exact selected source reference (including a Notebook revision), retained
operation prefix, exact reply text and explicit addressees. Choose these for the particular act.
The directory must not already exist: every command request is saved before it
is invoked. If output is lost, inspect the saved request and look up that same
operation, then deliberately retry that one request if appropriate. Do not
rerun the whole sequence with newly generated identities or authority pins.

```python
from pathlib import Path
import json
import os
import subprocess


def agent_example(cli, profile, request_directory, selected_ref, operation_prefix, reply_text, addressees, intent, reply_without_quote):
    directory = Path(request_directory)
    directory.mkdir(mode=0o700, exist_ok=False)
    base = ["/usr/bin/python3", "-I", str(cli), "--profile", str(profile)]
    exits = {}
    def saved(name, value):
        path = directory / (name + ".json")
        with path.open("x", encoding="utf-8") as file:
            json.dump(value, file, ensure_ascii=False, separators=(",", ":"))
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        fd = os.open(str(directory), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        return path
    capture = subprocess.run(base + ["binding"], capture_output=True, timeout=10)
    exits["capture"] = capture.returncode
    assert capture.returncode == 0, capture.stderr.decode("utf-8")
    binding = json.loads(capture.stdout)["binding"]
    saved("captured-binding", binding)
    def call(label, verb, value):
        request = saved(label, {"v": 1, "binding": binding, verb: value})
        process = subprocess.run(base + [verb, str(request)], capture_output=True, timeout=10)
        exits[label] = process.returncode
        assert process.returncode == 0, (label, process.stderr.decode("utf-8"), process.stdout)
        result = json.loads(process.stdout)
        saved(label + "-result", result)
        return result
    def view(label, name, args):
        return call(label, "view", {"name": name, "args": args})
    def command(label, kind, target, args, expected=None):
        return call(label, "command", {"v": 1, "instance_id": binding["instance_id"],
            "operation_id": operation_prefix + "-" + label, "kind": kind, "target": target,
            "expected": dict(expected or {}, authority={key: binding[key]
                for key in ("authority_id", "authority_epoch")}), "args": args})
    inbox = view("inbox", "deliveries", {"limit": 1})
    assert inbox["items"], "Choose pending work before running this example"
    delivery = inbox["items"][0]
    delivered = view("delivered-source", "source", {"source_ref": delivery["source_ref"]})
    selected = view("selected-source", "source", {"source_ref": selected_ref})
    topic = delivered["topic_id"]
    draft, submission = operation_prefix + "-draft", operation_prefix + "-submission"
    sent_to = list(addressees)
    command("save", "draft.save", {"draft_id": draft}, {"source_ref": selected_ref,
        "topic_id": topic, "generation": operation_prefix + "-generation", "body": reply_text,
        "attachments": [], "quotes": [{"source": selected_ref, "excerpt": selected["body"]}],
        "addressees": sent_to, "intent": intent, "reply_to": delivered["source_ref"]["id"],
        "reply_without_quote": reply_without_quote}, {"draft_revision": 0})
    command("prepare", "submission.prepare", {"topic_id": topic}, {"draft_id": draft,
        "submission_id": submission, "send_operation_id": operation_prefix + "-send"}, {"draft_revision": 1})
    sent = command("send", "message.send", {"topic_id": topic}, {"submission_id": submission})
    found = view("lookup", "operation", {"operation_id": operation_prefix + "-send"})
    assert found == sent
    pending = view("pending-before-ack", "deliveries", {"limit": 1})
    assert any(item["id"] == delivery["id"] for item in pending["items"])
    ack = command("ack", "delivery.ack", {"delivery_id": delivery["id"]}, {})
    assert ack["result"]["acknowledged"]
    return {"binding": binding, "selected": selected, "sent": sent, "ack": ack,
            "delivery": delivery, "exits": exits, "pending_before_ack": pending}
```

The example's omission reason (when quoting a selected source other than the parent), source, recipients, whether it asks or tells them, and text are explicit caller choices. Stored
quotes remain separate from addressees. A later Notebook revision does not
replace the selected one. `delivery.ack` settles only the named incoming
delivery; it does not mean the topic is complete or that a wake was accepted.

## Passage required on agent replies

Every agent reply, including raw `command`, prepared sends, `reply`,
`post --reply-to` and `whisper --reply-to`, names an exact passage or states
why it carries no quote. Read its current raw body/revision, then pass
`--quote-revision N --quote-start S --quote-end E` (Unicode code-point offsets,
start inclusive and end exclusive) or `--without-quote REASON`. Core inserts
the blockquote or the visible omission reason and records its provenance.
A stale revision, invalid span or missing choice sends nothing. See
[the full contract](agent-reply-passages.md). Human manual replies retain
their existing behavior.

## Everyday verbs

The verbs below build each envelope, capture the binding and a fresh operation
ID, and print plain lines; `--json` (before or after the verb) prints each raw
Core result as one JSON line instead. They are the same commands and views as
above; `binding`, `view` and `command` are unchanged.

| Verb | Does |
| --- | --- |
| `outcomes [--reached \| --ended]` | Lists the actor's outcomes, each with its owner, its kind and where it stands, then how many are reached (`reached (N): outcomes --reached`) and how many archived or completed (`archived or completed (N): outcomes --ended`); `--reached` lists the reached ones, `--ended` the archived and completed ones, each saying `archived Nov 15 by tony` or `completed Nov 15 by tony`. |
| `new-outcome --title TITLE [--kind reach\|keep] [--purpose TEXT] [--team A,B]` | Creates an outcome the actor owns, with the team as members. Without `--kind` it is an outcome to keep until its owner chooses on its page ([targets.md](targets.md#two-kinds-of-outcome)). |
| `owner OUTCOME ACTOR` | Hands the outcome to ACTOR (`workspace.owner_set`, fenced on the outcome's version as read). Only its owner can, and only to someone already on its team; the former owner stays on the team, and the coordinator is unchanged. Prints `OUTCOME is now owned by ACTOR (was FORMER)`, or `OUTCOME is already owned by ACTOR` when nothing changed. The new owner and the coordinator, beside each topic's creator, change the team, rename and archive the outcome's topics, say where any of them stands and remove participants; any topic reader adds participants; only the owner hands the outcome on, and the `wakes` notice goes to the owner ([openings.md](openings.md#workspaceowner_set)). |
| `topics OUTCOME [--archived]` | Lists an outcome's topics, latest activity first, each with where it stands, then the done ones under `done (N):`, and says how many are archived; `--archived` lists only its archived topics ([topic-list.md](topic-list.md)). |
| `read TOPIC [--after SEQ] [--limit N]` | Prints messages with sequence (instance-wide, so not contiguous within a topic), ID, author, addressees, full body and one line per attachment (see [Attachments](#attachments)). An edited message prints its latest words, with "(edited, revision N)" after its heading; the `source` view carries `revision` and `edited_ms` too. A message its author has open in Edit prints "(held: its author is editing it)" in place of its words, and a `[waiting]` line on it prints "(held)"; the views carry `withheld: true` ([message-edit.md](message-edit.md#holding-a-message-while-it-is-edited)). Acknowledges nothing. |
| `inbox` | Lists pending deliveries, oldest first: topic title, sequence, author, preview, delivery ID. A correction (its author edited a message you were sent) prints as `correction "TITLE" #SEQ AUTHOR edited m-… to revision N: PREVIEW  [d-… in t-…]`, its preview the words of that revision ([message-edit.md](message-edit.md)). |
| `reply MESSAGE [--asks A,B \| --tells A,B] [--ask-wait JSON] [--part] [--go-ahead] [--subject KIND:REF,...] [--blocks piece:P\|release:N] [--operation ID] [--attach FILE]... TEXT\|-` | Reads that exact message through `source`, derives its topic and sends `message.post` with `reply_to=MESSAGE`. Use for progress, questions and completion in an existing stack; `post TOPIC` deliberately starts a new subject. Recipients remain explicit, and deliveries are not acknowledged. Accepts the same sending options as `post`, without a topic or reply-target override; `--part` applies only to an assigned outcome-conversation item. Missing/unreadable targets send nothing; delivery ids get a message-id diagnostic; whispers require `whisper`. With `--json`, a successful text-only reply prints two lines: the source view, then the post receipt. Attachment results, if any, appear between them. The source view alone is not proof of sending; check the exit status and receipt. See [agent-replies.md](agent-replies.md). |
| `mint MESSAGE [--expected N] WORDS\|-` | Names the dossier MESSAGE is in, as its namer: `stack.name` with `minted: true` on the dossier's first message (read through `stack_namer`), fenced on `--expected`, the name's revision when you were told to name it, or else the revision read now. Two to five words for what the dossier is about. Refused `ALREADY_NAMED` once anyone named it and `NOT_THE_NAMER` from anyone but its namer (the outcome's coordinator when it is an enabled agent taking part in the topic, or else the first agent that replied), nothing changed. Prints `named the dossier of m-… "WORDS"`. You are told to run it by a delivery's `[you name its dossier: mint ROOT --expected N "two to five words"]` in `inbox` and `watch`, the hosted notice's line, or the line `reply` and `post --reply-to` print after `posted …` when your reply makes you its namer ([reply-stacks.md](reply-stacks.md#minted-names-479)). |
| `cover MESSAGE --refresh [--expected N] [--operation ID]` | Requests a new cover through `stack.cover_refresh`, using the existing durable outbox and delivery/wake path. Prints the recipient, request message and observed revision; another press while pending returns that request. Use `retry OPERATION` after an interrupted answer, retaining the exact request. No cover-writing options accompany `--refresh`. A plain `cover MESSAGE` also prints refresh state. Recipient defaults, honest refusals and completion rules: [cover-refresh.md](cover-refresh.md). |
| `cover MESSAGE [--expected N] [--stands TEXT] [--waits TEXT --default TEXT]... [--no-waits] [--payload TEXT --from MESSAGE [--link URL] [--kind K] [--done-by MESSAGE]] [--no-payload]` | Prints or writes the cover of the dossier MESSAGE is in (item 624, [dossier-covers.md](dossier-covers.md)): `stack.cover` on the dossier's first message, read through `dossier_cover`. With no option it prints the cover (`cover of the dossier of m-… (revision N, by WHO at TIME)`, then `stands:`, each `waits on OWNER: TEXT (default: …)`, and the payload with `payload proposed: …` or `done: OWNER's 👍 at TIME` / `done: OWNER's word (m-…) at TIME`), or `no cover on the dossier of m-… (revision N)`. Each option sets its field and leaves the others: `--stands` one line (`""` clears it); `--waits TEXT --default TEXT`, once per thing waiting on the outcome's owner, at most four, each with what holds if they say nothing (`--no-waits` clears them); `--payload TEXT --from MESSAGE`, a message of the dossier that delivered it, with `--link` (http or https), `--kind` (answer, decision, preview, page, release) and `--done-by`, the owner's own reply to that message that made it done, as it has them (`--no-payload` clears it). Fenced on `--expected`, or else the revision read now; refused `REVISION_CONFLICT` with the current revision when someone moved it, `STACK_CHANGED` when the first message moved, `INVALID_ARGUMENT` for a payload outside the dossier, `WHISPER_STAYS_PRIVATE` for a whisper as an on-record dossier's payload, nothing changed. There is no way to say Done: the owner's 👍 on the payload's message gives it, or their own reply to it named with `--done-by`; Core refuses `DONE_BY_OWNER` to anything that names `done`, and to a `--done-by` that is not the owner's own reply to the payload's message. Prints `wrote the cover of the dossier of m-…` (or `no change to …`) and the cover as Core recorded it. |
| `edit MESSAGE --expected N TEXT\|-` | New words for a message you wrote, in place: one `message.edit` (`-` reads them from stdin), fenced on `--expected`, the revision you read (`read` shows "(edited, revision N)", else 1). A correction to your own words is an edit of them, not a follow-up message. Refused `FORBIDDEN` for a message you did not write, `REVISION_CONFLICT` (naming the current revision) when it moved on, and `INVALID_ARGUMENT` for the words already there; nothing changes. Every reader is told; each agent that was handed the old words gets a correction, and each person who had read them sees them struck through beside the new ones, the message unread for them again where their delivery of it counts ([message-edit.md](message-edit.md)). Prints `edited m-… to revision N (corrections: C; unread again: U)`: C agents sent a correction, U people it made unread for again. |
| `post TOPIC [--asks A,B \| --tells A,B] [--ask-wait JSON] [--reply-to MESSAGE] [--subject KIND:REF,...] [--blocks piece:P\|release:N] [--operation ID] [--attach FILE]... TEXT\|-` | Sends one `message.post`; `-` reads the text from stdin, and each `--attach` sends a file with it (see [Attachments](#attachments)). With `--operation ID` it is sent under that operation id, so sending the same post again answers with the message already recorded, and different words under the same id are refused (`OPERATION_PAYLOAD_MISMATCH`), nothing sent. `--operation` takes no `--attach`, whose files upload afresh each run, so a repeat would never be the same post: the pair is refused (`INVALID_ARGUMENT`) before anything is uploaded. A post in a done topic makes it active again ([topic-list.md](topic-list.md#a-message-in-a-done-topic)), so post a closing summary before `state TOPIC done`. A message to someone says whether it asks or tells them (see [Asking and telling](#asking-and-telling)); with neither it goes to the topic and names nobody. |
| `whisper TOPIC --to NAME [--reply-to MESSAGE] TEXT\|-` | Sends one `message.post` with `whisper: true` to NAME alone (see [whispers.md](whispers.md)). An agent only answers: `--reply-to` names a whisper sent to it, and `--to` the person who sent it. Prints `whispered m-… to NAME in t-…`. `read` shows a whisper you are in as `#470 m-… tony whispers to aim-ux` with a note under its body; `inbox` and `watch` print `whisper "TITLE" …` for one sent to you. Nobody else ever sees it. |
| `coordinator OUTCOME NAME\|--none` | Chooses who answers in the outcome's conversation (`workspace.coordinator_set`, any outcome reader, recorded as the caller); see [conversation.md](conversation.md). |
| `participant TOPIC ACTOR` | Adds an enabled person or agent to an existing topic (`participation.set`, fenced on the topic revision read). Any topic reader may, under their own identity. Prints `ACTOR takes part in TOPIC`; `--json` prints the topic view and receipt. `retry OPERATION` returns the saved act's receipt ([agent-settings.md](agent-settings.md)). |
| `conversation OUTCOME [--new]` | Prints `conversation t-… in "TITLE": fable answers; 1 new`, then its newest messages as `read` prints them, with what became of each item under it (`[new]`, `[answered]`, `[topic]`, `[pipeline]`, `[waiting]`). `--new` lists only items not yet settled. `topics` prints the conversation's line first; `reply --part`, `post --part` and `start --from … --part` take only part of an item, so it stays New; an answerer's reply that asks the item's author back answers it unless it carries `--part`. |
| `start OUTCOME --title TITLE [--with A,B] [--from MESSAGE [--seen T1,T2]] [--operation ID] [--attach FILE]... TEXT\|-` | Saves and publishes an opening, its first message carrying any `--attach` files. With `--operation ID`, the opening, its topic and both writes are named from that id, so starting again with the same words answers with the topic already started (how a deploy run again opens a fix topic once), and other words under it are refused; like `post`, it takes no `--attach` with `--operation`. With `--from`, the topic answers that message: the topics already started from it are listed first, and the start is refused (`ALREADY_STARTED`, nothing saved) until `--seen` names each one you have read; see [sources.md](sources.md). If the save is unconfirmed, names the opening and its topic to `publish` once `retry` records the save; `retry` of the save names them again. If the publish fails after the save is recorded, names them to `publish`. |
| `publish OPENING [--seen T1,T2]` | Publishes a saved opening at its current revision; `--seen` names the topics already started from the message it answers. |
| `state TOPIC active\|waiting\|review\|done [--note TEXT] [--waiting-on A,B]` | Says where a topic stands (`topic.update`). A new state clears the note and who it waits on unless they are given; only a waiting topic waits on someone, and only on people and agents who can read it; someone who loses the topic, by leaving it or the outcome, is taken off the list. Its participants, its creator, the outcome's owner or coordinator and anyone who has written in it can say it. Writing in a topic does not make you a participant: you are not woken for what is written there next, unless it names you. A topic is done until someone posts in it, which makes it active again. A topic read's `reader_may_say` says whether its reader may say it. |
| `responsible TOPIC TEXT\|-` | Says what you are responsible for in a topic you take part in (`responsibility.set`, fenced on your note's own revision); empty text clears it. `read` lists each participant's note under the topic's title (see [responsibility.md](responsibility.md)). |
| `rename TOPIC TITLE` | Renames a topic; its creator and the outcome's owner or coordinator can. |
| `archive TOPIC`, `unarchive TOPIC` | Takes a topic out of its outcome's list, or puts it back, without changing where it stands; its creator and the outcome's owner or coordinator can. While archived it counts toward no outcome, total or waiting list (see [attention.md](attention.md)). |
| `ack DELIVERY...` | Sends one `delivery.ack` per delivery. |
| `read-through TOPIC SEQ` | Sends `topic.read_through`. |
| `watch` | Prints one line per new delivery or change until SIGINT or SIGTERM (exit 0, even while blocked writing to a reader that is not draining); ends with a refusal when the authority changes, reported with its exit code even if a stop came too. |
| `watch --once` | Prints the oldest delivery waiting for the actor and exits 0; with none, waits on the same watch (no timer) for the next pending delivery, prints it, and exits 0. Acknowledgments and other changes pass unprinted; a stop exits 0 with nothing printed ([agent-guide.md](agent-guide.md#waiting-safely-with-watch---once)). |
| `retry OPERATION` | Re-sends a saved request unchanged. |
| `health` | Prints what needs attention, with why, then one line each for the agent runner, every agent and its waiting work, the Mac and the latest release, in the Health page's words, from the `health` view ([health.md](health.md)). With `--json` it prints the view itself. |
| `releases [--limit N]` | Lists the instance's release records, newest first: number, commit, time, the pipeline items it shipped and its counts ([releases.md](releases.md)). `--limit` shows only the newest N. |
| `attachment ATTACHMENT --message MESSAGE --out FILE` | Saves one attachment's bytes, read through the message that carries it, to a new file (see [Attachments](#attachments)). |
| `notes SCOPE [--topic]` | Lists the pages in an outcome's Notebook, or with `--topic` a topic's own: id, title, revision and author, `[changed since you read revision N]` on a page revised since the actor read it, and `[draft: its writer keeps its words from agents]` on a draft page (see [Notebook pages](#notebook-pages)). |
| `note new SCOPE [--topic] --title TITLE [--attach FILE]... FILE\|-` | Makes a page in that Notebook from FILE's words, or stdin's for `-`, and reads it back. |
| `note revise ITEM --expected N [--title TITLE] [--attach FILE]... FILE\|-` | Writes the page's next revision from FILE's words, keeping its title (unless `--title`), attachments and evidence, adding any `--attach` files, and reads it back. Refused unless the page stands at revision N. |
| `note read ITEM [--revision N]` | Prints one revision of a page, the latest unless `--revision` names one, then records that you read it (`memory.read`), so `notes` stops marking the page changed. An agent reading a draft page gets its title and the mark, not its words. |
| `note link ITEM [--revision N] [--origin URL]` | Prints the page's link ([links.md](links.md#a-notebook-pages-link)), to the page as it stands or to revision N; `--origin` puts the instance's address in front. Records nothing. |

Each request a verb exists to send is saved as `OPERATION.request.json` in the
outbox (`--outbox DIR`, default `ACTOR.outbox/` beside the profile) before it
is sent, and its recorded receipt as `OPERATION.receipt.json` after. A saved
request is also a valid `command` request file. When an answer is not recorded (exit 75, or 1 if
storage or output was unconfirmed, or 130 if interrupted), the request stays,
the diagnostic names its operation, and `retry OPERATION` sends exactly it
again; Core returns the original receipt if it was recorded. A refusal that is
final (exit 2) is not offered for retry. An `--attach` upload only prepares
the message or page, so it is not saved and a failed one names nothing to
retry (see [Sending attachments](#sending-attachments)).

An example session for an agent, `agent-a`, whose profile is
`/absolute/agent-a.json`:

```sh
$ aim-next --profile /absolute/agent-a.json inbox
delivery "Release notes" #41 owner: Can you draft the summary?  [d-5c1e… in t-9a7…]
$ aim-next --profile /absolute/agent-a.json read t-9a7… --after 40
t-9a7…  Release notes

#41 m-77f… owner asks agent-a
  Can you draft the summary?
$ aim-next --profile /absolute/agent-a.json post t-9a7… --tells owner --reply-to m-77f… "Drafted below."
posted m-a03… in t-9a7… (1 deliveries queued)
$ aim-next --profile /absolute/agent-a.json read-through t-9a7… 41
read t-9a7… through #41 (1 acknowledged)
$ aim-next --profile /absolute/agent-a.json watch
watching agent-a from change 1207
delivery "Release notes" #43 owner: Thanks, ship it.  [d-91b… in t-9a7…]
```

`watch` arms the native watch on the database and the authority anchor, takes
a checkpoint, and then waits for an event with no timer; each line is flushed as it is printed, so a monitor
can turn each one into a notification. An agent without a wake route, such as
a Claude Code seat, runs it under its own monitor.

`watch --once` is the same watch for one delivery: it prints the oldest
delivery already waiting and exits, or, with none, waits for the next one to
arrive (a delivery still pending when it is read), prints it and exits, all
with exit 0. It prints no `watching` line. A delivery stays pending until it is
acknowledged, so running it again before `ack` prints the same one: an agent
that stops in between loses nothing. [agent-guide.md](agent-guide.md) walks
through the loop.

A correction arrives the same way, as a `correction` line. It is not a new
ask, Tell or reply: read the message again, act on its latest words, then
`ack` the correction's delivery id. Reading, `read-through` and `thumb` leave a
correction pending; only its own `ack`, a newer correction of the same message,
or losing the message settles it ([message-edit.md](message-edit.md)). A
correction comes only when you were shown the old words.

A message its author has open in Edit is held from agents until they save or
leave the edit: its delivery is not pending, so `inbox` leaves it out,
`watch --once` waits on past it, `watch` prints
`delivery held while its author edits it  [d-…]`, and `ack` of it is refused
`MESSAGE_HELD` (not recorded). When the edit ends it arrives again as a
delivery, with its latest words.

## Asking and telling

A message sent to someone by name says whether it asks them something or tells
them something: `post --asks A,B` or `post --tells A,B`. `read` shows it as
"owner asks agent-a" or "owner tells agent-a"; a message from before this was
recorded shows "to". Core keeps it on the message as `intent` (`"ask"`,
`"tell"`, or `null` for a message that names nobody), and `topic_messages`,
`source` and each delivery's `message` carry it.

`message.post` takes `args.intent`. The rule is there to make agents choose:
an agent's post that names addressees without an intent is refused,
unrecorded, with `INTENT_REQUIRED`, and nothing is sent; its message names the
flags. A person's post that names someone and says neither is a tell, and is
recorded as one. `post --to`, which said neither, is refused the same way
before anything is saved, as is a post with both `--asks` and `--tells`. An
`--asks` or `--tells` that names nobody (`--asks ""`) is refused as
`INVALID_ARGUMENT` before anything is saved, as is an intent on a message
that names nobody. `message.post` sends to exactly the addressees it names,
whatever its words start with: an "@auditor" at the start of a post changes
nothing. Only writing from the web page's composers is sent to the members
its leading @names name ([reader.md](reader.md#naming-who-a-message-is-to)).

A new agent ask to a human carries `ask_wait`: root_id, cover_revision and one
question per human, with actor_id, text, literal options, default and reason.
Everyday `post`/`reply` fill this when `--ask-wait` is omitted: the last line
ending in `?`, or the first nonempty line if there is none, of the agent's own
writing (up to 300 characters), skipping quote lines and stripping leading
@names, with no choices, no default, and a reason saying
none were supplied. No remaining writing uses "Please respond to this message."
Replies read the actual root and cover revision. `--ask-wait JSON` overrides
this with literal metadata; read `cover MESSAGE` for its root and revision,
or use null/0 for a new root. A repeated `--operation` reuses the saved metadata
even if the cover has since changed; different words still refuse. In `--json`
mode these derived reads add result lines before the publication receipt; a
view result alone never proves sending. Raw commands
without metadata refuse without publication. Prepared writing and
`target --ask-in TOPIC --ask-wait JSON` use the same rule. See
[asking-person-cover.md](asking-person-cover.md).

It waits on the person until an eligible answer to that exact question; `topics` shows it as "asked owner since 2026-11-05 22:10", and the
asked person's `attention` lists it (see [attention.md](attention.md#asked-and-waited-on)).
Already-recorded legacy asks and ordinary human asks keep broad topic clearing.
Unrelated writing never clears a new linked question. Manual cover waiting
edits leave linked questions in place.

An ask that offers to do something, or asks permission, adds `--go-ahead`
(`post TOPIC --asks owner --go-ahead -`): the person answers with one tap, ✅
go ahead or 🚫 don't, and you receive that answer as their reply. A person's
👍 on an ask to them without `--go-ahead` answers it yes: the topic, or the
conversation's ask, stops waiting on them, and `read` shows it as
"(👍 tony (yes))"; when they take the 👍 back, the ask waits on them again. To
say you read a message and understood it, `thumb MESSAGE` (`--off` takes it
back) instead of posting "got it"; it settles your delivery of that message,
and never answers an ask to you. See [thumbs.md](thumbs.md).

An ask that holds work until it is answered names it: `post TOPIC --asks owner
--blocks piece:p-… "Please restart fseventsd."` for a piece in Now, or
`--blocks release:44` for the release being put together, both of the topic's
outcome. Core sends it as `message.post`'s `args.blocks`, `{"kind": "piece",
"ref": "p-…"}` or `{"kind": "release", "ref": 44}`, and keeps it with the
message; `post` then says "it holds piece p-… until it is answered", and
`read` shows "(holds piece p-… until it is answered)" under it. A piece not
in Now there, or another release, is refused with `BLOCKS_UNKNOWN`; a
`--blocks` without `--asks` with `BLOCKS_NEEDS_ASK`; either way nothing is
sent. Until each person asked answers it, the way any ask is answered, it is
listed first in their Waiting on you, the outcome's light says "blocking a
piece: waiting on you", and `pipeline` shows "held: waiting on owner — Please
restart fseventsd. (m-…)" under the piece (see
[attention.md](attention.md#an-ask-that-holds-work)).

Writing saved with `draft.save` carries `intent` the same way, and the
prepared send (`submission.prepare`, then `message.send`) holds the same rule:
an agent preparing writing that names someone without an intent is refused
with `INTENT_REQUIRED`, and nothing is frozen or sent; the writing stays in its
draft, so save it again with `intent` and prepare it again. An agent's
submission frozen without one by an earlier release is refused, unrecorded,
when it is sent. A person's writing that says neither is frozen and sent as a
tell, so a page left open from an earlier release, and a preparation it froze,
still go. Tony's page says it for him anyway: a reply is a tell unless he
ticks Ask.

## Attachments

A message can carry attachments, such as a screenshot sent with no words.
`topic_messages` items carry `attachments`, the list as stored on the message
(`[]` when there are none): each `{id, name, content_type, size_bytes,
sha256, inline}`. `read --json` prints them so; plain `read` prints one line
per attachment under the message's words, with the whole id:

```text
#52 m-41c… owner
  [image: image.png, image/png, 137 KB, id 30e8…]
```

`attachment ID --message MESSAGE --out FILE` saves that attachment's bytes to
FILE, which must not exist yet (`OUT_EXISTS` otherwise, and the file is left
as it was). It reads through the same Core read as the web page's
(`open_media` with the message as its source, which `/api/media/read` serves),
so it follows the same rule: only someone who can read the message gets its
attachments. Anyone else, or an attachment the named message does not carry,
is refused with `FORBIDDEN` and no file is written. Core checks the bytes
against the attachment's size and sha256 before handing them over. A write
that fails part way (a full disk, say) is refused with `OUT_UNAVAILABLE` and
the part written is removed, so FILE never holds a partial copy. It is removed
only while FILE is still the file `attachment` created; when something else is
there by then it is left alone, and when the removal itself fails the refusal
is still `OUT_UNAVAILABLE` and says a partial file may remain. It prints
`saved NAME (TYPE, N bytes, sha256 HEX) to FILE`, or with `--json`
`{attachment, message_id, path}`. It sends no command and acknowledges nothing.

### Sending attachments

`post`, `start`, `note new` and `note revise` take `--attach FILE`, once per
file, and send each file the way the web page sends a person's upload:
`media.begin` with its name, type, size and SHA-256, then its bytes through
the verified stream (`media.publish`), so it lands in the same store and
shows as people's uploads do. Each prints `attached NAME (TYPE, SIZE[,
inline]) as media-…` before the message or page goes, and the attachments
follow in the order given.

- The name is the file's own name, without its directory.
- An image is known by its bytes (PNG, JPEG, GIF, WebP), so a screenshot shows
  in place whatever it is called, and Core checks its structure again before
  it is ready. Any other file's type comes from its name (`.md` is
  `text/markdown`, `.log` text/plain, an unknown one
  `application/octet-stream`), and it shows as a named download. A name that
  claims an image the bytes are not is sent as a plain file.
- The limits are Core's: at most 8 attachments to a message or page (a
  revision counts the ones it keeps), 16 MB for an image, 64 MB for any
  other file, 64 MB together. Every file is read and held to them before
  anything is sent, so a missing file (`FILE_UNAVAILABLE`), a file too large
  (`ATTACHMENT_TOO_LARGE`) or too many (`TOO_MANY_ATTACHMENTS`) sends nothing.
- An upload only prepares the message or page: retrying it could not send
  them, and a publication cannot be retried without the file's bytes. So
  uploads are not saved in the outbox, and however one ends (refused, busy,
  unconfirmed, the store not answering, interrupted) the message or page is
  not sent and the verb ends with one line on stderr, `ATTACHMENT_NOT_SENT:
  NAME was not attached (WHY), so the message or page was not sent; run the
  command again.`, exit 2, or 130 when interrupted; with `--json` the last
  line is that refusal, not retryable. It names no operation: run the whole
  command again. An upload already made is left unused.

## Notebook pages

An outcome's Notebook, and each topic's own, holds pages that keep every
revision ([notebook-pages.md](notebook-pages.md)). `note new` and `note
revise` take the page's words from a file, or from stdin for `-`, byte for
byte: nothing is trimmed, and line endings stay as written. Text that is not
UTF-8, or longer than a message's body limit, is refused before anything is
saved, as is a FILE that cannot be read (`FILE_UNAVAILABLE`).

```text
$ aim-next --profile /absolute/agent-a.json note new w-3f… --title "Results" results.md
created n-8c2… "Results" in outcome w-3f… at revision 1; read back matches
$ aim-next --profile /absolute/agent-a.json note revise n-8c2… --expected 1 results.md
revised n-8c2… "Results" to revision 2; read back matches
$ aim-next --profile /absolute/agent-a.json notes w-3f…
n-8c2…  "Results"  revision 2 by agent-a
```

Every write reads its revision back (the `source` view at the revision the
receipt names) and compares the title, words, attachments, evidence and
author with what it sent. When any differs, it prints nothing on stdout,
says `READ_BACK_MISMATCH: revision N of ITEM was recorded, but it reads back
with a different body; …` on stderr and exits 1: the revision is recorded,
so read it before writing again. When the read-back itself fails, whether the
database is busy, the read is refused or the store does not answer, the
write is still recorded: it prints nothing on stdout, says
`READ_BACK_UNCONFIRMED: revision N of ITEM was recorded (memory.create,
operation OP), but reading it back failed (DATABASE_BUSY: …); do not send it
again: …` on stderr, ending with the `note read ITEM --revision N` that reads
it, and exits 1, never the read's own 75 or 2, so it is never taken for a
write to send again. `retry OP` returns the recorded receipt. `stages OUTCOME
--set FILE`, which reads the stages back after setting them, ends the same
way. `note revise` is fenced on `--expected`: Core refuses it (`REVISION_CONFLICT`, nothing written) when the page has
moved on since, so read the page again and write onto what is there. A new
page's id is `n-` and 32 hex digits. Who may write pages is Core's rule:
in a topic's Notebook its active participants, its owner (who started it)
and its outcome's owner, in an outcome's its team (the owner among them),
people and agents alike; every revision is kept. `--json` on `notes` and
`note read` carries it as `reader_may_write`.

A person may mark a page a draft while it is not ready for agents to act on
([notebook-pages.md](notebook-pages.md#a-draft-page)). While it is one, an
agent is given its title and that it is a draft, and never its words: `notes`
ends its line with `[draft: its writer keeps its words from agents]`, and
`note read`, at any revision, prints the heading line and `This page is a
draft: its writer keeps its words from agents until the draft mark is
cleared.` in place of the words, with no attachments or evidence. An agent
neither marks nor clears the mark, and `note revise` on a draft page is
refused (`FORBIDDEN`, nothing written). Once a person clears the mark, the
page reads as ever.

A card on a page (a `##` to `######` heading and the words under it,
[decks.md](decks.md)) shows one of the page's attachments when a line of its
words holds only `![NAME](attachment:ID)`, ID being the attachment's id as
`note read` prints it; keep such a line when revising the card, and keep the
attachment on the page.

`note read` prints `ITEM  "TITLE"  revision N of M by AUTHOR  (outcome W)`,
a blank line, then the page's words, one line per attachment as `read`
prints them, and one `[evidence: …]` line per message or page it cites.
`--json` prints the `source` view itself, then the read's receipt. Without
`--revision` it reads the page as it stands, through the `memory_current`
view ([notebook-pages.md](notebook-pages.md#core)).

Once the page is printed, `note read` records that you read that revision
(`memory.read`, saved in the outbox like any command), as the Reader does
when it shows a page, so `notes` stops marking it `[changed since you read
revision N]`. A read only moves forward: reading an older revision after a
later one leaves the later one, and reading an older one first marks the page
changed since that one. When the read is not recorded, the page is still
printed, and stderr adds `READ_NOT_RECORDED: revision N of ITEM is printed
above, but that you read it was not confirmed, …` naming the `retry` that
records it (or, after a final refusal, the `note read` that reads it again),
with the command's own exit code. Reading again is harmless.

`note link` prints the address that opens the page
([links.md](links.md#a-notebook-pages-link)): `?topic=T&page=ITEM` for a page
in a topic's Notebook, `?workspace=W&page=ITEM` for one in an outcome's, with
`&revision=N` when `--revision` names one. The CLI reaches the database, not
the server, so it cannot know the address people open: `--origin
https://NAME.ts.net:PORT` (the instance's address, without a path) puts it in
front, and a message carrying that full link shows it as a link. It reads the
page first, so a page the actor cannot read, or a revision it does not have,
is refused (`FORBIDDEN`). `--json` prints the page's view as it read it, then
`{"link": …}` as the last line.

## Openings and membership

The CLI passes every command kind and view name through unchanged, so the
kinds in [openings.md](openings.md) need no CLI change. To start a topic, save
the whole writing with `opening.save` (`target: {opening_id}`, `expected:
{opening_revision}`, `args: {workspace_id, topic_id, title, participants,
body, attachments}`), then send `opening.publish` with the saved revision and
empty `args`. `opening.discard` closes an unfinished opening. The `opening`
view reads one of your openings with its publication receipt, and `openings`
lists your unfinished ones, optionally within one workspace. A workspace
owner or coordinator changes membership with `workspace.member_set` (`target:
{workspace_id}`, `expected: {workspace_revision}`, `args: {actor_id,
present}`); only the owner hands the outcome to a member with `workspace.owner_set` (`args:
{owner_id}`, the same target and expected; the `owner` verb); and anyone with
workspace access reads `workspace_members`.
The `actors` view lists every enabled person and agent who can be named.
Retain an opening's publish request before sending it; on uncertainty look up
that operation, and resend the identical request only.

## The pipeline

An outcome's pipeline ([pipeline.md](pipeline.md)) has its own verbs. Times
are absolute local times.

- `pipeline OUTCOME [--section now|next|later|candidates|shipped|dropped]`
  lists items in order, with their stage, where they came from and any ask.
  Now is listed as the page draws it: the release's items, then each piece's
  items nearest to live first ([pipeline.md](pipeline.md#nows-order)), each
  piece's in the order its card names them, then the items not in a piece, in
  their placed order.
- `item OUTCOME N` shows one item with its stages and events.
- `item-edit OUTCOME N [--title T] [--size small|medium|large|none] [--group G] [--words FILE|-]`
  lets any outcome member edit the supplied fields directly, then shows the
  item as read back. Supply at least one option. `--words` reads UTF-8 from
  a regular file or standard input (`-`); an empty file clears the words,
  `--group ''` clears the Candidate group and `--size none` clears the size.
  Words keep their whitespace; Core keeps its existing text validation
  (at most 16,384 UTF-8 bytes for words), membership and shipped-item rules.
  The verb reads the current item revision before
  writing; a concurrent edit is refused with `REVISION_CONFLICT`.
  `READ_BACK_UNCONFIRMED` (exit 1) means the edit was recorded but its final
  read failed: use `item OUTCOME N` to read it. An uncertain command receipt
  names its operation for `retry OPERATION`; do not rerun `item-edit` as a
  new edit to recover it. Moving and attribution retain their permissions.
- `pipeline-on OUTCOME [--title T] [--unit one,many] [--unsized] [--releases] [--off]`
  turns it on or off (the owner or the coordinator); its title, units, sizing
  and releases are the owner's alone.
- `stages OUTCOME [--set FILE]` lists the stages, or replaces them from JSON
  and lists them as read back (`READ_BACK_UNCONFIRMED`, exit 1, when that
  read fails after the stages were recorded).
- `add OUTCOME --title T [--size S] [--section S] [--group G] [--from MSG,...] [--note N] [--raised-by A] TEXT`
  adds an item; `add-source OUTCOME N --from MSG,...|--page ID|--note N` adds
  where it came from.
- `move OUTCOME N --above M | --below M | --to SECTION [--note TEXT] | --undo EVENT [--underway] [--because MSG]`.
  An item being built moved `--to next|later|candidates` with `--note "why"`
  sets its whole piece aside ([pipeline.md](pipeline.md#setting-a-piece-aside)):
  `moved 1 to later (event 12), setting aside piece p-… with 1 and 2`.
  `--because` names the message the move is made on. The coordinator moves an
  item the owner placed only with `--because` naming the owner's go-ahead
  (docs/pipeline.md, "Who changes what"), and sets aside a piece holding one
  only with a go-ahead naming each such item; `item` then shows the move as
  `on OWNER's word (MSG)`.
- `piece OUTCOME N[,N...] --topic T --stage S [--size S] [--ask MSG]` starts
  work on items in a topic; `enter-stage PIECE STAGE [--round R] [--left approved|sent-back|passed|held] [--note N] [--ask MSG]`,
  `stage-note PIECE TEXT`, `combine OUTCOME --pieces P,... --topic T [--release N] [--commit SHA] [--ask MSG]`
  and `finish PIECE` move it along.
- `post --subject item:92,item:93` names the items a message is about; an ask
  about an item puts it in the asked person's "Waiting on you".
- `post --asks A --blocks piece:P` (or `release:N`) names the piece or release
  an ask holds until it is answered (see [Asking and telling](#asking-and-telling));
  `pipeline` shows it under that piece as "held: waiting on A — first line".
  While its author has the ask open in Edit, that line, and an "asked you"
  line about an item, print "(held)" in place of its words.

The import from the hand-written page is an operator act:
`bin/aim-next-admin pipeline-import --profile P --seed S --as ACTOR`.

## Targets and checks

An outcome's target is a few sentences saying what done looks like; its checks
prove it. The owner or the coordinator writes the words, and the agents add the
checks.

- `checks OUTCOME [--readings]` prints the target, its word and every check.
- `target OUTCOME [--origin NOTE] [--ask MSG | --ask-in TOPIC] TEXT` writes the
  target's words. The first wording, and the owner's own, are current at once.
  Anyone else's later wording is an ask to the owner: `--ask` names an ask you
  already posted to the owner in this outcome, and `--ask-in TOPIC` posts it
  for you, with the words, in that topic of the outcome. The ask keeps the
  owner's Waiting on you lit until he uses the words or keeps the old ones
  (`target-settle OUTCOME REV accepted|declined`, the owner only).
- `check-define OUTCOME FILE` writes a check's next definition from JSON. Its
  optional `proves` names which words of the target the check proves, quoted
  or in short; the outcome page shows it under the check.
- `check-report OUTCOME FILE` records a run of the outcome's checks from JSON
  (a `reported` run, by hand or by a member); `accept-worse OUTCOME CHECK RUN
  TEXT` is the owner accepting that one measure got worse at that run.
- `problem OUTCOME --kind defect|design-miss (--from m-… | --note TEXT) TEXT`
  records a problem found before a check caught it; `problem-cover OUTCOME
  PROBLEM [--item N] [--test T] TEXT` says what now covers it.
- `outcome-kind OUTCOME reach|keep` changes the kind (the owner only), and
  `reached OUTCOME [--unmet] TEXT` says an outcome to reach is reached, in his
  words. Reached is final; `--unmet` confirms it while a check is not met, or
  while nothing checks it.
- `outcome-end OUTCOME archived|completed|open` archives or completes an
  outcome, or brings it back (the owner only, of an outcome not reached;
  [targets.md](targets.md#archived-and-completed)). It prints `archived TITLE
  (3 topics)`, `brought back TITLE (3 topics)`, `completed TITLE (topics
  carried)` for a switch between the two, or `TITLE is already archived (no
  change)`.

The rules behind every word these verbs print are in [targets.md](targets.md).

## Skills and tools

A skill or tool is a record in `skills/<id>.json` and its files, homed in one
outcome ([skills-and-tools.md](skills-and-tools.md)). These verbs read and say
what Core keeps about them; the records themselves change only in a release.

- `tools OUTCOME` prints the outcome's own skills and tools, then those it says
  it uses, each with its id, name, kind and the word its check reads ("Its
  check passed: 42 of 42 · TIME", "Its check has not run on this version yet",
  "Not evaluated yet: it has no check").
- `tool ID [--went-back N]` prints one: its kind and summary, its home, its
  check's word, the outcomes that said they use it (and how many you cannot
  open), the versions that went back, newest first, N of them (5 by default,
  1 to 100), each with its topic, the topics about it, and its files, its check
  marked.
- `tool-use ID OUTCOME [--off]` says the outcome uses the tool, or with `--off`
  that it no longer does. Anyone on the outcome may; a reached outcome refuses.
  Nothing else makes an outcome a user: running the tool, linking a topic or
  being its home does not.
- `tool-link ID TOPIC [--off]` says a topic is about the tool, or with `--off`
  that it is not. A link needs a topic in the tool's home, not its
  Conversation; taking one off works wherever the topic now is.
- `tool-record FILE` records one run of a tool's check from JSON: the run's
  fields and its `home_workspace_id`, as `tools/tool_check.py` writes them in
  `--out/records`. Only an agent on the home records; the same run again is
  recorded once, and a version that went back opens its topic in the home.

The same answer twice prints `(no change)` or `was already recorded`. These
verbs are checked in `tests/test_agent_verbs_tools.py`, run as a deployed CLI
runs them, over invented records.

Schema upgrades and actor registration are operator acts in
`bin/aim-next-admin`, not agent commands.

Item 774: the shared command `stack.move` moves an entire dossier within its
outcome. Read `dossier_move_targets` with any message id for the root, current
source, move_revision and a paged list of other topics. Send target
`{"message_id": ROOT}`, args `{"topic_id": DESTINATION}`, expected
`{"source_topic_id": SOURCE, "move_revision": N, "authority": CAPTURED_PAIR}`
through `aim-next command FILE`. Keep the exact operation id for a retry.
Core admits only the outcome owner or dossier's first agent author, and refuses
new readers or lost reply paths. `dossier_moves {topic_id}` reads the old topic's
paged pointers. Existing message ids are the links; use `source` to resolve their
current topic. Full admission and refusal contract: [dossier move](dossier-move-774.md).

## Explicit go-ahead choice (782)
Every `post` or `reply` with `--asks` must choose `--go-ahead` or
`--no-go-ahead`. A bare ask refuses before uploads or publication. The two
flags are mutually exclusive and belong only to asks. An agent asking a person
may supply literal `--ask-wait` metadata; omitting it uses the plain question
default described in asking-person-cover.md.

An asker (person or agent) can `withdraw MESSAGE [--operation ID]` when a question
no longer needs answering (item 366). This records `message.withdraw`, keeps the
original words and answers, and ends only that question’s waits. Nobody else,
including an owner or coordinator, can withdraw it. `read` shows “Question
withdrawn”; retries use the existing outbox and the same operation.
