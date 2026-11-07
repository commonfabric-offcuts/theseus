from __future__ import annotations

"""Where an outcome stands, for one reader: the outcome light (item 86, docs/outcome-light.md).

The rules are pure (aim_next/outcome_rules.py) and are checked row by row,
each beside its neighbour; the reads (aim_next/outcome_light.py) are checked
through the store's own views, with the clock held."""

import calendar
import sqlite3
import unittest
from unittest import mock

from aim_next import outcome_rules, work
from aim_next.cli import _light_words
from aim_next.outcome_rules import stands, unreadable
from aim_next.work import WORK_WINDOW_MS
import test_store as fixtures

MINUTE = 60 * 1000
HOUR = 60 * MINUTE
NOW = 100 * HOUR


def worked(ms, by="warp", how="posted", waits=False, observed=None):
    return {"observed": (NOW - ms <= WORK_WINDOW_MS or waits) if observed is None else observed,
            "seen_ms": ms, "by": by, "how": how, "waits": waits}


QUIET_WORK = {"observed": False, "seen_ms": None, "by": None, "how": None, "waits": False}


def topic(topic_id, title, work_value=QUIET_WORK):
    return {"topic_id": topic_id, "title": title, "title_truncated": False, "activity_ms": NOW, "work": work_value}


def item(number, title, topic_id, work_value=QUIET_WORK):
    return {"number": number, "title": title, "topic_id": topic_id, "topic_title": title, "work": work_value}


def pipeline(now, all_shipped=False, shipped=None, last_now_work=None):
    return {"now": now, "all_shipped": all_shipped, "shipped": shipped, "last_now_work": last_now_work}


KEEP = {"reached": None, "kind": "keep", "target_word": None, "checks": None}
ON_TARGET = {"reached": None, "kind": "keep", "target_word": "on_target", "checks": {"count": 7, "last_run_ms": NOW - 8 * HOUR}}
ASK = {"topic_id": "t-notes", "title": "Speaker notes", "title_truncated": False, "by": "fable", "ms": NOW - 27 * MINUTE}
CREATED = {"by": "tony", "ms": None}
LAST_NOW = {"item": 4, "title": "Phone sign-in survives a restart", "by": "warp", "how": "posted",
            "topic_title": "Phone sign-in", "ms": NOW - 40 * HOUR}


def light(answer):
    return answer["light"]["light"], answer["light"]["short"]


