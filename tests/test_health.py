from __future__ import annotations

"""The Health page's facts, its link and its notices (pipeline item 109, docs/health.md).

agent-a is a hosted agent routed here with the topic's opening waiting; it
coordinates the outcome w1, whose team is agent-a and agent-b and whose
conversation the owner and agent-a take part in. A runner holds the role.
"""

import io
import json
import re
import sqlite3
from pathlib import Path
from unittest import mock

from aim_next import cli
from aim_next.health import FAILING_AFTER, HANDOVER_MS, WHY, machine_load as _real_machine_load, report_lines, why_words
from aim_next.profile import write_profile
from aim_next.runner import RunnerError
from test_hosted_schedule import OTHER_THREAD, THREAD
from test_wake_contract import HostedFixture, own_cases


NOTICE_TAIL = "\n\nThe Health page, under the instance name, says more; agents can run aim-next health."


@own_cases
class HealthCase(HostedFixture):
    def setUp(self):
        super().setUp()
        # The Mac's load is read live; these cases hold it calm.
        patch = mock.patch("aim_next.health.machine_load", return_value={"load": [0.5, 0.5, 0.5], "cpus": 8})
        patch.start()
        self.addCleanup(patch.stop)

    def light(self, actor="owner"):
        answer = self.store.view(actor, "health_light", {})
        self.assertNotIn("error", answer, answer)
        return answer["red"]

    def health(self, actor="owner"):
        answer = self.store.view(actor, "health", {})
        self.assertNotIn("error", answer, answer)
        return answer

    def agent(self, actor_id="agent-a", reader="owner"):
        return next(item for item in self.health(reader)["agents"] if item["actor_id"] == actor_id)

    def conversation(self):
        return self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND kind='conversation'")[0][0]

    def notices(self):
        """Theseus's notices, oldest first, as (topic, body)."""
        return self.sql("SELECT topic_id,body FROM messages WHERE author_id='theseus' ORDER BY seq")

    def miss(self, outcome="unavailable", reason="route_unavailable"):
        """One wake to agent-a that did not get through, then on to when the next is due."""
        claim = self.claim_now()
        result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], outcome, reason=reason)
        self.assertEqual(result["status"], "settled", result)
        self.now = max(self.now + 1000, result["next_due_ms"] or 0)
        self.fresh_lease()

    def failing(self, times=FAILING_AFTER, **args):
        for _ in range(times):
            self.miss(**args)

    def part(self, present):
        """The owner takes agent-a off the topic t1, or puts it back."""
        self.serial += 1
        topic = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
        result = self.store.command("owner", {
            "v": 1, "instance_id": "test-instance", "operation_id": "op-part%d" % self.serial, "kind": "participation.set",
            "target": {"topic_id": "t1"}, "expected": {"topic_revision": topic["version"], "authority": dict(self.pin)},
            "args": {"actor_id": "agent-a", "present": present}})
        self.assertEqual(result.get("status"), "committed", result)

    def deliveries_of(self, body_start):
        return self.sql("SELECT d.recipient_id,d.state FROM deliveries d JOIN messages m ON m.id=d.message_id "
                        "WHERE m.author_id='theseus' AND m.body LIKE ? ORDER BY d.recipient_id", (body_start + "%",))


@own_cases
class FailingWakesCase(HealthCase):
    def test_an_agent_whose_wakes_do_not_get_through_is_red_with_why_until_one_does(self):
        self.failing(FAILING_AFTER - 1)
        self.assertEqual(self.light(), [], "two wakes that did not get through are not yet failing")
        self.assertNotIn("failing", self.agent())
        first = self.sql("SELECT failing_since_ms FROM wake_facts WHERE recipient_id='agent-a'")[0][0]
        self.miss()
        self.assertEqual(self.light(), ["failing:agent-a"])
        self.assertEqual(self.health()["red"], ["failing:agent-a"], "the page and its link read one rule")
        self.assertEqual(self.agent()["failing"], {"count": 3, "since_ms": first, "outcome": "unavailable",
                                                   "reason": "route_unavailable", "why": WHY["route_unavailable"]})
        self.miss(outcome="error", reason="broker_exit")
        self.assertEqual(self.agent()["failing"]["why"], WHY["broker_exit"], "the latest failure says why")
        self.assertEqual(self.agent()["failing"]["count"], 4)
        self.hand(self.claim_now(), turn_id="turn-through")
        self.assertEqual(self.light(), ["failing:agent-a"], "a handed wake gets through when its turn completes")
        self.end("completed", turn_id="turn-through")
        self.assertEqual(self.light(), [])
        self.assertNotIn("failing", self.agent())
        self.assertEqual(self.agent()["reached_ms"], self.now)

    def test_a_reason_that_is_not_a_short_fixed_code_is_refused(self):
        claim = self.claim_now()
        for reason in ("route unavailable", "x" * 65, 7):
            with self.subTest(reason=reason):
                with self.assertRaises(Exception) as raised:
                    self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "error", reason=reason)
                self.assertEqual(raised.exception.code, "INVALID_ARGUMENT")

    def test_failures_before_core_kept_why_say_so(self):
        self.failing(reason=None, outcome="error")
        self.assertEqual(self.agent()["failing"]["why"], "Theseus did not record why: these failures began before it did")


@own_cases
class NoticeCase(HealthCase):
    def test_every_code_the_codex_host_settles_a_claim_with_is_said_in_words(self):
        """Each fixed code codex_host settles a claim with, directly or through a thread or a Codex
        process that cannot serve, has words of its own, never "the agent runner said <code>"."""
        source = (Path(__file__).resolve().parent.parent / "aim_next" / "codex_host.py").read_text()
        codes = set(re.findall(r'(?:_settle\((?:work|self\.current), "[a-z]+", None, |_attach_failed\(thread, |[ .]failed\(|_fail_child\(child, )"([A-Za-z_]+)"', source))
        self.assertTrue({"resume_failed", "settings_not_applied", "child_exited", "not_steerable", "stalled", "protocol_error"} <= codes, codes)
        for code in sorted(codes - {"thread_"}):
            self.assertNotIn("the agent runner said", why_words(code, "unavailable"), code)
        self.assertEqual(why_words("thread_notLoaded", "unavailable"), "its Codex thread is not loaded")

    def test_theseus_posts_once_when_an_agent_goes_red_never_again_while_it_stays_red_and_once_when_it_clears(self):
        self.failing(FAILING_AFTER - 1)
        self.assertEqual(self.notices(), [])
        self.miss()
        conversation = self.conversation()
        self.assertEqual(self.notices(), [(conversation, "Health: agent-a can't be woken: its last 3 wakes did not get through. "
                                           "Why: %s." % WHY["route_unavailable"] + NOTICE_TAIL)])
        self.assertEqual(self.sql("SELECT kind,name,enabled FROM actors WHERE id='theseus'"), [("agent", "Theseus", 0)],
                         "Theseus itself posts, registered disabled with its first notice")
        self.failing(2)
        self.send_next("More work, while it is red")
        self.assertEqual(len(self.notices()), 1, "no repeat while it stays red")
        self.hand(self.claim_now(), turn_id="turn-through")
        self.end("completed", turn_id="turn-through")
        self.assertEqual(self.notices()[1], (conversation, "Health: agent-a can be woken again: a wake got through." + NOTICE_TAIL))
        self.assertEqual(len(self.notices()), 2)

    def test_a_notice_is_settled_for_whom_it_is_about_and_for_people_and_is_work_for_a_coordinator_it_is_not_about(self):
        self.failing()
        # About agent-a, the coordinator: nobody is woken by it; the owner sees the link light.
        self.assertEqual(self.deliveries_of("Health: agent-a"), [("agent-a", "acknowledged"), ("owner", "acknowledged")])
        # About agent-b: the coordinator, agent-a, gets it as work.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO wake_facts(recipient_id,failed_wakes,failing_since_ms,failed_outcome,failed_reason) "
                       "VALUES ('agent-b',3,1000,'error','deadline')")
        self.send_next("Any act settles what is red")
        self.assertEqual(self.deliveries_of("Health: agent-b"), [("agent-a", "pending"), ("owner", "acknowledged")])
        self.assertIn("Why: %s." % WHY["deadline"], self.notices()[-1][1])

    def test_a_notice_is_nobodys_request_so_it_is_not_an_item_of_the_conversation(self):
        self.failing()
        self.assertEqual(self.sql("SELECT count(*) FROM conversation_items i JOIN messages m ON m.id=i.message_id "
                                  "WHERE m.author_id='theseus'"), [(0,)])
        self.assertEqual(self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["new_items"], 0)

    def test_agents_red_for_one_reason_are_told_together_and_a_codex_queue_route_says_where_to_look(self):
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO wake_facts(recipient_id,failed_wakes,failing_since_ms,failed_outcome,failed_reason) VALUES (?,3,1000,'error','broker_exit')",
                           [("agent-a",), ("agent-b",)])
        self.send_next("Any act settles what is red")
        self.assertIn("Health: agent-a and agent-b can't be woken: their last 3 wakes each did not get through. Why: %s." % WHY["broker_exit"],
                      self.notices()[-1][1])
        self.assertNotIn("look there first", self.notices()[-1][1], "agent-a is hosted, so the queue is not where to look")
        self.pin_route(self.hosting, "codex-queue-stdio", OTHER_THREAD, actor="agent-b")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE wake_facts SET failed_wakes=0 WHERE recipient_id='agent-b'")
        self.send_next("agent-b got through")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE wake_facts SET failed_wakes=3,failed_reason='deadline' WHERE recipient_id='agent-b'")
        self.send_next("and fails again, for another reason")
        self.assertEqual(self.notices()[-1][1], "Health: agent-b can't be woken: its last 3 wakes did not get through. Why: %s. "
                         "Its wakes go through the Codex app's queue, so look there first: is the ChatGPT app open?" % WHY["deadline"] + NOTICE_TAIL)

    def test_no_notice_is_posted_as_a_member_someone_else_registered_as_theseus(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name,enabled) VALUES ('theseus','human','Someone else',1)")
        self.failing()
        self.assertEqual(self.light(), ["failing:agent-a"], "the page still says it")
        self.assertEqual(self.notices(), [])

    def test_an_agent_on_no_team_lights_the_page_but_tells_no_outcome(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name,enabled) VALUES ('agent-c','agent','agent-c',1)")
            db.execute("INSERT INTO wake_facts(recipient_id,failed_wakes,failing_since_ms,failed_outcome,failed_reason) VALUES ('agent-c',3,1000,'error','deadline')")
        self.send_next("Any act settles what is red")
        self.assertEqual(self.light(), ["failing:agent-c"])
        self.assertEqual(self.notices(), [])


