from __future__ import annotations

"""Holding a message while its author has it open in Edit (item 452, docs/message-edit.md, slice 2).

M is owner's ask "Deploy at 5" to agent-a in t1, and D agent-a's delivery of it. Opening Edit moves every agent's
unsettled delivery of M to the state 'held', the same row, uncounted as an acknowledgment uncounts it; the scheduler
reads only 'pending', so to it the hold is a departure and the release an arrival. Holding (the data) ends only with
the holder's Save, its close, or a lapse a write observes; held (the clock) is holding and renewed within
edit_hold_ms. The clock is aim_next.delivery._now_ms, patched to self.now from 1000; every claim and finish uses a
runner of this case holding a live lease, and agent-a is a hosted agent pinned to a thread, so a claim can be handed.
After every write the holding invariant is checked: an agent's delivery of M is 'held' exactly while M is holding and
the delivery is unsettled, no person's delivery is ever held, and every active group's counters, and every
schedule's pending count, equal a recount of its 'pending' rows.
"""

from pathlib import Path
import unittest
from unittest import mock

from aim_next import hosted_notice
from aim_next.contract import LIMITS
import test_message_edit


THREAD = "12345678-1234-4234-8234-123456789abc"
HOLD = LIMITS["edit_hold_ms"]


class HoldCase(test_message_edit.EditCase):
    def setUp(self):
        self.now = 1000
        patch = mock.patch("aim_next.delivery._now_ms", side_effect=lambda: self.now)
        patch.start()
        self.addCleanup(patch.stop)
        super().setUp()
        self.home = Path(self.temp.name).resolve() / "codex-home"
        self.home.mkdir()
        self.hosting = self.store.runner_guard("hold-runner")
        self.hosting.__enter__()
        self.addCleanup(self.hosting.close)
        pinned = self.store.provision_route_pin(self.hosting, "agent-a", {"kind": "codex-hosted-stdio", "protocol_version": 1,
                                                                          "codex_home": str(self.home), "thread_id": THREAD})
        self.assertEqual(pinned["status"], "provisioned", pinned)
        self.runner = self.store.acquire_runner(self.hosting)["runner_token"]

    # The fixture ---------------------------------------------------------------------------------------------------

    def ask_m(self, body="Deploy at 5"):
        self.m = self.post(body, addressees=["agent-a"], intent="ask")
        self.d = self.delivery("agent-a", self.m)
        return self.m

    def delivery(self, agent, message, revision=1):
        rows = self.sql("SELECT id FROM deliveries WHERE recipient_id=? AND message_id=? AND revision=?", (agent, message, revision))
        return rows[0][0] if rows else None

    def ack_the_rest(self, agent="agent-a", keep=()):
        """The agent acks every pending delivery but those kept, as an inbox is cleared."""
        for (delivery_id,) in self.sql("SELECT id FROM deliveries WHERE recipient_id=? AND state='pending' ORDER BY seq", (agent,)):
            if delivery_id not in keep:
                self.committed(self.command("delivery.ack", {}, target={"delivery_id": delivery_id}, actor=agent))

    def row(self, delivery_id):
        """D's row: its columns and its reasons."""
        return (self.sql("SELECT id,seq,group_id,revision,topic_id,state FROM deliveries WHERE id=?", (delivery_id,)),
                self.sql("SELECT reason,topic_id,participant_epoch FROM delivery_reasons WHERE delivery_id=? ORDER BY reason", (delivery_id,)))

    def state(self, delivery_id):
        return self.sql("SELECT state FROM deliveries WHERE id=?", (delivery_id,))[0][0]

    def group(self, delivery_id):
        return self.sql("SELECT g.id,g.pending_count,g.first_pending_seq FROM delivery_groups g JOIN deliveries d ON d.group_id=g.id WHERE d.id=?",
                        (delivery_id,))[0]

    def due(self, agent="agent-a"):
        return self.sql("SELECT next_due_ms FROM recipient_schedule WHERE recipient_id=?", (agent,))[0][0]

    def full_schedule(self, agent="agent-a"):
        return dict(zip(("pending_count", "next_due_ms", "handed_seq", "captured_seq", "unanswered_wakes"), self.sql(
            "SELECT pending_count,next_due_ms,handed_seq,captured_seq,unanswered_wakes FROM recipient_schedule WHERE recipient_id=?", (agent,))[0]))

    def session(self, verb, message=None, holder="h-laptop", actor="owner", op=None, expected=None, **args):
        return self.command("message.edit_" + verb, dict({"holder": holder}, **args), target={"message_id": message or self.m},
                            expected=expected, actor=actor, op=op)

    def open(self, message=None, holder="h-laptop", **args):
        result = self.committed(self.session("open", message, holder, **args))
        self.invariant()
        return result

    def close(self, message=None, holder="h-laptop"):
        result = self.committed(self.session("close", message, holder))
        self.invariant()
        return result

    def save(self, body, revision=1, holder="h-laptop", message=None, op=None):
        args = {"body": body} if holder is None else {"body": body, "holder": holder}
        return self.command("message.edit", args, target={"message_id": message or self.m}, expected={"message_revision": revision}, op=op)

    def draft(self, body, session_revision, holder="h-laptop", base=1, message=None, op=None):
        return self.session("draft", message, holder, op=op, expected={"session_revision": session_revision}, body=body, base_revision=base)

    def saw(self, agent, message=None):
        """The agent reads the message's source: it is handed its words."""
        return self.source({"kind": "message", "id": message or self.m}, actor=agent)

    def invariant(self):
        holding = {row[0] for row in self.sql("SELECT message_id FROM message_edit_sessions WHERE state='open' AND released_ms IS NULL")}
        for delivery_id, message, state, kind in self.sql("SELECT d.id,d.message_id,d.state,a.kind FROM deliveries d JOIN actors a ON a.id=d.recipient_id"):
            if kind != "agent":
                self.assertNotEqual(state, "held", "a person's delivery is never held")
            elif message in holding:
                self.assertNotEqual(state, "pending", "an unsettled agent delivery of a holding message is held: %s" % delivery_id)
            else:
                self.assertNotEqual(state, "held", "only a holding message's deliveries are held: %s" % delivery_id)
        for group, count, head, recount, rehead in self.sql(
                "SELECT g.id,g.pending_count,g.first_pending_seq,(SELECT count(*) FROM deliveries d WHERE d.group_id=g.id AND d.state='pending'),"
                "(SELECT min(d.seq) FROM deliveries d WHERE d.group_id=g.id AND d.state='pending') FROM delivery_groups g WHERE g.active=1"):
            self.assertEqual((count, head), (recount, rehead), "group %s counts its pending rows" % group)
        for agent, count, recount in self.sql("SELECT s.recipient_id,s.pending_count,(SELECT coalesce(sum(g.pending_count),0) FROM delivery_groups g "
                                              "WHERE g.recipient_id=s.recipient_id AND g.active=1) FROM recipient_schedule s"):
            self.assertEqual(count, recount, "%s's schedule counts its active groups" % agent)

    # The runner ----------------------------------------------------------------------------------------------------

    def claims(self, agents=("agent-a",)):
        """claim_wakes at self.now for these routed agents, under a lease renewed first."""
        if self.store.renew_runner(self.hosting, self.runner)["status"] != "renewed":
            self.runner = self.store.acquire_runner(self.hosting)["runner_token"]
        result = self.store.claim_wakes(self.hosting, self.runner, list(agents), limit=8)
        self.assertEqual(result["status"], "ok", result)
        self.invariant()
        return result

    def attempts(self):
        return self.sql("SELECT count(*) FROM wake_attempts")[0][0]

    def notice(self, claim, agent="agent-a"):
        items = self.store.view(agent, "deliveries", {})["items"]
        found = hosted_notice.notice(items, claim["handed_seq"], agent, claim["attempt_id"])
        return found["input"][0]["text"] if found else None

    def hand(self, claim, turn="turn-1"):
        result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "handed", turn={
            "thread_id": THREAD, "turn_id": turn, "mode": "start", "client_id": "theseus:" + claim["attempt_id"],
            "announced_seq": claim["captured_seq"]})
        self.assertEqual((result["status"], result["wake_status"]), ("settled", "handed"), result)
        self.invariant()
        return result

    def end_turn(self, status="completed", turn="turn-1"):
        result = self.store.end_hosted_turn(self.hosting, self.runner, THREAD, turn, status)
        self.invariant()
        return result