class LightRulesCase(unittest.TestCase):
    """6.4's precedence, a row at a time and its neighbour: reached, waiting, built, done, quiet."""

    def test_waiting_on_you_wins_over_work_in_now_and_says_the_work_too(self):
        now = [item(69, "Notebook pages", "t-69", worked(NOW - 5 * MINUTE, "fable", "turn")), item(70, "Other", "t-70")]
        answer = stands([ASK], pipeline(now), [], [], KEEP, True, None, CREATED)
        self.assertEqual(light(answer), ("waiting", {"kind": "asks", "count": 1}))
        self.assertEqual(answer["lead"], {"kind": "asks", "count": 1})
        self.assertEqual(answer["facts"], [dict(ASK, kind="ask")])
        self.assertEqual(answer["also"], [{"kind": "also_built", "seen": 1, "of": 2}])
        # Its neighbour: no ask, the same Now work is Being worked on.
        built = stands([], pipeline(now), [], [], KEEP, True, None, CREATED)
        self.assertEqual(light(built), ("built", {"kind": "seen", "ms": NOW - 5 * MINUTE}))
        self.assertEqual(built["lead"], {"kind": "now_work", "seen": 1, "of": 2})
        self.assertEqual(built["facts"], [{"kind": "item_work", "item": 69, "title": "Notebook pages", "by": "fable", "how": "turn",
                                           "ms": NOW - 5 * MINUTE}])

    def test_d4_talk_outside_now_is_quiet_with_since_the_last_work_in_now(self):
        now = [item(4, "Phone sign-in survives a restart", "t-4"), item(5, "Five", "t-5"), item(6, "Six", "t-6")]
        talk = [topic("t-friction", "Friction log", worked(NOW - 10 * MINUTE, "aim-ux"))]
        answer = stands([], pipeline(now, last_now_work=LAST_NOW), talk, [], KEEP, True, None, CREATED)
        self.assertEqual(light(answer), ("quiet", {"kind": "talk", "ms": NOW - 10 * MINUTE, "how": "posted", "since_ms": NOW - 40 * HOUR}))
        self.assertEqual(answer["lead"], {"kind": "now_quiet_talk", "of": 3, "since_ms": NOW - 40 * HOUR, "talk_ms": NOW - 10 * MINUTE, "how": "posted"})
        self.assertEqual(answer["facts"], [{"kind": "topic_work", "topic_id": "t-friction", "title": "Friction log", "by": "aim-ux",
                                            "how": "posted", "ms": NOW - 10 * MINUTE}])
        self.assertEqual(answer["also"], [dict(LAST_NOW, kind="last_now_work"), {"kind": "may_be_stalled"}])

    def test_d4_with_the_pipeline_on_quiet_says_since_the_last_work_in_now_never_newer_talk_elsewhere(self):
        now = [item(4, "Phone sign-in survives a restart", "t-4")] + [item(n, "Item %d" % n, "t-%d" % n) for n in range(5, 19)]
        # A post in Friction log 3 hours ago, newer than the last work in Now.
        last = {"by": "aim-ux", "how": "posted", "topic_title": "Friction log", "ms": NOW - 3 * HOUR}
        answer = stands([], pipeline(now, last_now_work=LAST_NOW), [], [], KEEP, True, last, CREATED)
        self.assertEqual(light(answer), ("quiet", {"kind": "since", "ms": NOW - 40 * HOUR}))
        self.assertEqual(answer["lead"], {"kind": "now_quiet", "of": 15, "ever": True})
        self.assertEqual(answer["facts"], [dict(LAST_NOW, kind="last_now_work")])
        self.assertEqual(answer["also"], [{"kind": "may_be_stalled"}])
        # No work on an item in Now ever seen: Quiet with no time.
        never = stands([], pipeline(now), [], [], KEEP, True, last, CREATED)
        self.assertEqual(light(never), ("quiet", {"kind": "since", "ms": None}))
        self.assertEqual(never["lead"], {"kind": "now_quiet", "of": 15, "ever": False})

    def test_with_the_pipeline_off_work_in_any_open_topic_or_wait_counts(self):
        talk = [topic("t-a", "How a release ships", worked(NOW - 45 * MINUTE, "aim-spec")),
                topic("t-b", "Slide order", worked(NOW - 42 * MINUTE, "funding", "turn"))]
        answer = stands([], None, talk, [], KEEP, True, None, CREATED)
        self.assertEqual(light(answer), ("built", {"kind": "seen", "ms": NOW - 42 * MINUTE}))
        self.assertEqual(answer["lead"], {"kind": "topics_work"})
        self.assertEqual([fact["topic_id"] for fact in answer["facts"]], ["t-b", "t-a"], "newest first")
        old_wait = [topic("t-w", "Waits on aim-core", worked(NOW - 3 * HOUR, "aim-core", waits=True))]
        self.assertEqual(light(stands([], None, [], old_wait, KEEP, True, None, CREATED))[0], "built", "a wait is work whatever its age")
        # Its neighbour: nothing worked on, so Quiet since the last thing that happened.
        last = {"by": "fable", "how": "posted", "topic_title": "Who answers where", "ms": NOW - 15 * HOUR}
        quiet = stands([], None, [topic("t-q", "Quiet")], [], KEEP, True, last, CREATED)
        self.assertEqual(light(quiet), ("quiet", {"kind": "since", "ms": NOW - 15 * HOUR}))
        self.assertEqual(quiet["lead"], {"kind": "topics_quiet"})
        self.assertEqual(quiet["facts"], [dict(last, kind="last_activity")])
        self.assertEqual(quiet["also"], [{"kind": "may_be_stalled"}])
        self.assertEqual(light(stands([], None, [], [], KEEP, True, None, CREATED)), ("quiet", {"kind": "since", "ms": None}))

    def test_d5_d43_done_means_one_thing_per_kind(self):
        shipped = {"count": 12, "last_release_ms": NOW - 63 * HOUR}
        everything = pipeline([], all_shipped=True, shipped=shipped)
        # To keep, everything shipped, no checks: not Done.
        self.assertEqual(light(stands([], everything, [], [], KEEP, True, None, CREATED))[0], "quiet")
        # To keep, on target and shipped: Done, with both facts.
        done = stands([], everything, [], [], ON_TARGET, True, None, CREATED)
        self.assertEqual(light(done), ("done", {"kind": "checks_pass"}))
        self.assertEqual(done["lead"], {"kind": "done", "pipeline": True})
        self.assertEqual(done["facts"], [{"kind": "all_shipped", "count": 12, "last_release_ms": NOW - 63 * HOUR},
                                         {"kind": "checks_pass", "count": 7, "last_run_ms": NOW - 8 * HOUR}])
        # On target with one item not shipped: not Done.
        one_left = pipeline([item(13, "Thirteen", "t-13")], all_shipped=False, shipped=shipped, last_now_work=LAST_NOW)
        self.assertEqual(light(stands([], one_left, [], [], ON_TARGET, True, None, CREATED))[0], "quiet")
        # On target with no pipeline: Done, said without one.
        no_pipeline = stands([], None, [topic("t", "T")], [], ON_TARGET, True, None, CREATED)
        self.assertEqual(light(no_pipeline), ("done", {"kind": "checks_pass"}))
        self.assertEqual(no_pipeline["lead"], {"kind": "done", "pipeline": False})
        # To reach, every check passing and everything shipped: never Done until Reached.
        reach = dict(ON_TARGET, kind="reach")
        self.assertEqual(light(stands([], everything, [], [], reach, True, None, CREATED))[0], "quiet")
        self.assertEqual(light(stands([], None, [topic("t", "T", worked(NOW - MINUTE))], [], reach, True, None, CREATED))[0], "built")
        # Reached: Done, ahead of an ask left in a topic.
        reached = dict(reach, reached={"by": "tony", "ms": NOW - 20 * HOUR, "words": "Sent to the board."})
        answer = stands([ASK], everything, [], [], reached, True, None, CREATED)
        self.assertEqual(light(answer), ("done", {"kind": "reached", "ms": NOW - 20 * HOUR}))
        self.assertEqual(answer["lead"], {"kind": "reached", "by": "tony", "ms": NOW - 20 * HOUR, "words": "Sent to the board."})
        self.assertEqual((answer["facts"], answer["also"]), ([], []))

    def test_done_again_when_names_what_is_left_for_an_outcome_to_keep(self):
        shipped = {"count": 12, "last_release_ms": NOW - 63 * HOUR}
        now = [item(13, "Thirteen", "t-13", worked(NOW - 5 * MINUTE))]
        answer = stands([], pipeline(now, shipped=shipped), [], [], ON_TARGET, True, None, CREATED)
        self.assertEqual(answer["also"], [{"kind": "done_again_when", "shipped": 12, "checks": 7, "waiting_on": [13]}])
        reach = stands([], pipeline(now, shipped=shipped), [], [], dict(ON_TARGET, kind="reach"), True, None, CREATED)
        self.assertEqual(reach["also"], [], "an outcome to reach is never Done again")

    def test_no_topics_says_who_started_it(self):
        answer = stands([], None, [], [], KEEP, False, None, {"by": "tony", "ms": NOW - 17 * MINUTE})
        self.assertEqual(light(answer), ("quiet", {"kind": "no_topics"}))
        self.assertEqual(answer["lead"], {"kind": "no_topics"})
        self.assertEqual(answer["facts"], [{"kind": "created", "by": "tony", "ms": NOW - 17 * MINUTE}])
        self.assertEqual(answer["also"], [], "no stuck line before there is anything to be stuck")

    def test_three_items_are_named_and_the_rest_counted_and_work_outside_now_is_said_beside_them(self):
        now = [item(n, "Item %d" % n, "t-%d" % n, worked(NOW - (k + 1) * MINUTE)) for k, n in enumerate((1, 2, 3, 91, 35, 48))] + [item(99, "Idle", "t-99")]
        talk = [topic("t-friction", "Friction log", worked(NOW - 2 * MINUTE, "aim-spec"))]
        answer = stands([], pipeline(now), talk, [], KEEP, True, None, CREATED)
        self.assertEqual(answer["lead"], {"kind": "now_work", "seen": 6, "of": 7})
        self.assertEqual([fact.get("item") for fact in answer["facts"][:3]], [1, 2, 3], "the latest three")
        self.assertEqual(answer["facts"][outcome_rules.FACTS_SHOWN:], [{"kind": "more_items", "numbers": [35, 48, 91]}], "and the rest counted, in order")
        self.assertEqual(answer["also"], [{"kind": "outside_now", "by": "aim-spec", "how": "posted", "topic_title": "Friction log",
                                           "ms": NOW - 2 * MINUTE}])

    def test_a_read_failure_after_the_questions_has_its_own_value_and_still_shows_waiting_on_you(self):
        failed = unreadable([])
        self.assertEqual(failed, {"light": {"light": None, "label": None, "short": None, "unreadable": True},
                                  "lead": {"kind": "unreadable"}, "facts": [], "also": []})
        waiting = unreadable([ASK])
        self.assertEqual(waiting["light"], {"light": "waiting", "label": "Waiting on you", "short": {"kind": "asks", "count": 1}, "unreadable": True})
        self.assertEqual(waiting["facts"], [dict(ASK, kind="ask")])


