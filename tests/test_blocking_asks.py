from __future__ import annotations

"""An agent's ask that names the piece or release it holds (item 259; docs/attention.md, "An ask that blocks work").

The fixture outcome w1 is owned by owner (a person), with agent-a (its
coordinator) and agent-b on its team; its topic t1 has owner and agent-a taking
part, and its pipeline is on with items 1 to 3 in Now (test_pipeline_stages).
Core records what an ask blocks with the message, refuses one that names
nothing of the topic's outcome or is not an ask, and the three readers of it
("Waiting on you", the outcome light, the pipeline's held row) clear exactly
when the ask does: a reply in the topic or a 👍 that answers it.
"""

import sqlite3
import unittest
from unittest import mock

from aim_next.blocking import first_line
import test_pipeline_stages
import test_pipeline_steering
import test_targets


class BlockingCase(test_pipeline_steering.PipelineCase):
    # StagesCase's pipeline and its helpers, without running its own cases again here (a module name for
    # that class would be discovered and run).
    start, topic = test_pipeline_stages.StagesCase.start, test_pipeline_stages.StagesCase.topic
    release_stages, combine = test_pipeline_stages.StagesCase.release_stages, test_pipeline_stages.StagesCase.combine
    CHECKS = test_pipeline_stages.StagesCase.CHECKS
    propose, revision, checks_view = test_targets.TargetCase.propose, test_targets.TargetCase.revision, test_targets.TargetCase.checks_view

    def setUp(self):
        super().setUp()
        self.committed(self.on())
        self.stages(*test_pipeline_stages.STAGES)
        for n in range(1, 4):
            self.add("Now %d" % n, section="now", size=("small", "large", "medium")[n - 1])

    def ask(self, body="Shall I restart it?", blocks=None, to=("owner",), actor="agent-a", topic="t1", **args):
        if blocks is not None:
            args["blocks"] = blocks
        return self.command("message.post", dict({"body": body, "addressees": list(to), "intent": "ask"}, **args),
                            {"topic_id": topic}, actor=actor)

    def asked(self, *args, **kwargs):
        return self.committed(self.ask(*args, **kwargs))["message_id"]

    def thumb(self, message, on=True, actor="owner"):
        revision = self.store.view(actor, "reactions", {"message_id": message})["reactions"]["thumb_revision"]
        return self.committed(self.command("message.thumb", {"thumbed": on}, target={"message_id": message},
                                           expected={"thumb_revision": revision}, actor=actor))

    def blocking(self, actor="owner"):
        """Waiting on you's blocking asks: (message, what it blocks)."""
        return [(item["message_id"], item["blocks"]) for item in self.store.view(actor, "attention", {})["blocking"]]

    def light(self, actor="owner"):
        answer = self.store.view(actor, "outcome_light", {"workspace_id": "w1"})
        self.assertNotIn("error", answer, answer)
        return answer

    def row_light(self, actor="owner"):
        [item] = [item for item in self.store.view(actor, "workspaces", {"limit": 100})["items"] if item["id"] == "w1"]
        return item["light"]

    def now(self, actor="owner"):
        answer = self.store.view(actor, "pipeline", {"workspace_id": "w1", "section": "now"})
        self.assertNotIn("error", answer, answer)
        return answer

    def held(self, piece, actor="owner"):
        now = self.now(actor)
        [found] = [p for p in now["pieces"] + ([now["release_piece"]] if now["release_piece"] else []) if p["id"] == piece]
        return [(held["message_id"], held["waiting_on"], held["line"]) for held in found["held"]]

    def messages(self):
        return self.sql("SELECT count(*) FROM messages")[0][0]

    def item_of(self, message, actor="owner"):
        items = self.store.view(actor, "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 50})["items"]
        [item] = [item for item in items if item["id"] == message]
        return item

    def shows_nothing_held(self, piece):
        self.assertEqual(self.blocking(), [], "Waiting on you lists no blocking ask")
        light = self.light()
        self.assertNotIn("blocking", light["light"]["short"] or {}, "the light says nothing blocks")
        self.assertNotIn("blocking", light["lead"])
        self.assertNotIn("blocking", self.row_light()["short"] or {})
        self.assertEqual(self.held(piece), [], "the pipeline's row holds nothing")

    def agree(self, piece, held, actor="owner"):
        """Waiting on you, the light (the outcome's and its row on the home) and the pipeline's row all say the same: held
        are the asks that hold piece and wait on actor, and nothing else holds anything for them."""
        self.assertEqual([message for message, _ in self.blocking(actor)], held, "Waiting on you")
        light = self.light(actor)
        for short in (light["light"]["short"] or {}, light["lead"], self.row_light(actor)["short"] or {}):
            self.assertEqual(short.get("blocking"), "piece" if held else None, "the light")
        self.assertEqual([message for message, waiting, _ in self.held(piece, actor) if actor in waiting], held, "the pipeline's row")


class RecordingCase(BlockingCase):
    def test_an_ask_records_the_piece_it_holds_and_every_reader_shows_it_first(self):
        piece = self.committed(self.start())["piece_id"]
        plain = self.asked("Which colour for the header?")
        receipt = self.committed(self.ask("Please restart fseventsd.\nIt stopped at 9.", blocks={"kind": "piece", "ref": piece}))
        held = receipt["message_id"]
        self.assertEqual(receipt["blocks"], {"kind": "piece", "ref": piece})
        self.assertEqual(self.sql("SELECT message_id,workspace_id,topic_id,kind,ref FROM message_blocks"), [(held, "w1", "t1", "piece", piece)])
        # The message carries it as it is read; the plain ask before it carries none.
        self.assertEqual(self.item_of(held)["blocks"], {"kind": "piece", "ref": piece})
        self.assertNotIn("blocks", self.item_of(plain))
        # Waiting on you lists it, naming the piece's items.
        [item] = self.store.view("owner", "attention", {})["blocking"]
        self.assertEqual((item["message_id"], item["topic_id"], item["by"], item["line"], item["blocks"]),
                         (held, "t1", "agent-a", "Please restart fseventsd.", {"kind": "piece", "piece_id": piece, "items": [1, 2]}))
        self.assertEqual(item["workspace"]["id"], "w1")
        # The light is Waiting on you, saying what it blocks, its topic's question first.
        light = self.light()
        self.assertEqual((light["light"]["light"], light["light"]["short"]), ("waiting", {"kind": "asks", "count": 1, "blocking": "piece"}))
        self.assertEqual(light["lead"], {"kind": "asks", "count": 1, "blocking": "piece"})
        self.assertEqual(light["facts"][0]["blocking"]["piece_id"], piece)
        self.assertEqual(self.row_light()["short"], {"kind": "asks", "count": 1, "blocking": "piece"})
        # The held row names who it waits on and the ask's first line, for every reader of the pipeline.
        for reader in ("owner", "agent-b"):
            self.assertEqual(self.held(piece, reader), [(held, ["owner"], "Please restart fseventsd.")], reader)
        self.assertEqual(self.blocking("agent-b"), [], "it waits on the person asked, not on whoever reads")

    def test_an_ask_records_the_release_it_holds_and_a_release_is_listed_before_a_piece(self):
        self.release_stages(*test_pipeline_stages.STAGES[:3], self.CHECKS)
        self.topic("t2")
        first = self.committed(self.start(stage="wait"))["piece_id"]
        second = self.committed(self.start(numbers=(3,), topic="t2", stage="wait"))["piece_id"]
        release = self.committed(self.combine([first]))
        self.assertEqual(release["release_number"], 23)
        on_piece = self.asked("May I rebase it?", blocks={"kind": "piece", "ref": second}, topic="t2")
        on_release = self.asked("Restart fseventsd, please", blocks={"kind": "release", "ref": "23"})
        self.assertEqual(self.sql("SELECT kind,ref FROM message_blocks WHERE message_id=?", (on_release,)), [("release", "23")])
        self.assertEqual(self.blocking(), [(on_release, {"kind": "release", "release": 23}),
                                           (on_piece, {"kind": "piece", "piece_id": second, "items": [3]})])
        self.assertEqual(self.light()["light"]["short"]["blocking"], "release")
        self.assertEqual(self.held(release["piece_id"]), [(on_release, ["owner"], "Restart fseventsd, please")])
        self.assertEqual(self.held(second), [(on_piece, ["owner"], "May I rebase it?")])
        self.assertEqual(self.now()["facts"]["next_release"]["release"], 23)

    def test_the_lights_card_lists_the_blocking_question_first_however_new_the_others(self):
        # The card's lead says "Work can't go on until you answer the first", so the first must be the one that holds work.
        piece = self.committed(self.start())["piece_id"]
        self.topic("t2")
        held = self.asked("Please restart fseventsd.", blocks={"kind": "piece", "ref": piece})
        self.asked("Which colour for the header?", topic="t2")
        light = self.light()
        self.assertEqual(light["lead"], {"kind": "asks", "count": 2, "blocking": "piece"})
        self.assertEqual([(fact["topic_id"], fact.get("blocking")) for fact in light["facts"]],
                         [("t1", {"kind": "piece", "piece_id": piece, "items": [1, 2]}), ("t2", None)])
        # Once it is answered the topics' waits are newest first again, and none says it blocks.
        self.thumb(held)
        self.asked("Anything else?")
        self.post("Blue.", actor="owner", topic="t2")
        self.asked("And the footer?", topic="t2")
        light = self.light()
        self.assertEqual(light["lead"], {"kind": "asks", "count": 2})
        self.assertEqual([(fact["topic_id"], fact.get("blocking")) for fact in light["facts"]], [("t2", None), ("t1", None)])

    def test_a_read_that_fails_after_the_questions_still_says_what_they_hold(self):
        piece = self.committed(self.start())["piece_id"]
        self.asked("Please restart fseventsd.", blocks={"kind": "piece", "ref": piece})
        with mock.patch("aim_next.outcome_light.OutcomeLight._light_reads", side_effect=sqlite3.DatabaseError("database disk image is malformed")):
            light = self.light()
        self.assertEqual((light["light"]["short"], light["light"]["unreadable"]), ({"kind": "asks", "count": 1, "blocking": "piece"}, True))
        self.assertEqual(light["facts"][0]["blocking"]["piece_id"], piece)

    def test_a_plain_ask_and_an_older_message_read_as_before(self):
        piece = self.committed(self.start())["piece_id"]
        plain = self.asked("Which colour for the header?")
        self.assertNotIn("blocks", self.item_of(plain))
        self.assertEqual(self.light()["light"]["short"], {"kind": "asks", "count": 1})
        self.shows_nothing_held(piece)
        self.assertEqual(self.store.view("owner", "attention", {})["latest_waiting"][0]["ask"]["message_id"], plain)


class RefusingCase(BlockingCase):
    def refused(self, receipt, code):
        self.rejected(receipt, code)
        self.assertEqual(self.sql("SELECT count(*) FROM message_blocks")[0][0], 0)

    def test_it_is_refused_on_a_message_that_does_not_ask_and_nothing_is_sent(self):
        piece = self.committed(self.start())["piece_id"]
        before = self.messages()
        blocks = {"kind": "piece", "ref": piece}
        self.refused(self.command("message.post", {"body": "It is done.", "addressees": ["owner"], "intent": "tell", "blocks": blocks},
                                  {"topic_id": "t1"}, actor="agent-a"), "BLOCKS_NEEDS_ASK")
        self.refused(self.command("message.post", {"body": "To everyone.", "blocks": blocks}, {"topic_id": "t1"}, actor="agent-a"),
                     "BLOCKS_NEEDS_ASK")
        self.assertEqual(self.messages(), before, "nothing was sent")
        self.assertIn("Only an ask holds work", self.ask(blocks=blocks, intent="tell")["error"]["message"])

    def test_it_is_refused_unless_it_names_a_piece_being_built_or_the_release_of_the_topics_outcome(self):
        piece = self.committed(self.start())["piece_id"]
        before = self.messages()
        self.refused(self.ask(blocks={"kind": "piece", "ref": "p-" + "0" * 32}), "BLOCKS_UNKNOWN")
        self.refused(self.ask(blocks={"kind": "release", "ref": 1}), "BLOCKS_UNKNOWN")
        for shape in ({"kind": "item", "ref": 1}, {"kind": "piece"}, {"kind": "release", "ref": "next"}, "release:1"):
            self.refused(self.ask(blocks=shape), "INVALID_ARGUMENT")
        # A piece being built in another outcome is not this outcome's.
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Elsewhere", "purpose": "Another outcome", "team": ["agent-a"]}))
        source = {"kind": "new_topic", "id": "opening-t9", "workspace_id": "w2"}
        self.committed(self.save_draft("draft-t9", source, "t9", "Opening", opening={"workspace_id": "w2", "title": "There", "participants": ["agent-a"]}))
        self.committed(self.prepare("draft-t9", "t9", submission="sub-t9", send_op="open-t9"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "sub-t9"}, target={"topic_id": "t9"}, op="open-t9"))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w2"}, {"pipeline_revision": 0}))
        self.committed(self.command("pipeline.item_add", {"title": "There", "section": "now", "sources": [{"note": "a test"}]}, {"workspace_id": "w2"}))
        number = self.store.view("owner", "pipeline", {"workspace_id": "w2", "section": "now"})["items"][0]["number"]
        revision = self.store.view("owner", "pipeline", {"workspace_id": "w2", "limit": 1})["pipeline"]["version"]
        self.committed(self.command("pipeline.stages_set", {"stages": [{"stage_id": "build", "name": "Build"}]}, {"workspace_id": "w2"},
                                    {"pipeline_revision": revision}))
        elsewhere = self.committed(self.command("pipeline.piece_start", {"numbers": [number], "topic_id": "t9", "stage_id": "build", "size": "small"},
                                                {"workspace_id": "w2"}))["piece_id"]
        before = self.messages()
        self.refused(self.ask(blocks={"kind": "piece", "ref": elsewhere}), "BLOCKS_UNKNOWN")
        # A piece that finished holds nothing more.
        self.committed(self.command("pipeline.piece_finish", {}, {"piece_id": piece}))
        self.refused(self.ask(blocks={"kind": "piece", "ref": piece}), "BLOCKS_UNKNOWN")
        self.assertEqual(self.messages(), before, "nothing was sent")
        # The same ask, naming what it may, goes; there too, so the refusals above are about the reference alone.
        self.assertEqual(self.ask(blocks={"kind": "piece", "ref": elsewhere}, topic="t9")["status"], "committed")

    def test_a_release_other_than_the_one_being_put_together_is_refused(self):
        self.release_stages(*test_pipeline_stages.STAGES[:3], self.CHECKS)
        first = self.committed(self.start(stage="wait"))["piece_id"]
        refused = self.ask(blocks={"kind": "release", "ref": 23})
        self.refused(refused, "BLOCKS_UNKNOWN")
        self.assertIn("none is", refused["error"]["message"])
        self.committed(self.combine([first]))
        refused = self.ask(blocks={"kind": "release", "ref": 24})
        self.refused(refused, "BLOCKS_UNKNOWN")
        self.assertIn("release 23 is", refused["error"]["message"])
        self.assertEqual(self.ask(blocks={"kind": "release", "ref": 23})["status"], "committed")