@own_cases
class ParkedNoticeCase(HealthCase):
    """Every case moves agent-a only by real acts: wakes the runner settles, turns that end, and
    the owner taking it off its topic, so the scheduler's own counting runs as it does live."""

    def unanswered_wake(self, body):
        """Work for agent-a and a wake that reaches it (an accepted notice), which it leaves unanswered."""
        self.now += 61000
        self.send_next(body)
        claim = self.claim_now()  # first: it may take the role again, with a new token
        result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "accepted")
        self.assertEqual(result["status"], "settled", result)

    def park(self):
        for number in range(3):
            self.unanswered_wake("Work for an agent that does not answer %d" % number)

    def acts_of_agent_a(self):
        return self.sql("SELECT count(*) FROM operations WHERE actor_id='agent-a'")[0][0]

    def test_an_agent_that_leaves_its_wakes_unanswered_is_told_once_whatever_work_comes_and_goes_and_once_it_answers(self):
        self.park()
        self.assertEqual(self.light(), ["parked:agent-a"])
        # Told by the act that settled its third unanswered wake.
        self.assertEqual([body for _, body in self.notices()],
                         ["Health: agent-a has not answered its last 3 wakes; 4 messages wait for it." + NOTICE_TAIL])
        for round_ in range(2):
            # The owner takes its work away (off the topic, so nothing waits and the
            # scheduler's count clears), then gives it again; agent-a does nothing.
            self.part(False)
            self.assertEqual(self.light(), [], "nothing waits for it, so the page and link are quiet")
            self.assertEqual([body for _, body in self.notices()][1:], [], "it did not answer, so it is not 'answering again'")
            self.part(True)
            self.send_next("Work again %d" % round_)
            self.assertEqual(self.light(), ["parked:agent-a"])
        self.assertEqual(self.acts_of_agent_a(), 0)
        self.assertEqual(len(self.notices()), 1, "it never answered, so nothing changed to tell")
        self.ack(self.pending()["items"][0]["id"])
        self.assertEqual(self.light(), [])
        self.assertEqual(self.notices()[-1][1], "Health: agent-a is answering again." + NOTICE_TAIL)
        self.assertEqual(len(self.notices()), 2)

    def hosted_turn(self, number, status, act=False):
        """Work for agent-a and a hosted turn started with it that ends as status; agent-a acts in it only if act."""
        self.now += 61000
        self.send_next("Work %d" % number)
        self.hand(self.claim_now(), turn_id="turn-%d" % number)
        if act:
            self.ack(self.pending()["items"][0]["id"])
        self.end(status, turn_id="turn-%d" % number, **({} if status == "completed" else {"error_code": "serverOverloaded"}))

    def test_a_hosted_turn_codex_ended_as_failed_or_lost_is_a_wake_that_did_not_get_through(self):
        """The reviewer's hosted sequence: two turns complete and three fail or are lost, with no act
        by agent-a. Codex did not run them, so agent-a can't be woken, and Codex's code says why;
        it never said it has not answered them."""
        for number, status in enumerate(["completed", "completed", "failed", "lost", "failed"]):
            self.hosted_turn(number, status)
            self.assertEqual(self.light(), [] if number < 4 else ["failing:agent-a"], "turn %d" % number)
        self.assertEqual(self.acts_of_agent_a(), 0)
        why = "its Codex turn failed (server overloaded)"
        self.assertEqual([body for _, body in self.notices()],
                         ["Health: agent-a can't be woken: its last 3 wakes did not get through. Why: %s." % why + NOTICE_TAIL])
        agent = self.agent()
        self.assertNotIn("not_answering", agent)
        self.assertEqual({key: agent["failing"][key] for key in ("count", "outcome", "reason", "why")},
                         {"count": 3, "outcome": "failed", "reason": "serverOverloaded", "why": why})
        self.hosted_turn(5, "completed", act=True)
        self.assertEqual(self.notices()[-1][1], "Health: agent-a can be woken again: a wake got through." + NOTICE_TAIL)
        self.assertEqual(self.light(), [])

    def test_a_turn_still_running_settles_nothing_until_it_ends(self):
        for number in range(3):
            self.hosted_turn(number, "failed")
        self.assertEqual(self.light(), ["failing:agent-a"])
        self.now += 61000
        self.send_next("Work while a turn runs")
        self.hand(self.claim_now(), turn_id="turn-open")
        self.assertEqual(self.light(), ["failing:agent-a"], "whether the turn gets through is known when it ends")
        self.assertEqual(len(self.notices()), 1)
        self.end("completed", turn_id="turn-open")
        self.assertEqual(self.light(), [])

    def test_completed_turns_it_did_not_act_in_are_unanswered_and_a_failed_turn_never_says_it_answered(self):
        for number in range(3):
            self.hosted_turn(number, "completed")
        self.assertEqual(self.light(), ["parked:agent-a"])
        self.assertEqual(len(self.notices()), 1)
        self.assertEqual(self.agent()["not_answering"]["count"], 3)
        self.hosted_turn(3, "failed")
        self.assertEqual((self.light(), len(self.notices())), (["parked:agent-a"], 1), "a turn Codex failed is not the agent answering")
        self.assertEqual(self.agent()["not_answering"]["count"], 3)
        self.ack(self.pending()["items"][0]["id"])
        self.assertEqual(self.notices()[-1][1], "Health: agent-a is answering again." + NOTICE_TAIL)
        self.assertEqual(len(self.notices()), 2)

    def wake_facts(self):
        return self.sql("SELECT failed_wakes,failed_outcome,unanswered_wakes FROM wake_facts WHERE recipient_id='agent-a'")[0]

    def test_a_turn_with_a_steer_it_never_read_or_one_it_read_is_one_wake_that_got_through(self):
        self.hand(self.claim_now(), turn_id="turn-0")
        self.now += 1000
        self.send_next("Work while the turn runs")
        self.hand(self.claim_now(), turn_id="turn-0", mode="steer")  # never seen in the thread
        self.end("completed", turn_id="turn-0")
        self.assertEqual(self.wake_facts(), (0, None, 1), "the turn got through; the steer it never read is work handed again")
        self.assertEqual(self.agent()["reached_ms"], self.now)
        # A steer into a turn that had already ended joins an attempt already settled.
        self.now += 61000
        self.send_next("Work after it ended")
        self.hand(self.claim_now(), turn_id="turn-0", mode="steer")
        self.assertEqual(self.wake_facts(), (0, None, 1))
        # One the turn read gets through with it, as one wake.
        self.now += 61000
        self.hand(self.claim_now(), turn_id="turn-1")
        self.send_next("Work for a running turn")
        steer = self.claim_now()
        self.hand(steer, turn_id="turn-1", mode="steer")
        self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, "theseus:" + steer["attempt_id"])["status"], "recorded")
        self.end("completed", turn_id="turn-1")
        self.assertEqual(self.wake_facts(), (0, None, 2))
        self.assertEqual(self.sql("SELECT count(*) FROM wake_turns"), [(0,)], "a turn's attempt is kept only while it runs")

    def test_a_turn_codex_failed_after_the_agent_acted_in_it_got_through(self):
        """Only an agent the turn reached can act in it, so its wake got through, however the turn ended."""
        self.assertEqual(self.sql("SELECT count(*) FROM wake_facts WHERE recipient_id='agent-a'"), [(0,)], "its first turn is its first fact")
        for number in range(3):
            self.hosted_turn(number, "failed", act=True)
            self.assertEqual(self.wake_facts(), (0, None, 0), "turn %d" % number)
        self.assertEqual((self.light(), self.notices()), ([], []))

    def test_a_turn_the_agent_acted_in_was_answered(self):
        for number in range(4):
            self.hosted_turn(number, "completed", act=True)
        self.assertEqual((self.light(), self.notices()), ([], []))
        self.assertEqual(self.sql("SELECT unanswered_wakes FROM wake_facts WHERE recipient_id='agent-a'"), [(0,)])

    def test_an_agent_disabled_while_told_is_said_to_be_no_longer_woken(self):
        self.failing()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='agent-b'")
            db.execute("INSERT INTO wake_facts(recipient_id,failed_wakes,failing_since_ms,failed_outcome,failed_reason) "
                       "VALUES ('agent-b',3,1000,'error','deadline')")
        self.send_next("Any act")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=1 WHERE id='agent-b'")
        self.send_next("agent-b is back")
        self.assertIn("agent-b can't be woken", self.notices()[-1][1])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        self.send_next("agent-b is disabled")
        self.assertEqual(self.notices()[-1][1], "Health: agent-b was disabled, so it is no longer woken." + NOTICE_TAIL)


