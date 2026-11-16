from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import unittest

from aim_next import Store
from aim_next.invite import invite
from aim_next.profile import load_profile, write_profile
from aim_next.serve import server_for_profile
from aim_next.server import create_server
import test_store as fixtures


class Receipts:
    """A receipt of the wrong shape fails on an assertion, never on a missing key."""

    def error(self, receipt):
        self.assertEqual(receipt.get("status"), "rejected", receipt)
        return receipt["error"]

    def sign_in(self, receipt):
        self.assertEqual(receipt.get("status"), "committed", receipt)
        self.assertIn("sign_in", receipt)
        return receipt["sign_in"]

    def refused(self, receipt, code, recorded=True):
        self.assertEqual((receipt.get("status"), (receipt.get("error") or {}).get("code"), receipt.get("recorded")), ("rejected", code, recorded), receipt)


class InviteCase(Receipts, unittest.TestCase):
    """Outcome w1: owner "owner", coordinator agent-a, member agent-b; "outsider" is on no team. Sign-in files go in a
    private folder of the test's own."""

    setUp_store = fixtures.StoreCase.setUp
    command = fixtures.StoreCase.command
    workspace = fixtures.StoreCase.workspace
    sql = fixtures.StoreCase.sql

    def setUp(self):
        self.setUp_store()
        self.workspace()
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('outsider','agent','Outside agent')")
        self.folder = Path(self.temp.name).resolve() / "profiles"
        self.folder.mkdir(mode=0o700)

    def version(self):
        return self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]

    def envelope(self, name="Release scribe", harness="claude-code", workspace="w1", revision=None, op=None):
        self.serial += 1
        return {"v": 1, "instance_id": "test-instance", "operation_id": op or "invite-%d" % self.serial,
                "kind": "workspace.agent_invite", "target": {"workspace_id": workspace},
                "expected": {"workspace_revision": self.version() if revision is None else revision, "authority": dict(self.pin)},
                "args": {"name": name, "harness": harness}}

    def invite(self, actor="owner", folder=None, **args):
        return invite(self.store, actor, self.envelope(**args), self.folder if folder is None else folder)

    def nothing_changed(self, before):
        self.assertEqual(self.state(), before)
        self.assertEqual(sorted(os.listdir(self.folder)), [], "no sign-in file is written")

    def state(self):
        return (self.sql("SELECT * FROM actors ORDER BY id"), self.sql("SELECT * FROM workspace_members ORDER BY actor_id"),
                self.sql("SELECT version FROM workspaces"))


