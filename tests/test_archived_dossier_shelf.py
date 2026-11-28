from __future__ import annotations

from test_stacks import StackCase


class ArchivedShelfCase(StackCase):
    def archive(self, mid, *, restore=False, revision=0, actor="owner"):
        seq = self.sql("SELECT max(seq) FROM messages WHERE topic_id='t1'")[0][0]
        return self.command("stack.aside", {"through": None if restore else seq}, target={"message_id": mid},
                            expected={"aside_revision": revision}, actor=actor)

    def page(self, cursor=None, limit=2, actor="owner", topic="t1"):
        args = {"topic_id": topic, "limit": limit}
        if cursor is not None:
            args["cursor"] = cursor
        return self.store.view(actor, "dossier_archive", args)

    def roots(self, page):
        self.assertNotIn("error", page, page)
        return [item["message_id"] for item in page["items"]]

    def test_projects_off_page_roots_and_keeps_star_then_dossier_order(self):
        oldest, second, third, fourth = [self.post("Archive %d" % n) for n in range(4)]
        child = self.post("An older reply", reply_to=oldest)
        for root in (oldest, second, third, fourth):
            self.committed(self.archive(root))
        self.committed(self.star(child))
        self.committed(self.name(second, "Named archive"))
        for n in range(6):
            self.post("Unarchived %d" % n)
        feed = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 3})
        self.assertFalse(set(self.roots(self.page())) & {row["id"] for row in feed["items"]})
        first = self.page()
        self.assertEqual(self.roots(first), [oldest, fourth])
        self.assertEqual(first["remaining"], 2)
        self.assertEqual(first["items"][0]["count"], 2)
        self.assertTrue(first["items"][0]["starred"])
        self.assertEqual(first["items"][1]["aside_revision"], 1)
        second_page = self.page(first["next_cursor"])
        self.assertEqual(self.roots(second_page), [third, second])
        self.assertEqual(second_page["items"][1]["name"], "Named archive")
        self.assertIsNone(second_page["next_cursor"])
        self.assertEqual(second_page["remaining"], 0)
        self.assertEqual(self.roots(self.page(actor="agent-a")), [])
        self.assertIn("error", self.page(actor="outsider"))

    def test_restore_and_visible_other_author_reply_remove_rows(self):
        root, second = self.post("Old dossier"), self.post("Another archive")
        self.committed(self.archive(root))
        self.committed(self.archive(second))
        self.post("Own reply", actor="owner", reply_to=root)
        self.assertCountEqual(self.roots(self.page()), [root, second])
        self.committed(self.archive(second, restore=True, revision=1))
        self.assertEqual(self.roots(self.page()), [root])
        self.post("New reply from someone else", reply_to=root)
        self.assertEqual(self.roots(self.page()), [])

    def test_ignores_old_archive_revisions_and_joined_roots(self):
        root, target = self.post("Dormant source"), self.post("Destination")
        self.committed(self.archive(root))
        self.committed(self.archive(root, restore=True, revision=1))
        self.committed(self.archive(root, revision=2))
        self.assertEqual(self.page()["items"][0]["aside_revision"], 3)
        self.committed(self.join(root, target))
        self.assertEqual(self.roots(self.page()), [])
        self.assertIn("error", self.page(cursor=[1, True, 2, 3]))

    def test_cursor_advances_past_a_page_of_joined_candidates(self):
        old = self.post("Still archived")
        self.committed(self.archive(old))
        destination = self.post("A separate dossier")
        for n in range(5):
            root = self.post("Already joined %d" % n)
            self.committed(self.archive(root))
            self.committed(self.join(root, destination))
        first = self.page(limit=1)
        self.assertEqual(self.roots(first), [])
        self.assertIsNotNone(first["next_cursor"])
        self.assertIsNone(first["remaining"])
        self.assertEqual(self.roots(self.page(first["next_cursor"], limit=1)), [old])

    def test_archive_unread_is_the_members_own_pending_or_marked_count(self):
        root = self.post("Archived unread")
        child = self.post("An archived unread reply", reply_to=root)
        self.committed(self.archive(root))
        unrelated = self.post("Unread elsewhere in this topic")
        self.committed(self.command("message.mark", {"marked": True}, target={"message_id": unrelated}, expected={"mark_revision": 0}))
        first = self.page()["items"][0]
        self.assertEqual(first["unread"], 2)
        seq = self.source({"kind": "message", "id": child})["seq"]
        self.committed(self.command("topic.read_through", {"seq": seq}, target={"topic_id": "t1"}))
        self.committed(self.command("message.mark", {"marked": True}, target={"message_id": child}, expected={"mark_revision": 0}))
        self.assertEqual(self.page()["items"][0]["unread"], 1)

    def test_remaining_count_is_omitted_when_the_lookahead_is_open_ended(self):
        roots = [self.post("Archived %d" % n) for n in range(18)]
        for root in roots:
            self.committed(self.archive(root))
        first = self.page(limit=8)
        self.assertEqual(self.roots(first), list(reversed(roots))[:8])
        self.assertIsNone(first["remaining"])
        second = self.page(first["next_cursor"], limit=8)
        self.assertEqual(self.roots(second), list(reversed(roots))[8:16])
        self.assertEqual(second["remaining"], 2)
