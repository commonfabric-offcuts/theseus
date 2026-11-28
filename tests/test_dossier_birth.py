from __future__ import annotations

import sqlite3

from aim_next import Store
from reader_fixture import ReaderCase


class BirthCase(ReaderCase):
    def setUp(self):
        super().setUp()
        self.participation("agent-b", True)
        self.root = self.post("Which cabin should we book?")
        self.reply = self.post("I will check the cabins.", actor="agent-a", reply_to=self.root)

    def post(self, body, actor="owner", **args):
        if "reply_to" in args:
            args["reply_without_quote"] = "Fixture isolates dossier birth."
        result = self.committed(self.command("message.post", dict(body=body, **args),
                                             target={"topic_id": "t1"}, actor=actor))
        return result["message_id"]

    def birth(self, actor="agent-a", reply=None, root=None, expected=None, op=None, **facts):
        return self.command("stack.birth", dict(reply_id=reply or self.reply, **facts),
                            target={"message_id": root or self.root},
                            expected={"name_revision": 0, "cover_revision": 0} if expected is None else expected,
                            actor=actor, op=op)

    def cover(self, message=None, actor="owner"):
        return self.store.view(actor, "dossier_cover", {"message_id": message or self.root})

    def name(self):
        return self.store.view("owner", "stack_namer", {"message_id": self.root})

    def write_cover(self, revision, *, actor="owner", **args):
        return self.committed(self.command("stack.cover", args, target={"message_id": self.root},
                                           expected={"cover_revision": revision}, actor=actor))

    def test_birth_mints_name_and_records_cover_once_and_survives_reopen(self):
        facts = {"name": "Cabin booking decision", "nature": "Decision", "done_when": "Owner confirms the cabin.",
                 "stands": "Checking dates.\nComparing prices."}
        receipt = self.birth(op="birth-once", **facts)
        result = self.committed(receipt)
        self.assertEqual((result["name_revision"], result["cover_revision"]), (1, 1))
        self.assertEqual(self.birth(op="birth-once", **facts), receipt)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        cover = self.cover(self.reply)["cover"]
        self.assertEqual(cover["stands"], facts["stands"])
        self.assertEqual(cover["birth"], {"nature": facts["nature"], "done_when": facts["done_when"]})
        self.assertEqual(self.name()["name"]["text"], facts["name"])
        self.assertEqual(self.name()["name"]["by"], "agent-a")
        self.rejected(self.birth(expected={"cover_revision": 1, "name_revision": 1},
                                 done_when="Different evidence"), "BIRTH_RECORDED")
        self.write_cover(1, stands="Dates confirmed.")
        self.assertEqual(self.cover()["cover"]["birth"], cover["birth"])

    def test_both_fences_keep_a_persons_name_and_existing_cover(self):
        self.committed(self.command("stack.name", {"name": "My cabin plan"}, target={"message_id": self.root},
                                   expected={"name_revision": 0}))
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": self.reply},
                                   expected={"thumb_revision": 0}))
        self.write_cover(0, stands="Owner chose a date.", waiting=[{"text": "Which cabin?", "default": "West"}],
                         payload={"text": "Cabin list", "kind": "answer", "message_id": self.reply})
        before = self.cover()["cover"]
        self.assertNotIn("birth", before)
        self.assertEqual(before["payload"]["done"]["by"], "owner")
        for expected in ({"cover_revision": 0, "name_revision": 1}, {"cover_revision": 1, "name_revision": 0}):
            stale = self.birth(expected=expected, name="Proposed other name", nature="Decision")
            self.rejected(stale, "REVISION_CONFLICT")
            self.assertEqual(stale["error"]["current_versions"], {"cover_revision": 1, "name_revision": 1})
        self.rejected(self.birth(expected={"name_revision": 1}, nature="Decision"), "INVALID_ARGUMENT")
        self.assertEqual(self.cover()["cover"], before)
        result = self.committed(self.birth(expected={"cover_revision": 1, "name_revision": 1},
                                          name="Proposed other name", nature="Decision", stands="Draft"))
        self.assertEqual(result["cover"]["payload"], before["payload"])
        self.assertEqual(result["cover"]["stands"], before["stands"])
        self.assertEqual(result["cover"]["waiting"], before["waiting"])
        self.assertEqual(self.name()["name"]["text"], "My cabin plan")

    def test_only_first_public_responder_with_current_root_can_record_birth(self):
        later = self.post("Another response", actor="agent-b", reply_to=self.root)
        whisper = self.post("Private details", addressees=["agent-a"], whisper=True)
        private = self.post("Private reply", actor="agent-a", reply_to=whisper, addressees=["owner"], whisper=True)
        self.rejected(self.birth(actor="agent-b", reply=private, nature="Private fact"), "FORBIDDEN")
        self.rejected(self.birth(actor="agent-b", reply=later, nature="Tracking"), "NOT_FIRST_RESPONDER")
        self.rejected(self.birth(reply=private, nature="Private fact"), "WHISPER_STAYS_PRIVATE")
        other = self.post("Separate dossier")
        self.rejected(self.birth(root=other, nature="Other facts"), "STACK_CHANGED")
        self.assertIsNone(self.cover()["cover"])

    def test_other_namer_keeps_the_existing_mint_authority(self):
        root = self.post("New dossier")
        reply = self.post("First public answer", actor="agent-b", reply_to=root)
        self.rejected(self.birth(actor="agent-b", root=root, reply=reply, name="Other agent name",
                                 done_when="Owner chooses"), "NOT_THE_NAMER")
        result = self.committed(self.birth(actor="agent-b", root=root, reply=reply, done_when="Owner chooses"))
        self.assertEqual(result["cover"]["birth"], {"done_when": "Owner chooses"})
        self.assertEqual(result["name_revision"], 0)
        self.assertEqual(self.cover(root)["cover"]["birth"], result["cover"]["birth"])

    def test_cover_write_failure_rolls_back_the_name_and_original_retry_succeeds(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER reject_birth_cover BEFORE INSERT ON message_acts WHEN NEW.kind='cover' "
                       "BEGIN SELECT RAISE(ABORT,'birth cover fixture'); END")
        facts = {"name": "Cabin booking decision", "nature": "Decision"}
        failed = self.birth(op="birth-rollback", **facts)
        self.rejected(failed, "INTERNAL_ERROR")
        self.assertFalse(failed["recorded"])
        self.assertEqual((self.name()["name_revision"], self.cover()["cover_revision"]), (0, 0))
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER reject_birth_cover")
        result = self.committed(self.birth(op="birth-rollback", **facts))
        self.assertEqual((result["name_revision"], result["cover_revision"]), (1, 1))

    def test_clearing_the_cover_with_retained_birth_facts_leaves_refresh_pending(self):
        self.committed(self.birth(nature="Decision", stands="Need dates."))
        self.committed(self.command("stack.cover_refresh", target={"message_id": self.root},
                                   expected={"cover_revision": 1}))
        self.write_cover(1, actor="agent-a", stands=None)
        cleared = self.cover()
        self.assertEqual(cleared["cover"]["birth"], {"nature": "Decision"})
        self.assertEqual(cleared["refresh"]["state"], "pending")
        self.write_cover(2, actor="agent-a", stands="Dates confirmed.")
        self.assertEqual(self.cover()["refresh"]["state"], "completed")
