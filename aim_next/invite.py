from __future__ import annotations

"""Inviting an agent to an outcome from its page (item 324, docs/agents.md "Inviting an agent").

Core takes the invitation as one act, workspace.agent_invite: it registers the
agent and adds it to the outcome's team, and only the outcome's owner or its
coordinator may take it. The adapter that took the request (the web server)
then writes the agent's sign-in file beside its own profile, with private
permissions, and hands back the prompt to copy into the agent. The file is
written only after Core has recorded the act, so a refused invitation leaves
no file; a sign-in that could not be written is written by sending the same
request again, which Core answers with its recorded receipt.

Item 525: the page keeps a request only while it is open, so after a reload, or
on another device, the same name is typed again as a new request. Core
remembers who invited each agent into which outcome (agent_invitations), and
gives the agent back to the person who invited it, in the same outcome, while it
is still on the team: nothing is registered or added again, and the adapter
writes its sign-in file if it is missing or was cut short."""

import hashlib
import os
from pathlib import Path
import re
import stat
import unicodedata

from .contract import LIMITS, Refusal, organises, _body, _identifier, _revision


# The programs an invited agent runs in, as the page names them.
HARNESSES = {"codex": "Codex", "claude-code": "Claude Code"}
NAME_MAX = 60
ID_MAX = 40
CODE_ROOT = Path(__file__).resolve().parents[1]
KIND = "workspace.agent_invite"
# Who invited each agent into which outcome (version 42), so the same person typing the same name there again gets that
# agent back. Stepping back is refused once anyone has been invited, since version 41 cannot say who invited them.
INVITATIONS_SCHEMA = [
    "CREATE TABLE agent_invitations (agent_id TEXT PRIMARY KEY REFERENCES actors(id), "
    "workspace_id TEXT NOT NULL REFERENCES workspaces(id), inviter_id TEXT NOT NULL REFERENCES actors(id))",
]
INVITATIONS_DOWN = ["DROP TABLE agent_invitations"]
INVITATIONS_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM agent_invitations)"


# Latin letters Unicode leaves whole that are written with letters of their own, by their Unicode names.
SPELLED = {"SHARP S": "ss", "THORN": "th", "ETH": "d", "ENG": "ng", "SCHWA": "e", "EZH": "z", "ESH": "sh", "GAMMA": "g",
           "KRA": "q", "YOGH": "gh", "WYNN": "w"}
# The rest are named as a letter with a mark: "LATIN SMALL LETTER O WITH STROKE" is o, "LATIN CAPITAL LIGATURE OE" is oe.
LATIN = re.compile(r"LATIN (?:SMALL |CAPITAL )?(?:LETTER|LIGATURE) (?:SMALL CAPITAL |DOTLESS |TURNED |REVERSED |OPEN |AFRICAN )?"
                   r"(.+?)(?: WITH .*| DIGRAPH)?")


def agent_id(name):
    """The ID an agent is known and addressed by, from its name: its Latin letters and digits, lower case, in words
    joined by hyphens. Accents are taken off (ë is e, ç is c), and a letter Unicode leaves whole is written as the letters it
    stands for (ø is o, ł is l, æ is ae, þ is th, ß is ss). An ID longer than ID_MAX keeps its start and ends with eight
    characters of a digest of the whole, so names that differ only past the cut get IDs of their own."""
    whole = "-".join(re.findall(r"[a-z0-9]+", "".join(_spelled(c) for c in _unaccented(name))))
    if len(whole) <= ID_MAX:
        return whole
    return "%s-%s" % (whole[:ID_MAX - 9].rstrip("-"), hashlib.sha256(whole.encode("ascii")).hexdigest()[:8])


