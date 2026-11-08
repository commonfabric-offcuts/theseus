from __future__ import annotations

"""The Health page's facts, its link and its notices (pipeline item 109, docs/health.md).

agent-a is a hosted agent routed here with the topic's opening waiting; it
coordinates the outcome w1, whose team is agent-a and agent-b and whose
conversation the owner and agent-a take part in. A runner holds the role.
"""

import io
import json
import sqlite3
from pathlib import Path
from unittest import mock

from aim_next import cli
from aim_next.health import FAILING_AFTER, HANDOVER_MS, WHY, machine_load as _real_machine_load, report_lines, why_words
from aim_next.profile import write_profile
from test_hosted_schedule import OTHER_THREAD
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

    def test_a_steer_its_turn_never_read_did_not_get_through_and_a_seen_one_did(self):
        self.hand(self.claim_now(), turn_id="turn-0")
        self.now += 1000
        self.send_next("Work while the turn runs")
        self.hand(self.claim_now(), turn_id="turn-0", mode="steer")  # never seen in the thread
        self.end("completed", turn_id="turn-0")
        self.assertEqual(self.wake_facts(), (1, "unseen", 1), "the turn got through; the steer it never read did not")
        self.assertEqual(self.agent()["reached_ms"], self.now)
        # A steer into a turn that had already ended is settled as it is handed.
        self.now += 61000
        self.send_next("Work after it ended")
        self.hand(self.claim_now(), turn_id="turn-0", mode="steer")
        self.assertEqual(self.wake_facts(), (2, "unseen", 1))
        # One the turn read gets through with it.
        self.now += 61000
        self.hand(self.claim_now(), turn_id="turn-1")
        self.send_next("Work for a running turn")
        steer = self.claim_now()
        self.hand(steer, turn_id="turn-1", mode="steer")
        self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, "theseus:" + steer["attempt_id"])["status"], "recorded")
        self.end("completed", turn_id="turn-1")
        self.assertEqual(self.wake_facts(), (0, None, 2))
        self.assertEqual(WHY.get("unseen"), None)
        self.assertEqual(why_words(None, "unseen"), "its work was added to a Codex turn that ended before it read it")

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