class Core(InviteCase):
    """workspace.agent_invite: who may take it, what it records, and what it refuses."""

    def test_the_owner_invites_an_agent_who_is_registered_and_on_the_team_in_one_act(self):
        before = self.version()
        receipt = self.store.command("owner", self.envelope("Release  scribe ", harness="codex"))
        self.assertEqual(receipt["status"], "committed", receipt)
        self.assertEqual(receipt["result"], {"workspace_id": "w1", "title": "Isolated test", "version": before + 1, "harness": "codex",
                                             "agent": {"id": "release-scribe", "name": "Release scribe", "kind": "agent"}})
        self.assertEqual(self.sql("SELECT id,kind,name,enabled FROM actors WHERE id='release-scribe'"), [("release-scribe", "agent", "Release scribe", 1)])
        members = [item["actor_id"] for item in self.store.view("owner", "workspace_members", {"workspace_id": "w1"})["items"]]
        self.assertIn("release-scribe", members)
        # The agent reads the outcome as a member; as with workspace.member_set, an agent other than the
        # coordinator is not one of its conversation's people (standing_conversation.py).
        self.assertEqual([item["id"] for item in self.store.view("release-scribe", "workspaces", {})["items"]], ["w1"])
        conversation = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]
        self.assertNotIn(("release-scribe",), self.sql("SELECT actor_id FROM topic_participants WHERE topic_id=? AND active=1", (conversation["topic_id"],)))
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,version FROM changes WHERE resource_kind='workspace' ORDER BY seq")[-3:],
                         [("workspace", "w1", "workspace", before + 1), ("outcome", "w1", "workspace", before + 1),
                          ("actor", "release-scribe", "workspace", before + 1)])

    def test_the_coordinator_may_invite_and_a_member_or_an_outsider_is_refused_by_core(self):
        self.assertEqual(self.store.command("agent-a", self.envelope("Coordinated helper"))["status"], "committed")
        for actor in ("agent-b", "outsider"):
            before = self.state()
            receipt = self.store.command(actor, self.envelope("Not allowed %s" % actor))
            self.refused(receipt, "FORBIDDEN")
            self.assertEqual(self.error(receipt)["message"], "Only the outcome's owner or its coordinator can invite an agent to it.")
            self.assertEqual(self.state(), before, "%s registered no one and added no one" % actor)
        self.refused(self.store.command("owner", self.envelope("Nowhere", workspace="w-missing", revision=0)), "FORBIDDEN")

    def test_a_name_already_taken_is_refused_with_another_to_choose_and_nothing_changes(self):
        self.assertEqual(self.store.command("owner", self.envelope("Release scribe"))["status"], "committed")
        for name in ("release SCRIBE", "Release-Scribe!", "Outside agent", "agent-a"):
            before = self.state()
            receipt = self.store.command("owner", self.envelope(name))
            self.refused(receipt, "NAME_TAKEN")
            self.assertEqual(self.state(), before)
        message = self.error(self.store.command("owner", self.envelope("Release scribe")))["message"]
        self.assertEqual(message, "There is already someone called Release scribe here. Choose another name, such as Release scribe 2.")
        self.assertEqual(self.store.command("owner", self.envelope("Release scribe 2"))["status"], "committed", "the suggestion is free")

    def test_a_name_that_cannot_name_an_agent_and_an_unknown_program_are_refused(self):
        before = self.state()
        self.refused(self.store.command("owner", self.envelope("   ")), "NAME_REQUIRED")
        self.refused(self.store.command("owner", self.envelope("代理人")), "NAME_UNUSABLE")
        self.refused(self.store.command("owner", self.envelope("x" * 61)), "NAME_TOO_LONG")
        self.refused(self.store.command("owner", self.envelope(harness="cursor")), "INVALID_ARGUMENT", recorded=False)
        self.assertEqual(self.state(), before)

    def test_a_stale_revision_is_a_conflict_that_names_the_current_one(self):
        receipt = self.store.command("owner", self.envelope(revision=self.version() - 1))
        self.refused(receipt, "REVISION_CONFLICT")
        self.assertEqual(self.error(receipt)["current_versions"], {"workspace_revision": self.version()})


