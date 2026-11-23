from __future__ import annotations

import hashlib
import sqlite3
from unittest import mock
from aim_next import migrations, colors
from aim_next import memory as memory_module
from reader_fixture import ReaderCase


class NotebookColours1028Case(ReaderCase):
    def test_uncoloured_page_exposes_a_core_fact_without_changing_words(self):
        self.committed(self.memory())
        source = self.store.view("owner", "memory_current", {"item_id": "memory-one"})
        self.assertIn("color", source)
        self.assertIsNone(source["color"])
        self.assertEqual(source["body"], "Original Notebook words")

    def test_page_colour_history_omission_and_clear_are_kept_in_revision_stream(self):
        before = self.public_state()
        self.committed(self.memory(color="blue"))
        self.committed(self.memory(revision=1, body="Different words"))
        self.assertEqual(self.source(self.memory_ref(revision=1))["color"], "blue")
        self.assertEqual(self.source(self.memory_ref(revision=2))["color"], "blue")
        self.committed(self.memory(revision=2, color=None, body="Different words"))
        self.assertIsNone(self.source(self.memory_ref(revision=3))["color"])
        self.assertEqual(self.source(self.memory_ref(revision=2))["color"], "blue")
        self.assertEqual(self.public_state(), before)

    def test_colour_is_page_specific_not_an_individual_card_marker(self):
        body = '## Card\n\n<!-- theseus-card: {"id":"c-11111111111111111111111111111111","aliases":[],"color":"rose"} -->\n\nWords\n'
        self.committed(self.memory(item="text-page", color="green"))
        self.committed(self.memory(item="card-stack", color="blue", body=body))
        self.committed(self.memory(item="text-page", revision=1, color="olive"))
        self.assertEqual(self.source(self.memory_ref("text-page", 2))["color"], "olive")
        stack = self.source(self.memory_ref("card-stack"))
        self.assertEqual(stack["color"], "blue")
        self.assertEqual(stack["body"], body)

    def test_stale_and_invalid_colour_requests_cannot_replace_a_later_choice(self):
        self.committed(self.memory(color="blue"))
        self.committed(self.memory(revision=1, color="green"))
        self.rejected(self.memory(revision=1, color="rose"), "REVISION_CONFLICT")
        for color in ("orchid", "#00ff00", [], {}, False):
            with self.subTest(color=color):
                self.rejected(self.memory(revision=2, color=color), "INVALID_ARGUMENT")
        self.assertEqual(self.source(self.memory_ref(revision=2))["color"], "green")

    def test_all_palette_names_current_list_status_and_exact_replay_agree(self):
        colors = ("green", "blue", "indigo", "violet", "rose", "peach", "cyan", "olive")
        self.committed(self.memory())
        for revision, color in enumerate(colors, 1):
            envelope = self.envelope("memory.revise", {"item_id": "memory-one"}, {
                "title": "Notebook", "body": "Original Notebook words", "attachments": [], "references": [], "color": color},
                {"item_revision": revision})
            receipt = self.store.command("agent-a", envelope)
            self.committed(receipt)
            self.assertEqual(self.store.command("agent-a", envelope), receipt)
            for name, args in (("memory_current", {"item_id": "memory-one"}), ("memory_status", {"item_id": "memory-one"})):
                state = self.store.view("owner", name, args)
                self.assertEqual((state["color"], state["source_ref"]["revision"]), (color, revision + 1))
            listed = self.store.view("owner", "memory_items", {"owner_scope": {"kind": "topic", "id": "t1"}})
            self.assertEqual(listed["items"][0]["color"], color)
        self.assertEqual(self.sql("SELECT count(*) FROM memory_revisions"), [(9,)])

    def test_delete_restore_keeps_colour_and_draft_access_is_still_authoritative(self):
        self.committed(self.memory(actor="owner", color="rose", draft=True))
        self.rejected(self.memory(revision=1, actor="agent-a", color="blue"), "FORBIDDEN")
        self.rejected(self.memory(revision=1, actor="outsider", color="blue"), "FORBIDDEN")
        for revision, deleted in ((1, True), (2, False)):
            self.committed(self.command("memory.delete", {"deleted": deleted}, target={"item_id": "memory-one"}, expected={"item_revision": revision}))
            state = self.store.view("owner", "memory_current", {"item_id": "memory-one"})
            self.assertEqual((state["color"], state["draft"], state["deleted"]), ("rose", True, deleted))
        self.committed(self.memory(actor="owner", revision=3, color="blue", draft=False))
        self.assertEqual(self.source(self.memory_ref(revision=4))["color"], "blue")