class CliWordsCase(unittest.TestCase):
    """`aim-next outcomes` says each light in plain words with absolute times."""

    def test_each_light_in_the_cli_words(self):
        with mock.patch("time.localtime", side_effect=lambda seconds: __import__("time").gmtime(seconds)):
            at = calendar.timegm((2026, 11, 5, 8, 0, 0)) * 1000
            self.assertEqual(_light_words({"light": "waiting", "short": {"kind": "asks", "count": 1}}), "waiting on you · 1 question")
            self.assertEqual(_light_words({"light": "waiting", "short": {"kind": "asks", "count": 2}}), "waiting on you · 2 questions")
            self.assertEqual(_light_words({"light": "built", "short": {"kind": "seen", "ms": at}}), "worked on at 2026-11-05 08:00")
            self.assertEqual(_light_words({"light": "done", "short": {"kind": "checks_pass"}}), "done · all checks pass")
            self.assertEqual(_light_words({"light": "quiet", "short": {"kind": "no_topics"}}), "no topics yet")
            self.assertEqual(_light_words({"light": "quiet", "short": {"kind": "since", "ms": at}}), "quiet since 2026-11-05 08:00")
            self.assertEqual(_light_words({"light": "quiet", "short": {"kind": "since", "ms": None}}), "quiet")
            self.assertEqual(_light_words({"light": "quiet", "short": {"kind": "talk", "ms": at, "how": "turn", "since_ms": None}}), "quiet · work at 2026-11-05 08:00")
            self.assertEqual(_light_words({"light": "quiet", "short": {"kind": "talk", "ms": at, "how": "posted", "since_ms": at}}),
                             "quiet since 2026-11-05 08:00 · a post at 2026-11-05 08:00")
            self.assertEqual(_light_words({"light": None, "short": None, "unreadable": True}), "couldn't check where it stands")
            self.assertEqual(_light_words(None), "")


