from __future__ import annotations

"""Getting something in is one line: a topic from a title alone or from a message
with nothing written, and an outcome's title and purpose set in place afterwards
(docs/openings.md)."""

import hashlib
import io
import json
import unittest

from aim_next.contract import LIMITS
import reader_fixture as fixtures


class QuickStartCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a (its coordinator)
    # and agent-b as members. Its topic t1 was created by owner, with agent-a in it.

    def setUp(self):
        super().setUp()
        self.message = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]

    def start(self, topic, participants=(), body="", actor="owner", **extra):
        opening = "o-" + topic
        self.committed(self.command("opening.save", dict({
            "workspace_id": "w1", "topic_id": topic, "title": "Started " + topic, "participants": list(participants),
            "body": body, "attachments": []}, **extra), target={"opening_id": opening},
            expected={"opening_revision": 0}, actor=actor))
        return self.command("opening.publish", {}, target={"opening_id": opening}, expected={"opening_revision": 1}, actor=actor)

    def ready_file(self, media_id="file-only"):
        """A ready attachment, as the opening tests make one."""
        data, publish = b"a file\n", "publish-" + media_id
        self.committed(self.command("media.begin", {
            "name": "file.txt", "content_type": "text/plain", "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "publish_operation_id": publish,
        }, target={"media_id": media_id}, expected={"media_revision": 0}))
        self.committed(self.store.publish_media("owner", self.envelope("media.publish", {"media_id": media_id}, {},
                                                                        {"media_revision": 1}, op=publish), io.BytesIO(data)))
        return {"id": media_id}

    def messages(self, topic):
        return self.sql("SELECT body,quotes,author_id FROM messages WHERE topic_id=? ORDER BY seq", (topic,))

    def test_a_title_alone_starts_the_topic_with_no_message(self):
        before = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        receipt = self.start("t-bare", participants=["agent-a"])
        result = self.committed(receipt)
        self.assertIsNone(result["message_id"])
        self.assertEqual(result["delivery"], {"queued": 0, "unavailable_subscribers": []})
        self.assertEqual(self.messages("t-bare"), [], "no message, not an empty one")
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries d JOIN messages m ON m.id=d.message_id WHERE m.topic_id='t-bare'"), [(0,)])
        version = self.sql("SELECT version FROM topics WHERE id='t-bare'")[0][0]
        self.assertEqual(result["topic"], {"id": "t-bare", "version": version})
        self.assertEqual(self.store.view("owner", "opening", {"opening_id": "o-t-bare"})["opening"]["message_id"], None)
        # Its people are in it, and the one who is not its author learns so; the author is told nothing.
        self.assertEqual(sorted(row[0] for row in self.sql("SELECT actor_id FROM topic_participants WHERE topic_id='t-bare' AND active=1")),
                         ["agent-a", "owner"])
        told = self.sql("SELECT scope_id,version FROM changes WHERE scope_kind='actor' AND resource_kind='participation' AND resource_id='t-bare'")
        self.assertIn(("agent-a", version), told)
        self.assertNotIn("owner", [scope for scope, _ in told])
        # It is the outcome's latest activity, and the outcome's version moved on.
        latest = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "limit": 5})
        self.assertNotIn("error", latest, latest)
        self.assertEqual(latest["items"][0]["id"], "t-bare")
        self.assertGreater(self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0], before)
        self.assertEqual(self.store.view("agent-a", "topic", {"topic_id": "t-bare"})["topic"]["title"], "Started t-bare")

    def test_written_words_still_open_the_topic_as_its_first_message(self):
        result = self.committed(self.start("t-words", body="The opening words"))
        self.assertIsNotNone(result["message_id"])
        self.assertEqual(self.messages("t-words"), [("The opening words", "[]", "owner")])

    def test_a_topic_started_from_a_message_with_nothing_written_opens_with_its_words_quoted(self):
        words = "Line one of it.\nLine two of it."
        self.message = self.send("  " + words + "\n")["id"]
        result = self.committed(self.start("t-quoted", source_message_id=self.message))
        self.assertEqual(len(self.messages("t-quoted")), 1, "the topic opens with one message")
        [(body, quotes, author)] = self.messages("t-quoted")
        self.assertEqual(result["message_id"], self.sql("SELECT id FROM messages WHERE topic_id='t-quoted'")[0][0])
        self.assertEqual(body, "> Line one of it.\n> Line two of it.")
        self.assertEqual(json.loads(quotes), [{"source": {"kind": "message", "id": self.message}, "excerpt": words}])
        self.assertEqual(author, "owner")
        # Words written in it are its opening instead, and nothing is quoted.
        self.committed(self.command("opening.save", {
            "workspace_id": "w1", "topic_id": "t-own", "title": "Own", "participants": [], "body": "My own words",
            "attachments": [], "source_message_id": self.message}, target={"opening_id": "o-t-own"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {"seen": ["t-quoted"]}, target={"opening_id": "o-t-own"},
                                    expected={"opening_revision": 1}))
        self.assertEqual(self.messages("t-own"), [("My own words", "[]", "owner")])

    def test_a_source_too_long_to_quote_whole_is_cut_at_its_end_and_still_quoted_from_its_words(self):
        line = "x" * 99 + "\n"
        words = line * (LIMITS["body_utf8_bytes"] // len(line))
        self.message = self.send(words)["id"]
        self.committed(self.start("t-long", source_message_id=self.message))
        self.assertEqual(len(self.messages("t-long")), 1, "the topic opens with one message")
        [(body, quotes, _)] = self.messages("t-long")
        self.assertLessEqual(len(body.encode("utf-8")), LIMITS["body_utf8_bytes"])
        [quote] = json.loads(quotes)
        self.assertTrue(words.startswith(quote["excerpt"]), "the excerpt is the source's own words, from the start")
        self.assertLess(len(quote["excerpt"]), len(words.strip()))
        self.assertEqual(body, "\n".join("> " + part for part in quote["excerpt"].split("\n")))

    def test_a_source_with_no_words_starts_the_topic_from_its_title_alone(self):
        self.message = self.send(" \n ", attachments=[self.ready_file()])["id"]
        result = self.committed(self.start("t-silent", source_message_id=self.message))
        self.assertIsNone(result["message_id"])
        self.assertEqual(self.messages("t-silent"), [])
        self.assertEqual(self.sql("SELECT source_message_id FROM topics WHERE id='t-silent'"), [(self.message,)])

    def test_a_blank_title_is_still_refused(self):
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t-blank", "title": " ", "participants": [],
                                                     "body": "", "attachments": []}, target={"opening_id": "o-blank"},
                                    expected={"opening_revision": 0}))
        self.rejected(self.command("opening.publish", {}, target={"opening_id": "o-blank"}, expected={"opening_revision": 1}), "EMPTY_TITLE")
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE id='t-blank'"), [(0,)])


