from __future__ import annotations

from unittest import mock

from aim_next.store import Store
from test_agent_verbs import AgentVerbCase


class NotebookColourCLI1028Case(AgentVerbCase):
    maxDiff = None

    def test_new_page_keeps_the_named_colour_and_exact_words(self):
        code, output, error = self.run_cli("note", "new", "t1", "--topic", "--title", "Colour CLI", "--color", "blue", "-", stdin="Exact words é\n".encode())
        self.assertEqual((code, error), (0, ""), output)
        item = self.sql("SELECT id FROM memory_items")[0][0]
        source = self.store.view("agent-a", "memory_current", {"item_id": item})
        self.assertEqual((source["color"], source["body"]), ("blue", "Exact words é\n"))

    def test_revision_omission_preserves_and_none_explicitly_clears(self):
        self.committed(self.memory(color="rose"))
        code, output, error = self.run_cli("note", "revise", "memory-one", "--expected", "1", "-", stdin=b"Second words\n")
        self.assertEqual((code, error), (0, ""), output)
        self.assertEqual(self.store.view("agent-a", "memory_current", {"item_id": "memory-one"})["color"], "rose")
        code, output, error = self.run_cli("note", "revise", "memory-one", "--expected", "2", "--color", "none", "-", stdin=b"Third words\n")
        self.assertEqual((code, error), (0, ""), output)
        source = self.store.view("agent-a", "memory_current", {"item_id": "memory-one"})
        self.assertEqual((source["color"], source["body"], source["version"]), (None, "Third words\n", 3))

    def test_note_read_shows_the_kept_colour_with_the_same_body(self):
        self.committed(self.memory(color="olive"))
        code, output, error = self.run_cli("note", "read", "memory-one")
        self.assertEqual((code, error), (0, ""))
        self.assertIn("Color: olive\n", output)
        self.assertIn("Original Notebook words\n", output)

    def test_invalid_palette_name_writes_nothing(self):
        before = self.records()
        code, output, error = self.run_cli("note", "new", "t1", "--topic", "--title", "Invalid", "--color", "orchid", "-", stdin=b"Must not write")
        self.assertEqual(code, 2)
        self.assertEqual(self.records(), before)

    def test_stale_colour_revision_keeps_the_current_choice(self):
        self.committed(self.memory(color="blue"))
        self.committed(self.memory(revision=1, color="green"))
        code, output, error = self.run_cli("note", "revise", "memory-one", "--expected", "1", "--color", "rose", "-", stdin=b"Stale words")
        self.assertEqual(code, 2)
        self.assertIn("REVISION_CONFLICT", error)
        source = self.store.view("agent-a", "memory_current", {"item_id": "memory-one"})
        self.assertEqual((source["color"], source["body"], source["version"]), ("green", "Original Notebook words", 2))

    def test_colour_readback_difference_is_reported_without_rewriting_the_recorded_page(self):
        original = Store.view
        def changed(store, actor, name, args):
            answer = original(store, actor, name, args)
            if name == "source" and args.get("source_ref", {}).get("kind") == "memory":
                return dict(answer, color="rose")
            return answer
        with mock.patch.object(Store, "view", changed):
            code, output, error = self.run_cli("note", "new", "t1", "--topic", "--title", "Read back", "--color", "blue", "-", stdin=b"Kept once")
        self.assertEqual(code, 1)
        self.assertIn("READ_BACK_MISMATCH", error)
        self.assertIn("color", error)
        self.assertEqual(self.sql("SELECT color,body FROM memory_revisions"), [("blue", "Kept once")])