class AttemptFixture(HealthCase):
    """Helpers for attempts to reach agent-a: hosted turns, claims settled the runner's ways, and Core's clock."""

    def facts(self):
        rows = self.sql("SELECT failed_wakes,failed_outcome,unanswered_wakes FROM wake_facts WHERE recipient_id='agent-a'")
        return rows[0] if rows else (0, None, 0)  # no attempt settled yet

    def steered_turn(self, turn_id, steers, see=False):
        """A turn started with agent-a's work, then `steers` more messages, each steered into it."""
        self.now += 61000
        self.send_next("Work %s" % turn_id)
        self.hand(self.claim_now(), turn_id=turn_id)
        for number in range(steers):
            self.now += 1000
            self.send_next("More for %s %d" % (turn_id, number))
            claim = self.claim_now()
            self.hand(claim, turn_id=turn_id, mode="steer")
            if see:
                self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, "theseus:" + claim["attempt_id"])["status"], "recorded")

    def settle(self, claim, outcome, reason=None, from_turn=None):
        """Settle claim as the runner does; from_turn names the running turn the Codex host says it came from."""
        named = None if from_turn is None else {"thread_id": THREAD, "turn_id": from_turn}
        result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], outcome, reason=reason, from_turn=named)
        self.assertEqual(result["status"], "settled", result)
        return result

    def traffic_during(self, turn_id, outcomes):
        """While turn_id runs, one more message arrives and each claim for it, all of the same run of the
        runner, settles as outcomes say ((outcome, code) or (outcome, code, the turn the host names)),
        on the scheduler's backoff."""
        self.now += 1000
        self.send_next("More for %s" % turn_id)
        for outcome in outcomes:
            self.keep_role_until(max(self.now, self.store.runner_schedule(["agent-a"])["next_due_ms"]))
            self.settle(self.claim_now(), *outcome)

    def keep_role_until(self, when):
        """Core's clock moves on to when, while the same run of the runner keeps renewing its lease."""
        while self.now < when:
            self.now = min(when, self.now + 15000)
            self.assertEqual(self.store.renew_runner(self.hosting, self.runner)["status"], "renewed")

    def fail_unreached(self, codes, count):
        """count claims of this run for agent-a, each settled with the next of codes: the runner's codes
        for a claim that never reached agent-a's thread, on the scheduler's backoff."""
        for number in range(count):
            self.keep_role_until(max(self.now, self.store.runner_schedule(["agent-a"])["next_due_ms"]))
            self.settle(self.claim_now(), *codes[number % len(codes)])

    def expire(self, count):
        """count claims of this run for agent-a that the runner never settles (Codex never answered
        turn/start): each is found expired by the next claim, which is left out too."""
        for _ in range(count + 1):
            self.keep_role_until(max(self.now, self.store.runner_schedule(["agent-a"])["next_due_ms"]))
            self.claim_now()


