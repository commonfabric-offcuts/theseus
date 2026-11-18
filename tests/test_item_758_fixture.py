from __future__ import annotations

from item_758_fixture import PassageFixture
from test_store import StoreCase
import sqlite3


class NativeFixtureCase(StoreCase):
    def test_actual_http_fixture_binding_keeps_whisper_to_an_agent(self):
        from fixtures.ui_http import item758_fixture
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,?,?)", [
                ("fixture-notebook-agent", "agent", "Synthetic posting agent"),
                ("fixture-outside-agent", "agent", "Synthetic private recipient"),
                ("fixture-other-person", "human", "Synthetic other human")])
        self.create_topic()
        def command(kind, operation, args, target=None, expected=None, sender=None, refusable=False):
            result = self.command(kind, args, target, expected, actor=sender or "owner", op=operation)
            assert refusable or result["status"] == "committed", result
            return result
        fixture = item758_fixture(lambda: self.store, command, self.path, "owner")
        before = fixture.begin("t1")
        self.assertEqual(len(before["refusals"]), 3)
        self.assertTrue(fixture.finish("t1")["retry_public_unchanged"])

    def test_native_fixture_uses_real_core_and_exact_approved_words(self):
        self.create_topic()
        def command(kind, operation, args, target=None, expected=None, sender=None, refusable=False):
            result = self.command(kind, args, target, expected, actor=sender or "owner", op=operation)
            assert refusable or result["status"] == "committed", result
            return result
        fixture = PassageFixture(lambda: self.store, command, self.path, "owner", "agent-a", "agent-b")
        before = fixture.begin("t1")
        self.assertEqual(len(before["refusals"]), 3)
        after = fixture.finish("t1")
        self.assertTrue(after["retry_public_unchanged"])


def load_tests(loader, tests, pattern):
    import unittest
    return unittest.TestSuite(NativeFixtureCase(name) for name in loader.getTestCaseNames(NativeFixtureCase)
                              if name in NativeFixtureCase.__dict__)
