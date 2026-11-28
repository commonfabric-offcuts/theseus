from __future__ import annotations

import json
import shlex
from unittest import mock

from aim_next import Store
import test_agent_verbs


class OpenAskReplyHintsCase(test_agent_verbs.AgentVerbCase):
    def send(self, body, *, actor="owner", **fields):
        return self.committed(self.store.command(actor, self.envelope(
            "message.post", {"topic_id": "t1"}, dict(body=body, **fields))))["message_id"]

    def ask(self, body, to="agent-a", actor="owner", root=None):
        fields = {"addressees": [to], "intent": "ask", "go_ahead": False}
        if root is not None:
            fields.update(reply_to=root)
            if actor != "owner":
                fields.update(reply_without_quote="The fixture asks about the whole dossier.")
        if actor != "owner" and root is None:
            fields.update(divergence_reason="The fixture asks about a separate subject.")
        return self.send(body, actor=actor, **fields)

    def bare(self, *flags):
        return self.run_cli("post", "t1", *flags, "A proposed answer.")

    def test_refusal_names_each_open_ask_and_its_current_dossier_and_asker(self):
        self.participation("agent-b", True)
        root = self.opening["id"]
        first = self.ask("Which route should we publish?", root=root)
        second = self.ask("What time will we meet?", actor="agent-b")
        foreign = self.ask("How much should we print?", to="agent-b", root=root)
        code, out, err = self.bare()
        self.assertEqual((code, out), (2, ""), (out, err))
        self.assertIn("DIVERGENCE_REASON_REQUIRED", err)
        self.assertIn("Choose the Ask you mean", err)
        self.assertIn("aim-next reply %s --tells=owner --quote=TEXT -" % first, err)
        self.assertIn("aim-next reply %s --tells=agent-b --quote=TEXT -" % second, err)
        self.assertNotIn("aim-next reply " + foreign, err)
        code, result, err = self.view_cli("open_ask_replies", {"topic_id": "t1"})
        self.assertEqual((code, err), (0, ""), result)
        self.assertEqual([(item["message_id"], item["root_id"], item["asker"]) for item in result["items"]],
                         [(first, root, "owner"), (second, second, "agent-b")])

    def test_one_open_ask_can_be_read_and_replied_to_without_another_root(self):
        closed = self.ask("Which packet is ready?")
        self.committed(self.command("message.resolve", {}, target={"message_id": closed}))
        open_ask = self.ask("Which route should we publish?")
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (open_ask,))[0][0]
        code, out, err = self.bare()
        self.assertEqual((code, out), (2, ""))
        self.assertIn("aim-next read --after %d --limit 1 -- t1" % (seq - 1), err)
        self.assertIn("aim-next reply %s --tells=owner --quote=TEXT -" % open_ask, err)
        self.assertNotIn("aim-next reply " + closed, err)
        code, out, err = self.run_cli("reply", open_ask, "--tells", "owner", "--quote",
                                      "Which route should we publish?", "The riverside route.")
        self.assertEqual((code, err), (0, ""), (out, err))
        self.assertEqual(self.latest()[-1], open_ask)

    def test_structured_refusal_and_deliberate_new_subject_are_unchanged(self):
        ask = self.ask("Which route should we publish?")
        code, out, err = self.run_cli("--json", "post", "t1", "A proposed answer.")
        self.assertEqual((code, err), (2, ""))
        receipt = json.loads(out)
        self.assertEqual(receipt["error"]["code"], "DIVERGENCE_REASON_REQUIRED")
        self.assertEqual(set(receipt["error"]["details"]), {"topic_revision", "candidates"})
        code, out, err = self.bare("--divergence-reason", "Separate equipment notes.")
        self.assertEqual((code, err), (0, ""), (out, err))
        self.assertIsNone(self.latest()[-1])
        self.assertNotIn("aim-next reply " + ask, out)

    def test_join_updates_the_dossier_label_without_changing_the_reply_target(self):
        root = self.opening["id"]
        ask = self.ask("Which route should we publish?")
        self.committed(self.command("stack.name", {"name": "Route planning"}, target={"message_id": root},
                                    expected={"name_revision": 0}))
        self.committed(self.command("stack.join", {"into": root}, target={"message_id": ask},
                                    expected={"join_revision": 0}))
        code, result, err = self.view_cli("open_ask_replies", {"topic_id": "t1"})
        self.assertEqual((code, err), (0, ""))
        self.assertEqual([(item["message_id"], item["root_id"], item["dossier_name"]) for item in result["items"]],
                         [(ask, root, "Route planning")])
        _, _, error = self.bare()
        self.assertIn("Route planning (%s)" % root, error)
        self.assertIn("aim-next reply %s --tells=owner " % ask, error)

    def test_edit_held_ask_is_skipped_and_the_result_is_bounded(self):
        held = self.ask("There is a private edit in progress.")
        self.committed(self.command("message.edit_open", {"holder": "test-editor"}, target={"message_id": held}))
        live = [self.ask("Open Ask %d?" % n) for n in range(11)]
        code, result, err = self.view_cli("open_ask_replies", {"topic_id": "t1"})
        self.assertEqual((code, err), (0, ""))
        self.assertEqual([item["message_id"] for item in result["items"]], live[:10])
        self.assertTrue(result["more"])
        self.assertNotIn("private edit", json.dumps(result))

    def test_copying_the_reply_command_cannot_address_somebody_else(self):
        control_id = "lead\u0085route"
        escaped_id = r"lead\x85route"
        for actor in ("alpha", "beta", "alpha,beta", "-route-lead", control_id, escaped_id):
            self.store.register_actor(actor, "human", actor)
            self.participation(actor, True)
        for asker, expected in (("alpha,beta", []), ("-route-lead", ["-route-lead"]), (control_id, [])):
            with self.subTest(asker=asker):
                question = "Which route should we publish?"
                ask = self.ask(question, actor=asker)
                _, _, err = self.bare()
                command = next(line for line in err.splitlines() if "aim-next reply " + ask in line)
                argv = [word.replace("--quote=TEXT", "--quote=" + question) for word in shlex.split(command)]
                code, out, err = self.run_cli(*argv[1:], stdin=b"The riverside route.")
                self.assertEqual(code, 0, (out, err))
                self.assertEqual((json.loads(self.latest()[4]), self.latest()[-1]), (expected, ask))

    def create_ask_topic(self, topic):
        target = {"opening_id": "fixture-opening"}
        saved = self.committed(self.command("opening.save", {
            "workspace_id": "w1", "topic_id": topic, "title": "Route planning", "participants": ["agent-a"],
            "body": "Plan the route.", "attachments": [],
        }, target=target, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target=target,
                                    expected={"opening_revision": saved["opening_revision"]}))
        return self.committed(self.command("message.post", {
            "body": "Which route?", "intent": "ask", "addressees": ["agent-a"], "go_ahead": False,
        }, target={"topic_id": topic}))["message_id"]

    def test_copying_the_read_command_works_for_a_topic_starting_with_a_dash(self):
        topic = "-project"
        ask = self.create_ask_topic(topic)
        code, _, err = self.run_cli("post", "--", topic, "An answer.")
        self.assertEqual(code, 2, err)
        command = next(line for line in err.splitlines() if "aim-next read " in line)
        code, out, err = self.run_cli(*shlex.split(command)[1:])
        self.assertEqual((code, err), (0, ""), out)
        self.assertIn(ask, out)

    def test_hint_does_not_print_a_read_command_with_a_changed_topic_id(self):
        topic = "route\u0085planning"
        ask = self.create_ask_topic(topic)
        code, _, err = self.run_cli("post", "--", topic, "An answer.")
        self.assertEqual(code, 2, err)
        self.assertNotIn("aim-next read ", err)
        self.assertIn("aim-next reply " + ask, err)

    def test_hint_read_failure_preserves_the_original_refusal(self):
        self.ask("Which route should we publish?")
        original = Store.view

        def unavailable(store, actor, name, args):
            if name == "open_ask_replies":
                return {"error": {"code": "DATABASE_BUSY", "retryable": True}}
            return original(store, actor, name, args)

        prior = self.latest()
        with mock.patch.object(Store, "view", unavailable):
            code, out, err = self.bare()
        self.assertEqual((code, out), (2, ""))
        self.assertIn("DIVERGENCE_REASON_REQUIRED", err)
        self.assertEqual(self.latest(), prior)
