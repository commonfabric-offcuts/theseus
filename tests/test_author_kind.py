from __future__ import annotations

from reader_fixture import ReaderCase


class AuthorKindCase(ReaderCase):
    """A topic's messages say whether a person or an agent wrote each one, so the page can give each agent its color."""

    def test_each_message_says_what_kind_of_actor_wrote_it(self):
        for actor, args in (("agent-a", {"body": "From an agent"}), ("owner", {"body": "From a person"}),
                            ("agent-a", {"body": "To the owner", "addressees": ["owner"]})):
            self.committed(self.command("message.post", args, target={"topic_id": "t1"}, actor=actor))
        for audience in ("all", "reader"):
            page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 10, "audience": audience})
            self.assertNotIn("error", page, page)
            kinds = {item["body"]: (item["author_id"], item["author_kind"]) for item in page["items"]}
            self.assertEqual(kinds["From an agent"], ("agent-a", "agent"), audience)
            self.assertEqual(kinds["From a person"], ("owner", "human"), audience)
            self.assertEqual(kinds["To the owner"], ("agent-a", "agent"), audience)
