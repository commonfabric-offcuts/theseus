from __future__ import annotations

"""Inviting an agent to an outcome from its page (item 324, docs/agents.md "Inviting an agent").

Core takes the invitation as one act, workspace.agent_invite: it registers the
agent and adds it to the outcome's team, and only the outcome's owner or its
coordinator may take it. The adapter that took the request (the web server)
then writes the agent's sign-in file beside its own profile, with private
permissions, and hands back the prompt to copy into the agent. The file is
written only after Core has recorded the act, so a refused invitation leaves
no file; a sign-in that could not be written is written by sending the same
request again, which Core answers with its recorded receipt."""

import re
from pathlib import Path

from .contract import LIMITS, Refusal, organises, _body, _identifier, _revision


# The programs an invited agent runs in, as the page names them.
HARNESSES = {"codex": "Codex", "claude-code": "Claude Code"}
NAME_MAX = 60
ID_MAX = 40
CODE_ROOT = Path(__file__).resolve().parents[1]
KIND = "workspace.agent_invite"


def agent_id(name):
    """The ID an agent is known and addressed by, from its name: its ASCII letters and digits, lower case, in words joined by hyphens."""
    return "-".join(re.findall(r"[a-z0-9]+", name.lower()))[:ID_MAX].strip("-")


def _name(value):
    return " ".join(_body(value).split())


def _taken(db, name, agent):
    """Whether an actor, enabled or not, already has this ID or this name (ignoring case)."""
    return bool(db.execute("SELECT 1 FROM actors WHERE id=? OR name=? COLLATE NOCASE LIMIT 1", (agent, name)).fetchone())


def _free(db, name):
    """The first of "NAME 2", "NAME 3", ... that is free, for the refusal to suggest."""
    for number in range(2, 100):
        candidate = "%s %d" % (name[:NAME_MAX - 3], number)
        if not _taken(db, candidate, agent_id(candidate)):
            return candidate
    return None


class Invites:
    def _command_workspace_agent_invite(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if (set(target) != {"workspace_id"} or set(args) != {"name", "harness"} or not isinstance(args["name"], str)
                or args["harness"] not in HARNESSES):
            raise Refusal("INVALID_ARGUMENT", "Name one outcome, the agent's name, and codex or claude-code")
        workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (_identifier(target["workspace_id"], "workspace_id"),)).fetchone()
        # Core decides who may invite, whatever the page showed: the outcome's owner or its coordinator.
        if workspace is None or not organises(workspace, actor):
            raise Refusal("FORBIDDEN", "Only the outcome's owner or its coordinator can invite an agent to it.")
        _revision(envelope["expected"], "workspace_revision", workspace["version"])
        name = _name(args["name"])
        if not name:
            raise Refusal("NAME_REQUIRED", "Give the agent a name.")
        if len(name) > NAME_MAX:
            raise Refusal("NAME_TOO_LONG", "An agent's name is at most %d characters." % NAME_MAX)
        agent = agent_id(name)
        if not agent:
            raise Refusal("NAME_UNUSABLE", "An agent's name needs a letter from a to z or a digit, for the name people address it by.")
        if _taken(db, name, agent):
            other = _free(db, name)
            raise Refusal("NAME_TAKEN", "There is already someone called %s here. Choose another name%s." % (
                name, ", such as %s" % other if other else ""))
        if db.execute("SELECT count(*) FROM workspace_members WHERE workspace_id=?", (workspace["id"],)).fetchone()[0] >= LIMITS["workspace_members"]:
            raise Refusal("TOO_MANY_WORKSPACE_MEMBERS", "Workspace team limit includes its owner")
        db.execute("INSERT INTO actors(id,kind,name) VALUES (?,?,?)", (agent, "agent", name))
        db.execute("INSERT INTO workspace_members VALUES (?,?)", (workspace["id"], agent))
        version = workspace["version"] + 1
        db.execute("UPDATE workspaces SET version=? WHERE id=?", (version, workspace["id"]))
        # The conversation's people follow the team (standing_conversation.py).
        self._sync_participants(db, workspace["id"])
        self._outcome_change(db, workspace["id"], version)
        self._change(db, "actor", agent, "workspace", workspace["id"], version)
        return {"workspace_id": workspace["id"], "title": workspace["title"], "version": version, "harness": args["harness"],
                "agent": {"id": agent, "name": name, "kind": "agent"}}, [
            {"kind": "workspace", "id": workspace["id"], "version": version}]


