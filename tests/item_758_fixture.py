from __future__ import annotations

"""Item 758's isolated native fixture and its below-browser protocol oracle.

The browser calls these same phases. All records belong to the caller's fresh
fixture DB; no profile, server, credentials or live records are used here.
"""

import sqlite3


PARENT = "Before\n  **Keep these words** 🪴\nAfter\n"
EXCERPT = "  **Keep these words** 🪴"
ANSWER = "The corrected reply is in the same dossier."
REASON = "This is a status update about the whole assignment."
EXCEPTION = "This answer concerns the surrounding work."


class PassageFixture:
    def __init__(self, store, command, path, actor, agent, other):
        self.store, self.command, self.path = store, command, path
        self.actor, self.agent, self.other = actor, agent, other
        self.records = {}

    def public(self):
        with sqlite3.connect(str(self.path)) as db:
            return {table: db.execute("SELECT * FROM " + table + " ORDER BY rowid").fetchall()
                    for table in ("messages", "deliveries", "changes", "topic_summaries", "message_acts")}

    def source(self, identity):
        return self.store().view(self.actor, "source", {"kind": "message", "id": identity})

    def begin(self, topic):
        def command(kind, suffix, args, target=None, **extra):
            return self.command(kind, topic + "-" + suffix, args, target, **extra)
        for role, identity in (("poster", self.agent), ("private-recipient", self.other)):
            revision = self.store().view(self.actor, "topic", {"topic_id": topic})["topic"]["version"]
            command("participation.set", "join-" + role, {"actor_id": identity, "present": True},
                    {"topic_id": topic}, expected={"topic_revision": revision})
        private = command("message.post", "private", {"body": "Hidden private words", "whisper": True,
                          "addressees": [self.other]}, {"topic_id": topic})["result"]["message_id"]
        parent = command("message.post", "parent", {"body": PARENT}, {"topic_id": topic})["result"]["message_id"]
        span = {"source": {"kind": "message", "id": parent, "revision": 1}, "start": 7, "end": 31}
        assert PARENT[7:31] == EXCERPT
        refusals = []
        for suffix, identity, choice, code in [
                ("missing", parent, {}, "REPLY_PASSAGE_REQUIRED"),
                ("stale", parent, {"reply_passage": dict(span, source=dict(span["source"], revision=2))}, "REPLY_SOURCE_CHANGED"),
                ("private-span", private, {"reply_passage": dict(span, source=dict(span["source"], id=private))}, "INVALID_REPLY")]:
            before = self.public()
            result = command("message.post", suffix, dict(body="Must not appear: " + suffix, reply_to=identity, **choice),
                             {"topic_id": topic}, sender=self.agent, refusable=True)
            assert result["status"] == "rejected", result
            assert result["error"]["code"] == code, result
            assert self.public() == before, (suffix, "partial public effects")
            refusals.append({"request": suffix, "receipt": result, "public_unchanged": True})
        self.records[topic] = {"topic": topic, "parent": parent, "span": span, "refusals": refusals}
        return dict(self.records[topic], parent_source=self.source(parent))

    def finish(self, topic):
        record = self.records[topic]
        args = {"body": ANSWER, "reply_to": record["parent"], "reply_passage": record["span"]}
        first = self.command("message.post", topic + "-quoted", args, {"topic_id": topic}, sender=self.agent)
        before = self.public()
        retry = self.command("message.post", topic + "-quoted", args, {"topic_id": topic}, sender=self.agent)
        assert retry == first, (first, retry)
        assert self.public() == before, "retry duplicated public effects"
        quoted = self.source(first["result"]["message_id"])
        assert quoted["body"] == ">   **Keep these words** 🪴\n\n" + ANSWER, quoted
        assert quoted["quotes"] == [dict(record["span"], excerpt=EXCERPT)], quoted
        assert quoted["reply_basis"] == dict(record["span"], excerpt=EXCERPT, author_id=self.actor), quoted
        exception = self.command("message.post", topic + "-exception", {"body": EXCEPTION,
                    "reply_to": record["parent"], "reply_without_quote": REASON}, {"topic_id": topic}, sender=self.agent)
        exception = self.source(exception["result"]["message_id"])
        assert exception["body"] == "Reply without a quote:\n\n> " + REASON + "\n\n" + EXCEPTION, exception
        assert exception["quotes"] == [] and exception["reply_basis"]["reason"] == REASON, exception
        return dict(record, quoted=quoted, exception=exception, retry=retry, retry_public_unchanged=True)