class SaveCase(HoldCase):
    """Group 2: holding is not acknowledging; an ack of a held delivery is refused MESSAGE_HELD; the holder's Save
    restores the same row and wakes the agent, which reads revision 2 with no correction."""

    def test_open_holds_the_same_row_save_restores_it_and_wakes_the_agent(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        before, group, schedule = self.row(self.d), self.group(self.d), self.full_schedule()
        correction_groups = self.sql("SELECT * FROM delivery_groups WHERE recipient_id='agent-a' AND kind='correction'")
        changes = self.sql("SELECT count(*) FROM changes WHERE resource_kind='delivery' AND resource_id=?", (self.d,))
        operations = self.sql("SELECT count(*) FROM operations WHERE actor_id='agent-a'")
        opened = self.open()
        self.assertEqual((opened["session_revision"], opened["holder"], opened["taken"], opened["base_revision"], opened["base_words"],
                          opened["draft"], opened["revision"], opened["words"], opened["renewed_ms"], opened["hold_ms"]),
                         (1, "h-laptop", False, 1, "Deploy at 5", "Deploy at 5", 1, "Deploy at 5", 1000, HOLD))
        held = self.row(self.d)
        self.assertEqual(held[0][0][:5], before[0][0][:5], "the same id, seq, group, revision and topic")
        self.assertEqual((held[0][0][5], held[1]), ("held", before[1]), "only the state changed; the reasons are kept")
        self.assertEqual(self.group(self.d), (group[0], group[1] - 1, None), "one lower, and the head is the recount")
        self.assertEqual((self.full_schedule()["pending_count"], self.due()), (0, None))
        # Nothing of an acknowledgment happened.
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE resource_kind='delivery' AND resource_id=?", (self.d,)), changes,
                         "no delivery change for D")
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE actor_id='agent-a'"), operations)
        self.assertEqual(self.sql("SELECT * FROM delivery_groups WHERE recipient_id='agent-a' AND kind='correction'"), correction_groups)
        # An ack is refused, and not recorded.
        refused = self.command("delivery.ack", {}, target={"delivery_id": self.d}, actor="agent-a", op="ack-1")
        self.assertEqual((refused.get("error", {}).get("code"), refused["recorded"]), ("MESSAGE_HELD", False), refused)
        self.assertIn("is being edited by its author and is held until they save or leave the edit (at most 2 minutes). Nothing was done.",
                      refused["error"]["message"])
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE id='ack-1'"), [(0,)])
        self.assertEqual(self.state(self.d), "held")
        # Reading through and a thumb leave it held; the reaction is recorded.
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (self.m,))[0][0]
        self.committed(self.command("topic.read_through", {"seq": seq}, target={"topic_id": "t1"}, actor="agent-a"))
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": self.m}, expected={"thumb_revision": 0}, actor="agent-a"))
        self.assertEqual(self.state(self.d), "held")
        self.assertEqual(self.sql("SELECT count(*) FROM message_reactions WHERE message_id=? AND actor_id='agent-a'", (self.m,)), [(1,)])
        self.invariant()
        # Nothing is claimed while it is held.
        self.now = 2000
        attempts = self.attempts()
        self.assertEqual(self.claims()["claims"], [])
        self.assertEqual((self.attempts(), self.due()), (attempts, None))
        # The holder's Save releases the same row and hands it back, before any correction.
        self.now = 3000
        saved = self.committed(self.save("Deploy at 6"))
        self.invariant()
        self.assertEqual((saved["revision"], saved["corrections"], saved["session_closed"], saved["session_revision"]), (2, 0, True, 2))
        self.assertEqual(self.row(self.d), before, "D's row is restored, pending")
        self.assertEqual(self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-a' AND message_id=?", (self.m,)), [(self.d,)])
        self.assertEqual(self.group(self.d), group, "the counters are the snapshot's")
        self.assertEqual(self.due(), 3000, "release's hand-back: due now")
        self.assertEqual(self.sql("SELECT version FROM changes WHERE resource_kind='delivery' AND resource_id=? AND scope_id='agent-a' ORDER BY seq DESC LIMIT 1",
                                  (self.d,)), [(1,)], "watch prints it as a delivery")
        self.assertEqual(self.sql("SELECT state FROM message_edit_sessions WHERE message_id=?", (self.m,)), [("saved",)])
        [claim] = self.claims()["claims"]
        self.assertIn(self.d, self.notice(claim))
        [item] = [item for item in self.listed("agent-a") if item["id"] == self.d]
        self.assertEqual((item["message"]["body"], item["message"]["revision"]), ("Deploy at 6", 2))
        self.assertIsNone(self.delivery("agent-a", self.m, 2), "no correction: agent-a was never handed the old words")
        again = self.command("delivery.ack", {}, target={"delivery_id": self.d}, actor="agent-a", op="ack-1")
        self.committed(again)
        self.assertEqual(self.state(self.d), "acknowledged")
        self.invariant()

    def test_without_the_open_the_ack_commits_at_once_and_nothing_is_held(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        self.committed(self.command("delivery.ack", {}, target={"delivery_id": self.d}, actor="agent-a", op="ack-1"))
        self.assertEqual(self.state(self.d), "acknowledged")
        self.committed(self.save("Deploy at 6", holder=None))
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE state='held'"), [(0,)])
        self.invariant()

    def test_a_held_delivery_is_never_listed_counted_or_given_and_people_are_never_held(self):
        self.member("other-reader", True)
        self.participation("other-reader", True)
        self.ask_m()
        people = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id IN ('owner','other-reader')", (self.m,))
        self.assertTrue(people)
        attention = self.store.view("agent-a", "attention", {})
        self.assertIn(self.d, [item["id"] for item in attention["latest_addressed"]])
        self.open()
        for (person,) in people:
            self.assertNotEqual(self.state(person), "held")
        self.assertNotIn(self.d, [item["id"] for item in self.listed("agent-a")])
        self.assertNotIn(self.d, [item["id"] for item in self.store.view("agent-a", "attention", {})["latest_addressed"]])
        held = self.store.view("agent-a", "delivery", {"delivery_id": self.d})
        self.assertEqual(held.get("error", {}).get("code"), "MESSAGE_HELD", held)
        self.assertLess(self.store.view("agent-a", "attention", {})["addressed"], attention["addressed"])
        # A person's view of the same delivery is untouched: people's deliveries are never held.
        self.assertNotIn("error", self.store.view("other-reader", "deliveries", {}))


class CancelCase(HoldCase):
    """Group 3: the holder's close releases, and the words are unchanged; another holder's close is refused."""

    def test_cancel_releases_and_the_agent_reads_the_unchanged_words(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        before = self.row(self.d)
        self.open()
        refused = self.session("close", holder="h-other")
        self.assertEqual((refused.get("error", {}).get("code"), refused["recorded"]), ("EDIT_TAKEN", False), refused)
        self.assertEqual(self.state(self.d), "held")
        self.now = 4000
        closed = self.close()
        self.assertEqual(closed, {"message_id": self.m, "closed": True, "session_revision": 2})
        self.assertEqual(self.sql("SELECT state,draft FROM message_edit_sessions"), [("closed", "")])
        self.assertEqual(self.row(self.d), before)
        self.assertEqual(self.due(), 4000, "due at the close's time")
        [claim] = self.claims()["claims"]
        self.assertIn(self.d, self.notice(claim))
        [item] = [item for item in self.listed("agent-a") if item["id"] == self.d]
        self.assertEqual((item["message"]["body"], item["message"]["revision"]), ("Deploy at 5", 1))
        self.assertEqual(self.sql("SELECT count(*) FROM message_revisions"), [(0,)])
        self.assertEqual(self.corrections(), [])
        # A close with nothing open commits, changing nothing.
        self.assertEqual(self.committed(self.session("close")), {"message_id": self.m, "closed": False})


class LapseCase(HoldCase):
    """Group 4: a lapse releases, without delaying or cancelling other wakes. Each step checks next_due_ms as the
    contract's "Scheduling, walked" gives it."""

    def agent_c_topic(self):
        """agent-c, with work of its own in t-c (a topic of w1 it alone takes part in), due at 50000."""
        with __import__("sqlite3").connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('agent-c','agent','Agent C')")
        self.member("agent-c", True)
        source = {"kind": "new_topic", "id": "opening-c", "workspace_id": "w1"}
        self.committed(self.command("draft.save", dict(source_ref=source, topic_id="t-c", body="Work for agent-c", generation="gA", attachments=[],
                                                       quotes=[], addressees=[], opening={"workspace_id": "w1", "title": "C", "participants": ["agent-c"]}),
                                    target={"draft_id": "opening-c"}, expected={"draft_revision": 0}))
        self.committed(self.command("submission.prepare", {"draft_id": "opening-c", "submission_id": "opening-c", "send_operation_id": "open-c"},
                                    target={"topic_id": "t-c"}, expected={"draft_revision": 1}))
        self.committed(self.command("topic.create_and_send", {"submission_id": "opening-c"}, target={"topic_id": "t-c"}, op="open-c"))
        self.sql("UPDATE recipient_schedule SET next_due_ms=50000 WHERE recipient_id='agent-c'")

    def test_base_ack_during_the_hold_and_the_lapse_released_by_claim_wakes(self):
        self.ask_m()
        self.w = self.post("Check the logs", addressees=["agent-a"], intent="tell")
        w = self.delivery("agent-a", self.w)
        self.ack_the_rest(keep=(self.d, w))
        self.agent_c_topic()
        before = self.row(self.d)
        due = self.due()
        self.open()
        self.assertEqual((self.state(self.d), self.state(w), self.full_schedule()["pending_count"]), ("held", "pending", 1))
        self.assertEqual(self.due(), due, "no earlier claim: next_due_ms is unchanged")
        [claim] = self.claims()["claims"]
        text = self.notice(claim)
        self.assertIn(w, text)
        self.assertNotIn(self.d, text)
        self.hand(claim)
        self.assertIsNone(self.due(), "handed")
        self.committed(self.command("delivery.ack", {}, target={"delivery_id": w}, actor="agent-a"))
        self.assertEqual((self.full_schedule()["pending_count"], self.due(), self.full_schedule()["handed_seq"]), (0, None, None))
        # agent-c's own work is claimed at its time, untouched.
        self.now = 50000
        [other] = self.claims(("agent-a", "agent-c"))["claims"]
        self.assertEqual(other["recipient_id"], "agent-c")
        self.now = 60000
        attempts = self.attempts()
        self.assertEqual(self.claims()["claims"], [], "no empty wake for agent-a")
        self.assertEqual(self.attempts(), attempts)
        # At the hold's end the runner wakes; its claim releases M and claims agent-a in the same call.
        self.assertEqual(self.store.runner_schedule(["agent-a"])["next_due_ms"], 1000 + HOLD)
        self.now = 1000 + HOLD
        [claim] = self.claims()["claims"]
        self.assertEqual(self.row(self.d), before, "D restored, pending")
        self.assertEqual(self.sql("SELECT released_ms FROM message_edit_sessions"), [(self.now,)])
        self.assertEqual(claim["recipient_id"], "agent-a")
        self.assertIn(self.d, self.notice(claim))
        # Handing that claim names D again (the accepted duplicate: released inside this claim, at the same millisecond).
        handed = self.hand(claim, turn="turn-2")
        self.assertEqual((handed["handed_seq"], handed["next_due_ms"]), (None, self.now))

    def test_renewal_moves_the_hold_end_and_nothing_is_woken_for_it(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        opened = self.open()
        self.now = 100000
        renewed = self.committed(self.draft("Deploy at 5", opened["session_revision"]))
        self.assertEqual(renewed["renewed_ms"], 100000)
        self.invariant()
        self.now = 1000 + HOLD
        attempts = self.attempts()
        self.assertEqual(self.claims()["claims"], [])
        self.assertEqual((self.attempts(), self.state(self.d)), (attempts, "held"), "nothing released, nothing woken")
        self.assertEqual(self.store.runner_schedule(["agent-a"])["next_due_ms"], 100000 + HOLD)
        self.now = 100000 + HOLD
        [claim] = self.claims()["claims"]
        self.assertEqual((claim["recipient_id"], self.state(self.d)), ("agent-a", "pending"))

    def test_a_live_claim_across_a_release_is_handed_as_stale(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        self.open()
        self.now = 110000
        w2 = self.delivery("agent-a", self.post("Second thing", addressees=["agent-a"], intent="tell"))
        [claim] = self.claims()["claims"]
        self.assertGreaterEqual(claim["captured_seq"], self.sql("SELECT seq FROM deliveries WHERE id=?", (w2,))[0][0])
        self.assertNotIn(self.d, self.notice(claim))
        self.now = 1000 + HOLD
        self.assertEqual(self.committed(self.command("delivery.ack", {}, target={"delivery_id": w2}, actor="agent-a"))["acknowledged"], True)
        self.assertEqual(self.claims()["claims"], [], "agent-a's claim is live")
        self.assertEqual((self.state(self.d), self.due()), ("pending", 130000), "due when the live claim ends")
        self.now = 122000
        handed = self.hand(claim)
        self.assertEqual((handed["handed_seq"], handed["next_due_ms"]), (None, 122000), "released since the claim: handled as stale")
        [again] = self.claims()["claims"]
        self.assertIn(self.d, self.notice(again))

    def test_head_variant_new_work_on_an_empty_count_is_due_at_once(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        [claim] = self.claims()["claims"]
        self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "accepted")
        self.assertEqual(self.due(), 1000 + 60000)
        self.open()
        self.assertIsNone(self.due())
        self.now = 5000
        n = self.delivery("agent-a", self.post("New work", addressees=["agent-a"], intent="tell"))
        self.assertEqual(self.due(), 5000, "N is due at once")
        [claim] = self.claims()["claims"]
        text = self.notice(claim)
        self.assertIn(n, text)
        self.assertNotIn(self.d, text)

    def test_head_variant_without_the_open_waits_for_the_accepted_wake(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        [claim] = self.claims()["claims"]
        self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "accepted")
        self.now = 5000
        self.post("New work", addressees=["agent-a"], intent="tell")
        self.assertEqual(self.due(), 1000 + 60000, "D is captured, undone work: N waits for the accepted wake, as today")

    def turn_holding_w(self):
        """A turn T holds W (handed_seq >= W.seq); agent-a has nothing else pending."""
        self.w = self.post("Check the logs", addressees=["agent-a"], intent="tell")
        w = self.delivery("agent-a", self.w)
        self.ack_the_rest(keep=(w,))
        [claim] = self.claims()["claims"]
        self.hand(claim)
        return w

    def test_turn_variant_a_held_arrival_does_not_rearm_the_turn_end(self):
        w = self.turn_holding_w()
        self.now = 2000
        self.ask_m("Deploy at 7")
        self.assertEqual(self.due(), 2000, "arrived after handing: due now")
        self.open()
        self.assertIsNone(self.due(), "the held arrival departed; only work the turn holds is left")
        self.now = 3000
        attempts = self.attempts()
        self.assertEqual(self.claims()["claims"], [])
        self.assertEqual((self.attempts(), self.due()), (attempts, None))
        self.now = 5000
        self.end_turn()
        self.assertEqual((self.due(), self.full_schedule()["handed_seq"]), (65000, None))
        self.now = 65000
        [claim] = self.claims()["claims"]
        text = self.notice(claim)
        self.assertIn(w, text)
        self.assertNotIn(self.d, text)

    def test_turn_variant_negative_nothing_held(self):
        self.turn_holding_w()
        self.now = 2000
        self.ask_m("Deploy at 7")
        self.now = 3000
        [claim] = self.claims()["claims"]
        self.assertIn(self.d, self.notice(claim))

    def test_turn_variant_negative_the_handed_work_held(self):
        w = self.turn_holding_w()
        self.m = self.w
        self.open()
        self.assertEqual((self.full_schedule()["handed_seq"], self.due()), (None, None), "nothing pending")
        self.now = 5000
        self.end_turn()
        self.assertIsNone(self.due(), "T's end re-arms nothing")
        self.now = 6000
        self.close()
        self.assertEqual(self.due(), 6000)
        [claim] = self.claims()["claims"]
        self.assertIn(w, self.notice(claim))

    def test_ack_after_the_lapse_releases_and_acks_in_one_commit(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        self.open()
        self.now = 1000 + HOLD
        commits = self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0]
        acked = self.committed(self.command("delivery.ack", {}, target={"delivery_id": self.d}, actor="agent-a"))
        self.assertTrue(acked["acknowledged"])
        self.assertEqual(int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0]), int(commits) + 1, "one commit")
        self.assertEqual(self.state(self.d), "acknowledged")
        self.assertEqual(self.sql("SELECT released_ms FROM message_edit_sessions"), [(self.now,)])
        self.invariant()

    def test_next_due_counts_only_a_hold_on_an_agents_delivery(self):
        # owner's own message, not sent to any agent, held: no held agent delivery, so no hold end.
        lone = self.post("A note to myself", topic="t1")
        for agent in ("agent-a",):
            self.ack_the_rest(agent)
        before = (self.store.runner_schedule(["agent-a"])["next_due_ms"], self.store.runner_status().get("next_due_ms"))
        self.sql("UPDATE deliveries SET state='acknowledged' WHERE message_id=?", (lone,))
        self.committed(self.session("open", lone))
        self.assertEqual((self.store.runner_schedule(["agent-a"])["next_due_ms"], self.store.runner_status().get("next_due_ms")), before)


class DevicesCase(HoldCase):
    """Group 5: two devices hold M through its one session; only the end of that session releases."""

    def roles(self, first, second, exposed=False):
        self.ask_m()
        if exposed:
            self.saw("agent-a")
        self.ack_the_rest(keep=(self.d,))
        self.before = self.row(self.d)
        one = self.open(holder=first)
        self.now = 2000
        two = self.open(holder=second)
        self.assertEqual((one["taken"], two["taken"], one["revision"], two["revision"]), (False, True, 1, 1))
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE state='held'"), [(1,)], "D is held once")
        self.assertEqual(self.state(self.d), "held")
        return two

    def first_device_loses(self, first, second, exposed=False):
        two = self.roles(first, second, exposed)
        for receipt in (self.draft("L words", 2, holder=first), self.session("close", holder=first)):
            self.assertEqual((receipt.get("error", {}).get("code"), receipt["recorded"]), ("EDIT_TAKEN", False), receipt)
        self.assertEqual(self.state(self.d), "held")
        saved = self.committed(self.save("L", holder=first))
        self.invariant()
        self.assertEqual((saved["revision"], saved["session_closed"]), (2, False))
        self.assertNotIn("session_revision", saved)
        self.assertEqual(self.sql("SELECT state,holder FROM message_edit_sessions"), [("open", second)])
        self.assertEqual(self.state(self.d), "held")
        page = self.store.view("agent-a", "topic_messages", {"topic_id": "t1", "message_ids": [self.m]})
        self.assertEqual((page["items"][0]["withheld"], page["items"][0]["body"]), (True, ""))
        if exposed:
            self.assertEqual([row[2:] for row in self.corrections("agent-a", self.m)], [(2, "held")], "queued held, counted nowhere")
        return two

    def test_laptop_then_phone_only_the_phones_save_releases(self):
        self.check_order("h-laptop", "h-phone", exposed=False)

    def test_reverse_order_phone_then_laptop(self):
        self.check_order("h-phone", "h-laptop", exposed=False)

    def test_an_exposed_agent_gets_one_correction_at_the_last_revision(self):
        self.check_order("h-laptop", "h-phone", exposed=True)

    def check_order(self, first, second, exposed):
        two = self.first_device_loses(first, second, exposed)
        stale = self.save("P", holder=second, op="phone-save")
        self.assertEqual((stale.get("error", {}).get("code"), stale["recorded"], stale["error"].get("current_versions")),
                         ("REVISION_CONFLICT", True, {"message_revision": 2}))
        self.assertEqual(self.save("P", holder=second, op="phone-save"), stale, "the same operation returns it again")
        self.assertEqual(self.state(self.d), "held")
        changes = self.sql("SELECT count(*) FROM changes WHERE resource_kind='edit_session'")[0][0]
        saved = self.committed(self.save("P", revision=2, holder=second))
        self.invariant()
        self.assertEqual((saved["revision"], saved["session_closed"], saved["session_revision"]), (3, True, two["session_revision"] + 1))
        self.assertEqual(self.sql("SELECT scope_id,version FROM changes WHERE resource_kind='edit_session' ORDER BY seq DESC LIMIT 1"),
                         [("owner", saved["session_revision"])])
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE resource_kind='edit_session'")[0][0], changes + 1)
        self.assertEqual(self.row(self.d), self.before, "D restored")
        if exposed:
            self.assertEqual([row[2:] for row in self.corrections("agent-a", self.m)], [(2, "acknowledged"), (3, "pending")],
                             "the held revision-2 correction was settled by the revision-3 one")
        else:
            self.assertEqual(self.corrections("agent-a", self.m), [])
        page = self.store.view("agent-a", "topic_messages", {"topic_id": "t1", "message_ids": [self.m]})
        self.assertEqual((page["items"][0]["withheld"], page["items"][0]["body"]), (False, "P"))

    def test_the_phones_close_instead_releases(self):
        self.first_device_loses("h-laptop", "h-phone")
        self.close(holder="h-phone")
        self.assertEqual(self.row(self.d), self.before)

    def test_the_phones_lapse_instead_releases(self):
        self.first_device_loses("h-laptop", "h-phone")
        self.now = 2000 + HOLD - 1
        self.claims()
        self.assertEqual(self.state(self.d), "held", "renewed at 2000 by the phone's open")
        self.now = 2000 + HOLD
        self.claims()
        self.assertEqual(self.row(self.d), self.before)

    def test_an_exposed_agent_b_with_no_schedule_gets_a_held_correction_and_its_release(self):
        """The spec gate's missing schedule row: agent-b, sent nothing, reads M, and a non-holder Save queues its
        correction held; the holder's later close releases it with no error."""
        self.ask_m()
        self.saw("agent-b")
        self.assertEqual(self.sql("SELECT count(*) FROM recipient_schedule WHERE recipient_id='agent-b' AND pending_count>0"), [(0,)])
        self.sql("DELETE FROM recipient_schedule WHERE recipient_id='agent-b'")
        self.open(holder="h-phone")
        self.committed(self.save("L", holder="h-laptop"))
        self.invariant()
        self.assertEqual([row[2:] for row in self.corrections("agent-b", self.m)], [(2, "held")])
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='agent-b'"), [(0,)])
        self.now = 3000
        self.close(holder="h-phone")
        self.assertEqual([row[2:] for row in self.corrections("agent-b", self.m)], [(2, "pending")])
        self.assertEqual(self.due("agent-b"), 3000)
        self.assertEqual(self.sql("SELECT version FROM changes WHERE resource_kind='delivery' AND scope_id='agent-b' ORDER BY seq DESC LIMIT 1"), [(1,)])

    def test_holder_validation(self):
        self.ask_m()
        for args in ({"body": "x", "holder": 7}, {"body": "x", "holder": ""}, {"body": "x", "holder": None}):
            with self.subTest(args=args):
                refused = self.command("message.edit", args, target={"message_id": self.m}, expected={"message_revision": 1})
                self.assertEqual((refused.get("error", {}).get("code"), refused["recorded"]), ("INVALID_ARGUMENT", False))
        opened = self.open()
        refused = self.session("draft", holder=7, expected={"session_revision": opened["session_revision"]}, body="x", base_revision=1)
        self.assertEqual(refused.get("error", {}).get("code"), "INVALID_ARGUMENT")
        for base in (0, 2, True, "1", 1.0):
            with self.subTest(base=base):
                refused = self.session("draft", expected={"session_revision": opened["session_revision"]}, body="x", base_revision=base)
                self.assertEqual(refused.get("error", {}).get("code"), "INVALID_ARGUMENT")


class SessionCommandCase(HoldCase):
    """The session commands' checks and results (docs/message-edit.md, "Edit sessions")."""

    def test_only_the_author_a_person_opens_and_a_reached_outcome_refuses_all_but_close(self):
        self.ask_m()
        agent_post = self.post("Agent words", actor="agent-a")
        for receipt, code in ((self.session("open", agent_post), "FORBIDDEN"), (self.session("open", actor="agent-a"), "FORBIDDEN"),
                              (self.session("open", "m-nobody"), "FORBIDDEN")):
            self.assertEqual(receipt.get("error", {}).get("code"), code, receipt)
        self.open()
        self.sql("INSERT INTO outcome_reached VALUES ('w1','Done','[]','owner',1)")
        self.assertEqual(self.session("open", holder="h-phone").get("error", {}).get("code"), "OUTCOME_REACHED")
        self.assertEqual(self.draft("x", 1).get("error", {}).get("code"), "OUTCOME_REACHED")
        self.assertTrue(self.committed(self.session("close"))["closed"], "a hold can always be ended")

    def test_drafts_keep_the_words_in_core_and_any_device_resumes_them(self):
        self.ask_m()
        opened = self.open()
        self.now = 1500
        kept = self.committed(self.draft("Deploy at 6, maybe", opened["session_revision"]))
        self.assertEqual(kept, {"message_id": self.m, "session_revision": 2, "renewed_ms": 1500})
        conflict = self.draft("Other", 1)
        self.assertEqual((conflict["error"]["code"], conflict["recorded"], conflict["error"].get("current_versions")),
                         ("REVISION_CONFLICT", True, {"session_revision": 2}))
        too_long = self.draft("x" * (LIMITS["body_utf8_bytes"] + 1), 2, op="too-long")
        self.assertEqual((too_long["error"]["code"], too_long["recorded"]), ("BODY_TOO_LARGE", True))
        phone = self.open(holder="h-phone")
        self.assertEqual((phone["taken"], phone["draft"], phone["base_revision"], phone["base_words"]), (True, "Deploy at 6, maybe", 1, "Deploy at 5"))
        taken = self.draft("Laptop again", phone["session_revision"])
        self.assertEqual((taken["error"]["code"], taken["recorded"]), ("EDIT_TAKEN", False))
        self.close(holder="h-phone")
        closed = self.draft("After", phone["session_revision"] + 1, holder="h-phone")
        self.assertEqual((closed["error"]["code"], closed["recorded"]), ("EDIT_CLOSED", False))
        # A session that ended starts again from the current words.
        again = self.open(holder="h-phone")
        self.assertEqual((again["draft"], again["taken"]), ("Deploy at 5", False))

    def test_every_session_command_tells_the_author_and_nobody_else(self):
        self.ask_m()
        opened = self.open()
        self.committed(self.draft("x", opened["session_revision"]))
        self.close()
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_id,version FROM changes WHERE resource_kind='edit_session' ORDER BY seq"),
                         [("actor", "owner", self.m, 1), ("actor", "owner", self.m, 2), ("actor", "owner", self.m, 3)])
        self.assertEqual(self.committed(self.session("close"))["closed"], False)
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE resource_kind='edit_session'"), [(3,)], "a close with nothing open writes none")

    def test_a_draft_after_a_released_lapse_holds_again(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        opened = self.open()
        self.now = 1000 + HOLD
        self.claims()
        self.assertEqual(self.state(self.d), "pending", "released")
        self.committed(self.draft("Deploy at 5!", opened["session_revision"]))
        self.invariant()
        self.assertEqual(self.state(self.d), "held")
        self.assertEqual(self.sql("SELECT released_ms FROM message_edit_sessions"), [(None,)])

    def test_an_open_on_a_lapsed_unreleased_session_moves_nothing(self):
        self.ask_m()
        self.ack_the_rest(keep=(self.d,))
        self.open()
        self.now = 1000 + HOLD + 5
        self.open(holder="h-phone")
        self.assertEqual((self.state(self.d), self.sql("SELECT count(*) FROM deliveries WHERE state='held'")), ("held", [(1,)]))


class AccessThroughHeldCase(HoldCase):
    """Group 12: access through a held delivery is exactly its pending access."""

    def test_an_addressed_outsider_keeps_exactly_its_access(self):
        # Addressed while it took part, as tests/test_agent_cli.py:230-233 does; leaving keeps the addressed source.
        self.participation("outsider", True)
        m5 = self.post("Outsider: rotate the key", addressees=["outsider"], intent="tell")
        self.participation("outsider", False)
        d5 = self.delivery("outsider", m5)
        self.assertEqual(self.state(d5), "pending")
        self.assertIn(("addressed",), self.sql("SELECT reason FROM delivery_reasons WHERE delivery_id=?", (d5,)))
        self.assertEqual(self.saw("outsider", m5)["body"], "Outsider: rotate the key")

        def refused(view, args):
            return self.store.view("outsider", view, args).get("error", {}).get("code")
        self.assertEqual(refused("source", {"source_ref": {"kind": "message", "id": self.opening["id"]}}), "FORBIDDEN")
        self.assertEqual(refused("topic_messages", {"topic_id": "t1"}), "FORBIDDEN")
        self.m = m5
        self.open()
        self.assertEqual(self.state(d5), "held")
        held = self.saw("outsider", m5)
        self.assertEqual((held["withheld"], held["body"], held["attachments"], held["quotes"]), (True, "", [], []))
        self.assertEqual(refused("source", {"source_ref": {"kind": "message", "id": self.opening["id"]}}), "FORBIDDEN")
        self.assertEqual(refused("topic_messages", {"topic_id": "t1"}), "FORBIDDEN")
        self.assertEqual(refused("source", {"source_ref": {"kind": "message", "id": "m-nobody"}}), "FORBIDDEN", "an unknown id too")
        self.close()
        self.assertEqual(self.state(d5), "pending")
        self.assertEqual(self.saw("outsider", m5)["body"], "Outsider: rotate the key")
        self.assertEqual(refused("source", {"source_ref": {"kind": "message", "id": self.opening["id"]}}), "FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
