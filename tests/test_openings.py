from __future__ import annotations

import hashlib
import io
import json
import unittest

from aim_next.contract import LIMITS
import test_store as fixtures


class OpeningsCase(fixtures.StoreCase):
    def setUp(self):
        super().setUp()
        self.workspace()
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('outsider','agent','Outside fixture agent')")

    def writing(self, **fields):
        args = {"workspace_id": "w1", "topic_id": "t-new", "title": "A new topic", "participants": ["agent-a"],
                "body": "The opening words", "attachments": []}
        args.update(fields)
        return args

    def save(self, opening="o1", revision=0, actor="owner", op=None, **fields):
        return self.command("opening.save", self.writing(**fields), {"opening_id": opening},
                            {"opening_revision": revision}, actor=actor, op=op)

    def act(self, kind, opening="o1", revision=1, actor="owner", op=None, args=None):
        return self.command(kind, args or {}, {"opening_id": opening}, {"opening_revision": revision}, actor=actor, op=op)

    def committed(self, receipt):
        self.assertEqual(receipt.get("status"), "committed", receipt)
        self.assertTrue(receipt["recorded"], receipt)
        return receipt["result"]

    def refused(self, receipt, code, recorded=True):
        self.assertEqual(receipt.get("status"), "rejected", receipt)
        self.assertEqual(receipt["error"]["code"], code, receipt)
        self.assertIs(receipt["recorded"], recorded, receipt)
        return receipt

    def view(self, name, actor="owner", **args):
        return self.store.view(actor, name, args)

    def opening(self, opening="o1", actor="owner"):
        answer = self.view("opening", actor, opening_id=opening)
        self.assertNotIn("error", answer, answer)
        return answer

    def published_records(self):
        return {table: self.sql("SELECT * FROM " + table + " ORDER BY rowid") for table in (
            "topics", "topic_participants", "topic_summaries", "messages", "deliveries", "delivery_groups")}

    def stored_openings(self):
        return self.sql("SELECT * FROM openings ORDER BY rowid")

    def assert_closed(self, revision):
        # A closed opening refuses as closed at any expected revision, never as a conflict to reconcile.
        for stale in (revision, revision - 1, 0):
            with self.subTest(revision=stale):
                for receipt in (self.save(revision=stale, body="Late"), self.act("opening.publish", revision=stale),
                                self.act("opening.discard", revision=stale)):
                    self.assertNotIn("current_versions", self.refused(receipt, "OPENING_CLOSED")["error"])

    def media(self, media_id, data=b"opening attachment\n", ready=True, actor="owner"):
        publish = "publish-" + media_id
        self.committed(self.command("media.begin", {
            "name": "opening.txt", "content_type": "text/plain", "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "publish_operation_id": publish,
        }, target={"media_id": media_id}, expected={"media_revision": 0}, actor=actor))
        if ready:
            self.committed(self.store.publish_media(actor, {
                "v": 1, "instance_id": "test-instance", "operation_id": publish, "kind": "media.publish",
                "target": {"media_id": media_id}, "expected": {"media_revision": 1, "authority": dict(self.pin)},
                "args": {}}, io.BytesIO(data)))
        return {"id": media_id}

    def test_save_creates_then_replaces_whole_private_writing(self):
        first = self.committed(self.save())
        self.assertEqual(first, {"opening_id": "o1", "opening_revision": 1, "state": "open"})
        self.assertEqual(self.opening(), {"instance_id": "test-instance", "publish_receipt": None, "opening": {
            "id": "o1", "workspace_id": "w1", "topic_id": "t-new", "revision": 1, "state": "open",
            "title": "A new topic", "participants": ["agent-a"], "body": "The opening words", "attachments": [],
            "publish_operation_id": None, "message_id": None}})
        pending = self.media("pending-media", ready=False)
        second = self.save(revision=1, title="", body="", participants=[], attachments=[pending])
        self.assertEqual(self.committed(second)["opening_revision"], 2)
        self.assertEqual(second["affected"], [{"kind": "opening", "id": "o1", "version": 2}])
        saved = self.opening()["opening"]
        self.assertEqual((saved["title"], saved["body"], saved["participants"], saved["attachments"], saved["revision"]),
                         ("", "", [], [{"id": "pending-media"}], 2))
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes "
                                  "WHERE resource_kind='opening' ORDER BY seq"),
                         [("actor", "owner", "opening", "o1", 1), ("actor", "owner", "opening", "o1", 2)])
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE id='t-new'"), [(0,)])

    def test_revision_conflicts_preserve_the_stored_writing(self):
        self.committed(self.save())
        self.committed(self.save(revision=1, body="Newer words"))
        before = self.stored_openings()
        stale = self.refused(self.save(revision=1, body="Late words"), "REVISION_CONFLICT")
        self.assertEqual(stale["error"]["current_versions"], {"opening_revision": 2})
        self.assertEqual(self.stored_openings(), before)
        fresh = self.refused(self.save(opening="o2", revision=3, topic_id="t-other"), "REVISION_CONFLICT")
        self.assertEqual(fresh["error"]["current_versions"], {"opening_revision": 0})
        self.assertEqual(self.stored_openings(), before)
        self.refused(self.act("opening.publish", revision=1), "REVISION_CONFLICT")
        self.refused(self.act("opening.discard", revision=3), "REVISION_CONFLICT")
        self.assertEqual(self.stored_openings(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), [(0,)])

    def test_workspace_and_topic_are_fixed_by_the_first_save(self):
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second"}))
        self.committed(self.save())
        before = self.stored_openings()
        for fields in ({"workspace_id": "w2"}, {"topic_id": "t-moved"}):
            with self.subTest(fields=fields):
                self.refused(self.save(revision=1, **fields), "INVALID_ARGUMENT", recorded=False)
        self.assertEqual(self.stored_openings(), before)
        self.committed(self.save(revision=1, body="Same place"))

    def test_creation_checks_workspace_access_and_unused_topic_identity(self):
        self.committed(self.save())
        self.committed(self.command("workspace.create", {"id": "w-private", "title": "Private"}, actor="agent-b"))
        self.refused(self.save(opening="o2", topic_id="t-private", workspace_id="w-private"), "FORBIDDEN")
        self.refused(self.save(opening="o-out", topic_id="t-out", actor="outsider"), "FORBIDDEN")
        self.sql("INSERT INTO topics VALUES ('t-existing','w1','Existing','owner',1)")
        for actor, opening, topic in (("owner", "o2", "t-existing"), ("owner", "o2", "t-new"),
                                      ("agent-a", "o1", "t-new"), ("agent-a", "o9", "t-existing")):
            with self.subTest(actor=actor, topic=topic):
                self.refused(self.save(opening=opening, topic_id=topic, actor=actor), "REVISION_CONFLICT")
        self.assertEqual(self.sql("SELECT actor_id,id,topic_id FROM openings"), [("owner", "o1", "t-new")])
        # Opening IDs are per actor; another actor's ID with a new topic is its own opening.
        self.committed(self.save(opening="o1", topic_id="t-agent", actor="agent-a"))
        self.assertEqual(self.opening(actor="agent-a")["opening"]["topic_id"], "t-agent")
        self.assertEqual(self.opening()["opening"]["topic_id"], "t-new")

    def test_save_arguments_are_whole_bounded_and_validated(self):
        foreign = self.media("foreign-media", actor="agent-a")
        too_many = ["p-%02d" % number for number in range(LIMITS["topic_participants"])]
        self.sql("INSERT INTO actors(id,kind,name) VALUES " + ",".join("('%s','agent','p')" % p for p in too_many))
        cases = [
            ("missing", self.command("opening.save", {key: value for key, value in self.writing().items() if key != "body"},
                                     {"opening_id": "o1"}, {"opening_revision": 0}), "INVALID_ARGUMENT"),
            ("extra", self.command("opening.save", dict(self.writing(), quotes=[]), {"opening_id": "o1"},
                                   {"opening_revision": 0}), "INVALID_ARGUMENT"),
            ("target", self.command("opening.save", self.writing(), {"opening_id": "o1", "topic_id": "t-new"},
                                    {"opening_revision": 0}), "INVALID_ARGUMENT"),
            ("no revision", self.command("opening.save", self.writing(), {"opening_id": "o1"}), "INVALID_ARGUMENT"),
            ("duplicate", self.save(participants=["agent-a", "agent-a"]), "INVALID_ARGUMENT"),
            ("not a list", self.save(participants="agent-a"), "INVALID_ARGUMENT"),
            ("title type", self.save(title=7), "INVALID_ARGUMENT"),
            ("unknown", self.save(participants=["nobody"]), "INVALID_RECIPIENT"),
            ("too many", self.save(participants=too_many), "TOO_MANY_PARTICIPANTS"),
            ("foreign media", self.save(attachments=[foreign]), "FORBIDDEN"),
            ("body", self.save(body="x" * (LIMITS["body_utf8_bytes"] + 1)), "BODY_TOO_LARGE"),
        ]
        for name, receipt, code in cases:
            with self.subTest(name=name):
                self.refused(receipt, code, recorded=code != "INVALID_ARGUMENT")
        self.assertEqual(self.stored_openings(), [])
        self.committed(self.save(participants=too_many[1:]))

    def test_another_actor_cannot_read_list_publish_or_discard(self):
        self.committed(self.save())
        before = self.stored_openings()
        for actor in ("agent-a", "outsider"):
            with self.subTest(actor=actor):
                self.assertEqual(self.view("opening", actor, opening_id="o1")["error"]["code"], "FORBIDDEN")
                self.assertEqual(self.view("openings", actor)["items"], [])
                self.assertEqual(self.view("changes", actor, scope={"kind": "actor", "id": "owner"})["error"]["code"], "FORBIDDEN")
                self.refused(self.act("opening.publish", actor=actor), "FORBIDDEN")
                self.refused(self.act("opening.discard", actor=actor), "FORBIDDEN")
        self.assertEqual(self.view("openings", "agent-a", workspace_id="w1")["items"], [])
        self.assertEqual(self.stored_openings(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), [(0,)])
        self.assertEqual([item["id"] for item in self.view("openings")["items"]], ["o1"])

    def test_publish_creates_the_topic_as_an_ordinary_publication_once(self):
        ready = self.media("ready-media")
        self.committed(self.save(attachments=[ready]))
        receipt = self.act("opening.publish", op="publish-o1")
        result = self.committed(receipt)
        message_id = result["message_id"]
        self.assertEqual(result, {"opening_id": "o1", "opening_revision": 2, "message_id": message_id,
                                  "topic": {"id": "t-new", "version": 1},
                                  "delivery": {"queued": 1, "unavailable_subscribers": []}})
        self.assertEqual(receipt["affected"], [{"kind": "topic", "id": "t-new", "version": 1},
                                               {"kind": "message", "id": message_id, "version": 1},
                                               {"kind": "opening", "id": "o1", "version": 2}])
        self.assertEqual(self.sql("SELECT id,workspace_id,title,creator_id,version FROM topics"),
                         [("t-new", "w1", "A new topic", "owner", 1)])
        self.assertEqual(self.sql("SELECT actor_id,active,epoch FROM topic_participants ORDER BY actor_id"),
                         [("agent-a", 1, 1), ("owner", 1, 1)])
        self.assertEqual(self.sql("SELECT message_count,latest_message_id FROM topic_summaries"), [(1, message_id)])
        stored = self.sql("SELECT topic_id,author_id,body,attachments,quotes,addressees,operation_id FROM messages")
        self.assertEqual(stored[0][:3], ("t-new", "owner", "The opening words"))
        self.assertEqual(stored[0][4:], ("[]", "[]", "publish-o1"))
        self.assertIn('"sha256"', stored[0][3])
        self.assertEqual(self.sql("SELECT recipient_id,state FROM deliveries"), [("agent-a", "pending")])
        topic = self.store.view("agent-a", "topic", {"topic_id": "t-new"})
        self.assertEqual(topic["summary"]["latest_message_id"], message_id)
        self.assertEqual(self.sql("SELECT state,revision,publish_operation_id,message_id FROM openings"),
                         [("published", 2, "publish-o1", message_id)])
        changes = self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes WHERE seq>"
                           "(SELECT max(seq) FROM changes WHERE resource_kind='opening' AND version=1) ORDER BY seq")
        delivery = self.sql("SELECT id FROM deliveries")[0][0]
        self.assertEqual(changes, [("actor", "agent-a", "delivery", delivery, 1), ("topic", "t-new", "topic", "t-new", 1),
                                   ("workspace", "w1", "topic", "t-new", 1), ("actor", "owner", "opening", "o1", 2)])
        view = self.opening()
        self.assertEqual(view["publish_receipt"], receipt)
        self.assertEqual(view["opening"]["state"], "published")
        self.assertEqual(self.view("openings")["items"], [])

        records = self.published_records()
        self.assertEqual(self.act("opening.publish", op="publish-o1"), receipt)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "publish-o1"}), receipt)
        again = self.refused(self.act("opening.publish", revision=2, op="publish-again"), "OPENING_CLOSED")
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "publish-again"}), again)
        self.assert_closed(2)
        self.assertEqual(self.published_records(), records)
        self.assertEqual(self.opening()["publish_receipt"], receipt)

    def test_publish_refusals_create_nothing_and_leave_the_opening_open(self):
        pending = self.media("pending-media", ready=False)
        ready = self.media("ready-media")
        self.committed(self.save())
        revision = [1]

        def resave(**fields):
            self.committed(self.save(revision=revision[0], **fields))
            revision[0] += 1

        def refuse(code, op):
            records, openings = self.published_records(), self.stored_openings()
            self.refused(self.act("opening.publish", revision=revision[0], op=op), code)
            self.assertEqual(self.published_records(), records)
            self.assertEqual(self.stored_openings(), openings)
            self.assertEqual(self.sql("SELECT state FROM openings"), [("open",)])

        resave(title=" \n")
        refuse("EMPTY_TITLE", "p-title")
        resave(body=" ", attachments=[])
        refuse("EMPTY_MESSAGE", "p-empty")
        resave(body="", attachments=[pending])
        refuse("ATTACHMENT_NOT_READY", "p-pending")
        resave(body="", attachments=[ready])
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        refuse("INVALID_RECIPIENT", "p-disabled")
        # Participants are checked before the title.
        resave(title=" ")
        refuse("INVALID_RECIPIENT", "p-disabled-untitled")
        resave(body="", attachments=[ready])
        self.sql("UPDATE actors SET enabled=1 WHERE id='agent-a'")
        self.sql("INSERT INTO topics VALUES ('t-new','w1','Raced','agent-b',1)")
        refuse("REVISION_CONFLICT", "p-raced")
        self.sql("DELETE FROM topics WHERE id='t-new'")
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE id LIKE 'p-%'"), [(6,)])
        published = self.committed(self.act("opening.publish", revision=revision[0], op="p-final"))
        self.assertEqual(published["topic"]["id"], "t-new")
        self.assertEqual(self.sql("SELECT body FROM messages"), [("",)])

    def test_publish_rechecks_workspace_access(self):
        self.committed(self.save(actor="agent-a", participants=[]))
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-a", "present": False},
                                    {"workspace_id": "w1"}, {"workspace_revision": version}))
        self.refused(self.act("opening.publish", actor="agent-a"), "FORBIDDEN")
        self.assertEqual(self.sql("SELECT state FROM openings"), [("open",)])
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), [(0,)])

    def test_publish_and_discard_take_no_writing(self):
        self.committed(self.save())
        before = self.stored_openings()
        for kind in ("opening.publish", "opening.discard"):
            with self.subTest(kind=kind):
                self.refused(self.act(kind, args={"body": "override"}), "INVALID_ARGUMENT", recorded=False)
                self.refused(self.command(kind, {}, {"opening_id": "o1"}), "INVALID_ARGUMENT", recorded=False)
        self.assertEqual(self.stored_openings(), before)

    def test_discard_closes_the_opening_and_keeps_its_media(self):
        pending = self.media("pending-media", ready=False)
        self.committed(self.save(attachments=[pending]))
        self.committed(self.save(opening="o2", topic_id="t-two"))
        discarded = self.act("opening.discard", op="discard-o1")
        self.assertEqual(self.committed(discarded), {"opening_id": "o1", "opening_revision": 2, "state": "discarded"})
        self.assertEqual(discarded["affected"], [{"kind": "opening", "id": "o1", "version": 2}])
        self.assertEqual([item["id"] for item in self.view("openings")["items"]], ["o2"])
        view = self.opening()
        self.assertEqual((view["opening"]["state"], view["opening"]["revision"], view["publish_receipt"]), ("discarded", 2, None))
        self.assertEqual(self.sql("SELECT count(*) FROM media_intents WHERE id='pending-media'"), [(1,)])
        self.assertEqual(self.sql("SELECT scope_id,version FROM changes WHERE resource_id='o1' ORDER BY seq"),
                         [("owner", 1), ("owner", 2)])
        before = self.stored_openings()
        self.assert_closed(2)
        self.assertEqual(self.act("opening.discard", op="discard-o1"), discarded)
        self.assertEqual(self.stored_openings(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), [(0,)])

    def test_unfinished_list_pages_by_id_and_scopes_by_workspace(self):
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second", "team": ["agent-a"]}))
        self.committed(self.command("workspace.create", {"id": "w-private", "title": "Private"}, actor="agent-b"))
        for opening, workspace in (("o-c", "w1"), ("o-a", "w2"), ("o-d", "w2"), ("o-b", "w1")):
            self.committed(self.save(opening=opening, topic_id="t-" + opening, workspace_id=workspace,
                                     title="Title " + opening))
        self.committed(self.save(opening="o-agent", topic_id="t-agent", actor="agent-a"))
        first = self.view("openings", limit=2)
        self.assertEqual(first, {"instance_id": "test-instance", "next_cursor": "o-b", "items": [
            {"id": "o-a", "workspace_id": "w2", "topic_id": "t-o-a", "revision": 1, "title": "Title o-a", "title_truncated": False},
            {"id": "o-b", "workspace_id": "w1", "topic_id": "t-o-b", "revision": 1, "title": "Title o-b", "title_truncated": False}]})
        second = self.view("openings", limit=2, cursor="o-b")
        self.assertEqual(([item["id"] for item in second["items"]], second["next_cursor"]), (["o-c", "o-d"], None))
        self.assertEqual([item["id"] for item in self.view("openings", workspace_id="w1")["items"]], ["o-b", "o-c"])
        self.assertEqual([item["id"] for item in self.view("openings", workspace_id="w2", cursor="o-a")["items"]], ["o-d"])
        self.assertEqual(self.view("openings", workspace_id="w-private")["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.view("openings", workspace_id="w-missing")["error"]["code"], "FORBIDDEN")
        for args in ({"cursor": 3}, {"cursor": None}, {"cursor": "bad\n"}, {"limit": 0}, {"limit": True},
                     {"limit": LIMITS["page_max"] + 1}, {"actor": "agent-a"}, {"workspace_id": ""}):
            with self.subTest(args=args):
                self.assertEqual(self.store.view("owner", "openings", args)["error"]["code"], "INVALID_ARGUMENT")
        for args in ({}, {"opening_id": ""}, {"opening_id": "o-a", "actor": "agent-a"}):
            with self.subTest(args=args):
                self.assertEqual(self.store.view("owner", "opening", args)["error"]["code"], "INVALID_ARGUMENT")

    def test_title_previews_are_bounded_and_pages_preserve_every_id(self):
        self.committed(self.save(opening="o-000", topic_id="t-000", title="a" * 1023 + "🙂" + "界" * 1000))
        self.committed(self.save(opening="o-001", topic_id="t-001", title="界" * 341 + "a"))
        for number in range(2, 41):
            self.committed(self.save(opening="o-%03d" % number, topic_id="t-%03d" % number,
                                     title="\x00" * 1024 + "suffix"))
        listing = self.view("openings", limit=2)["items"]
        self.assertEqual((listing[0]["title"], listing[0]["title_truncated"]), ("a" * 1023, True))
        self.assertEqual((listing[1]["title"], listing[1]["title_truncated"]), ("界" * 341 + "a", False))
        cursor, seen, pages = "", [], 0
        while cursor is not None:
            page = self.view("openings", limit=100, cursor=cursor)
            self.assertLessEqual(len(json.dumps(page, ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
                                 LIMITS["summary_utf8_bytes"])
            seen += [item["id"] for item in page["items"]]
            cursor, pages = page["next_cursor"], pages + 1
        self.assertGreater(pages, 1, "the byte bound must split this page")
        self.assertEqual(seen, ["o-%03d" % number for number in range(41)])

    def test_earlier_prepared_openings_publish_exactly_as_before(self):
        source = {"kind": "new_topic", "id": "legacy", "workspace_id": "w1"}
        self.committed(self.save_draft("legacy-draft", source, "t-legacy", "Legacy words",
                                       opening={"workspace_id": "w1", "title": "Legacy", "participants": ["agent-a"]}))
        self.committed(self.prepare("legacy-draft", "t-legacy", submission="legacy", send_op="legacy-send"))
        seq = self.sql("SELECT max(seq) FROM changes")[0][0]
        receipt = self.command("topic.create_and_send", {"submission_id": "legacy"}, {"topic_id": "t-legacy"}, op="legacy-send")
        result = self.committed(receipt)
        message_id = result["message_id"]
        self.assertEqual(result, {"message_id": message_id, "submission_id": "legacy", "topic": {"id": "t-legacy", "version": 1},
                                  "delivery": {"queued": 1, "unavailable_subscribers": []}})
        self.assertEqual(receipt["affected"], [{"kind": "topic", "id": "t-legacy", "version": 1},
                                               {"kind": "message", "id": message_id, "version": 1}])
        delivery = self.sql("SELECT id FROM deliveries")[0][0]
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes WHERE seq>? ORDER BY seq", (seq,)),
                         [("actor", "agent-a", "delivery", delivery, 1), ("topic", "t-legacy", "topic", "t-legacy", 1),
                          ("workspace", "w1", "topic", "t-legacy", 1), ("actor", "owner", "submission", "legacy", 2)])
        self.assertEqual(self.sql("SELECT topic_id,body,attachments,quotes,addressees,operation_id FROM messages"),
                         [("t-legacy", "Legacy words", "[]", "[]", "[]", "legacy-send")])
        self.assertEqual(self.command("topic.create_and_send", {"submission_id": "legacy"}, {"topic_id": "t-legacy"},
                                      op="legacy-send"), receipt)
        # A prepared opening's topic is in use for a new opening.
        self.refused(self.save(topic_id="t-legacy"), "REVISION_CONFLICT")

    def test_earlier_prepared_openings_check_participants_before_the_title(self):
        source = {"kind": "new_topic", "id": "legacy", "workspace_id": "w1"}
        self.committed(self.save_draft("legacy-draft", source, "t-legacy", "Legacy words",
                                       opening={"workspace_id": "w1", "title": " ", "participants": ["agent-a"]}))
        self.committed(self.prepare("legacy-draft", "t-legacy", submission="legacy", send_op="legacy-send"))
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        refused = self.refused(self.command("topic.create_and_send", {"submission_id": "legacy"}, {"topic_id": "t-legacy"},
                                            op="legacy-send"), "INVALID_RECIPIENT")
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "legacy-send"}), refused)
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), [(0,)])


# Do not rerun the inherited StoreCase tests during module discovery.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in OpeningsCase.__dict__:
        setattr(OpeningsCase, _name, None)


if __name__ == "__main__":
    unittest.main()
