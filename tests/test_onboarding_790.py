from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from aim_next.invite import assignment_text
import test_store as fixtures


class OnboardingCase(unittest.TestCase):
    setUp_store = fixtures.StoreCase.setUp
    command = fixtures.StoreCase.command
    workspace = fixtures.StoreCase.workspace
    sql = fixtures.StoreCase.sql

    def setUp(self):
        self.setUp_store()
        self.workspace()
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('outsider','agent','Isolated outsider')")

    def read(self, actor="owner", workspace="w1", variant="codex", **more):
        return self.store.view(actor, "onboarding_prompt", dict(workspace_id=workspace, variant=variant, **more))

    def topic(self, id="t-open", title="Current topic", state="waiting", archived=0):
        # Isolated stored facts, not attributed test messages in a live conversation.
        self.sql("INSERT INTO topics(id,workspace_id,title,creator_id,version,state,archived,state_note,list_position) VALUES (?,?,?,?,1,?,?,?,1)",
                 (id, "w1", title, "owner", state, archived, "Needs a decision"))
        self.sql("INSERT INTO topic_waiting(topic_id,actor_id,said) VALUES (?, 'agent-b',1)", (id,))

    def test_owner_only_and_no_context_read_before_authorization(self):
        for actor in ("agent-a", "agent-b", "outsider"):
            # The owner guard must run before even _workspace's contextual read.
            with patch.object(self.store, "_workspace", side_effect=AssertionError("context read before owner check")):
                answer = self.read(actor)
            self.assertEqual(answer["error"]["code"], "FORBIDDEN", answer)
            self.assertNotIn("prompt", answer)
        self.assertEqual(self.read(workspace="missing")["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.read(actor_id="owner")["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.read(variant="other")["error"]["code"], "INVALID_ARGUMENT")

    def test_variants_facts_and_no_record_changes(self):
        self.topic()
        self.topic("t-done", "DONE PRIVATE CANARY", "done")
        self.topic("t-archived", "ARCHIVED PRIVATE CANARY", archived=1)
        before = self.sql("SELECT count(*) FROM operations"), self.sql("SELECT max(seq) FROM changes")
        a, b = self.read()["prompt"], self.read(variant="claude")["prompt"]
        # The context stays identical; only the harness instructions differ.
        self.assertEqual(a.replace("AGENTS.md", "CLAUDE.md").replace(assignment_text("codex"), "ASSIGNMENT"),
                         b.replace(assignment_text("claude-code"), "ASSIGNMENT"))
        for words in ("Isolated test", "Exercise one recorded act", "Owner: owner", "agent-a", "agent-b", "Current topic", "Needs a decision", "waits on agent-b", "docs/agent-cli.md", "--operation", "+ Invite agent", "No current rule is configured", "No pipeline is configured"):
            self.assertIn(words, a)
        for words in ("DONE PRIVATE CANARY", "ARCHIVED PRIVATE CANARY", "Isolated outsider"):
            self.assertNotIn(words, a)
        self.assertEqual(before, (self.sql("SELECT count(*) FROM operations"), self.sql("SELECT max(seq) FROM changes")))

    def test_current_state_and_owner_transfer(self):
        first = self.read()["prompt"]
        receipt = self.command("workspace.update", {"title": "Changed just before copy", "purpose": "Current purpose"},
                               {"workspace_id": "w1"}, {"workspace_revision": 1})
        self.assertEqual(receipt["status"], "committed", receipt)
        self.topic()
        second = self.read()["prompt"]
        self.assertNotEqual(first, second)
        self.assertIn("Changed just before copy", second)
        self.assertIn("Current purpose", second)
        self.assertIn("Current topic", second)
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        receipt = self.command("workspace.owner_set", {"owner_id": "agent-b"}, {"workspace_id": "w1"}, {"workspace_revision": version})
        self.assertEqual(receipt["status"], "committed", receipt)
        self.assertEqual(self.read()["error"]["code"], "FORBIDDEN")
        self.assertIn("Owner: agent-b", self.read("agent-b")["prompt"])

    def test_secret_canaries_refuse_without_echo_and_private_pages_are_never_read(self):
        # Entirely invented canaries. No runtime sign-in file is opened.
        canaries = ["sk-syntheticCanary790", "token=CANARY790", "Bearer CANARY790", "-----BEGIN PRIVATE KEY-----",
                    "/Users/synthetic/agent.profile.json", "~/synthetic/session.json", "identity.key"]
        for canary in canaries:
            self.sql("UPDATE workspaces SET purpose=? WHERE id='w1'", (canary,))
            answer = self.read()
            self.assertEqual(answer.get("error", {}).get("code"), "ONBOARDING_UNSAFE_CONTEXT", answer)
            self.assertNotIn(canary, json.dumps(answer))
            self.assertNotIn("prompt", answer)
        self.sql("UPDATE workspaces SET purpose='Safe purpose' WHERE id='w1'")
        self.sql("INSERT INTO workspaces(id,owner_id,title,purpose,version) VALUES ('foreign','outsider','FOREIGN CANARY','token=FOREIGN790',1)")
        self.sql("INSERT INTO topics(id,workspace_id,title,creator_id,version,state,list_position) VALUES ('foreign-topic','foreign','FOREIGN TOPIC CANARY','outsider',1,'active',2)")
        # An arbitrary unpinned Notebook page is not a rule source.
        with patch.object(self.store, "_view_memory_items", side_effect=AssertionError("Notebook read")):
            answer = self.read()["prompt"]
        self.assertNotIn("FOREIGN", answer)
        self.assertNotIn("CANARY", answer)
        for field in ("title", "purpose"):
            self.sql("UPDATE workspaces SET " + field + "=? WHERE id='w1'", ("token=FIELD790",))
            self.assertNotIn("prompt", self.read())
            self.sql("UPDATE workspaces SET " + field + "='Safe' WHERE id='w1'")

    def test_bounded_topics_waits_and_now_excludes_shipped_and_other_sections(self):
        for n in range(102):
            self.topic("t-%03d" % n, "Topic %03d" % n)
        answer = self.read()["prompt"]
        self.assertIn("More open topics are not included", answer)
        self.assertEqual(answer.count("Needs a decision"), 100)
        self.sql("INSERT INTO pipelines VALUES ('w1',1,'Pipeline','item','items',0,0,'{}',1)")
        for number, title, section, finished in ((1, "Now short name", "now", ""), (2, "Later canary", "later", ""), (3, "Shipped canary", "now", "done")):
            self.sql("INSERT INTO pipeline_items(workspace_id,number,title,description,section,position,finished_note,version) VALUES ('w1',?,?,'',?,?,?,1)",
                     (number, title, section, number, finished))
        text = self.read()["prompt"]
        self.assertIn("1: Now short name", text)
        self.assertNotIn("Later canary", text)
        self.assertNotIn("Shipped canary", text)
        self.sql("INSERT INTO workspaces(id,owner_id,title,purpose,version) VALUES ('foreign','outsider','Foreign','Private',1)")
        self.sql("INSERT INTO pipelines VALUES ('foreign',1,'Other pipeline','item','items',0,0,'{}',1)")
        self.sql("INSERT INTO pipeline_items(workspace_id,number,title,description,section,position,version) VALUES ('foreign',7,'FOREIGN NOW CANARY','','now',1,1)")
        self.assertNotIn("FOREIGN NOW CANARY", self.read()["prompt"])
        self.sql("UPDATE pipeline_items SET title='Renamed Now' WHERE workspace_id='w1' AND number=1")
        self.assertIn("Renamed Now", self.read()["prompt"])

    def test_bounds_members_waits_and_release_history_are_explicit(self):
        self.topic()
        for n in range(105):
            name = "bounded-%03d" % n
            self.sql("INSERT INTO actors(id,kind,name) VALUES (?,'agent',?)", (name, name))
            self.sql("INSERT INTO workspace_members VALUES ('w1',?)", (name,))
            if n < 34:
                self.sql("INSERT INTO topic_waiting(topic_id,actor_id,said) VALUES ('t-open',?,1)", (name,))
        self.sql("INSERT INTO pipelines VALUES ('w1',1,'Pipeline','item','items',0,1,'{}',1)")
        for n in range(101):
            self.sql("INSERT INTO releases(number,commit_sha,deployed_at,deployed_ms,items,source,recorded_ms) VALUES (?,?,'2026-01-01',0,'[]','backfill',0)", (n + 1, "%040d" % n))
        text = self.read()["prompt"]
        self.assertIn("More team members are not included", text)
        self.assertIn("more waits not included", text)
        self.assertIn("No Now items", text)
        self.assertLess(len(json.dumps(text).encode()), 131072)
        self.sql("UPDATE workspaces SET purpose=? WHERE id='w1'", ("x" * 4097,))
        answer = self.read()
        self.assertNotIn("prompt", answer)
        self.assertEqual(answer["error"]["code"], "ONBOARDING_CONTEXT_TOO_LONG")


if __name__ == "__main__":
    unittest.main()
