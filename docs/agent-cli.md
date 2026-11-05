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
COMMAND is the complete Core envelope. No actor override, profile discovery,
implicit defaults, new operation identities, pagination or retries are added.
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


def agent_example(cli, profile, request_directory, selected_ref, operation_prefix, reply_text, addressees):
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
        "addressees": sent_to, "reply_to": delivered["source_ref"]["id"]}, {"draft_revision": 0})
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

The example's source, recipient and text are explicit caller choices. Stored
quotes remain separate from addressees. A later Notebook revision does not
replace the selected one. `delivery.ack` settles only the named incoming
delivery; it does not mean the topic is complete or that a wake was accepted.

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
Retain an opening's publish request before sending it; on uncertainty look up
that operation, and resend the identical request only.

Schema upgrades and actor registration are operator acts in
`bin/aim-next-admin`, not agent commands.