@own_cases
class AttemptCase(AttemptFixture):
    """One attempt to reach agent-a is one claim the runner settles, or one hosted turn with every
    hand it took (its start and each steer), which got through when agent-a first acted while it ran
    or when it completed, and otherwise did not, when it ended. How many messages were steered into
    a turn never changes what it says about whether agent-a can be woken."""

    def test_one_failed_turn_with_steers_is_one_wake_that_did_not_get_through_and_tells_nothing(self):
        """The reviewer's P2: a busy agent's turn takes two steers and Codex fails it once; then a
        turn completes. Twice. One temporary fault each time, so nothing is told."""
        for round_ in range(2):
            self.steered_turn("turn-f%d" % round_, 2, see=True)
            self.end("failed", turn_id="turn-f%d" % round_, error_code="serverOverloaded")
            self.assertEqual(self.facts(), (1, "failed", 0), "round %d" % round_)
            self.assertEqual(self.light(), [])
            self.now += 61000
            self.hand(self.claim_now(), turn_id="turn-ok%d" % round_)
            self.ack(self.pending()["items"][0]["id"])
            self.end("completed", turn_id="turn-ok%d" % round_)
            self.assertEqual(self.facts(), (0, None, 0))
        self.assertEqual(self.notices(), [])

    def test_three_failed_turns_with_steers_are_three_wakes_that_did_not_get_through(self):
        for number, steers in enumerate([0, 3, 1]):
            self.steered_turn("turn-%d" % number, steers, see=number % 2 == 0)
            self.end("failed", turn_id="turn-%d" % number, error_code="serverOverloaded")
        self.assertEqual(self.facts(), (3, "failed", 0))
        self.assertEqual([body for _, body in self.notices()],
                         ["Health: agent-a can't be woken: its last 3 wakes did not get through. Why: its Codex turn failed "
                          "(server overloaded)." + NOTICE_TAIL])

    def test_a_turn_left_unanswered_is_so_from_when_it_was_first_handed_work(self):
        """Handed work at its start, given more by a steer, completed with no act: agent-a has left it
        unanswered since the start's hand, not since the steer or the turn's end."""
        self.now += 61000
        self.send_next("Work")
        self.hand(self.claim_now(), turn_id="turn-1")
        handed = self.now
        self.now += 1000
        self.send_next("More")
        self.hand(self.claim_now(), turn_id="turn-1", mode="steer")
        self.now += 5000
        self.end("completed", turn_id="turn-1")
        self.assertEqual(self.facts(), (0, None, 1))
        self.assertEqual(self.sql("SELECT unanswered_since_ms FROM wake_facts WHERE recipient_id='agent-a'"), [(handed,)])

    def test_a_turn_that_completed_with_steers_it_never_read_got_through(self):
        """The reviewer's P1b: the turn ran to its end, so agent-a was woken; the steers it never read
        are work the scheduler hands again, not wakes that failed."""
        self.steered_turn("turn-1", 3)
        self.end("completed", turn_id="turn-1")
        self.assertEqual(self.facts(), (0, None, 1), "one wake got through, and agent-a did not answer it")
        self.assertEqual(self.agent()["reached_ms"], self.now)
        self.assertEqual((self.light(), self.notices()), ([], []))
        # A steer handed after its turn ended joins a turn already settled: it settles nothing.
        self.now += 61000
        self.hand(self.claim_now(), turn_id="turn-1", mode="steer")
        self.assertEqual(self.facts(), (0, None, 1))
        self.assertEqual(self.notices(), [])

    def test_an_act_after_the_claim_and_before_the_hand_is_recorded_counts_for_the_turn(self):
        """agent-a acts once Codex started its turn but before the runner recorded the hand: the claim
        was out, so the act is after the wake began and the turn was answered, however it ends."""
        for number, status in enumerate(["completed", "completed", "completed", "failed", "failed", "failed"]):
            self.now += 61000
            self.send_next("Work %d" % number)
            claim = self.claim_now()
            self.now += 10
            self.ack(self.pending()["items"][0]["id"])
            self.now += 10
            self.hand(claim, turn_id="turn-%d" % number)
            self.end(status, turn_id="turn-%d" % number, **({} if status == "completed" else {"error_code": "serverOverloaded"}))
            self.assertEqual(self.facts(), (0, None, 0), "turn %d" % number)
        self.assertEqual((self.light(), self.notices()), ([], []))

    def test_a_hand_with_nothing_pending_is_not_a_wake_left_unanswered(self):
        """The owner takes agent-a off its topic between the claim and the hand, so nothing waits when
        the turn starts: the turn got through, and there was nothing for agent-a to answer."""
        for number in range(3):
            self.part(True)
            self.now += 61000
            self.send_next("Work %d" % number)
            claim = self.claim_now()
            self.part(False)
            self.assertEqual(self.hand(claim, turn_id="turn-%d" % number)["handed_seq"], None)
            self.end("completed", turn_id="turn-%d" % number)
            self.assertEqual(self.facts(), (0, None, 0), "turn %d" % number)
            self.assertEqual(self.agent()["reached_ms"], self.now)
        self.assertEqual(self.notices(), [])

    def test_an_accepted_notice_with_nothing_left_waiting_is_not_left_unanswered(self):
        """The owner takes agent-a off its topic between the claim and the notice being accepted."""
        for number in range(3):
            self.part(True)
            self.now += 61000
            self.send_next("Work %d" % number)
            claim = self.claim_now()
            self.part(False)
            self.assertEqual(self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "accepted")["pending_count"], 0)
            self.assertEqual(self.facts(), (0, None, 0), "wake %d" % number)
        self.assertEqual(self.notices(), [])

    def test_wakes_left_unanswered_are_counted_from_the_first(self):
        reached = []
        for number in range(3):
            self.now += 61000
            self.send_next("Work %d" % number)
            claim = self.claim_now()
            self.now += 5
            self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "accepted")
            reached.append(self.now)
        self.assertEqual(self.sql("SELECT unanswered_wakes,unanswered_since_ms FROM wake_facts WHERE recipient_id='agent-a'"), [(3, reached[0])])

    def test_a_turn_given_work_by_any_of_its_hands_is_left_unanswered_when_it_completes_with_no_act(self):
        """A turn started with work takes a steer whose work the owner took away before its hand:
        the turn was still given work, by its start, and agent-a did not act."""
        self.steered_turn("turn-1", 0)
        self.send_next("More for turn-1")
        claim = self.claim_now()
        self.part(False)
        self.assertEqual(self.hand(claim, turn_id="turn-1", mode="steer")["handed_seq"], None)
        self.end("completed", turn_id="turn-1")
        self.assertEqual(self.facts(), (0, None, 1))

    def test_claims_that_fail_while_the_runners_turn_runs_join_that_turn_and_its_end_decides_them(self):
        """The reviewer's P1: a message arrives while Codex cannot take more work (a compact or review
        turn), so steers into agent-a's running turn settle busy, and Codex's process exits with one
        in flight; the turn then completes and agent-a acts. Twice. The host names the turn each came
        from, so nothing is told; while the turn runs the page says what the settled attempts said.
        A steer Codex refused for a reason it did not say is the turn being busy (steer_failed) never
        reached a turn Codex said is running, so it counts, and the turn's end clears it."""
        for round_ in range(2):
            turn = "turn-b%d" % round_
            self.steered_turn(turn, 0)
            self.traffic_during(turn, [("busy", "not_steerable", turn), ("busy", "not_steerable", turn),
                                       ("unavailable", "child_exited", turn)])
            self.assertEqual(self.facts(), (0, None, 0), "round %d: the turn still runs, so nothing settled" % round_)
            self.traffic_during(turn, [("error", "steer_failed")])
            self.assertEqual(self.facts(), (1, "error", 0), "round %d: Codex never said the turn runs" % round_)
            self.assertEqual(self.light(), [])
            for item in self.pending()["items"]:
                self.ack(item["id"])
            self.end("completed", turn_id=turn)
            self.assertEqual(self.facts(), (0, None, 0), "round %d: one wake, and it got through" % round_)
        self.assertEqual(self.notices(), [])
        # Once no turn runs, each claim that fails is an attempt of its own, whatever turn it names.
        self.traffic_during("after", [("busy", "not_steerable", "turn-b1")] * FAILING_AFTER)
        self.assertEqual(self.facts(), (FAILING_AFTER, "busy", 0))
        self.assertEqual(self.light(), ["failing:agent-a"])

    def test_one_codex_exit_with_a_steer_in_flight_is_one_wake_that_did_not_get_through(self):
        """The reviewer's P2: Codex's process exits while a steer is in flight, so the steer's claim
        settles unavailable and the turn ends lost; or it answers the steer in a way Theseus does not
        understand, so the claim settles error and the host ends the process, and the turn ends lost.
        One fault, one attempt; twice is two, and tells nothing; the third is told once, with the
        turn's own why."""
        faults = [("unavailable", "child_exited"), ("error", "protocol_error"), ("unavailable", "child_exited")]
        for number, fault in enumerate(faults):
            turn = "turn-x%d" % number
            self.steered_turn(turn, 0)
            self.traffic_during(turn, [fault + (turn,)])
            self.end("lost", turn_id=turn)
            self.assertEqual(self.facts(), (number + 1, "lost", 0), "exit %d" % number)
            self.assertEqual(self.notices() != [], number + 1 == FAILING_AFTER, "exit %d" % number)
        self.assertEqual([body for _, body in self.notices()],
                         ["Health: agent-a can't be woken: its last 3 wakes did not get through. Why: its Codex turn was lost." + NOTICE_TAIL])

    def test_claims_that_never_reach_the_thread_while_its_turn_stays_open_are_attempts_of_their_own(self):
        """The reviewer's r4 blocker: Codex closes agent-a's thread mid-turn (thread/closed, or a
        status of notLoaded or systemError), and the runner forgets the thread without ending the turn,
        so Core still lists the turn as open. Every later claim of the same run fails before it reaches
        the thread: Codex will not resume it, resumes it with other settings, the thread will not
        load, Codex cannot be started or will not start a turn, or its process stopped answering.
        None of those came from the turn, so each is an attempt of its own: the outage is red and told
        once, however long it lasts, and the turn's end, when it comes, is one more."""
        self.steered_turn("turn-T", 0)
        run = self.runner
        self.now += 1000
        self.send_next("More for turn-T")
        codes = [("unavailable", "resume_failed"), ("unavailable", "settings_not_applied"), ("unavailable", "thread_notLoaded"),
                 ("unavailable", "spawn_failed"), ("error", "start_failed"), ("unavailable", "stalled")]
        began = self.now
        self.fail_unreached(codes, 12)
        self.assertEqual(self.runner, run, "one run of the runner throughout")
        self.assertGreater(self.now - began, 8 * 60000, "the outage lasted minutes")
        self.assertEqual(self.sql("SELECT turn_id FROM wake_turns"), [("turn-T",)], "Core still lists the turn as open")
        self.assertEqual(self.facts(), (12, "unavailable", 0))
        self.assertEqual(self.light(), ["failing:agent-a"])
        self.assertEqual(self.agent()["failing"]["why"], WHY["stalled"], "the latest failure says why, in words")
        self.assertEqual([body for _, body in self.notices()],
                         ["Health: agent-a can't be woken: its last 3 wakes did not get through. Why: its Codex thread is not loaded."
                          + NOTICE_TAIL])
        # The next run ends the turn the last one left: one more attempt that did not get through.
        self.now += 61000
        self.fresh_lease()
        self.assertNotEqual(self.runner, run)
        self.end("lost", turn_id="turn-T")
        self.assertEqual(self.facts(), (13, "lost", 0))
        self.assertEqual(len(self.notices()), 1)

    def test_a_claim_from_the_running_turn_joins_it_and_one_that_never_reached_the_thread_does_not(self):
        """While the turn runs, each claim the host says came from it (Codex said it cannot take more
        work, or its process exited or answered in a way Theseus does not understand) joins it, and
        each that names no turn is an attempt of its own, in any order: one that never reached the
        thread, and a steer Codex refused without saying the turn runs."""
        self.steered_turn("turn-m", 0)
        self.traffic_during("turn-m", [("busy", "not_steerable", "turn-m"), ("unavailable", "resume_failed"), ("error", "steer_failed"),
                                       ("error", "start_failed"), ("unavailable", "child_exited", "turn-m"),
                                       ("error", "protocol_error", "turn-m")])
        self.assertEqual(self.facts(), (3, "error", 0), "three of the six named no running turn")
        for item in self.pending()["items"]:
            self.ack(item["id"])
        self.assertEqual(self.facts(), (0, None, 0), "agent-a acted while the turn ran: a wake got through, then")
        self.end("completed", turn_id="turn-m")
        self.assertEqual(self.facts(), (0, None, 0), "the turn got through and agent-a acted")

    def test_a_claim_left_to_expire_is_an_attempt_of_its_own_when_its_lease_ended(self):
        """A steer's claim is never settled (its runner stopped, or Codex never answered): nobody said
        it came from a turn, so it is an attempt that did not get through, at its lease's end, whether
        the same runner or the next one finds it. The turn's end is one more."""
        for number, wait in enumerate([21000, 61000]):
            self.steered_turn("turn-e%d" % number, 0)
            self.now += 1000
            self.send_next("More for turn-e%d" % number)
            before = self.runner
            lease_end = self.claim_now()["lease_until_ms"]
            self.now += wait
            claim = self.claim_now()
            self.assertEqual(self.runner == before, wait < 30000, "the runner taking the next claim")
            self.assertEqual(self.facts(), (1, "expired", 0))
            self.assertEqual(self.sql("SELECT failing_since_ms FROM wake_facts WHERE recipient_id='agent-a'"), [(lease_end,)])
            self.end("lost", turn_id="turn-e%d" % number)
            self.assertEqual(self.facts(), (2, "lost", 0))
            self.settle(claim, "unavailable", "abandoned")
            self.assertEqual(self.facts(), (3, "unavailable", 0))
            self.now += 61000
            self.hand(self.claim_now(), turn_id="turn-ok%d" % number)
            self.ack(self.pending()["items"][0]["id"])
            self.end("completed", turn_id="turn-ok%d" % number)
            self.assertEqual(self.facts(), (0, None, 0))

    def test_an_expired_claim_found_after_a_wake_got_through_is_not_counted_after_it(self):
        """A runner hands agent-a a turn and stops; the next runner's claim is never settled, and agent-a
        acts in its running turn after that claim's lease ended, so a wake got through then. Found
        later, the expired claim happened before that, so it is not one of the failures since."""
        self.steered_turn("turn-o", 0)
        first = self.runner
        self.now += 61000
        self.send_next("More for turn-o")
        lease_end = self.claim_now()["lease_until_ms"]
        self.assertNotEqual(self.runner, first)
        self.now = lease_end + 1000
        self.ack(self.pending()["items"][0]["id"])
        self.assertEqual(self.facts(), (0, None, 0))
        self.now += 1000
        self.send_next("Later")
        self.claim_now()
        self.assertEqual(self.sql("SELECT outcome FROM wake_results WHERE outcome='expired'"), [("expired",)])
        self.assertEqual(self.facts(), (0, None, 0), "it expired before the wake that got through")

    def test_an_expired_claim_found_after_a_later_failure_counts_from_when_it_happened_and_does_not_say_why(self):
        """A steer's claim expires, then its turn ends lost; the next claim finds the expired one. Both
        did not get through: the run began when the claim's lease ended, and the latest failure, the
        turn's end, says why."""
        self.steered_turn("turn-q", 0)
        self.now += 1000
        self.send_next("More for turn-q")
        lease_end = self.claim_now()["lease_until_ms"]
        self.now = lease_end + 1000
        self.fresh_lease()
        self.end("lost", turn_id="turn-q")
        self.assertEqual(self.facts(), (1, "lost", 0))
        self.now += 1000
        self.claim_now()
        self.assertEqual(self.facts(), (2, "lost", 0))
        self.assertEqual(self.sql("SELECT failing_since_ms FROM wake_facts WHERE recipient_id='agent-a'"), [(lease_end,)])

    def test_a_turn_the_agent_acted_in_that_completes_after_failures_got_through_when_it_completed(self):
        """agent-a acts in its turn, three claims that never reached the thread fail, then Codex
        completes the turn: Codex ran it to its end, so a wake got through then."""
        self.steered_turn("turn-c", 0)
        self.ack(self.pending()["items"][0]["id"])
        self.now += 1000
        self.send_next("More for turn-c")
        self.fail_unreached([("unavailable", "resume_failed")], FAILING_AFTER)
        self.assertEqual(self.light(), ["failing:agent-a"])
        self.end("completed", turn_id="turn-c")
        self.assertEqual((self.facts(), self.light()), ((0, None, 0), []))
        self.assertEqual(self.agent()["reached_ms"], self.now)

    def test_claims_of_a_runner_that_never_handed_work_to_the_running_turn_are_attempts_of_their_own(self):
        """A runner stops with its turn open, and the next one cannot reach agent-a (its Codex process
        exits before it reads the thread, so it never ends the turn the last one left): every claim
        of the new runner is an attempt of its own, so the team is told, though the old turn is open."""
        self.steered_turn("turn-1", 0)
        before = self.runner
        self.now += 61000
        self.send_next("More for turn-1")
        for _ in range(FAILING_AFTER):
            self.miss(reason="child_exited")
        self.assertNotEqual(self.runner, before)
        self.assertEqual(self.facts(), (FAILING_AFTER, "unavailable", 0))
        self.assertEqual(self.light(), ["failing:agent-a"])
        self.end("lost", turn_id="turn-1")
        self.assertEqual(self.facts(), (FAILING_AFTER + 1, "lost", 0))

    def test_a_notice_accepted_while_the_turn_runs_is_an_attempt_of_its_own(self):
        """A notice accepted into agent-a's chat while its turn runs never went through the turn: it got
        through on its own, ending the failures before it, and with work waiting it is left
        unanswered at once. The turn's end is decided by the turn alone."""
        self.steered_turn("turn-1", 0)
        run = self.runner
        self.now += 1000
        self.send_next("More for turn-1")
        self.fail_unreached([("unavailable", "resume_failed")], 2)
        self.assertEqual(self.facts(), (2, "unavailable", 0))
        self.keep_role_until(max(self.now, self.store.runner_schedule(["agent-a"])["next_due_ms"]))
        self.assertTrue(self.settle(self.claim_now(), "accepted")["pending_count"])
        self.assertEqual(self.runner, run)
        self.assertEqual(self.facts(), (0, None, 1), "the notice got through, and agent-a has not answered it")
        self.assertEqual(self.agent()["reached_ms"], self.now)
        self.end("completed", turn_id="turn-1")
        self.assertEqual(self.facts(), (0, None, 2), "the turn was given work by its start, and agent-a did not act")

    def test_a_claim_the_running_turn_could_not_take_gives_it_no_work(self):
        """A turn handed nothing pending (the owner took the work away before its hand) runs while a
        claim with work waiting settles busy from it: it joins the turn, but the turn never took its
        work, so the turn got through and was given nothing to answer."""
        self.now += 61000
        self.send_next("Work 3")
        claim = self.claim_now()
        self.part(False)
        self.assertIsNone(self.hand(claim, turn_id="turn-3")["handed_seq"])
        self.part(True)
        self.now += 1000
        self.send_next("More 3")
        self.now = max(self.now, self.store.runner_schedule(["agent-a"])["next_due_ms"])
        self.assertTrue(self.settle(self.claim_now(), "busy", "not_steerable", "turn-3")["pending_count"])
        self.assertEqual(self.facts(), (0, None, 0), "the claim joined the running turn")
        self.end("completed", turn_id="turn-3")
        self.assertEqual(self.facts(), (0, None, 0), "the turn got through and was given nothing to answer")

    def test_only_a_failed_wake_names_the_turn_it_came_from(self):
        claim = self.claim_now()
        for outcome, named in [("accepted", {"thread_id": THREAD, "turn_id": "t"}), ("busy", {"turn_id": "t"}),
                               ("busy", {"thread_id": THREAD, "turn_id": "t", "mode": "steer"}), ("busy", {"thread_id": "x", "turn_id": "t"})]:
            with self.subTest(outcome=outcome, named=named), self.assertRaises(RunnerError) as raised:
                self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], outcome, reason="not_steerable", from_turn=named)
            self.assertEqual(raised.exception.code, "INVALID_ARGUMENT")


