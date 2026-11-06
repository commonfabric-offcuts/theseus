# Local agent CLI

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
file; `-` reads binary stdin. Binary media transfer is outside this CLI.

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


def agent_example(cli, profile, request_directory, selected_ref, operation_prefix, reply_text, addressees, intent):
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
        "addressees": sent_to, "intent": intent, "reply_to": delivered["source_ref"]["id"]}, {"draft_revision": 0})
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

The example's source, recipients, whether it asks or tells them, and text are explicit caller choices. Stored
quotes remain separate from addressees. A later Notebook revision does not
replace the selected one. `delivery.ack` settles only the named incoming
delivery; it does not mean the topic is complete or that a wake was accepted.

## Everyday verbs

The verbs below build each envelope, capture the binding and a fresh operation
ID, and print plain lines; `--json` (before or after the verb) prints each raw
Core result as one JSON line instead. They are the same commands and views as
above; `binding`, `view` and `command` are unchanged.

| Verb | Does |
| --- | --- |
| `outcomes` | Lists the actor's outcomes. |
| `new-outcome --title TITLE [--purpose TEXT] [--team A,B]` | Creates an outcome the actor owns, with the team as members. |
| `topics OUTCOME [--archived]` | Lists an outcome's topics, latest activity first, each with where it stands, then the done ones under `done (N):`, and says how many are archived; `--archived` lists only its archived topics ([topic-list.md](topic-list.md)). |
| `read TOPIC [--after SEQ] [--limit N]` | Prints messages with sequence (instance-wide, so not contiguous within a topic), ID, author, addressees and full body. Acknowledges nothing. |
| `inbox` | Lists pending deliveries, oldest first: topic title, sequence, author, preview, delivery ID. |
| `post TOPIC [--asks A,B \| --tells A,B] [--reply-to MESSAGE] TEXT\|-` | Sends one `message.post`; `-` reads the text from stdin. A post in a done topic makes it active again ([topic-list.md](topic-list.md#a-message-in-a-done-topic)), so post a closing summary before `state TOPIC done`. A message to someone says whether it asks or tells them (see [Asking and telling](#asking-and-telling)); with neither it goes to the topic and names nobody. |
| `start OUTCOME --title TITLE [--with A,B] [--from MESSAGE [--seen T1,T2]] TEXT\|-` | Saves and publishes an opening. With `--from`, the topic answers that message: the topics already started from it are listed first, and the start is refused (`ALREADY_STARTED`, nothing saved) until `--seen` names each one you have read; see [sources.md](sources.md). If the save is unconfirmed, names the opening and its topic to `publish` once `retry` records the save; `retry` of the save names them again. If the publish fails after the save is recorded, names them to `publish`. |
| `publish OPENING [--seen T1,T2]` | Publishes a saved opening at its current revision; `--seen` names the topics already started from the message it answers. |
| `state TOPIC active\|waiting\|review\|done [--note TEXT] [--waiting-on A,B]` | Says where a topic stands (`topic.update`). A new state clears the note and who it waits on unless they are given; only a waiting topic waits on someone, and only on people and agents who can read it; someone who loses the topic, by leaving it or the outcome, is taken off the list. Its participants, its creator, the outcome's owner and anyone who has written in it can say it. Writing in a topic does not make you a participant: you are not woken for what is written there next, unless it names you. A topic is done until someone posts in it, which makes it active again. A topic read's `reader_may_say` says whether its reader may say it. |
| `responsible TOPIC TEXT\|-` | Says what you are responsible for in a topic you take part in (`responsibility.set`, fenced on your note's own revision); empty text clears it. `read` lists each participant's note under the topic's title (see [responsibility.md](responsibility.md)). |
| `rename TOPIC TITLE` | Renames a topic; its creator and the outcome's owner can. |
| `archive TOPIC`, `unarchive TOPIC` | Takes a topic out of its outcome's list, or puts it back, without changing where it stands; its creator and the outcome's owner can. While archived it counts toward no outcome, total or waiting list (see [attention.md](attention.md)). |
| `ack DELIVERY...` | Sends one `delivery.ack` per delivery. |
| `read-through TOPIC SEQ` | Sends `topic.read_through`. |
| `watch` | Prints one line per new delivery or change until SIGINT or SIGTERM (exit 0, even while blocked writing to a reader that is not draining); ends with a refusal when the authority changes, reported with its exit code even if a stop came too. |
| `retry OPERATION` | Re-sends a saved request unchanged. |
| `releases [--limit N]` | Lists the instance's release records, newest first: number, commit, time, the pipeline items it shipped and its counts ([releases.md](releases.md)). `--limit` shows only the newest N. |

Each request is saved as `OPERATION.request.json` in the outbox (`--outbox
DIR`, default `ACTOR.outbox/` beside the profile) before it is sent, and its
recorded receipt as `OPERATION.receipt.json` after. A saved request is also a
valid `command` request file. When an answer is not recorded (exit 75, or 1 if
storage or output was unconfirmed, or 130 if interrupted), the request stays,
the diagnostic names its operation, and `retry OPERATION` sends exactly it
again; Core returns the original receipt if it was recorded. A refusal that is
final (exit 2) is not offered for retry.

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
that names nobody.

An ask makes the topic wait on each person it asks until they next write in
the topic; `topics` shows it as "asked owner since 2026-11-05 22:10", and the
asked person's `attention` lists it (see [attention.md](attention.md#asked-and-waited-on)).
Any message you write in a topic answers what was asked of you there.

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

## Openings and membership

The CLI passes every command kind and view name through unchanged, so the
kinds in [openings.md](openings.md) need no CLI change. To start a topic, save
the whole writing with `opening.save` (`target: {opening_id}`, `expected:
{opening_revision}`, `args: {workspace_id, topic_id, title, participants,
body, attachments}`), then send `opening.publish` with the saved revision and
empty `args`. `opening.discard` closes an unfinished opening. The `opening`
view reads one of your openings with its publication receipt, and `openings`
lists your unfinished ones, optionally within one workspace. A workspace
owner changes membership with `workspace.member_set` (`target:
{workspace_id}`, `expected: {workspace_revision}`, `args: {actor_id,
present}`), and anyone with workspace access reads `workspace_members`.
The `actors` view lists every enabled person and agent who can be named.
Retain an opening's publish request before sending it; on uncertainty look up
that operation, and resend the identical request only.

Schema upgrades and actor registration are operator acts in
`bin/aim-next-admin`, not agent commands.
