from __future__ import annotations

import unittest
from unittest import mock

from reader_fixture import ReaderCase


class AnswerDelivery625(ReaderCase):
    def post(self, actor="agent-a", parent=None, ask=True, go_ahead=False, topic="t1", **extra):
        args = dict(body="A separate question?" if ask else "An actual answer.",
                    addressees=["owner"] if ask else ["agent-a"], intent="ask" if ask else "tell")
        if parent:
            args["reply_to"] = parent
        if parent and actor.startswith("agent-"):
            args["reply_without_quote"] = "The entire scratch question is relevant"
        if ask and actor.startswith("agent-"):
            cover = self.store.view(actor, "dossier_cover", {"message_id": parent}) if parent else None
            args["ask_wait"] = dict(root_id=cover["root_id"] if cover else None,
                cover_revision=cover["cover_revision"] if cover else 0,
                questions=[dict(actor_id="owner", text="A separate question?", options=[], default=None,
                                reason="This scratch question offers no choices or default")])
        if go_ahead:
            args["go_ahead"] = True
        args.update(extra)
        return self.command("message.post", args, target={"topic_id": topic}, actor=actor)

    def ask(self, **extra):
        return self.committed(self.post(**extra))["message_id"]

    def thumb(self, ask, on=True, revision=0, op=None):
        return self.command("message.thumb", {"thumbed": on}, target={"message_id": ask},
                            expected={"thumb_revision": revision}, op=op)

    def inbox(self):
        return self.store.view("agent-a", "deliveries", {})["items"]

    def ack(self, item):
        return self.committed(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-a"))

    def test_answering_thumb_is_delivered_without_public_writing_and_survives_restart(self):
        ask = self.ask()
        before = self.sql("SELECT count(*) FROM messages")[0][0]
        self.committed(self.thumb(ask))
        items = [x for x in self.inbox() if x.get("answer")]
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]["answer"]["message_id"], items[0]["answer"]["actor_id"],
                          items[0]["answer"]["value"], items[0]["answer"]["stands"]), (ask, "owner", "yes", True))
        self.assertEqual(self.sql("SELECT count(*) FROM messages")[0][0], before)
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(len(self.inbox()),)])
        from aim_next import Store
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual([x["id"] for x in self.inbox() if x.get("answer")], [items[0]["id"]])

    def test_unread_thumb_blocks_same_dossier_ask_before_supersession_but_ack_allows_it(self):
        ask = self.ask()
        self.committed(self.thumb(ask))
        before = self.sql("SELECT * FROM messages"), self.sql("SELECT * FROM question_closures")
        result = self.post(parent=ask)
        self.rejected(result, "ANSWER_UNREAD")
        self.assertEqual((self.sql("SELECT * FROM messages"), self.sql("SELECT * FROM question_closures")), before)
        item = next(x for x in self.inbox() if x.get("answer"))
        self.assertIn(item["id"], str(result["error"]))
        self.ack(item)
        self.committed(self.post(parent=ask))

    def test_existing_explicit_answer_and_actual_reply_block_without_duplicate_delivery(self):
        for mode in ["decision", "reply"]:
            ask = self.ask(go_ahead=mode == "decision")
            if mode == "decision":
                answered = self.committed(self.command("message.answer", {"answer": "yes"},
                    target={"message_id": ask}, expected={"answer_revision": 0}))
                answer = answered["reply_id"]
            else:
                answer = self.committed(self.post(actor="owner", parent=ask, ask=False))["message_id"]
            items = [x for x in self.inbox() if x["message_id"] == answer]
            self.assertEqual(len(items), 1)
            self.rejected(self.post(parent=ask), "ANSWER_UNREAD")
            self.ack(items[0])
            self.committed(self.post(parent=ask))

    def test_ordinary_thumb_and_other_dossier_do_not_block(self):
        told = self.committed(self.post(ask=False, addressees=["owner"]))["message_id"]
        self.committed(self.thumb(told))
        self.assertFalse(any(x.get("answer") for x in self.inbox()))
        ask = self.ask()
        self.committed(self.thumb(ask))
        self.ask()  # Another dossier, despite the unread answer in this one.
        self.committed(self.post(parent=ask, ask=False))

    def test_taken_back_answer_stops_blocking_and_old_ack_cannot_settle_new_answer(self):
        ask = self.ask()
        first = self.thumb(ask, op="answer-once")
        self.committed(first)
        self.assertEqual(self.thumb(ask, op="answer-once"), first)
        self.committed(self.thumb(ask, revision=1))  # No change, no second receipt.
        old = next(x for x in self.inbox() if x.get("answer"))
        self.committed(self.thumb(ask, on=False, revision=1))
        self.assertFalse(next(x for x in self.inbox() if x["id"] == old["id"])["answer"]["stands"])
        self.committed(self.post(parent=ask, ask=False))
        self.committed(self.thumb(ask, revision=2))
        new = next(x for x in self.inbox() if x.get("answer", {}).get("stands"))
        self.assertNotEqual(old["id"], new["id"])
        self.ack(old)
        self.rejected(self.post(parent=ask), "ANSWER_UNREAD")
        self.ack(new)
        self.committed(self.post(parent=ask))

    def test_people_never_get_new_receipts_or_the_next_ask_gate(self):
        self.participation("other-reader", True)
        ask = self.committed(self.post(actor="owner", addressees=["other-reader"]))["message_id"]
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": ask},
                                    expected={"thumb_revision": 0}, actor="other-reader"))
        self.assertEqual(self.sql("SELECT * FROM answer_receipts"), [])
        self.committed(self.post(actor="owner", parent=ask, addressees=["other-reader"]))

    def test_receipt_queue_and_wait_removal_roll_back_together(self):
        ask = self.ask()
        before = self.records()
        with mock.patch.object(self.store, "_queue_delivery", side_effect=RuntimeError("owned queue fault")):
            with self.assertRaisesRegex(RuntimeError, "owned queue fault"):
                self.thumb(ask, op="atomic-answer")
        self.assertEqual(self.records(), before)
        self.committed(self.thumb(ask, op="atomic-answer"))
        self.assertEqual(len([x for x in self.inbox() if x.get("answer")]), 1)

    def test_read_through_does_not_ack_an_answer_to_an_older_question(self):
        ask = self.ask()
        self.committed(self.thumb(ask))
        self.committed(self.command("topic.read_through", {"seq": 9223372036854775807},
                                    target={"topic_id": "t1"}, actor="agent-a"))
        self.assertEqual(len(self.inbox()), 1)
        self.assertTrue(self.inbox()[0].get("answer"))
        self.rejected(self.post(parent=ask), "ANSWER_UNREAD")

    def test_actual_bound_cli_and_hosted_notice_name_the_answer_and_question(self):
        import subprocess
        import sys
        from pathlib import Path
        from aim_next.profile import write_profile
        from aim_next import hosted_notice
        ask = self.ask()
        self.committed(self.thumb(ask))
        answer = next(x for x in self.inbox() if x.get("answer"))
        profile = Path(self.temp.name) / "agent.profile.json"
        write_profile(profile, self.path, "test-instance", "agent-a", binding=self.binding)
        result = subprocess.run([sys.executable, "-I", "bin/aim-next", "--profile", str(profile), "inbox"],
                                 text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for text in ("answer", "owner", ask, answer["id"]):
            self.assertIn(text, result.stdout)
        notice = hosted_notice.notice([answer], None, "agent-a", "fixture-answer", True)
        text = notice["input"][0]["text"]
        self.assertIn("answer in topic t1 from owner to question " + ask, text)
        self.assertIn(answer["id"], text)
        preview = next(iter(notice["additionalContext"].values()))["value"]
        self.assertIn('"from": "owner"', preview)
        self.assertIn("yes", preview)
        ack = subprocess.run([sys.executable, "-I", "bin/aim-next", "--profile", str(profile), "ack", answer["id"]],
                             text=True, capture_output=True)
        self.assertEqual(ack.returncode, 0, ack.stderr)
        self.committed(self.post(parent=ask))

    def test_current_join_and_split_control_which_dossier_is_blocked(self):
        ask = self.ask()
        target = self.ask()
        self.committed(self.thumb(ask))
        self.committed(self.command("stack.join", {"into": target}, target={"message_id": ask},
                                    expected={"join_revision": 0}, actor="agent-a"))
        self.rejected(self.post(parent=target), "ANSWER_UNREAD")
        self.committed(self.command("stack.join", {"into": None}, target={"message_id": ask},
                                    expected={"join_revision": 1}, actor="agent-a"))
        self.committed(self.post(parent=target))
        self.rejected(self.post(parent=ask), "ANSWER_UNREAD")

    def test_migration_preserves_normal_and_request_delivery_identity_and_refuses_answer_loss(self):
        from aim_next import Store
        from aim_next.migrations import migrate, MigrationError
        ask = self.ask()
        cover = self.store.view("owner", "dossier_cover", {"message_id": ask})
        self.committed(self.command("stack.cover_refresh", target={"message_id": ask}, expected={"cover_revision": cover["cover_revision"]}))
        self.source(self.opening, actor="agent-a")
        self.committed(self.command("message.edit", {"body": "An actually edited opening"},
            target={"message_id": self.opening["id"]}, expected={"message_revision": 1}))
        self.assertTrue(self.sql("SELECT 1 FROM deliveries WHERE revision=2"))
        before = self.sql("SELECT seq,id,message_id,recipient_id,group_id,state,topic_id,revision,request_id FROM deliveries ORDER BY seq")
        reasons = self.sql("SELECT * FROM delivery_reasons ORDER BY delivery_id,reason")
        counts = self.sql("SELECT * FROM recipient_schedule")
        sequence = self.sql("SELECT seq FROM sqlite_sequence WHERE name='deliveries'")
        migrate(self.path, "test-instance", self.binding, "57")
        self.assertEqual(migrate(self.path, "test-instance", self.binding)["schema_version"], "58")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.sql("SELECT seq,id,message_id,recipient_id,group_id,state,topic_id,revision,request_id FROM deliveries ORDER BY seq"), before)
        self.assertEqual(self.sql("SELECT * FROM delivery_reasons ORDER BY delivery_id,reason"), reasons)
        self.assertEqual(self.sql("SELECT * FROM recipient_schedule"), counts)
        self.assertEqual(self.sql("SELECT seq FROM sqlite_sequence WHERE name='deliveries'"), sequence)
        self.committed(self.thumb(ask))
        self.assertGreater(next(x for x in self.inbox() if x.get("answer"))["seq"], sequence[0][0])
        with self.assertRaises(MigrationError):
            migrate(self.path, "test-instance", self.binding, "57")

    def test_taking_back_the_only_answer_permits_an_ask_with_its_delivery_still_pending(self):
        ask = self.ask()
        self.committed(self.thumb(ask))
        self.committed(self.thumb(ask, on=False, revision=1))
        self.assertTrue(any(x.get("answer") for x in self.inbox()))
        self.committed(self.post(parent=ask))

    def test_every_asked_persons_unread_answer_must_be_acknowledged(self):
        self.participation("other-reader", True)
        ask = self.ask(addressees=["owner", "other-reader"], ask_wait=dict(root_id=None, cover_revision=0,
            questions=[dict(actor_id=who, text="Question?", options=[], default=None, reason="No choices or default")
                       for who in ["owner", "other-reader"]]))
        self.committed(self.thumb(ask))
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": ask},
                                    expected={"thumb_revision": 0}, actor="other-reader"))
        answers = [x for x in self.inbox() if x.get("answer")]
        self.assertEqual(len(answers), 2)
        self.ack(answers[0])
        self.rejected(self.post(parent=ask), "ANSWER_UNREAD")
        self.ack(answers[1])
        self.committed(self.post(parent=ask))

    def test_answer_arriving_after_prepare_is_checked_before_send_and_preserves_frozen_writing(self):
        ask = self.ask()
        cover = self.store.view("agent-a", "dossier_cover", {"message_id": ask})
        self.committed(self.command("draft.save", dict(source_ref={"kind": "message", "id": ask}, topic_id="t1",
            generation="prepared-answer", body="Prepared exact question?", addressees=["owner"], intent="ask",
            reply_without_quote="The complete scratch question is relevant", ask_wait=dict(root_id=cover["root_id"],
                cover_revision=cover["cover_revision"], questions=[dict(actor_id="owner", text="Question?", options=[],
                    default=None, reason="No choices or default")])), target={"draft_id": "prepared-answer"},
            expected={"draft_revision": 0}, actor="agent-a"))
        self.committed(self.command("submission.prepare", dict(draft_id="prepared-answer", submission_id="prepared-answer",
            send_operation_id="prepared-answer-send"), target={"topic_id": "t1"}, expected={"draft_revision": 1}, actor="agent-a"))
        frozen = self.sql("SELECT * FROM submissions")
        self.committed(self.thumb(ask))
        send = lambda: self.command("message.send", {"submission_id": "prepared-answer"}, target={"topic_id": "t1"},
                                    actor="agent-a", op="prepared-answer-send")
        refused = send()
        self.rejected(refused, "ANSWER_UNREAD")
        self.assertFalse(refused["recorded"])
        self.assertEqual(self.sql("SELECT * FROM submissions"), frozen)
        self.ack(next(x for x in self.inbox() if x.get("answer")))
        # A frozen cover basis still goes through its ordinary revision check.
        self.rejected(send(), "REVISION_CONFLICT")
        self.assertEqual(self.sql("SELECT * FROM submissions"), frozen)
        self.committed(self.post(parent=ask))

    def test_answer_arrival_is_claimable_by_the_actual_runner(self):
        for item in self.inbox():
            self.ack(item)
        ask = self.ask()
        self.committed(self.thumb(ask))
        answer = next(x for x in self.inbox() if x.get("answer"))
        guard = self.store.runner_guard("fixture-625-runner")
        guard.__enter__()
        self.addCleanup(guard.close)
        token = self.store.acquire_runner(guard)["runner_token"]
        result = self.store.claim_wakes(guard, token, ["agent-a"])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["claims"]), 1)
        self.assertEqual(result["claims"][0]["recipient_id"], "agent-a")
        self.assertEqual(result["claims"][0]["captured_seq"], answer["seq"])

    def test_losing_access_settles_answer_without_leaking_it_in_a_preview(self):
        ask = self.ask()
        self.committed(self.thumb(ask))
        answer = next(x for x in self.inbox() if x.get("answer"))
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-a", "present": False},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.participation("agent-a", False)
        self.assertFalse(any(x.get("answer") for x in self.inbox()))
        self.assertIn("error", self.store.view("agent-a", "delivery", {"delivery_id": answer["id"]}))
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE id=?", (answer["id"],)), [("acknowledged",)])

    def test_health_dates_the_new_answer_instead_of_the_old_question(self):
        import sqlite3
        for item in self.inbox():
            self.ack(item)
        with mock.patch("aim_next.conversation._now_ms", return_value=1000):
            ask = self.ask()
        with mock.patch("aim_next.reactions._now_ms", return_value=2000):
            self.committed(self.thumb(ask))
        with sqlite3.connect(str(self.path)) as db:
            self.assertEqual(self.store._on_record_waiting(db, "agent-a"), (1, 2000))

    def test_move_keeps_answer_identity_and_guard_in_the_destination(self):
        ask = self.ask()
        self.committed(self.thumb(ask))
        answer = next(x for x in self.inbox() if x.get("answer"))
        self.committed(self.save_draft("move-draft", {"kind": "new_topic", "id": "move-opening", "workspace_id": "w1"},
            "t2", "Destination", opening={"workspace_id": "w1", "title": "Destination", "participants": ["agent-a"]}))
        self.committed(self.prepare("move-draft", "t2", submission="move-opening", send_op="open-destination"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "move-opening"}, target={"topic_id": "t2"}, op="open-destination"))
        self.committed(self.command("stack.move", {"topic_id": "t2"}, target={"message_id": ask},
                                    expected={"source_topic_id": "t1", "move_revision": 0}, actor="agent-a"))
        moved = next(x for x in self.inbox() if x["id"] == answer["id"])
        self.assertEqual(moved["topic"]["id"], "t2")
        self.assertEqual(moved["answer"], answer["answer"])
        cover = self.store.view("agent-a", "dossier_cover", {"message_id": ask})
        args = dict(body="A destination question?", addressees=["owner"], intent="ask", reply_to=ask,
            reply_without_quote="The whole moved question is relevant", ask_wait=dict(root_id=cover["root_id"],
            cover_revision=cover["cover_revision"], questions=[dict(actor_id="owner", text="Question?", options=[],
                default=None, reason="No options or default")]))
        self.rejected(self.command("message.post", args, target={"topic_id": "t2"}, actor="agent-a"), "ANSWER_UNREAD")

    def test_conversation_uses_its_real_answerer_route_and_derives_waiting_from_the_thumb(self):
        conversation = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        root = self.committed(self.post(actor="owner", ask=False, topic=conversation))["message_id"]
        ask = self.ask(parent=root, topic=conversation)
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": conversation})["topic"]["state"], "waiting")
        self.committed(self.thumb(ask))
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": conversation})["topic"]["state"], "active")
        self.rejected(self.post(parent=root, topic=conversation), "ANSWER_UNREAD")
        self.ack(next(x for x in self.inbox() if x.get("answer")))
        self.committed(self.post(parent=root, topic=conversation))

    def test_private_actual_reply_blocks_only_its_asker(self):
        ask = self.ask()
        reply = self.committed(self.post(actor="owner", parent=ask, ask=False, whisper=True, intent=None))["message_id"]
        refused = self.post(parent=ask)
        self.rejected(refused, "ANSWER_UNREAD")
        self.assertIn(reply, str(refused["error"]))
        self.committed(self.post(actor="agent-b", parent=ask))
        self.assertIn("error", self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": reply}}))

    def test_latest_explicit_decision_replaces_the_old_unread_decision(self):
        ask = self.ask(go_ahead=True)
        old = self.committed(self.command("message.answer", {"answer": "yes"}, target={"message_id": ask},
                                          expected={"answer_revision": 0}))["reply_id"]
        new = self.committed(self.command("message.answer", {"answer": "no"}, target={"message_id": ask},
                                          expected={"answer_revision": 1}))["reply_id"]
        self.ack(next(x for x in self.inbox() if x["message_id"] == new))
        self.assertTrue(any(x["message_id"] == old for x in self.inbox()))
        self.committed(self.post(parent=ask))


if __name__ == "__main__":
    unittest.main()