@own_cases
class StaleTurnCase(AttemptFixture):
    """The reviewer's r5 blockers. Core lists a turn as open that the host has stopped running, and
    no turn has started on its thread since (a start would end it: ReplacedTurnCase): Codex ended it
    with a status the host does not know, or the host's re-read found it ended, and every claim after
    fails before a turn starts. It stays open in Core, the same run throughout, until the runner's
    process exits. turn-2 completed before it; agent-a acted in turn-L, while it was open."""

    def stale_turn(self):
        self.now += 61000
        self.fresh_lease()
        self.run = self.runner
        self.send_next("First")
        self.hand(self.claim_now(), turn_id="turn-2")
        self.end("completed", turn_id="turn-2")
        self.keep_role_until(self.store.runner_schedule(["agent-a"])["next_due_ms"])
        self.send_next("Second")
        self.hand(self.claim_now(), turn_id="turn-L")
        for item in self.pending()["items"]:
            self.ack(item["id"])
        self.assertEqual(self.facts(), (0, None, 0))
        self.now += 1000
        self.send_next("Third")

    def outage_told(self, count, outcome):
        self.assertEqual(self.runner, self.run, "one run throughout")
        self.assertEqual(self.sql("SELECT turn_id FROM wake_turns"), [("turn-L",)], "Core still lists the lost turn as open")
        self.assertEqual(self.facts(), (count, outcome, 0))
        self.assertEqual(self.light(), ["failing:agent-a"])
        self.assertEqual(len(self.notices()), 1)

    def test_turn_starts_codex_refuses_while_a_stale_turn_is_open_are_each_an_attempt(self):
        """Codex refuses every turn/start as activeTurnNotSteerable (a review or compact turn of its
        own): no turn the host runs refused them, so the host names none, and each counts."""
        self.stale_turn()
        self.fail_unreached([("busy", "not_steerable")], 8)
        self.outage_told(8, "busy")

    def test_claims_naming_a_turn_that_ended_join_nothing_while_a_stale_turn_is_open(self):
        """A claim names turn-2, which has ended: it joins nothing, though Core still lists turn-L."""
        self.stale_turn()
        self.fail_unreached([("busy", "not_steerable", "turn-2"), ("unavailable", "child_exited", "turn-2")], 4)
        self.outage_told(4, "unavailable")

    def test_turn_starts_codex_never_answers_while_a_stale_turn_is_open_are_each_an_attempt(self):
        self.stale_turn()
        self.expire(5)
        self.outage_told(5, "expired")

    def test_the_stale_turn_ending_when_the_process_exits_clears_no_outage_after_it(self):
        """agent-a's act in turn-2 got the stale turn through too, then: its end when the process exits
        is no news, so the outage after that act stays red and is told once."""
        self.stale_turn()
        self.fail_unreached([("unavailable", "resume_failed")], 4)
        self.outage_told(4, "unavailable")
        self.end("lost", turn_id="turn-L")
        self.assertEqual(self.facts(), (4, "unavailable", 0))
        self.assertEqual((self.light(), len(self.notices())), (["failing:agent-a"], 1))

    def test_a_turn_the_agent_acted_in_before_an_outage_clears_none_of_it_when_it_ends(self):
        """The reviewer's order probe: agent-a acts in turn-T, then Codex closes the thread and every
        later claim fails; the process exits and turn-T ends lost. turn-T got through before the
        outage began, at agent-a's act, so its end clears none of the failures after it."""
        self.now += 61000
        self.fresh_lease()
        self.send_next("First")
        self.hand(self.claim_now(), turn_id="turn-T")
        self.now += 2000
        self.ack(self.pending()["items"][0]["id"])
        acted = self.now
        self.now += 1000
        self.send_next("More")
        self.fail_unreached([("unavailable", "resume_failed")], 6)
        self.assertEqual((self.facts(), self.light(), len(self.notices())), ((6, "unavailable", 0), ["failing:agent-a"], 1))
        self.end("lost", turn_id="turn-T")
        self.assertEqual((self.facts(), self.light(), len(self.notices())), ((6, "unavailable", 0), ["failing:agent-a"], 1))
        self.assertEqual(self.agent()["reached_ms"], acted, "a wake last got through when agent-a acted")
        self.fail_unreached([("unavailable", "resume_failed")], 3)
        self.assertEqual((self.facts(), len(self.notices())), ((9, "unavailable", 0), 1))