def _unaccented(text):
    """text in compatibility form (NFKD) without its combining marks: Zoë is Zoe, Ça is Ca, ﬁ is fi."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def _spelled(c):
    """c in ASCII, lower case: a Latin letter as the letters it stands for; anything else not ASCII is a space."""
    if c.isascii():
        return c.lower()
    latin = LATIN.fullmatch(unicodedata.name(c, ""))
    letter = latin.group(1) if latin else ""
    return SPELLED.get(letter) or (letter.lower() if re.fullmatch(r"[A-Z]{1,2}", letter) else " ")


def _name(value):
    return " ".join(_body(value).split())


def _holders(db, name, agent):
    """The actors, enabled or not, who already have this ID or this name (ignoring case), those with the name first."""
    return db.execute("SELECT id,name,enabled FROM actors WHERE id=? OR name=? COLLATE NOCASE ORDER BY name=? COLLATE NOCASE DESC, id",
                      (agent, name, name)).fetchall()


def _free(db, name):
    """The first of "NAME 2", "NAME 3", ... that is free, for the refusal to suggest."""
    for number in range(2, 100):
        candidate = "%s %d" % (name[:NAME_MAX - 3], number)
        if not _holders(db, candidate, agent_id(candidate)):
            return candidate
    return None


def _given_back(db, workspace, actor, name, holders):
    """The agent this actor's own invitation put on this outcome's team under this name, when that is the one holder."""
    if len(holders) != 1 or holders[0]["name"].casefold() != name.casefold() or not holders[0]["enabled"]:
        return None
    agent = holders[0]["id"]
    invited = db.execute("SELECT 1 FROM agent_invitations WHERE agent_id=? AND workspace_id=? AND inviter_id=?",
                         (agent, workspace, actor)).fetchone()
    member = db.execute("SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (workspace, agent)).fetchone()
    return holders[0] if invited and member else None


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
        holders = _holders(db, name, agent)
        given = _given_back(db, workspace["id"], actor, name, holders)
        if given is not None:
            # The same invitation asked again as a new request: its agent, as recorded, and nothing changes.
            return {"workspace_id": workspace["id"], "title": workspace["title"], "version": workspace["version"],
                    "harness": args["harness"], "agent": {"id": given["id"], "name": given["name"], "kind": "agent"}}, []
        if holders:
            other = _free(db, name)
            raise Refusal("NAME_TAKEN", "There is already someone called %s here. Choose another name%s." % (
                holders[0]["name"], ", such as %s" % other if other else ""))
        if db.execute("SELECT count(*) FROM workspace_members WHERE workspace_id=?", (workspace["id"],)).fetchone()[0] >= LIMITS["workspace_members"]:
            raise Refusal("TOO_MANY_WORKSPACE_MEMBERS", "This outcome's team is full: it has %d members, its owner included." % LIMITS["workspace_members"])
        db.execute("INSERT INTO actors(id,kind,name) VALUES (?,?,?)", (agent, "agent", name))
        db.execute("INSERT INTO workspace_members VALUES (?,?)", (workspace["id"], agent))
        db.execute("INSERT INTO agent_invitations VALUES (?,?,?)", (agent, workspace["id"], actor))
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


MINE, CUT_SHORT, OTHER = "mine", "cut short", "other"


def _held(path, store, agent):
    """What is at path: None when nothing is there; MINE when it is agent's sign-in file in this instance; CUT_SHORT when
    it holds the beginning of exactly that file, or nothing, as a write cut short leaves it (a full disk after the
    file was created); OTHER for anything else, which is someone else's and is never written over."""
    from .profile import ProfileError, profile_bytes, read_binding
    if not path.exists() and not path.is_symlink():
        return None
    try:
        held = read_binding(path)
    except ProfileError:
        return CUT_SHORT if _begins(path, profile_bytes(store.path, store.instance_id, agent, store.binding)) else OTHER
    return MINE if (held.actor_id, held.db_path, held.instance_id, held.binding) == (agent, store.path, store.instance_id, store.binding) else OTHER


def _begins(path, whole):
    """Whether path is a private regular file of this user's holding fewer bytes than whole, and only its first ones."""
    try:
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return False
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            return False
        part = source.read(len(whole))
    return len(part) < len(whole) and whole.startswith(part)


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
    file Core's recorded receipt names, and nothing else is repeated. A file cut short for this same agent is written
    again; one that is someone else's never is. The same name typed again as a new request, by whoever invited it, in
    the same outcome, gets the same agent back from Core, and its file is written the same way."""
    if not isinstance(envelope, dict):
        envelope = {}
    if folder is None:
        return _refused(envelope, "NO_SIGN_IN_FOLDER", "This server keeps no folder for sign-in files, so it cannot invite an agent.")
    folder = Path(folder)
    args = envelope.get("args")
    name = args.get("name") if isinstance(args, dict) else None
    agent = agent_id(" ".join(name.split())) if isinstance(name, str) else ""
    # A file already in the new agent's place, for anyone else, is never overwritten or adopted.
    if agent and _held(sign_in_path(folder, agent), store, agent) == OTHER:
        return _refused(envelope, "SIGN_IN_TAKEN", "A sign-in file named %s is already in this instance's folder, for someone else. "
                        "Choose another name." % sign_in_path(folder, agent).name)
    receipt = store.command(actor, envelope)
    if receipt.get("status") != "committed" or receipt.get("kind") != KIND:
        return receipt
    from .profile import ProfileError, write_profile
    result = receipt["result"]
    path = sign_in_path(folder, result["agent"]["id"])
    try:
        held = _held(path, store, result["agent"]["id"])
        if held == CUT_SHORT:
            # This agent's own file, cut short by a write that failed: it goes, and is written whole.
            path.unlink()
            held = None
        if held is None:
            write_profile(path, store.path, store.instance_id, result["agent"]["id"], binding=store.binding)
    except (ProfileError, OSError):
        # Written at the same moment by the same request sent twice is written.
        pass
    if _held(path, store, result["agent"]["id"]) != MINE:
        return dict(receipt, sign_in={"written": False, "path": str(path), "message": (
            "%s is on the team, but its sign-in file could not be written in %s. Try again: the same invitation "
            "writes it, and nothing else is repeated." % (result["agent"]["name"], folder))})
    return dict(receipt, sign_in={"written": True, "path": str(path), "prompt": prompt(result, path, store.path)})