class NotebookColourMigration1028Case(ReaderCase):
    def color_step(self):
        # A carry can renumber this step after another judged migration.
        self.assertTrue(hasattr(memory_module, "MEMORY_COLOR_SCHEMA"), "Notebook colour migration is present")
        MEMORY_COLOR_SCHEMA = memory_module.MEMORY_COLOR_SCHEMA
        steps=[(old,new) for old,new,up,_,_ in migrations.STEPS if up==MEMORY_COLOR_SCHEMA]
        self.assertEqual(len(steps),1)
        return steps[0]

    def test_existing_history_gets_null_and_empty_downgrade_preserves_it(self):
        self.committed(self.memory())
        self.committed(self.memory(revision=1, body="Second words"))
        original = self.sql("SELECT item_id,revision,author_id,operation_id,title,body,attachments,refs,draft,deleted FROM memory_revisions")
        migrations.migrate(self.path, "test-instance", self.binding, self.color_step()[0])
        with sqlite3.connect(str(self.path)) as db:
            self.assertNotIn("color", [row[1] for row in db.execute("PRAGMA table_info(memory_revisions)")])
        migrations.migrate(self.path, "test-instance", self.binding)
        self.assertEqual(self.sql("SELECT color FROM memory_revisions"), [(None,), (None,)])
        self.assertEqual(self.sql("SELECT item_id,revision,author_id,operation_id,title,body,attachments,refs,draft,deleted FROM memory_revisions"), original)

    def test_cleared_current_colour_cannot_erase_historical_colour_on_downgrade(self):
        self.committed(self.memory(color="blue"))
        self.committed(self.memory(revision=1, color=None))
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        with self.assertRaises(migrations.MigrationError):
            migrations.migrate(self.path, "test-instance", self.binding, self.color_step()[0])
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), digest)


    def test_failed_colour_step_rolls_back_the_whole_file(self):
        self.committed(self.memory())
        before,after=self.color_step()
        migrations.migrate(self.path, "test-instance", self.binding, before)
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        steps = tuple((old, new, list(up) + ["SELECT missing_colour_1028 FROM metadata"], down, occupied)
                      if (old, new) == (before, after) else (old, new, up, down, occupied)
                      for old, new, up, down, occupied in migrations.STEPS)
        self.assertEqual(sum((old, new) == (before, after) for old, new, _, _, _ in steps), 1)
        with mock.patch.object(migrations, "STEPS", steps):
            with self.assertRaises(migrations.MigrationError):
                migrations.migrate(self.path, "test-instance", self.binding)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), digest)

class NotebookPaletteEvolution1028Case(ReaderCase):
    def test_retired_name_reads_as_none_in_all_four_projections_without_rewriting_history(self):
        self.committed(self.memory(color="blue"))
        self.committed(self.command("memory.star", {"starred": True}, target={"item_id": "memory-one"}, expected={"star_revision": 0}))
        offered = tuple(name for name in colors.AGENT_COLORS if name != "blue")
        with mock.patch.object(colors, "AGENT_COLORS", offered), mock.patch.object(memory_module, "AGENT_COLORS", offered):
            views = [self.store.view("owner", name, {"item_id": "memory-one"}) for name in ("memory_current", "memory_status")]
            views.append(self.store.view("owner", "memory_items", {"owner_scope": {"kind": "topic", "id": "t1"}})["items"][0])
            views.append(self.store.view("owner", "memory_stars", {"topic_id": "t1"})["items"][0])
            for source in views:
                self.assertIn("color", source)
                self.assertIsNone(source["color"], source)
            self.rejected(self.memory(revision=1, color="blue"), "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT color FROM memory_revisions WHERE item_id='memory-one'"), [("blue",)])

    def test_newly_offered_name_writes_to_migrated_and_fresh_databases(self):
        self.committed(self.memory())
        schema = getattr(memory_module, "MEMORY_COLOR_SCHEMA", None)
        self.assertIsNotNone(schema, "Notebook colour migration exists")
        before = next(old for old, new, up, down, occupied in migrations.STEPS if up is schema)
        migrations.migrate(self.path, "test-instance", self.binding, before)
        migrations.migrate(self.path, "test-instance", self.binding)
        offered = colors.AGENT_COLORS + ("future-fixture-hue",)
        with mock.patch.object(colors, "AGENT_COLORS", offered), mock.patch.object(memory_module, "AGENT_COLORS", offered):
            self.committed(self.memory(revision=1, color="future-fixture-hue"))
            fresh = ReaderCase()
            fresh.setUp()
            self.addCleanup(fresh.doCleanups)
            self.committed(fresh.memory(color="future-fixture-hue"))
            for store in (self.store, fresh.store):
                source = store.view("owner", "memory_current", {"item_id": "memory-one"})
                self.assertEqual(source["color"], "future-fixture-hue")