@own_cases
class ReplacedTurnCase(AttemptFixture):
    """The reviewer's r6 blocker. Codex loses turn-L; the host's steer into it is refused, so it
    starts turn-N on the same thread (codex_host.py _steered), and turn-N completes. A thread runs
    one turn at a time, so turn-N's start is when turn-L ended as far as anyone knows: Core ends it
    lost then, through the same path a turn's end takes, before it records turn-N, not hours later
    when the process exits after wakes that got through. Any hand Codex takes into another turn on
    the thread says the same."""

    def lost_and_replaced(self, number):
        self.now += 61000
        self.send_next("Work L%d" % number)
        self.hand(self.claim_now(), turn_id="turn-L%d" % number)
        self.now += 1000
        self.send_next("More %d" % number)
        self.hand(self.claim_now(), turn_id="turn-N%d" % number)
        replaced = self.now
        # turn-L's work went back when it was lost, and turn-N's notice named only "More": the
        # scheduler names it all again at once, steered into turn-N.
        self.assertEqual(self.store.runner_schedule(["agent-a"])["next_due_ms"], self.now)
        self.now += 1000
        self.hand(self.claim_now(), turn_id="turn-N%d" % number, mode="steer")
        self.now += 5000
        self.end("completed", turn_id="turn-N%d" % number)
        return replaced

    def test_turns_lost_and_replaced_before_wakes_that_got_through_are_counted_before_them(self):
        """The deploy: three lost turns, each replaced by one that completed. The process exits hours
        later and ends whatever Core still lists open. Every wake since the losses got through, so
        nothing is red and nobody is told agent-a can't be woken."""
        replaced = [self.lost_and_replaced(number) for number in range(3)]
        reached = self.agent()["reached_ms"]
        self.now += 3 * 3600 * 1000
        self.fresh_lease()
        for row in self.store.open_hosted_turns(self.hosting, self.runner, [THREAD])["turns"]:
            self.end("lost", turn_id=row["turn_id"])  # what codex_host.py _handle_exit does
        self.assertEqual(self.facts(), (0, None, 3), "no wake failed since the last that got through; agent-a answered none")
        self.assertEqual(self.agent()["reached_ms"], reached)
        self.assertNotIn("failing:agent-a", self.light())
        self.assertEqual([body for _, body in self.notices() if "can't be woken" in body], [])
        self.assertEqual(self.sql("SELECT turn_id,final_status,finished_ms FROM hosted_turns WHERE turn_id LIKE 'turn-L%' ORDER BY turn_id"),
                         [("turn-L%d" % number, "lost", at) for number, at in enumerate(replaced)],
                         "each lost turn ended when the turn that replaced it started")

    def test_a_claim_from_the_new_turn_joins_it_and_one_naming_the_replaced_turn_is_its_own(self):
        """After the replacement Core lists turn-N alone as running: a claim the host says came from
        turn-N joins it; one naming turn-L, which ended, is an attempt of its own."""
        self.now += 61000
        self.send_next("Work L")
        self.hand(self.claim_now(), turn_id="turn-L")
        self.now += 1000
        self.send_next("More")
        self.hand(self.claim_now(), turn_id="turn-N")
        self.assertEqual(self.sql("SELECT turn_id FROM wake_turns"), [("turn-N",)])
        self.assertEqual(self.facts()[:2], (1, "lost"), "turn-L did not get through, when turn-N started")
        self.traffic_during("turn-N", [("busy", "not_steerable", "turn-N"), ("busy", "not_steerable", "turn-L")])
        self.assertEqual(self.facts()[:2], (2, "busy"), "the claim from turn-N joined it; the one naming turn-L did not")
        self.end("completed", turn_id="turn-N")
        self.assertEqual(self.facts()[:2], (0, None))

    def test_a_steer_codex_takes_into_another_turn_ends_the_one_core_listed(self):
        """The host's re-read of the thread names turn-M in progress, not turn-L, and its steer into
        turn-M is taken: turn-L had ended by then, so Core ends it lost at that hand."""
        self.now += 61000
        self.send_next("Work L")
        self.hand(self.claim_now(), turn_id="turn-L")
        self.now += 1000
        self.send_next("More")
        self.hand(self.claim_now(), turn_id="turn-M", mode="steer")
        self.assertEqual(self.sql("SELECT turn_id,final_status,finished_ms FROM hosted_turns WHERE turn_id='turn-L'"), [("turn-L", "lost", self.now)])
        self.assertEqual(self.sql("SELECT turn_id FROM wake_turns"), [("turn-M",)])
        self.now += 5000
        self.end("completed", turn_id="turn-M")
        self.assertEqual(self.facts()[:2], (0, None))

    def test_a_steer_or_a_start_of_the_same_turn_ends_no_turn(self):
        """A steer joins the running turn, and a start Codex answers with the running turn's own id
        names that turn: neither says another turn started, so nothing ends."""
        self.steered_turn("turn-1", 2)
        self.now += 1000
        self.send_next("Again")
        self.hand(self.claim_now(), turn_id="turn-1")
        self.assertEqual(self.sql("SELECT DISTINCT turn_id FROM hosted_turns WHERE final_status IS NULL"), [("turn-1",)])
        self.assertEqual(self.facts(), (0, None, 0))

