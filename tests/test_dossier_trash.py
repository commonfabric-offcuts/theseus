from __future__ import annotations

from reader_fixture import ReaderCase
from tests.historical_fixture import post_fields


class TrashCase(ReaderCase):
    def trash(self, message, trashed, revision, *, actor="owner", op=None):
        return self.command("stack.trash", {"trashed": trashed}, target={"message_id": message},
                            expected={"trash_revision": revision}, actor=actor, op=op)

    def post(self, body, **args):
        return self.committed(self.command("message.post", post_fields(self, "agent-a", dict(args, body=body)),
                                           target={"topic_id": "t1"}, actor="agent-a"))["message_id"]

    def page(self, actor="owner", **args):
        page = self.store.view(actor, "dossier_trash", dict(args, topic_id="t1"))
        self.assertNotIn("error", page, page)
        return page

    def position(self, message, actor="owner"):
        result = self.store.view(actor, "stack_positions", {"topic_id": "t1", "message_ids": [message]})
        self.assertNotIn("error", result, result)
        return result["items"][0]["stack_position"]

    def test_trash_keeps_retracted_words_and_omits_unsent_roots(self):
        def trashed(body):
            root = self.committed(self.command("message.post", {"body": body}, target={"topic_id": "t1"}))["message_id"]
            self.committed(self.trash(root, True, 0))
            return root

        retracted = trashed("Keep the retracted title.")
        removed = trashed("Erase the unsent title.")
        act = self.committed(self.command("message.retract", target={"message_id": retracted}))["removal"]
        self.committed(self.command("message.unsend", target={"message_id": removed}))
        row, = self.page()["items"]
        self.assertEqual((row["message_id"], row["excerpt"], row["removal"]), (retracted, "Keep the retracted title.", act))

    def test_trash_is_personal_revision_fenced_and_does_not_change_archive_or_stars(self):
        root = self.opening["id"]
        child = self.post("Part of the dossier", reply_to=root)
        through = self.sql("SELECT max(seq) FROM messages WHERE topic_id='t1'")[0][0]
        self.committed(self.command("stack.aside", {"through": through}, target={"message_id": root},
                                    expected={"aside_revision": 0}))
        self.committed(self.command("message.star", {"starred": True}, target={"message_id": root},
                                    expected={"star_revision": 0}))
        before = self.position(child)
        self.rejected(self.trash(child, True, 0), "STACK_CHANGED")
        self.rejected(self.trash(root, True, 0, actor="outsider"), "FORBIDDEN")
        saved = self.trash(root, True, 0, op="first-trash")
        self.assertEqual(self.trash(root, True, 0, op="first-trash"), saved)
        first = self.committed(saved)
        self.assertEqual(first["trash_revision"], 1)
        self.rejected(self.trash(root, False, 0), "REVISION_CONFLICT")
        self.assertFalse(self.committed(self.trash(root, True, 1))["changed"])
        trashed = self.position(child)
        self.assertEqual((trashed["trashed"], trashed["trash_revision"]), (True, 1))
        self.assertNotIn("trashed", self.position(child, actor="agent-a"))
        self.assertEqual(self.page("agent-a")["items"], [])
        self.assertEqual(self.store.view("outsider", "dossier_trash", {"topic_id": "t1"})["error"]["code"], "FORBIDDEN")
        seen, = self.page()["items"]
        self.assertEqual((seen["message_id"], seen["starred"], seen["star_revision"]), (root, True, 1))
        self.committed(self.trash(root, False, 1))
        self.assertEqual(self.page()["items"], [])
        restored = self.position(child)
        self.assertEqual((restored["trashed"], restored["trash_revision"]), (False, 2))
        for key in ("below", "through", "aside_revision", "starred", "order_key", "order_tie", "placed"):
            self.assertEqual((trashed[key], restored[key]), (before[key], before[key]), key)
        self.assertEqual(self.sql("SELECT scope_kind,scope_id FROM changes WHERE resource_kind='acts' AND version>=?",
                                  (first["acts_version"],)),
                         [("actor", "owner"), ("actor", "owner")])

    def test_trash_page_uses_action_order_and_retains_its_bound_after_restore(self):
        roots = [self.post("Separate dossier %d" % n) for n in range(4)]
        for root in roots:
            self.committed(self.trash(root, True, 0))
        page = self.page(limit=2)
        self.assertEqual([row["message_id"] for row in page["items"]], roots[:1:-1])
        self.committed(self.trash(roots[-1], False, 1))
        last = self.page(limit=2, cursor=page["next_cursor"])
        self.assertEqual([row["message_id"] for row in last["items"]], roots[1::-1])
        self.assertIsNone(last["next_cursor"])
        for cursor in (True, "3", 0, 1 << 64):
            answer = self.store.view("owner", "dossier_trash", {"topic_id": "t1", "cursor": cursor})
            self.assertEqual(answer["error"]["code"], "INVALID_ARGUMENT")

    def test_current_trash_follows_a_dossier_move_and_keeps_its_revision(self):
        root = self.post("A dossier moving to a different topic")
        self.committed(self.trash(root, True, 0))
        self.committed(self.command("opening.save", {
            "workspace_id": "w1", "topic_id": "target", "title": "Target topic",
            "participants": [], "body": "", "attachments": [],
        }, target={"opening_id": "trash-test-destination"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", target={"opening_id": "trash-test-destination"},
                                    expected={"opening_revision": 1}))
        self.committed(self.command("stack.move", {"topic_id": "target"}, target={"message_id": root},
                                    expected={"source_topic_id": "t1", "move_revision": 0}))
        self.assertEqual(self.page()["items"], [])
        moved, = self.store.view("owner", "dossier_trash", {"topic_id": "target"})["items"]
        self.assertEqual((moved["message_id"], moved["trash_revision"]), (root, 1))
        self.assertEqual(self.sql("SELECT topic_id FROM message_acts WHERE kind='trash'"), [("target",)])
        self.assertEqual(self.committed(self.trash(root, False, 1))["topic_id"], "target")

    def test_joined_roots_remain_dormant_in_the_trash_index(self):
        other = self.post("A dossier that stays in Trash")
        parent = self.post("A dossier outside Trash")
        joined = self.post("A dossier that will be joined")
        self.committed(self.trash(other, True, 0))
        for revision in range(9):
            self.committed(self.trash(joined, revision % 2 == 0, revision))
        self.committed(self.command("stack.join", {"into": parent}, target={"message_id": joined},
                                    expected={"join_revision": 0}))
        first = self.page(limit=1)
        self.assertEqual(first["items"], [])
        self.assertIsNotNone(first["next_cursor"])
        self.assertEqual([row["message_id"] for row in self.page(limit=1, cursor=first["next_cursor"])["items"]], [other])
        self.assertNotIn("trashed", self.position(joined))
        self.committed(self.command("stack.join", {"into": None}, target={"message_id": joined},
                                    expected={"join_revision": 1}))
        self.assertEqual(self.position(joined)["trash_revision"], 9)
