from __future__ import annotations

"""770 sources and privacy, through Core and CLI in isolated records."""

import sqlite3

from aim_next.cover_values import shown
from test_dossier_covers import CoverCase


class WaitSource770Case(CoverCase):
    def wait(self, **fields):
        return dict(text="Choose a date", default="Keep the current date", **fields)

    def test_recorded_source_roundtrips_all_cover_views_and_partial_updates(self):
        root, source, _ = self.dossier()
        wait = self.wait(message_id=source)
        self.committed(self.cover(root, {"waiting": [wait]}))
        self.assertEqual(self.rows()[-1][0]["waiting"], [wait])
        for actor in ("owner", "agent-a", "agent-b"):
            self.assertEqual(self.shown(root, actor)["waiting"], [wait])
            self.assertEqual(self.store.view(actor, "dossier_cover", {"message_id": source})["cover"]["waiting"], [wait])
            placed = self.store.view(actor, "stack_positions", {"topic_id": "t1", "message_ids": [source]})
            self.assertEqual(placed["items"][0]["stack_position"]["cover"]["waiting"], [wait])
        self.committed(self.cover(root, {"stands": "A date is pending"}, revision=1))
        self.assertEqual(self.rows()[-1][0]["waiting"], [wait])

    def test_cli_records_the_supplied_reply_before_resolving_its_root(self):
        root, source, _ = self.dossier()
        code, out, err = self.run_cli("cover", source, "--waits", "Choose a date", "--default", "Keep the current date")
        self.assertEqual((code, err), (0, ""), out)
        self.assertEqual(self.shown(root)["waiting"], [self.wait(message_id=source)])

    def test_omitted_and_null_sources_are_not_backfilled(self):
        root, _, _ = self.dossier()
        waits = [self.wait(), self.wait(message_id=None)]
        self.committed(self.cover(root, {"waiting": waits}))
        self.committed(self.cover(root, {"stands": "Still waiting"}, revision=1))
        self.assertEqual(self.shown(root)["waiting"], waits)
        self.assertEqual(self.rows()[-1][0]["waiting"], waits)

    def test_membership_and_whisper_refusals_are_atomic(self):
        root, source, _ = self.dossier()
        other = self.post("Another dossier")
        private = self.post("A private reply", reply_to=root, whisper=True, addressees=["agent-a"])
        self.committed(self.cover(root, {"waiting": [self.wait(message_id=source)]}))
        before = self.rows()
        for message, actor, code in ((other, "agent-a", "INVALID_ARGUMENT"),
                                     ("m-" + "0" * 32, "agent-a", "INVALID_ARGUMENT"),
                                     (private, "agent-a", "WHISPER_STAYS_PRIVATE"),
                                     (private, "agent-b", "INVALID_ARGUMENT")):
            with self.subTest(message=message, actor=actor):
                self.rejected(self.cover(root, {"stands": "Must not stick", "waiting": [self.wait(message_id=message)]},
                                         revision=1, actor=actor), code)
                self.assertEqual(self.rows(), before)

    def test_a_private_dossier_can_link_its_own_private_source(self):
        root = self.post("Private dossier", whisper=True, addressees=["agent-a"])
        source = self.post("Private detail", reply_to=root, whisper=True, addressees=["agent-a"])
        self.committed(self.cover(root, {"waiting": [self.wait(message_id=source)]}))
        self.assertEqual(self.shown(root, "agent-a")["waiting"][0]["message_id"], source)
        self.assertEqual(self.shown(root, "agent-b"), "absent")

    def test_projection_filters_both_sources_without_mutating_the_record(self):
        root, public, _ = self.dossier()
        private = self.post("Private source", reply_to=root, whisper=True, addressees=["agent-a"])
        # Read-side defense against old/recovered values: even a stored hidden
        # source must not escape through a cover. No live records are changed.
        waits = [self.wait(message_id=private, ask_id=public), self.wait(ask_id=private),
                 self.wait(message_id=public, ask_id=private)]
        value = dict(stands=None, waiting=waits, payload=None)
        with sqlite3.connect(str(self.path)) as db:
            db.row_factory = sqlite3.Row
            owner = shown(db, "owner", value, "agent-a", 1, "owner")["waiting"]
            outsider = shown(db, "agent-b", value, "agent-a", 1, "owner")["waiting"]
        self.assertEqual(owner, waits)
        self.assertEqual(outsider, [self.wait(ask_id=public), self.wait(), self.wait(message_id=public)])
        self.assertEqual(value["waiting"], waits, "reader projection never edits stored values")

    def test_existing_ask_and_answer_fence_survive_manual_wait_writes(self):
        root, _, _ = self.dossier()
        question = dict(actor_id="owner", text="Choose a date?", options=["Keep", "Move"], default="Keep", reason=None)
        ask = self.post("Choose a date?", actor="agent-a", reply_to=root, intent="ask", addressees=["owner"],
                        go_ahead=True, ask_wait=dict(root_id=root, cover_revision=0, questions=[question]))
        before = self.shown(root)["waiting"][0]
        self.assertEqual((before["ask_id"], before["go_ahead"], before["answer_revision"]), (ask, True, 0))
        self.committed(self.cover(root, {"waiting": [self.wait(message_id=root)]}, revision=1))
        after = self.shown(root)["waiting"]
        self.assertEqual(after, [self.wait(message_id=root), before])
        self.assertNotIn("go_ahead", self.shown(root, "agent-b")["waiting"][1])
        self.committed(self.command("message.answer", {"answer": "yes"}, target={"message_id": ask},
                                    expected={"answer_revision": 0}, actor="owner"))
        self.assertEqual(self.shown(root)["waiting"], [self.wait(message_id=root)])