@own_cases
class RunnerNoticeCase(HealthCase):
    def test_a_pause_is_red_and_told_and_the_runner_taking_the_role_again_is_told_once(self):
        paused = self.store.pause_runner(self.hosting, self.runner, "operator_pause")
        self.assertEqual(self.light(), ["runner"])
        self.assertEqual(self.health()["runner"]["why"], "an operator paused it")
        self.assertEqual(self.notices(), [(self.conversation(), "Health: The agent runner was paused because an operator paused it, "
                                           "so no wakes are going out." + NOTICE_TAIL)])
        self.send_next("Work while it is paused")
        self.assertEqual(len(self.notices()), 1)
        self.hosting.close()
        resumed = self.store.resume_runner(self.guard("successor"), paused["version"])
        self.assertEqual(resumed["status"], "acquired", resumed)
        self.assertEqual(self.light(), [])
        self.assertEqual(self.notices()[-1][1], "Health: The agent runner is running again, so wakes are going out." + NOTICE_TAIL)
        self.assertEqual(self.health()["runner"]["prior"]["why"], "an operator paused it", "the page says what it came back from")

    def test_an_exit_is_told_with_how_it_ended(self):
        self.now += 7000
        self.assertEqual(self.store.record_runner_exit(__import__("os").getpid(), -9)["status"], "recorded")
        self.assertEqual(self.light(), ["runner"])
        self.assertEqual(self.notices(), [(self.conversation(), "Health: The agent runner was killed, so no wakes are going out." + NOTICE_TAIL)])

    def due(self):
        """The moment Core keeps for what is red to change with no act at all, or None."""
        row = self.sql("SELECT value FROM metadata WHERE key='health_due'")
        return int(row[0][0]) if row else None

    def test_a_stop_a_runner_follows_is_red_until_then_but_never_told(self):
        stopped = self.store.stop_runner(self.hosting, self.runner)
        self.assertEqual(stopped["status"], "stopped")
        self.assertEqual(self.light(), ["runner"])
        self.assertEqual(self.due(), stopped["ended_ms"] + HANDOVER_MS, "Core keeps when the stop will have lasted")
        self.now += HANDOVER_MS - 1
        self.send_next("Work while it is stopped")
        self.hosting.close()
        self.token(self.guard("successor"))
        self.assertEqual(self.light(), [])
        self.assertEqual(self.notices(), [], "a deploy's stop and start post nothing")

    def test_a_stop_no_runner_follows_is_told_once_it_has_lasted_and_the_runner_back_is_told_once(self):
        # A deploy refused after it stopped the runner, or the runner sent TERM:
        # the supervisor does not start it again.
        stopped = self.store.stop_runner(self.hosting, self.runner)
        self.hosting.close()
        self.now = stopped["ended_ms"] + HANDOVER_MS - 1
        self.send_next("Work just before the stop has lasted")
        self.assertEqual(self.notices(), [])
        self.now += 1
        self.send_next("Work once it has")
        self.assertEqual(self.notices(), [(self.conversation(), "Health: The agent runner was stopped and no runner has taken its place, "
                                           "so no wakes are going out." + NOTICE_TAIL)])
        for hour in range(1, 25):
            self.now += 3600 * 1000
            self.send_next("Work %d hours after the stop" % hour)
        self.assertEqual(len(self.notices()), 1, "told once while it stays red")
        self.assertIsNone(self.due(), "nothing more is due")
        self.token(self.guard("successor"))
        self.assertEqual(self.notices()[-1][1], "Health: The agent runner is running again, so wakes are going out." + NOTICE_TAIL)

    def never_ran(self):
        self.hosting.close()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE runner_state SET state='idle',reason_code=NULL,lease_until_ms=NULL")

    def test_a_runner_that_never_ran_is_red_while_work_waits_and_never_told_however_work_comes_and_goes(self):
        """The reviewer's case: told when work had waited, it cleared as "running again" when agents
        answered with no runner at all, and the pair came back with every batch of work."""
        self.never_ran()
        oldest = self.sql("SELECT min(m.sent_ms) FROM deliveries d JOIN messages m ON m.id=d.message_id "
                          "WHERE d.recipient_id='agent-a' AND d.state='pending'")[0][0]
        self.now = oldest + HANDOVER_MS
        self.send_next("Work once it has lasted")
        self.assertEqual((self.light(), self.health()["runner"]["state"]), (["runner"], "never_run"), "the page and the link say it")
        self.assertIsNone(self.due(), "nothing about it is ever due to be told")
        for round_ in range(2):
            for item in self.pending()["items"]:
                self.ack(item["id"])
            self.assertEqual(self.light(), [], "nothing waits for a runner")
            self.now += HANDOVER_MS
            self.send_next("More work %d" % round_)
            self.now += HANDOVER_MS
            self.send_next("Still more %d" % round_)
            self.assertEqual(self.light(), ["runner"])
        self.assertEqual(self.health()["runner"]["state"], "never_run")
        self.assertEqual([body.split("\n")[0] for _, body in self.notices()], [], "the runner's facts never changed, so nothing is told")
        # A runner taking the role for the first time ends nothing that was told.
        self.token(self.guard("first"))
        self.assertEqual((self.light(), self.notices()), ([], []))

    def test_a_runner_that_stopped_renewing_is_told_once_by_the_act_that_sees_it_and_again_when_a_runner_takes_the_role(self):
        # Hung: its process lives, so neither the supervisor nor the server records an exit.
        self.now += 3600 * 1000
        self.send_next("Work an hour after the runner hung")
        self.send_next("More work")
        self.assertEqual(self.light(), ["runner"])
        self.assertEqual(self.health()["runner"]["state"], "unrenewed")
        self.assertEqual(self.notices(), [(self.conversation(), "Health: The agent runner stopped answering (its lease ran out and it "
                                           "did not renew it), so no wakes are going out." + NOTICE_TAIL)])
        # Its end recorded later is the same red thing: nothing more is posted.
        self.assertEqual(self.store.record_runner_exit(__import__("os").getpid(), 75)["status"], "recorded")
        self.assertEqual(len(self.notices()), 1)
        self.hosting.close()
        self.token(self.guard("successor"))
        self.assertEqual(self.light(), [])
        self.assertEqual(self.notices()[-1][1], "Health: The agent runner is running again, so wakes are going out." + NOTICE_TAIL)

    def test_the_server_settles_what_is_due_on_a_commit_of_its_own_once(self):
        """What the live feed calls when Core's moment comes with no act at all to see it (docs/health.md)."""
        self.fresh_lease()
        lease = self.sql("SELECT lease_until_ms FROM runner_state")[0][0]
        self.assertEqual(self.due(), lease, "while a runner runs, its lease's end is due")
        seq = lambda: int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
        before = seq()
        self.assertEqual(self.store.settle_health_due(lease)["status"], "early", "a moment that has not come")
        self.assertEqual((seq(), self.notices()), (before, []))
        self.now = lease
        self.assertEqual(self.store.settle_health_due(lease)["status"], "settled", "the link goes red at the lease's end")
        self.assertEqual(seq(), before + 1, "on a commit of its own, so every open page reads it")
        self.assertEqual(json.loads(self.sql("SELECT value FROM metadata WHERE key='health_light'")[0][0]), {"red": ["runner"], "seq": before + 1})
        self.assertEqual((self.notices(), self.due()), ([], lease + HANDOVER_MS), "told once no runner has followed it for the handover")
        self.assertEqual(self.store.settle_health_due(lease)["status"], "unchanged")
        self.now = lease + HANDOVER_MS
        self.assertEqual(self.store.settle_health_due(lease + HANDOVER_MS)["status"], "settled")
        self.assertEqual(seq(), before + 2)
        self.assertEqual([body.split(",")[0] for _, body in self.notices()], ["Health: The agent runner stopped answering (its lease ran out and it did not renew it)"])
        self.assertEqual(self.store.settle_health_due(lease + HANDOVER_MS)["status"], "unchanged")
        self.assertEqual((seq(), len(self.notices())), (before + 2, 1), "said once")
        self.assertEqual(self.sql("SELECT state,lease_until_ms FROM runner_state")[0], ("running", lease), "nothing of the runner's is recorded")

    def test_a_hung_runner_then_stopped_has_been_absent_since_it_stopped_answering(self):
        """A runner whose lease ran out unrenewed and is then stopped (TERM to a hung runner) stays told:
        wakes last went out at its lease's end, not at the stop."""
        self.fresh_lease()
        lease = self.sql("SELECT lease_until_ms FROM runner_state")[0][0]
        self.now = lease + HANDOVER_MS + 5000
        self.send_next("Work once it has lasted")
        self.assertEqual(len(self.notices()), 1)
        stopped = self.store.stop_runner(self.hosting, self.runner)
        self.assertEqual((stopped["status"], stopped["ended_ms"]), ("stopped", lease))
        self.assertEqual(self.health()["runner"]["since_ms"], lease)
        self.assertEqual(len(self.notices()), 1, "the same absence: no word that it is running again, and none that it stopped")
        self.hosting.close()
        self.token(self.guard("successor"))
        self.assertEqual(self.notices()[-1][1], "Health: The agent runner is running again, so wakes are going out." + NOTICE_TAIL)

    def test_a_stop_that_lasts_with_no_act_at_all_is_settled_at_its_moment(self):
        stopped = self.store.stop_runner(self.hosting, self.runner)
        due = self.due()
        self.assertEqual(due, stopped["ended_ms"] + HANDOVER_MS)
        self.now = due - 1
        self.assertEqual(self.store.settle_health_due(due)["status"], "early")
        self.now = due
        self.assertEqual(self.store.settle_health_due(due)["status"], "settled")
        self.assertEqual([body.split(",")[0] for _, body in self.notices()], ["Health: The agent runner was stopped and no runner has taken its place"])
        self.assertIsNone(self.due())

    def test_a_paused_runner_is_not_stopped_so_nothing_more_is_told(self):
        paused = self.store.pause_runner(self.hosting, self.runner, "storage_failure")
        self.assertEqual(self.store.stop_runner(self.hosting, self.runner)["status"], "paused", "a pause needs a deliberate resume")
        self.send_next("Any act settles what is red")
        self.assertEqual(self.light(), ["runner"])
        self.assertEqual(len(self.notices()), 1, "no word that it is running again")
        self.assertEqual(paused["status"], "paused")


