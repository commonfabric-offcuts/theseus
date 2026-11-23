from __future__ import annotations

"""858's behavior through public Core commands, in ReaderCase's scratch store.

Prepared before product edits. No test result is implied by this file.
"""

import json

from aim_next.store import Store
from test_stacks import StackCase


class DossierLevel858Case(StackCase):
    def post(self, body="Words", actor="agent-a", topic="t1", **args):
        if args.get("reply_to") and "reply_passage" not in args and "reply_without_quote" not in args:
            args["reply_without_quote"] = "A separate reply in the isolated dossier-level fixture"
        return super().post(body, actor=actor, topic=topic, **args)

    def level(self, root, value, revision=0, actor="owner", op=None):
        return self.command("stack.level", {"level": value},
                            target={"message_id": root},
                            expected={"level_revision": revision}, actor=actor, op=op)

    def position(self, message, actor="owner", store=None):
        answer = (store or self.store).view(actor, "stack_positions", {
            "topic_id": "t1", "message_ids": [message]})
        self.assertNotIn("error", answer, answer)
        return answer["items"][0]["stack_position"]

    def test_858_two_independent_sessions_and_reopen_read_the_same_saved_choice(self):
        root = self.post("A reader's dossier")
        reply = self.post("Answer", reply_to=root)
        other_session = Store(self.path, "test-instance", expected_binding=self.binding)
        saved = self.committed(self.level(root, "folded"))
        self.assertEqual((saved["level"], saved["level_revision"]), ("folded", 1))
        self.assertEqual(self.position(reply, store=other_session)["level"], "folded")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.position(reply)["level"], "folded", "a fresh store sees Core's choice")
        self.committed(self.level(root, "open", revision=1))
        self.assertEqual(self.position(root, store=other_session)["level"], "open")
        self.assertEqual(self.position(reply, store=other_session)["level_revision"], 2)

    def test_858_each_reader_keeps_their_choice_and_only_their_change(self):
        root = self.post("Two readers")
        reply = self.post("Answer", reply_to=root)
        after = self.sql("SELECT coalesce(max(seq),0) FROM changes")[0][0]
        deliveries = self.sql("SELECT * FROM deliveries")
        topic_before = self.sql("SELECT * FROM topics")
        self.committed(self.level(root, "folded"))
        self.assertEqual(self.told(after=after), [("actor", "owner")])
        self.assertEqual(self.position(reply, actor="agent-a")["level"], None)
        self.assertEqual(self.position(reply, actor="agent-a")["level_revision"], 0)
        self.committed(self.level(root, "open", actor="agent-a"))
        self.assertEqual(self.position(reply)["level"], "folded")
        self.assertEqual(self.position(reply, actor="agent-a")["level"], "open")
        self.assertEqual(self.sql("SELECT * FROM deliveries"), deliveries)
        self.assertEqual(self.sql("SELECT * FROM topics"), topic_before)
        self.assertEqual([(row[1], row[2]) for row in self.rows("level")],
                         [("owner", "owner"), ("agent-a", "agent-a")])

    def test_858_partial_page_carries_unloaded_roots_preference_and_fence(self):
        root = self.post("First message outside the page")
        parent = root
        for n in range(4):
            parent = self.post("Answer %d" % n, reply_to=parent)
        self.committed(self.level(root, "folded"))
        page = self.store.view("owner", "topic_messages", {
            "topic_id": "t1", "direction": "before", "limit": 2})
        self.assertNotIn(root, [item["id"] for item in page["items"]])
        self.assertEqual(len(page["items"]), 2)
        for item in page["items"]:
            place = item["stack_position"]
            self.assertEqual((place["root_id"], place["level"], place["level_revision"]),
                             (root, "folded", 1))
        self.rejected(self.level(parent, "open"), "STACK_CHANGED")

    def test_858_join_uses_destination_choice_split_recovers_source_choice(self):
        destination, source = self.post("Destination"), self.post("Source")
        child = self.post("Child", reply_to=source)
        self.committed(self.level(destination, "open"))
        self.committed(self.level(source, "folded"))
        self.committed(self.join(source, destination))
        self.assertEqual((self.position(child)["root_id"], self.position(child)["level"]),
                         (destination, "open"))
        self.rejected(self.level(source, "open", revision=1), "STACK_CHANGED")
        self.committed(self.join(source, None, revision=1))
        self.assertEqual((self.position(child)["root_id"], self.position(child)["level"]),
                         (source, "folded"))

    def test_858_retry_keeps_identity_and_stale_fence_never_replaces_choice(self):
        root = self.post()
        first = self.level(root, "folded", op="858-one-choice")
        self.committed(first)
        self.assertEqual(self.level(root, "folded", op="858-one-choice"), first)
        stale = self.level(root, "open")
        self.rejected(stale, "REVISION_CONFLICT")
        self.assertEqual(stale["error"]["current_versions"], {"level_revision": 1})
        changed = self.level(root, "open", op="858-one-choice")
        self.rejected(changed, "OPERATION_PAYLOAD_MISMATCH")
        self.assertEqual(self.position(root)["level"], "folded")
        self.assertEqual(len(self.rows("level")), 1)

    def test_858_explicit_default_and_clear_keep_append_only_revision_history(self):
        root = self.post()
        self.assertEqual((self.position(root).get("level"), self.position(root).get("level_revision")), (None, 0))
        explicit = self.committed(self.level(root, "open"))
        self.assertEqual((explicit["changed"], explicit["level_revision"]), (True, 1))
        same = self.committed(self.level(root, "open", revision=1))
        self.assertEqual((same["changed"], same["level_revision"]), (False, 1))
        clear = self.committed(self.level(root, None, revision=1))
        self.assertEqual((clear["changed"], clear["level_revision"]), (True, 2))
        self.assertEqual((self.position(root)["level"], self.position(root)["level_revision"]), (None, 2))
        self.assertEqual([(json.loads(row[3]), row[4]) for row in self.rows("level")],
                         [({"level": "open"}, 1), ({"level": None}, 2)])
        self.rejected(self.level(root, "folded", revision=1), "REVISION_CONFLICT")

    def test_858_dossier_choice_preserves_single_message_folds_stars_and_place(self):
        root = self.post()
        reply = self.post("A separately folded message", reply_to=root)
        self.committed(self.fold(reply))
        self.committed(self.star(reply))
        self.committed(self.act("stack.place", root, {"key": 2.5}))
        position = self.position(reply)
        acts = self.acts(reply)
        self.committed(self.level(root, "folded"))
        self.committed(self.level(root, "open", revision=1))
        self.assertEqual(self.acts(reply), acts)
        for key in ("root_id", "placed", "place_revision", "order_key", "order_tie", "starred"):
            self.assertEqual(self.position(reply)[key], position[key], key)
        self.assertEqual((self.acts(root)["level"], self.acts(root)["level_revision"]), ("open", 2))

    def test_858_invalid_values_missing_fence_and_unreadable_targets_write_nothing(self):
        root = self.post()
        for args in ({}, {"level": "head"}, {"level": "closed"}, {"level": False},
                     {"level": []}, {"level": "open", "folded": True}):
            with self.subTest(args=args):
                self.rejected(self.command("stack.level", args, target={"message_id": root},
                                           expected={"level_revision": 0}), "INVALID_ARGUMENT")
        self.rejected(self.command("stack.level", {"level": "open"}, target={"message_id": root}), "INVALID_ARGUMENT")
        self.rejected(self.level(root, "open", actor="other-reader"), "FORBIDDEN")
        self.rejected(self.level("m-unknown", "open"), "FORBIDDEN")
        asked = self.post("Between fixture actors", actor="owner", addressees=["agent-a"], whisper=True)
        private = self.post("Private response", addressees=["owner"], whisper=True, reply_to=asked)
        self.rejected(self.level(private, "open", actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.rows("level"), [])

    def test_858_closed_readable_outcome_keeps_personal_choice_available(self):
        root = self.post()
        version = lambda: self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('outcome.kind_set', {'kind': 'reach'}, {'workspace_id': 'w1'}, {'workspace_revision': version()}))
        self.committed(self.command('outcome.reach', {'words': 'Done', 'unmet_confirmed': True}, {'workspace_id': 'w1'}, {'workspace_revision': version()}))
        self.committed(self.level(root, 'folded'))
        self.assertEqual(self.position(root)['level'], 'folded')

    def test_858_removed_target_and_stale_authority_cannot_record_a_choice(self):
        root = self.post(actor='owner')
        stale = dict(self.pin, authority_epoch='e-stale-858')
        request = self.envelope('stack.level', {'message_id': root}, {'level': 'folded'}, {'level_revision': 0})
        request['expected']['authority'] = stale
        receipt = self.store.command('owner', request)
        self.assertNotEqual(receipt['status'], 'committed', receipt)
        self.assertEqual(self.rows('level'), [])
        self.committed(self.command('message.unsend', target={'message_id': root}))
        self.rejected(self.level(root, 'folded'), 'FORBIDDEN')
        self.assertEqual(self.rows('level'), [])