class SignIn(InviteCase):
    """The adapter's part: the sign-in file, written privately once Core has recorded the act, and the prompt."""

    def test_an_invitation_writes_a_private_sign_in_file_that_binds_the_new_agent_and_a_prompt_that_names_it(self):
        receipt = self.invite(harness="claude-code")
        self.assertEqual(receipt["status"], "committed", receipt)
        path = self.folder / "release-scribe.profile.json"
        self.assertEqual(self.sign_in(receipt)["path"], str(path))
        self.assertTrue(self.sign_in(receipt)["written"])
        info = os.stat(path, follow_symlinks=False)
        self.assertTrue(stat.S_ISREG(info.st_mode))
        self.assertEqual((stat.S_IMODE(info.st_mode), info.st_uid), (0o600, os.getuid()), "private to this user")
        profile = load_profile(path)
        self.assertEqual((profile.actor_id, profile.instance_id, profile.db_path), ("release-scribe", "test-instance", self.path.resolve()))
        self.assertEqual(profile.store().view("release-scribe", "capabilities", {})["actor_kind"], "agent")
        words = self.sign_in(receipt)["prompt"]
        root = Path(__file__).resolve().parents[1]
        for said in ("You are Release scribe", "You run in Claude Code.", "Your Theseus ID is release-scribe; people address you as @release-scribe.",
                     "the outcome “Isolated test”", "Your sign-in file is %s." % path,
                     "/usr/bin/python3 -I %s --profile %s" % (root / "bin" / "aim-next", path),
                     "read the agent guide: %s" % (root / "docs" / "agent-guide.md"), "Allow Bash to run that command."):
            self.assertIn(said, words)
        # The prompt says where the file is, never what is in it.
        for secret in (self.binding["authority_id"], self.binding["authority_epoch"]):
            self.assertNotIn(secret, json.dumps(receipt))

    def test_a_codex_agent_is_told_where_its_sandbox_must_let_it_write(self):
        words = self.sign_in(self.invite(name="Codex reviewer", harness="codex"))["prompt"]
        self.assertIn("You run in Codex.", words)
        self.assertIn("Your sandbox must let that command write in %s and %s" % (self.path.resolve().parent, self.folder / "codex-reviewer.outbox"), words)
        self.assertNotIn("Allow Bash", words)

    def test_a_refused_invitation_writes_no_file(self):
        before = self.state()
        self.refused(self.invite(actor="agent-b"), "FORBIDDEN")
        self.nothing_changed(before)
        self.refused(self.invite(name="Outside agent"), "NAME_TAKEN")
        self.nothing_changed(before)

    def test_a_file_already_in_the_agents_place_is_kept_and_core_is_not_asked(self):
        other = self.folder / "release-scribe.profile.json"
        other.write_text("someone else's\n")
        other.chmod(0o600)
        before = self.state()
        receipt = self.invite()
        self.refused(receipt, "SIGN_IN_TAKEN", recorded=False)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE kind='workspace.agent_invite'"), [(0,)])
        self.assertEqual(other.read_text(), "someone else's\n")

    def test_no_sign_in_folder_invites_no_one(self):
        before = self.state()
        receipt = invite(self.store, "owner", self.envelope(), None)
        self.refused(receipt, "NO_SIGN_IN_FOLDER", recorded=False)
        self.assertEqual(self.state(), before)

    def test_a_file_that_could_not_be_written_is_written_by_the_same_invitation_sent_again(self):
        missing = self.folder / "not-yet"
        envelope = self.envelope()
        first = invite(self.store, "owner", envelope, missing)
        self.assertEqual(first["status"], "committed")
        self.assertEqual(self.sign_in(first), {"written": False, "path": str(missing / "release-scribe.profile.json"), "message":
                         "Release scribe is on the team, but its sign-in file could not be written in %s. Try again: the same "
                         "invitation writes it, and nothing else is repeated." % missing})
        self.assertNotIn("prompt", self.sign_in(first))
        missing.mkdir(mode=0o700)
        again = invite(self.store, "owner", envelope, missing)
        self.assertTrue(self.sign_in(again)["written"])
        self.assertEqual(load_profile(missing / "release-scribe.profile.json").actor_id, "release-scribe")
        self.assertEqual({key: again[key] for key in ("operation_id", "result", "status")}, {key: first[key] for key in ("operation_id", "result", "status")})
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE kind='workspace.agent_invite'"), [(1,)], "Core recorded it once")
        # Sent once more, the file it wrote is kept as it is.
        before = (missing / "release-scribe.profile.json").read_bytes()
        self.assertTrue(self.sign_in(invite(self.store, "owner", envelope, missing))["written"])
        self.assertEqual((missing / "release-scribe.profile.json").read_bytes(), before)