class WorkspaceUpdateCase(fixtures.ReaderCase):
    def version(self):
        return self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]

    def update(self, args, actor="owner", revision=None, target=None):
        return self.command("workspace.update", args, target=target or {"workspace_id": "w1"},
                            expected={"workspace_revision": self.version() if revision is None else revision}, actor=actor)

    def test_whoever_organises_the_outcome_sets_its_purpose_and_title_in_place(self):
        version = self.version()
        result = self.committed(self.update({"purpose": "Ship the forms piece"}))
        self.assertEqual(result, {"workspace_id": "w1", "title": "Isolated test", "purpose": "Ship the forms piece", "version": version + 1})
        self.assertEqual(self.sql("SELECT title,purpose,version FROM workspaces WHERE id='w1'"), [("Isolated test", "Ship the forms piece", version + 1)])
        self.assertIn(("workspace", "w1", "workspace", "w1", version + 1),
                      self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes"))
        # Its coordinator may too.
        result = self.committed(self.update({"title": "Renamed", "purpose": ""}, actor="agent-a"))
        self.assertEqual((result["title"], result["purpose"], result["version"]), ("Renamed", "", version + 2))
        self.assertEqual(self.store.view("agent-b", "workspace", {"workspace_id": "w1"})["workspace"]["purpose"], "")

    def test_nothing_changed_moves_nothing_on(self):
        version = self.version()
        changes = self.sql("SELECT count(*) FROM changes")
        result = self.committed(self.update({"title": "Isolated test"}))
        self.assertEqual(result["version"], version)
        self.assertEqual((self.version(), self.sql("SELECT count(*) FROM changes")), (version, changes))

    def test_refusals_change_nothing(self):
        before = self.sql("SELECT title,purpose,version FROM workspaces WHERE id='w1'")
        self.rejected(self.update({"purpose": "Mine now"}, actor="agent-b"), "FORBIDDEN")
        self.rejected(self.update({"purpose": "Mine now"}, actor="outsider"), "FORBIDDEN")
        self.rejected(self.update({"title": " \n"}), "EMPTY_TITLE")
        self.rejected(self.update({"purpose": "Late"}, revision=self.version() - 1), "REVISION_CONFLICT")
        self.rejected(self.update({"purpose": "x" * (LIMITS["body_utf8_bytes"] + 1)}), "BODY_TOO_LARGE")
        for args in ({}, {"owner_id": "agent-b"}, {"purpose": "p", "team": []}):
            with self.subTest(args=args):
                self.rejected(self.update(args), "INVALID_ARGUMENT")
        self.rejected(self.update({"purpose": "p"}, target={"workspace_id": "w1", "topic_id": "t1"}), "INVALID_ARGUMENT")
        self.rejected(self.command("workspace.update", {"purpose": "p"}, target={"workspace_id": "w1"}, expected={}), "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT title,purpose,version FROM workspaces WHERE id='w1'"), before)


if __name__ == "__main__":
    unittest.main()