class LightReadsCase(fixtures.StoreCase):
    """The reads behind the light, through the store's views, with the clock held at self.now."""

    def setUp(self):
        self.now = 50 * HOUR
        for name in ("delivery", "conversation", "topic_state", "store", "outcome_light"):
            patch = mock.patch("aim_next.%s._now_ms" % name, side_effect=lambda: self.now)
            patch.start()
            self.addCleanup(patch.stop)
        super().setUp()
        self.workspace()
        self.topics = 0

    def topic(self, topic_id, title=None, author="owner", participants=("agent-a", "agent-b")):
        self.topics += 1
        n = self.topics
        source = {"kind": "new_topic", "id": "opening-%d" % n, "workspace_id": "w1"}
        self.assertEqual(self.command("draft.save", dict(source_ref=source, topic_id=topic_id, body="Opening %s" % topic_id, generation="g",
                                                         attachments=[], quotes=[], addressees=[],
                                                         opening={"workspace_id": "w1", "title": title or topic_id, "participants": list(participants)}),
                                      target={"draft_id": "d-%d" % n}, expected={"draft_revision": 0}, actor=author)["status"], "committed")
        self.assertEqual(self.command("submission.prepare", {"draft_id": "d-%d" % n, "submission_id": "s-%d" % n, "send_operation_id": "send-%d" % n},
                                      target={"topic_id": topic_id}, expected={"draft_revision": 1}, actor=author)["status"], "committed")
        created = self.command("topic.create_and_send", {"submission_id": "s-%d" % n}, target={"topic_id": topic_id}, op="send-%d" % n, actor=author)
        self.assertEqual(created["status"], "committed", created)

    def post(self, actor, topic_id, body="A post", **args):
        receipt = self.command("message.post", dict(args, body=body), target={"topic_id": topic_id}, actor=actor)
        self.assertEqual(receipt["status"], "committed", receipt)

    def update(self, actor, topic_id, **args):
        version = self.store.view(actor, "topic", {"topic_id": topic_id})["topic"]["version"]
        receipt = self.command("topic.update", args, target={"topic_id": topic_id}, expected={"topic_revision": version}, actor=actor)
        self.assertEqual(receipt["status"], "committed", receipt)

    def stands(self, actor="owner"):
        answer = self.store.view(actor, "outcome_light", {"workspace_id": "w1"})
        self.assertNotIn("error", answer, answer)
        row = [entry for entry in self.store.view(actor, "workspaces", {})["items"] if entry["id"] == "w1"][0]
        self.assertEqual(row["light"], answer["light"], "the row and the panel say the same")
        return answer

    def test_waiting_on_you_is_read_first_and_alone_so_a_failed_read_after_it_still_shows_it(self):
        self.topic("t1", "Speaker notes")
        self.now += MINUTE
        self.post("agent-a", "t1", "Which order?", intent="ask", addressees=["owner"])
        asked = self.now
        answer = self.stands()
        self.assertEqual(light(answer), ("waiting", {"kind": "asks", "count": 1}))
        self.assertEqual(answer["facts"], [{"kind": "ask", "topic_id": "t1", "title": "Speaker notes", "title_truncated": False, "by": "agent-a", "ms": asked}])
        self.assertEqual(light(self.stands("agent-b"))[0], "built", "the question is to the owner, not to agent-b")
        with mock.patch("aim_next.outcome_light.OutcomeLight._light_reads", side_effect=sqlite3.DatabaseError("database disk image is malformed")):
            failed = self.stands()
            self.assertEqual(failed["light"], {"light": "waiting", "label": "Waiting on you", "short": {"kind": "asks", "count": 1}, "unreadable": True})
            # Without a question, a failed read is no light at all, never a guess.
            nothing = self.stands("agent-b")
            self.assertEqual(nothing["light"], {"light": None, "label": None, "short": None, "unreadable": True})
            self.assertEqual(nothing["lead"], {"kind": "unreadable"})

    def test_a_busy_database_is_a_retryable_refusal_of_the_whole_view_not_an_unreadable_light(self):
        self.topic("t1")
        with mock.patch("aim_next.outcome_light.OutcomeLight._light_reads", side_effect=sqlite3.OperationalError("database is locked")):
            answer = self.store.view("owner", "outcome_light", {"workspace_id": "w1"})
        self.assertEqual(answer["error"]["code"], "DATABASE_BUSY")
        self.assertTrue(answer["error"]["retryable"])

    def test_the_readers_own_work_is_not_seen(self):
        self.topic("t1")
        self.now += MINUTE
        self.post("owner", "t1", "Only mine")
        self.assertEqual(light(self.stands("owner")), ("quiet", {"kind": "since", "ms": None}))
        self.assertEqual(light(self.stands("agent-a")), ("built", {"kind": "seen", "ms": self.now}))

    def test_with_no_pipeline_an_open_topic_counts_and_a_done_one_does_not(self):
        self.topic("t1", "Handbook")
        self.now += MINUTE
        self.post("agent-a", "t1", "A section")
        posted = self.now
        answer = self.stands()
        self.assertEqual(light(answer), ("built", {"kind": "seen", "ms": posted}))
        self.assertEqual(answer["facts"], [{"kind": "topic_work", "topic_id": "t1", "title": "Handbook", "by": "agent-a", "how": "posted", "ms": posted}])
        self.now += MINUTE
        self.update("owner", "t1", state="done")
        self.assertEqual(light(self.stands())[0], "quiet", "the same post in a done topic")

    def test_a_topic_whose_only_recent_activity_is_a_hosted_turn_is_seen_below_thirty_topics_with_older_posts(self):
        start = self.now
        self.topic("t-turn", "Turn only")
        self.now += MINUTE
        self.post("agent-a", "t-turn", "Early")
        for n in range(30):
            self.now += MINUTE
            self.topic("t-%02d" % n, author="agent-b")
        # Two hours later fable's hosted turn, 10 minutes ago, is all that happened.
        self.now = start + 2 * HOUR
        turned = self.now - 10 * MINUTE
        with sqlite3.connect(str(self.path)) as db:
            work._turn_in(db, ["t-turn"], None, "agent-a", turned)
        answer = self.stands()
        self.assertEqual(light(answer), ("built", {"kind": "seen", "ms": turned}))
        self.assertEqual(answer["facts"], [{"kind": "topic_work", "topic_id": "t-turn", "title": "Turn only", "by": "agent-a", "how": "turn", "ms": turned}])
        # D20: the turn orders the topic list as a post would.
        listed = self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})["items"]
        self.assertEqual(listed[0]["id"], "t-turn")

    def test_an_old_wait_is_work_whatever_its_age(self):
        self.topic("t1", "Needs aim-core")
        self.now += MINUTE
        self.update("owner", "t1", state="waiting", waiting_on=["agent-a"])
        self.now += 3 * HOUR
        answer = self.stands()
        self.assertEqual(answer["light"]["light"], "built")
        self.assertEqual(answer["facts"], [{"kind": "topic_work", "topic_id": "t1", "title": "Needs aim-core", "by": None, "how": None, "ms": None}])

    def test_quiet_since_is_the_newest_activity_by_others_and_a_capped_scan_gives_no_time(self):
        start = self.now
        self.topic("t-a", "A")
        self.now = start + MINUTE
        self.post("agent-a", "t-a", "In A")
        self.now = start + 2 * MINUTE
        self.topic("t-b", "B")
        self.now = start + 61 * MINUTE
        self.post("agent-b", "t-b", "In B, an hour after agent-a's in A")
        # The owner posts last in A, so A is first in activity order.
        self.now = start + 70 * MINUTE
        self.post("owner", "t-a", "Mine, last")
        self.now = start + 5 * HOUR
        answer = self.stands()
        self.assertEqual(light(answer), ("quiet", {"kind": "since", "ms": start + 61 * MINUTE}))
        # The last activity names its topic by id as well as title, so the page's Last line can link to it.
        self.assertEqual(answer["facts"], [{"kind": "last_activity", "by": "agent-b", "how": "posted", "topic_id": "t-b", "topic_title": "B",
                                            "title_truncated": False, "ms": start + 61 * MINUTE}])
        # A title too long to carry whole is cut, and says so, so the line can end it with an ellipsis.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE topics SET title=? WHERE id='t-b'", ("B" * 1100,))
        long = self.stands()["facts"][0]
        self.assertEqual((long["topic_id"], long["title_truncated"], long["topic_title"]), ("t-b", True, "B" * 1024))
        with mock.patch.object(outcome_rules, "LAST_SCAN_MAX", 1):
            capped = self.stands()
        self.assertEqual(light(capped), ("quiet", {"kind": "since", "ms": None}), "a scan that stopped on its cap may have missed something newer")
        self.assertEqual(capped["facts"], [])

    def plant(self, count, newest, step, author):
        """count open topics planted directly, one post each by author, the newest at newest and each next one step older.
        Returns their ids, newest first."""
        ids = []
        with sqlite3.connect(str(self.path)) as db:
            for n in range(count):
                topic_id, ms = "p-%03d" % n, newest - n * step
                db.execute("INSERT INTO topics(id,workspace_id,title,creator_id,version,activity_ms) VALUES (?,'w1',?,?,1,?)", (topic_id, topic_id, author, ms))
                db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id,sent_ms) "
                           "VALUES (?,?,?,'Body','[]','[]','[]',?,?)", ("m-" + topic_id, topic_id, author, "op-" + topic_id, ms))
                db.execute("INSERT INTO topic_summaries VALUES (?,1,?,NULL)", (topic_id, "m-" + topic_id))
                ids.append(topic_id)
        return ids

    def test_the_scan_reads_the_whole_window_and_stops_past_it(self):
        self.now = 200 * HOUR
        # 300 topics: 150 active within the hour, then 150 older, all only the owner's.
        ids = self.plant(300, self.now - 10_000, 24_000, "owner")
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE ?-activity_ms<=?", (self.now, WORK_WINDOW_MS))[0][0], 150)
        self.assertEqual(light(self.stands()), ("quiet", {"kind": "since", "ms": None}))
        # The 120th newest has agent-a's post as well, inside the window: the light sees it.
        seen_ms = self.now - 119 * 24_000 - 10_000
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id,sent_ms) "
                       "VALUES ('m-other',?,'agent-a','Body','[]','[]','[]','op-other',?)", (ids[119], seen_ms))
            db.execute("UPDATE topic_summaries SET other_message_id='m-other' WHERE topic_id=?", (ids[119],))
        self.assertEqual(light(self.stands()), ("built", {"kind": "seen", "ms": seen_ms}))

    def test_past_the_window_the_scan_stops_after_its_cap_with_no_time(self):
        self.now = 200 * HOUR
        ids = self.plant(300, self.now - 10_000, 24_000, "owner")
        # Only the 260th newest, far past the window and past the cap, has someone else's post.
        old = self.now - 259 * 24_000 - 10_000
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id,sent_ms) "
                       "VALUES ('m-other',?,'agent-a','Body','[]','[]','[]','op-other',?)", (ids[259], old))
            db.execute("UPDATE topic_summaries SET other_message_id='m-other' WHERE topic_id=?", (ids[259],))
        self.assertEqual(outcome_rules.LAST_SCAN_MAX, 100)
        self.assertEqual(light(self.stands()), ("quiet", {"kind": "since", "ms": None}))
        with mock.patch.object(outcome_rules, "LAST_SCAN_MAX", 300):
            self.assertEqual(light(self.stands()), ("quiet", {"kind": "since", "ms": old}), "a longer scan would have reached it")

    def test_an_outcome_with_no_topics_says_so_and_who_started_it(self):
        answer = self.stands()
        self.assertEqual(light(answer), ("quiet", {"kind": "no_topics"}))
        self.assertEqual(answer["facts"], [{"kind": "created", "by": "owner", "ms": None}])


# Do not rerun the inherited StoreCase tests here.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in LightReadsCase.__dict__:
        setattr(LightReadsCase, _name, None)


if __name__ == "__main__":
    unittest.main()
