from __future__ import annotations

import unittest
from test_stacks import StackCase


class OutlineStars(StackCase):
    def scoped(self, actor="owner", **args):
        return self.store.view(actor, "stars", dict(topic_id="t1", **args))

    def test_titles_follow_real_roots_names_and_live_star_order(self):
        first = self.post("**First words**\n\nMore words")
        second = self.post("Second words")
        reply = self.post("A reply", reply_to=first)
        self.committed(self.star(first))
        self.committed(self.star(second))
        self.committed(self.star(reply))
        self.committed(self.name(first, "Equal names"))
        page = self.scoped(limit=2)
        self.assertNotIn("error", page, page)
        self.assertEqual([r["message_id"] for r in page["items"]], [reply, second])
        self.assertEqual([r["dossier"]["id"] for r in page["items"]], [first, second])
        self.assertEqual(page["items"][0]["dossier"]["name"], "Equal names")
        next_page = self.scoped(limit=2, cursor=page["next_cursor"])
        self.assertEqual([r["dossier"]["id"] for r in next_page["items"]], [first])
        self.committed(self.name(first, "", revision=1))
        self.assertEqual(self.scoped()["items"][0]["dossier"]["body"], "**First words**\n\nMore words")
        self.assertEqual(self.scoped()["items"][0]["dossier"]["name"], "")
        self.committed(self.star(reply, False, revision=1))
        self.assertEqual(self.scoped()["items"][0]["message_id"], second)
        self.committed(self.join(second, first))
        self.assertEqual({r["dossier"]["id"] for r in self.scoped()["items"]}, {first})

    def test_scoped_reads_do_not_expose_another_actor_or_private_note(self):
        first = self.post("Public title")
        self.committed(self.star(first))
        self.assertNotIn("error", self.scoped())
        self.assertEqual(self.scoped(actor="agent-a")["items"], [])
        self.assertEqual(self.scoped(actor="outsider")["error"]["code"], "FORBIDDEN")
        self.assertEqual(set(self.scoped()["items"][0]["dossier"]), {"id", "name", "body", "attachments"})
        self.assertNotIn("dossier", self.store.view("owner", "stars", {})["items"][0], "existing unscoped shape is unchanged")

    def test_scoped_empty_and_denied_topic_have_no_fallback_to_other_topics(self):
        self.assertEqual(self.scoped()["items"], [])
        root = self.post("Only in t1")
        self.committed(self.star(root))
        denied = self.store.view("owner", "stars", {"topic_id": "missing"})
        self.assertEqual(denied["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.scoped(limit=0)["error"]["code"], "INVALID_ARGUMENT")


if __name__ == "__main__":
    unittest.main()