@own_cases
class LightCase(HealthCase):
    def kept(self):
        light = json.loads(self.sql("SELECT value FROM metadata WHERE key='health_light'")[0][0])
        seq = int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
        return light, seq

    def test_every_kind_of_commit_keeps_what_is_red_with_it(self):
        """The live feed sends what is red only with the commit it is true at, so every way of committing keeps it."""
        self.failing()
        light, seq = self.kept()
        self.assertEqual(light, {"red": ["failing:agent-a"], "seq": seq}, "a runner act")
        self.send_next("A command")
        light, seq = self.kept()
        self.assertEqual(light, {"red": ["failing:agent-a"], "seq": seq})
        # An operator write.
        self.store.register_actor("agent-c", "agent", "Agent C")
        light, seq = self.kept()
        self.assertEqual(light, {"red": ["failing:agent-a"], "seq": seq}, "registration")
        self.assertEqual(self.store.record_runner_exit(__import__("os").getpid(), -9)["status"], "recorded")
        light, seq = self.kept()
        self.assertEqual(light, {"red": ["failing:agent-a", "runner"], "seq": seq}, "a recorded exit")
        self.assertEqual(self.light(), light["red"], "the view answers what was kept")
        self.assertEqual(self.store.view("owner", "health_light", {})["commit_seq"], seq, "and names its commit")


@own_cases
class LightAfterNoticesCase(HealthCase):
    """The reviewer's cases: a notice about agent-b is work for agent-a, the coordinator, and work
    waiting for an agent that left its last three wakes unanswered is red. agent-a is parked by three
    accepted wakes and then taken off t1, so nothing waits for it; agent-b's failure is set in SQL."""

    kept, park, unanswered_wake = LightCase.kept, ParkedNoticeCase.park, ParkedNoticeCase.unanswered_wake

    def b_failing(self, failed_wakes):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO wake_facts(recipient_id,failed_wakes,failing_since_ms,failed_outcome,failed_reason) "
                       "VALUES ('agent-b',?,1000,'error','deadline') ON CONFLICT(recipient_id) DO UPDATE SET failed_wakes=excluded.failed_wakes",
                       (failed_wakes,))

    def parked_with_nothing_waiting(self):
        self.park()
        self.part(False)
        self.assertNotIn("parked:agent-a", self.light(), "nothing waits for it")

    def test_a_notice_that_is_work_for_a_parked_coordinator_is_red_at_the_commit_that_posts_it(self):
        self.parked_with_nothing_waiting()
        self.b_failing(3)
        self.fresh_lease()  # one runner renewal posts the notice, work for agent-a
        self.assertEqual(self.deliveries_of("Health: agent-b"), [("agent-a", "pending"), ("owner", "acknowledged")])
        light, seq = self.kept()
        self.assertEqual(light, {"red": ["failing:agent-b", "parked:agent-a"], "seq": seq})
        self.assertEqual(self.light(), light["red"], "the view at that commit says the same")

    def test_a_clear_that_is_work_for_a_parked_coordinator_is_red_at_the_commit_that_posts_it(self):
        # agent-b goes red first, and agent-a reads that notice (an act of its own) before it parks.
        self.b_failing(3)
        self.send_next("Any act settles what is red")
        self.ack(next(item["id"] for item in self.pending()["items"] if item["message"]["author_id"] == "theseus"))
        self.parked_with_nothing_waiting()
        self.assertEqual(self.light(), ["failing:agent-b"])
        self.b_failing(0)
        self.fresh_lease()  # one runner renewal posts the clear, work for agent-a
        self.assertEqual(self.notices()[-1][1], "Health: agent-b can be woken again: a wake got through." + NOTICE_TAIL)
        light, seq = self.kept()
        self.assertEqual(light, {"red": ["parked:agent-a"], "seq": seq}, "never quiet while the newest fact is red")
        self.assertEqual(self.light(), light["red"])


@own_cases
class CommandLineCase(HealthCase):
    def run_cli(self, *flags):
        profile = Path(self.temp.name).resolve() / "agent-b.json"
        if not profile.exists():
            write_profile(profile, str(self.path.resolve()), "test-instance", "agent-b", binding=self.binding)
        text, err = io.StringIO(), io.StringIO()
        self.assertEqual(cli.main(["--profile", str(profile), *flags, "health"], stdout=text, stderr=err), 0, err.getvalue())
        return text.getvalue().splitlines()

    def test_with_json_an_agent_reads_the_view_itself(self):
        self.failing()
        [line] = self.run_cli("--json")
        answer = json.loads(line)
        self.assertEqual(answer["red"], ["failing:agent-a"])
        self.assertEqual(answer["agents"][0]["failing"]["why"], WHY["route_unavailable"])

    def test_an_agent_reads_what_needs_attention_and_why_in_the_pages_words(self):
        lines = self.run_cli()
        self.assertTrue(lines[0].startswith("Everything is working"), lines)
        self.assertTrue(any(line.startswith("Agent runner: running since ") for line in lines), lines)
        self.failing()
        lines = self.run_cli()
        self.assertEqual(lines[0], "Needs attention:")
        self.assertRegex(lines[1], r"^  - agent-a can't be woken: no wake since .+ has got through \(3 wakes\)\. Why: %s\. 1 message waits for it\.$"
                         % WHY["route_unavailable"].replace("(", r"\(").replace(")", r"\)"))
        self.assertTrue(any(line.startswith("  agent-a  can't be woken · 1 waiting") for line in lines), lines)

    def test_a_load_that_could_not_be_read_is_said_never_left_out(self):
        with mock.patch("aim_next.health.os.getloadavg", side_effect=OSError("unavailable")), mock.patch("aim_next.health.os.cpu_count", return_value=8):
            self.assertEqual(_real_machine_load(), {"load": None, "cpus": 8})
        answer = self.health()
        answer["machine"] = {"load": None, "cpus": 8}
        lines = report_lines(answer, str)
        self.assertIn("This Mac: its load could not be read (8 cores)", lines)
        self.assertTrue(lines[0].startswith("Everything is working"), lines)
        answer["machine"] = {"load": [9.0, 9.0, 9.0], "cpus": None}
        lines = report_lines(answer, str)
        self.assertIn("This Mac: load 9.0 on a core count that could not be read (1, 5 and 15 minutes: 9.0, 9.0, 9.0)", lines)
        self.assertTrue(lines[0].startswith("Everything is working"), "an unknown core count is not an overload")
        answer["machine"] = {"load": [9.0, 9.0, 9.0], "cpus": 8}
        self.assertEqual(report_lines(answer, str)[1], "  - The Mac is overloaded: its load is 9.0 on 8 cores, so everything here may be slow.")

    def test_the_words_follow_red_not_the_runners_state_alone(self):
        answer = self.health()
        answer["runner"] = {"live": False, "state": "stopped", "since_ms": 1000}
        self.assertTrue(report_lines(answer, str)[0].startswith("Everything is working"),
                        "a stopped runner that is not red is not a problem")
        answer["red"] = ["runner"]
        self.assertEqual(report_lines(answer, str)[1], "  - The agent runner is stopped at 1000, so no wakes are going out.")