def sign_in_path(folder, agent):
    return Path(folder) / ("%s.profile.json" % agent)


def _binds(path, store, agent):
    """True when path is a sign-in file for agent in this instance, False when it is something else, None when nothing is there."""
    from .profile import ProfileError, read_binding
    if not path.exists() and not path.is_symlink():
        return None
    try:
        held = read_binding(path)
    except ProfileError:
        return False
    return (held.actor_id, held.db_path, held.instance_id, held.binding) == (agent, store.path, store.instance_id, store.binding)


def _refused(envelope, code, message):
    """An adapter's refusal in the shape of an unrecorded receipt: Core was never asked."""
    return {"instance_id": envelope.get("instance_id"), "operation_id": envelope.get("operation_id"), "kind": KIND,
            "status": "rejected", "recorded": False, "result": None, "affected": [],
            "error": {"code": code, "message": message, "retryable": False}}


def prompt(result, path, database):
    """What to paste into the new agent: who it is, where its sign-in file is, and to read the agent guide first."""
    agent, harness, path = result["agent"], result["harness"], Path(path)
    command = "/usr/bin/python3 -I %s --profile %s" % (CODE_ROOT / "bin" / "aim-next", path)
    # The CLI writes the instance's database and keeps its outbox beside the sign-in file (docs/agent-cli.md).
    room = {"codex": "Your sandbox must let that command write in %s and %s; run with that access, or ask for it." % (
                Path(database).parent, path.parent / ("%s.outbox" % agent["id"])),
            "claude-code": "Allow Bash to run that command."}[harness]
    return "\n".join([
        "You are %s, an agent in Theseus, where people and agents work on outcomes together. You run in %s." % (agent["name"], HARNESSES[harness]),
        "Your Theseus ID is %s; people address you as @%s. You are on the team of the outcome “%s”." % (agent["id"], agent["id"], result["title"]),
        "",
        "Your sign-in file is %s. It is private: never print it, copy it or share it." % path,
        "Run Theseus as: %s" % command,
        room,
        "",
        "Before anything else, read the agent guide: %s" % (CODE_ROOT / "docs" / "agent-guide.md"),
        "Then wait for work with `watch --once`, as the guide says.",
    ])


def invite(store, actor, envelope, folder):
    """Take one invitation for actor: Core's act, then, once it is recorded, the agent's sign-in file and its prompt.

    Returns Core's receipt, with sign_in added to a committed one: {written, path, prompt} or {written: False, path,
    message}. A refusal before Core is asked (no sign-in folder, or a file in the agent's place) is an unrecorded
    receipt. Sending the same request again after a lost answer, or after the file could not be written, writes the
    file Core's recorded receipt names, and nothing else is repeated."""
    if not isinstance(envelope, dict):
        envelope = {}
    if folder is None:
        return _refused(envelope, "NO_SIGN_IN_FOLDER", "This server keeps no folder for sign-in files, so it cannot invite an agent.")
    folder = Path(folder)
    args = envelope.get("args")
    name = args.get("name") if isinstance(args, dict) else None
    agent = agent_id(" ".join(name.split())) if isinstance(name, str) else ""
    # A file already in the new agent's place, for anyone else, is never overwritten or adopted.
    if agent and _binds(sign_in_path(folder, agent), store, agent) is False:
        return _refused(envelope, "SIGN_IN_TAKEN", "A sign-in file named %s is already in this instance's folder, for someone else. "
                        "Choose another name." % sign_in_path(folder, agent).name)
    receipt = store.command(actor, envelope)
    if receipt.get("status") != "committed" or receipt.get("kind") != KIND:
        return receipt
    from .profile import ProfileError, write_profile
    result = receipt["result"]
    path = sign_in_path(folder, result["agent"]["id"])
    try:
        if _binds(path, store, result["agent"]["id"]) is None:
            write_profile(path, store.path, store.instance_id, result["agent"]["id"], binding=store.binding)
    except ProfileError:
        # Written at the same moment by the same request sent twice is written.
        pass
    if _binds(path, store, result["agent"]["id"]) is not True:
        return dict(receipt, sign_in={"written": False, "path": str(path), "message": (
            "%s is on the team, but its sign-in file could not be written in %s. Try again: the same invitation "
            "writes it, and nothing else is repeated." % (result["agent"]["name"], folder))})
    return dict(receipt, sign_in={"written": True, "path": str(path), "prompt": prompt(result, path, store.path)})