class ClearingCase(BlockingCase):
    def setUp(self):
        super().setUp()
        self.piece = self.committed(self.start())["piece_id"]

    def test_a_reply_in_the_topic_clears_it_everywhere_and_someone_elses_does_not(self):
        held = self.asked("Please restart fseventsd.", blocks={"kind": "piece", "ref": self.piece})
        self.post("Still on it.", actor="agent-b")
        self.assertEqual(self.blocking(), [(held, {"kind": "piece", "piece_id": self.piece, "items": [1, 2]})], "another's writing answers nothing")
        self.assertEqual(len(self.held(self.piece)), 1)
        self.post("Restarted.", actor="owner")
        self.shows_nothing_held(self.piece)
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 0, "the topic's wait cleared in the same act")
        # A later plain ask makes the topic wait on them again; the answered one still holds nothing.
        self.asked("Anything else to restart?")
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 1)
        self.shows_nothing_held(self.piece)

    def test_a_thumbs_up_on_it_clears_it_and_taking_it_back_puts_it_back(self):
        plain = self.asked("Which colour for the header?")
        held = self.asked("Please restart fseventsd.", blocks={"kind": "piece", "ref": self.piece})
        # A 👍 on the other ask answers that one alone.
        self.thumb(plain)
        self.assertEqual([message for message, _ in self.blocking()], [held])
        self.assertEqual(len(self.held(self.piece)), 1)
        self.thumb(held)
        self.shows_nothing_held(self.piece)
        self.thumb(held, on=False)
        self.assertEqual([message for message, _ in self.blocking()], [held], "taking the 👍 back puts it back")
        self.assertEqual(self.held(self.piece), [(held, ["owner"], "Please restart fseventsd.")])
        self.assertEqual(self.light()["light"]["short"]["blocking"], "piece")

    def test_a_thumbs_up_on_it_clears_it_while_a_later_ask_still_waits(self):
        held = self.asked("Please restart fseventsd.", blocks={"kind": "piece", "ref": self.piece})
        self.asked("Which colour for the header?")
        self.thumb(held)
        self.shows_nothing_held(self.piece)
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 1, "the later question still waits")
        self.assertEqual(self.light()["light"]["short"], {"kind": "asks", "count": 1})

    def archive(self, archived=True, topic="t1"):
        version = self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]
        self.committed(self.command("topic.update", {"archived": archived}, target={"topic_id": topic}, expected={"topic_revision": version}))

    def test_archiving_its_topic_takes_it_off_every_reader_and_unarchiving_brings_it_back(self):
        # Archiving answers nothing, but an archived topic counts nowhere (docs/attention.md): not in Waiting on
        # you, not on the light, and not on the pipeline's row either, so the three never disagree.
        held = self.asked("Please restart fseventsd.", blocks={"kind": "piece", "ref": self.piece})
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 1)
        self.archive()
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 0)
        self.shows_nothing_held(self.piece)
        self.archive(False)
        self.assertEqual([message for message, _ in self.blocking()], [held], "unarchived, it holds the piece again")
        self.assertEqual(self.held(self.piece), [(held, ["owner"], "Please restart fseventsd.")])
        self.assertEqual(self.light()["light"]["short"]["blocking"], "piece")

    def test_an_ask_to_two_waits_on_whoever_has_not_answered(self):
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        held = self.asked("Please both look.", blocks={"kind": "piece", "ref": self.piece}, to=("owner", "other-reader"))
        self.assertEqual(self.held(self.piece), [(held, ["owner", "other-reader"], "Please both look.")])
        self.post("Looked.", actor="owner")
        self.assertEqual(self.held(self.piece), [(held, ["other-reader"], "Please both look.")])
        self.assertEqual(self.blocking(), [])
        self.assertEqual([message for message, _ in self.blocking("other-reader")], [held])

    def test_it_holds_everywhere_while_the_wait_moves_on_to_a_newer_wording_the_owner_is_asked_about(self):
        # A newer held ask (a target wording proposed to the owner, D8) can take over the topic's wait from an older one
        # while the blocking ask between them is still unanswered; that ask still holds the piece in all three places.
        self.committed(self.propose("First words."))
        self.committed(self.propose("Other words.", ask={"topic_id": "t1", "body": "Use these words?"}))
        held = self.asked("Please restart fseventsd.", blocks={"kind": "piece", "ref": self.piece})
        self.agree(self.piece, [held])
        newer = self.committed(self.propose("Third words.", ask={"topic_id": "t1", "body": "Or these?"}))["ask_message_id"]
        self.assertEqual(self.sql("SELECT ask_message_id FROM topic_waiting WHERE topic_id='t1' AND actor_id='owner'"), [(newer,)],
                         "the wait moved on to the newer wording's ask")
        self.agree(self.piece, [held])
        # Answering it clears it everywhere; the wording still waits on the owner, holding nothing.
        self.thumb(held)
        self.agree(self.piece, [])
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 1)
        self.thumb(held, on=False)
        self.agree(self.piece, [held])
        self.post("Restarted.", actor="owner")
        self.agree(self.piece, [])


class FirstLineCase(unittest.TestCase):
    def test_the_first_line_with_words_on_one_line_cut_with_an_ellipsis(self):
        self.assertEqual(first_line("\n\n  Restart   fseventsd \nthen run it"), "Restart fseventsd")
        self.assertEqual(first_line(""), "")
        self.assertEqual(first_line("x" * 200), "x" * 159 + "…")


if __name__ == "__main__":
    unittest.main()
