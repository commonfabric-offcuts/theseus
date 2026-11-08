from __future__ import annotations

"""Agents make, revise and read Notebook pages with `note` and `notes`; every write reads itself back."""

import json
from pathlib import Path
import sqlite3
from unittest import mock

from aim_next import Store
import test_agent_verbs


# Words a careless copy would change: a carriage return, trailing spaces, a tab,
# characters outside ASCII and no final newline.
EXACT = "Results\r\n  first line   \n\tsecond line é 🪴\n\nlast line without a newline"


class NoteCase(test_agent_verbs.AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.file = Path(self.temp.name).resolve() / "page.md"
        self.file.write_bytes(EXACT.encode("utf-8"))

    def page(self, item, revision=None):
        if revision is None:
            return self.store.view("agent-a", "memory_current", {"item_id": item})
        return self.store.view("agent-a", "source", {"source_ref": {"kind": "memory", "id": item, "revision": revision}})

    def created(self, out):
        # `created ITEM "TITLE" in SCOPE at revision 1; read back matches`
        self.assertRegex(out, r'^created n-[0-9a-f]{32} ')
        return out.split()[1]

    def test_new_makes_a_page_in_an_outcome_from_a_file_and_reads_it_back(self):
        code, out, err = self.run_cli("note", "new", "w1", "--title", "Findings", str(self.file))
        self.assertEqual((code, err), (0, ""))
        item = self.created(out)
        self.assertEqual(out, 'created %s "Findings" in outcome w1 at revision 1; read back matches\n' % item)
        stored = self.page(item, 1)
        self.assertEqual((stored["title"], stored["body"], stored["author"], stored["owner_scope"]),
                         ("Findings", EXACT, "agent-a", {"kind": "workspace", "id": "w1"}))
        # The request was saved before it was sent, and its receipt after.
        [request] = [name for name in self.saved() if name.endswith(".request.json")]
        saved = json.loads((self.outbox() / request).read_text())["command"]
        self.assertEqual((saved["kind"], saved["target"], saved["expected"]["item_revision"]),
                         ("memory.create", {"item_id": item, "owner_scope": {"kind": "workspace", "id": "w1"}}, 0))
        self.assertIn(request.replace(".request.json", ".receipt.json"), self.saved())

    def test_new_takes_the_words_from_stdin_and_a_topic_notebook_with_topic(self):
        code, out, err = self.run_cli("--json", "note", "new", "t1", "--topic", "--title", "Plan", "-", stdin=EXACT.encode("utf-8"))
        self.assertEqual((code, err), (0, ""))
        receipt, source = [json.loads(line) for line in out.splitlines()]
        item = receipt["result"]["item_id"]
        self.assertEqual(receipt["result"]["owner_scope"], {"kind": "topic", "id": "t1"})
        self.assertEqual((source["body"], source["title"], source["version"]), (EXACT, "Plan", 1))

    def test_a_write_that_reads_back_different_fails_loudly(self):
        original = Store.view

        def view(store, actor, name, args):
            result = original(store, actor, name, args)
            if name == "source":
                result = dict(result, body=result["body"] + " (changed)")
            return result
        with mock.patch.object(Store, "view", view):
            code, out, err = self.run_cli("note", "new", "w1", "--title", "Findings", str(self.file))
        self.assertEqual((code, out), (1, ""))
        [item] = [row[0] for row in self.sql("SELECT id FROM memory_items")]
        self.assertEqual(err, "READ_BACK_MISMATCH: revision 1 of %s was recorded, but it reads back with a different body; "
                              "read it with `note read %s --revision 1` before writing again.\n" % (item, item))
        # The same with a title that comes back changed from the revision written.
        def titled(store, actor, name, args):
            result = original(store, actor, name, args)
            return dict(result, title="Other") if name == "source" else result
        with mock.patch.object(Store, "view", titled):
            code, out, err = self.run_cli("note", "revise", item, "--expected", "1", str(self.file))
        self.assertEqual((code, out), (1, ""))
        self.assertIn("revision 2 of %s was recorded, but it reads back with a different title" % item, err)

    def test_revise_keeps_the_title_and_evidence_unless_told(self):
        message = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]
        self.committed(self.memory(item="results", scope={"kind": "workspace", "id": "w1"}, title="Results",
                                   references=[{"kind": "message", "id": message}]))
        code, out, err = self.run_cli("note", "revise", "results", "--expected", "1", str(self.file))
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, 'revised results "Results" to revision 2; read back matches\n')
        stored = self.page("results", 2)
        self.assertEqual((stored["title"], stored["body"], stored["references"]), ("Results", EXACT, [{"kind": "message", "id": message}]))
        code, out, err = self.run_cli("note", "revise", "results", "--expected", "2", "--title", "Results, final", "-", stdin=b"Short")
        self.assertEqual((code, out, err), (0, 'revised results "Results, final" to revision 3; read back matches\n', ""))
        self.assertEqual((self.page("results")["title"], self.page("results")["body"]), ("Results, final", "Short"))

    def test_revise_from_a_stale_revision_is_refused_and_writes_nothing(self):
        self.committed(self.memory(item="results", scope={"kind": "workspace", "id": "w1"}))
        self.committed(self.memory(item="results", revision=1, body="Someone else's revision"))
        before = self.sql("SELECT count(*) FROM memory_revisions")
        code, out, err = self.run_cli("note", "revise", "results", "--expected", "1", str(self.file))
        self.assertEqual((code, out), (2, ""))
        self.assertIn("REVISION_CONFLICT", err)
        self.assertEqual(self.sql("SELECT count(*) FROM memory_revisions"), before)
        self.assertEqual(self.page("results")["body"], "Someone else's revision")

    def test_read_prints_the_latest_or_a_named_revision(self):
        self.committed(self.memory(item="results", scope={"kind": "workspace", "id": "w1"}, title="Results", body="First words\nsecond line"))
        self.committed(self.memory(item="results", revision=1, actor="agent-b", title="Results", body="Revised words"))
        code, out, err = self.run_cli("note", "read", "results")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, 'results  "Results"  revision 2 of 2 by agent-b  (outcome w1)\n\nRevised words\n')
        code, out, err = self.run_cli("note", "read", "results", "--revision", "1")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, 'results  "Results"  revision 1 of 2 by agent-a  (outcome w1)\n\nFirst words\nsecond line\n')
        code, out, _ = self.run_cli("--json", "note", "read", "results", "--revision", "1")
        self.assertEqual(json.loads(out), self.page("results", 1))
        # Reading records nothing: no command is sent.
        self.assertEqual(self.saved(), [])

    def test_a_page_the_reader_cannot_read_is_refused(self):
        self.committed(self.memory(item="results", scope={"kind": "workspace", "id": "w1"}))
        for argv in (["note", "read", "results"], ["note", "read", "missing"], ["notes", "w1"]):
            with self.subTest(argv=argv):
                code, out, err = self.run_cli(*argv, actor="outsider")
                self.assertEqual((code, out), (2, ""))
                self.assertIn("FORBIDDEN", err)
        before = self.records()
        code, out, err = self.run_cli("note", "new", "w1", "--title", "Not mine", str(self.file), actor="outsider")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        self.assertEqual(self.sql("SELECT count(*) FROM memory_items"), [(1,)])

    def test_notes_lists_an_outcomes_pages_and_says_which_changed_since_you_read_them(self):
        self.committed(self.memory(item="plan", scope={"kind": "workspace", "id": "w1"}, title="Plan"))
        self.committed(self.memory(item="results", scope={"kind": "workspace", "id": "w1"}, actor="agent-b", title="Results"))
        self.committed(self.memory(item="results", revision=1, actor="agent-b", title="Results"))
        self.committed(self.memory(item="results", revision=2, actor="agent-b", title="Results"))
        self.committed(self.memory(item="topic-page", title="Topic page"))
        # agent-a read revision 1 of results, which has two revisions since.
        self.committed(self.command("memory.read", {"revision": 1}, target={"item_id": "results"}, actor="agent-a"))
        code, out, err = self.run_cli("notes", "w1")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, 'plan  "Plan"  revision 1 by agent-a\n'
                              'results  "Results"  revision 3 by agent-b  [changed since you read revision 1]\n')
        code, out, _ = self.run_cli("notes", "t1", "--topic")
        self.assertEqual(out, 'topic-page  "Topic page"  revision 1 by agent-a\n')
        code, out, _ = self.run_cli("notes", "w1", actor="agent-b")
        # A page never read wears nothing, and neither does one read as it stands.
        self.assertEqual(out, 'plan  "Plan"  revision 1 by agent-a\nresults  "Results"  revision 3 by agent-b\n')

    def test_notes_says_when_there_are_none(self):
        self.assertEqual(self.run_cli("notes", "w1"), (0, "no Notebook pages\n", ""))

    def test_a_notebook_is_named_once(self):
        before = self.records()
        for argv in (["note", "new", "--title", "T", str(self.file)], ["note", "new", "w1", "t1", "--title", "T", str(self.file)],
                     ["notes"], ["notes", "w1", "t1"], ["note", "new", "w1", str(self.file)], ["note", "revise", "results", str(self.file)]):
            with self.subTest(argv=argv):
                code, out, err = self.run_cli(*argv)
                self.assertEqual((code, out), (2, ""))
                self.assertTrue(err.startswith("usage: aim-next"), err)
        self.assertEqual(self.records(), before)
        self.assertEqual(self.saved(), [])

    def test_a_file_that_cannot_be_read_or_is_not_utf8_sends_nothing(self):
        bad = self.file.with_name("bad.md")
        bad.write_bytes(b"caf\xe9")
        before = self.records()
        code, out, err = self.run_cli("note", "new", "w1", "--title", "T", str(self.file.with_name("missing.md")))
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FILE_UNAVAILABLE", err)
        code, out, err = self.run_cli("note", "new", "w1", "--title", "T", str(bad))
        self.assertEqual((code, out), (2, ""))
        self.assertIn("INVALID_REQUEST", err)
        self.assertEqual(self.records(), before)
        self.assertEqual(self.saved(), [])


