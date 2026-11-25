from __future__ import annotations

import io
import json
from pathlib import Path
import unittest
from unittest import mock

from aim_next import cli, Store
from aim_next.profile import write_profile
from test_release_cards_1248 import payload
import reader_fixture


class ReleaseCardCliCase(reader_fixture.ReaderCase):
    def setUp(self):
        super().setUp()
        self.profile = Path(self.temp.name) / "owner.json"
        write_profile(self.profile, str(self.path.resolve()), "test-instance", "owner", binding=self.binding)
        self.input = Path(self.temp.name) / "payload.json"
        self.input.write_text(json.dumps(payload()))

    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(["--profile", str(self.profile), "--json", "release-card"] + list(args), stdout=out, stderr=err)
        return code, [json.loads(line) for line in out.getvalue().splitlines()], err.getvalue()

    def create(self, operation="cli-create"):
        return self.run_cli("create", "t1", str(self.input), "--divergence-reason", "Synthetic release", "--operation", operation)

    def test_create_update_read_and_paged_history_share_saved_core_envelopes(self):
        code, lines, err = self.create()
        self.assertEqual(code, 0, (lines, err))
        mid = next(row["result"]["message_id"] for row in lines if row.get("kind") == "release_card.create")
        self.input.write_text(json.dumps(payload(summary="Updated through CLI")))
        code, lines, err = self.run_cli("update", mid, str(self.input), "--expected", "1", "--operation", "cli-update")
        self.assertEqual(code, 0, (lines, err))
        self.assertEqual(lines[-1]["release_card"]["revision"], 2)
        code, lines, err = self.run_cli("read", mid, "--revision", "1")
        self.assertEqual(code, 0, (lines, err))
        self.assertEqual(lines[-1]["release_card"]["payload"]["summary"], "Source is fixed")
        code, lines, err = self.run_cli("history", mid, "--limit", "1")
        self.assertEqual(code, 0, (lines, err))
        self.assertEqual(lines[-1]["next_cursor"], 2)
        saved = json.loads((Path(self.temp.name) / "owner.outbox" / "cli-update.request.json").read_text())
        self.assertEqual(saved["command"]["expected"]["message_revision"], 1)
        self.assertEqual(saved["binding"], self.binding)

    def test_failed_readback_preserves_committed_identity_and_same_operation_recovers(self):
        original = Store.view
        def unread(store, actor, name, args):
            if name == "release_card":
                return {"instance_id": "test-instance", "error": {"code": "DATABASE_BUSY", "message": "Injected readback barrier", "retryable": True}}
            return original(store, actor, name, args)
        with mock.patch.object(Store, "view", unread):
            code, lines, err = self.create()
        self.assertEqual(code, 1, (lines, err))
        self.assertIn("READ_BACK_UNCONFIRMED", err)
        self.assertEqual(self.sql("SELECT count(*) FROM release_cards"), [(1,)])
        mid = self.sql("SELECT message_id FROM release_cards")[0][0]
        code, lines, err = self.create()
        self.assertEqual(code, 0, (lines, err))
        self.assertEqual(lines[-1]["release_card"]["message_id"], mid)
        self.assertEqual(self.sql("SELECT count(*) FROM release_card_revisions"), [(1,)])

    def test_bad_json_and_stale_update_do_not_claim_a_new_record(self):
        self.input.write_text("{broken")
        code, lines, err = self.create()
        self.assertEqual(code, 2, (lines, err))
        self.assertEqual(self.sql("SELECT count(*) FROM release_cards"), [(0,)])
        self.input.write_text(json.dumps(payload()))
        code, lines, err = self.create()
        mid = lines[-1]["release_card"]["message_id"]
        code, lines, err = self.run_cli("update", mid, str(self.input), "--expected", "0")
        self.assertEqual(code, 2, (lines, err))
        self.assertEqual(self.sql("SELECT count(*) FROM release_card_revisions"), [(1,)])


if __name__ == "__main__":
    unittest.main()
