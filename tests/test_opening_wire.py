from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import threading
import unittest

from aim_next import Store
from aim_next.server import create_server
import test_store as fixtures


TESTS = Path(__file__).resolve().parent
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "The browser client's opening wire check needs Node")
class OpeningWireCase(unittest.TestCase):
    """The browser's opening client against the real HTTP adapter and Core."""

    command = fixtures.StoreCase.command
    workspace = fixtures.StoreCase.workspace
    sql = fixtures.StoreCase.sql

    def setUp(self):
        fixtures.StoreCase.setUp(self)
        self.workspace()
        self.server = create_server(lambda: Store(self.path, "test-instance", expected_binding=self.binding),
                                    "test-instance", "owner", self.path.parent, token="opening-wire-session")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_browser_client_and_core_agree_on_every_opening_wire_shape(self):
        run = subprocess.run([NODE, str(TESTS / "fixtures" / "opening_wire.mjs"), self.server.origin,
                              "opening-wire-session", "w1", "agent-a", str(TESTS / "fixtures" / "media" / "one.png")],
                             capture_output=True, text=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stderr)
        image = json.loads(run.stdout)["image"]
        topics = self.sql("SELECT id,title,workspace_id,creator_id FROM topics ORDER BY id")
        self.assertEqual(topics, [("t-lost", "Lost answer", "w1", "owner"), ("t-stale", "Stale", "w1", "owner"),
                                  ("t-wire", "Wire topic", "w1", "owner")])
        self.assertEqual(self.sql("SELECT actor_id FROM topic_participants WHERE topic_id='t-wire' ORDER BY actor_id"),
                         [("agent-a",), ("owner",)])
        body, attachments = self.sql("SELECT body,attachments FROM messages WHERE topic_id='t-wire'")[0]
        self.assertEqual(body, "Edited here")
        self.assertEqual([ref["id"] for ref in json.loads(attachments)], [image])
        self.assertEqual(self.sql("SELECT body FROM messages WHERE topic_id='t-stale'"), [("Newer words",)])
        self.assertEqual(self.sql("SELECT id,state,revision FROM openings ORDER BY id"), [
            ("o-drop", "discarded", 2), ("o-lost", "published", 2), ("o-stale", "published", 3), ("o-wire", "published", 5)])


if __name__ == "__main__":
    unittest.main()