class CurrentPageViewCase(test_agent_verbs.AgentVerbCase):
    def test_memory_current_reads_a_page_as_it_stands_and_names_its_revision(self):
        self.committed(self.memory(item="results", scope={"kind": "workspace", "id": "w1"}, body="One"))
        self.committed(self.memory(item="results", revision=1, body="Two"))
        latest = self.store.view("agent-b", "memory_current", {"item_id": "results"})
        self.assertEqual((latest["body"], latest["version"], latest["source_ref"]),
                         ("Two", 2, {"kind": "memory", "id": "results", "revision": 2}))
        # The same answer as the source view at that revision.
        self.assertEqual(latest, self.store.view("agent-b", "source", {"source_ref": latest["source_ref"]}))
        for actor, item in (("outsider", "results"), ("agent-b", "missing")):
            self.assertEqual(self.store.view(actor, "memory_current", {"item_id": item})["error"]["code"], "FORBIDDEN")
        # A source_ref without a revision still reads nothing.
        self.assertIn("error", self.store.view("agent-b", "source", {"source_ref": {"kind": "memory", "id": "results"}}))


for _case in (NoteCase, CurrentPageViewCase):
    for _base in _case.__mro__[1:]:
        for _name in list(vars(_base)):
            if _name.startswith("test_") and _name not in _case.__dict__:
                setattr(_case, _name, None)
# The loop's names would otherwise be found and run as test cases again.
del _case, _base, _name