class OverHTTP(Receipts, unittest.TestCase):
    """The page's path: POST /api/command with the invitation, as the server's own actor."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "records.sqlite3"
        from aim_next import initialize
        self.binding = initialize(self.db, "invite-http", [{"id": "test-human", "kind": "human"}, {"id": "test-other", "kind": "human"}],
                                  authority_path=self.root / "authority.json")["binding"]
        self.pin = {key: self.binding[key] for key in ("authority_id", "authority_epoch")}
        self.store = Store(self.db, "invite-http", expected_binding=self.binding)
        self.folder = self.root / "profiles"
        self.folder.mkdir(mode=0o700)
        for owner, workspace in (("test-human", "w-mine"), ("test-other", "w-theirs")):
            receipt = self.store.command(owner, {"v": 1, "instance_id": "invite-http", "operation_id": "create-" + workspace, "kind": "workspace.create",
                                                 "target": {}, "expected": {"workspace_revision": 0, "authority": dict(self.pin)},
                                                 "args": {"id": workspace, "title": "Outcome " + workspace, "team": ["test-human"] if owner == "test-other" else []}})
            self.assertEqual(receipt["status"], "committed", receipt)
        self.server = create_server(lambda: Store(self.db, "invite-http", expected_binding=self.binding), "invite-http", "test-human", self.root,
                                    token="invite-session", sign_in_folder=self.folder)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.tmp.cleanup()

    def post(self, workspace, name, op):
        version = self.store.view("test-human", "workspace", {"workspace_id": workspace})["workspace"]["version"]
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request("POST", "/api/command", body=json.dumps({
                "v": 1, "instance_id": "invite-http", "operation_id": op, "kind": "workspace.agent_invite", "target": {"workspace_id": workspace},
                "expected": {"workspace_revision": version, "authority": dict(self.pin)}, "args": {"name": name, "harness": "codex"}}),
                headers={"Authorization": "Bearer invite-session", "Origin": self.server.origin, "Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            return json.loads(response.read())
        finally:
            connection.close()

    def test_the_page_invites_into_its_own_outcome_and_is_refused_in_one_it_only_belongs_to(self):
        receipt = self.post("w-mine", "Night watch", "http-invite-1")
        self.assertEqual((receipt["status"], self.sign_in(receipt)["written"]), ("committed", True), receipt)
        self.assertEqual(load_profile(self.folder / "night-watch.profile.json").actor_id, "night-watch")
        self.assertIn("You are Night watch", self.sign_in(receipt)["prompt"])
        refused = self.post("w-theirs", "Sneaky helper", "http-invite-2")
        self.assertEqual((refused["status"], refused["recorded"], self.error(refused)["code"]), ("rejected", True, "FORBIDDEN"))
        self.assertNotIn("sign_in", refused)
        self.assertEqual(sorted(os.listdir(self.folder)), ["night-watch.profile.json"])
        self.assertEqual(self.store.view("test-human", "actors", {"kind": "agent"})["items"],
                         [{"id": "night-watch", "kind": "agent", "name": "Night watch", "name_truncated": False}])

    def test_a_duplicate_over_http_says_what_to_do(self):
        self.post("w-mine", "Night watch", "http-invite-1")
        refused = self.post("w-mine", "night watch", "http-invite-2")
        self.assertEqual(self.error(refused), {"code": "NAME_TAKEN", "retryable": False,
                                            "message": "There is already someone called night watch here. Choose another name, such as night watch 2."})


class Launcher(unittest.TestCase):
    def test_the_server_writes_sign_in_files_beside_its_own_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            web = root / "web"
            web.mkdir()
            (web / "index.html").write_text("<meta name=\"aim-next-session\" content=\"__AIM_SESSION_TOKEN__\">")
            from aim_next import initialize
            binding = initialize(root / "db.sqlite3", "launcher", [{"id": "person", "kind": "human"}], authority_path=root / "authority.json")["binding"]
            (root / "instance").mkdir(mode=0o700)
            write_profile(root / "instance" / "person.profile.json", root / "db.sqlite3", "launcher", "person", binding=binding)
            server = server_for_profile(root / "instance" / "person.profile.json", 0, web)
            try:
                self.assertEqual(server.sign_in_folder, root / "instance")
            finally:
                server.server_close()


if __name__ == "__main__":
    unittest.main()
