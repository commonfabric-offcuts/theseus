from __future__ import annotations

"""When a message was sent: recorded once at send, and carried by the topic log and the source view."""

import time
import unittest

import reader_fixture as fixtures


class MessageTimesCase(fixtures.ReaderCase):
    def test_a_sent_message_carries_its_time_in_the_log_and_the_source(self):
        start = int(time.time() * 1000)
        self.send("A timed message")
        finish = int(time.time() * 1000)
        items = self.store.view("owner", "topic_messages", {"topic_id": "t1", "audience": "all", "direction": "before", "limit": 30})["items"]
        timed = next(item for item in items if item["body"] == "A timed message")
        self.assertTrue(start <= timed["sent_ms"] <= finish, (start, timed["sent_ms"], finish))
        source = self.store.view("owner", "source", {"kind": "message", "id": timed["id"]})
        self.assertEqual(source["sent_ms"], timed["sent_ms"])

    def test_a_message_from_before_times_were_kept_says_none(self):
        self.send("Sent before times")
        # Messages are immutable to commands; this stands in for a row an older version wrote.
        self.sql("DROP TRIGGER immutable_messages_update")
        self.sql("UPDATE messages SET sent_ms=NULL WHERE body='Sent before times'")
        items = self.store.view("owner", "topic_messages", {"topic_id": "t1", "audience": "all", "direction": "before", "limit": 30})["items"]
        untimed = next(item for item in items if item["body"] == "Sent before times")
        self.assertIsNone(untimed["sent_ms"])
        self.assertIsNone(self.store.view("owner", "source", {"kind": "message", "id": untimed["id"]})["sent_ms"])


if __name__ == "__main__":
    unittest.main()
