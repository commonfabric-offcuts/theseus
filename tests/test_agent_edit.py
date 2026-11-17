from __future__ import annotations

"""An agent edits its own words (item 614, docs/message-edit.md, "An agent's edit").

The fixture is test_message_edit's: owner (a person) owns w1, with agent-a and agent-b on its team; t1 has owner and
agent-a taking part. Here other-reader, a second person, joins the team and the topic, so two people are sent each
message posted to the topic. agent-a writes "Built on release 85, the checks are green." and a minute later corrects
it to release 86, by editing it: one message, never a second. owner had read the first words and sees them struck
through beside the new ones, and the message is unread for owner again; other-reader had not read it, and sees only
the new words.
"""

import json
import unittest

from aim_next import hosted_notice, message_edit
import test_agent_verbs
import test_message_edit


FIRST = "Built on release 85, the checks are green."
FIXED = "Built on release 86, the checks are green."
# Where "85" stood: just before "86" in the new words, counted as a page counts its text.
AT = len("Built on release ")


class AgentEditCase(test_message_edit.EditCase):
    def setUp(self):
        super().setUp()
        self.member("other-reader", True)
        self.participation("other-reader", True)
        # Nothing earlier waits on anyone, so every count below is this message's.
        for row in self.sql("SELECT id,recipient_id FROM deliveries WHERE state='pending'"):
            self.committed(self.command("delivery.ack", {}, target={"delivery_id": row[0]}, actor=row[1]))

    def posted(self, body=FIRST, actor="agent-a", **args):
        return self.post(body, actor=actor, **args)

    def read_through(self, actor, message):
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (message,))[0][0]
        self.committed(self.command("topic.read_through", {"seq": seq}, target={"topic_id": "t1"}, actor=actor))

    def state(self, actor, message):
        return self.sql("SELECT state FROM deliveries WHERE message_id=? AND recipient_id=? AND revision=1", (message, actor))[0][0]

    def unread(self, actor):
        page = self.store.view(actor, "workspace_topics", {"workspace_id": "w1"})
        self.assertNotIn("error", page, page)
        return {item["id"]: item["unread"] for item in page["items"]}.get("t1")

    def people_rows(self, message):
        return self.sql("SELECT e.actor_id,e.revision FROM message_exposures e JOIN actors a ON a.id=e.actor_id "
                        "WHERE a.kind='human' AND e.message_id=? ORDER BY e.actor_id", (message,))


class AcceptanceCase(AgentEditCase):
    """Tony's screenshot: the agent's correction is one message, struck through for the reader who had read it."""

    def test_an_agents_correction_is_one_message_struck_for_the_reader_who_read_it_and_whole_for_the_one_who_had_not(self):
        message = self.posted()
        self.read_through("owner", message)
        self.assertEqual((self.state("owner", message), self.state("other-reader", message)), ("acknowledged", "pending"))
        before = {actor: self.unread(actor) for actor in ("owner", "other-reader")}
        count = self.sql("SELECT count(*) FROM messages WHERE topic_id='t1'")
        result = self.committed(self.edit(message, FIXED, actor="agent-a"))
        self.assertEqual((result["revision"], result["unread_again"]), (2, 1), "owner had read it; other-reader had not")
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE topic_id='t1'"), count, "no second message")
        # owner: the old words struck through where they stood, beside the new ones, on the one message.
        mine = self.item(message, actor="owner")
        self.assertEqual((mine["body"], mine["revision"], mine["struck"]), (FIXED, 2, {"revision": 1, "cuts": [{"at": AT, "words": "85"}]}))
        source = self.source({"kind": "message", "id": message}, actor="owner")
        self.assertEqual((source["body"], source["struck"]), (FIXED, {"revision": 1, "cuts": [{"at": AT, "words": "85"}]}))
        # other-reader: only the new words, no strike and no trace of the old ones.
        theirs = self.item(message, actor="other-reader")
        self.assertEqual((theirs["body"], theirs["struck"]), (FIXED, None))
        self.assertNotIn("85", json.dumps(theirs))
        self.assertIsNone(self.source({"kind": "message", "id": message}, actor="other-reader")["struck"])
        # The message is unread for owner again, as new; other-reader's count is as it was (it was unread already).
        self.assertEqual(self.state("owner", message), "pending")
        self.assertEqual(self.unread("owner"), (before["owner"] or 0) + 1)
        self.assertEqual(self.unread("other-reader"), before["other-reader"])
        self.assertEqual(mine["unread"], True)
        self.assertEqual(self.people_rows(message), [("owner", 1)], "Core keeps what owner had read, and nothing for other-reader")
        # Every reader is told, as a person's edit tells them.
        self.assertEqual(self.told(message), [("agent-a", 2), ("agent-b", 2), ("other-reader", 2), ("owner", 2)])

    def test_reading_it_again_keeps_the_strike_and_a_later_edit_strikes_from_what_was_read_last(self):
        message = self.posted()
        self.read_through("owner", message)
        self.committed(self.edit(message, FIXED, actor="agent-a"))
        self.read_through("owner", message)
        self.assertEqual(self.state("owner", message), "acknowledged")
        self.assertEqual(self.item(message, actor="owner")["struck"], {"revision": 1, "cuts": [{"at": AT, "words": "85"}]},
                         "what owner saw stays struck once read")
        # owner read revision 2; the third words take "green" away: struck from revision 2, and unread again.
        self.committed(self.edit(message, "Built on release 86, the checks are running.", revision=2, actor="agent-a"))
        self.assertEqual(self.item(message, actor="owner")["struck"],
                         {"revision": 2, "cuts": [{"at": len("Built on release 86, the checks are "), "words": "green"}]})
        self.assertEqual(self.state("owner", message), "pending")
        # other-reader read none of them: still nothing struck.
        self.assertIsNone(self.item(message, actor="other-reader")["struck"])

    def test_an_unread_message_edited_twice_strikes_from_the_words_last_read(self):
        message = self.posted()
        self.read_through("owner", message)
        self.committed(self.edit(message, FIXED, actor="agent-a"))
        # owner has not read revision 2 when revision 3 comes: what they read is still revision 1.
        self.committed(self.edit(message, "Built on release 87, the checks are green.", revision=2, actor="agent-a"))
        self.assertEqual(self.item(message, actor="owner")["struck"], {"revision": 1, "cuts": [{"at": AT, "words": "85"}]})
        self.assertEqual(self.item(message, actor="owner")["body"], "Built on release 87, the checks are green.")
        self.assertEqual(self.people_rows(message), [("owner", 1)])

    def test_words_only_added_strike_nothing_and_still_make_it_unread(self):
        message = self.posted()
        self.read_through("owner", message)
        self.committed(self.edit(message, FIRST + " Deployed.", actor="agent-a"))
        self.assertIsNone(self.item(message, actor="owner")["struck"], "nothing the reader read is gone")
        self.assertEqual(self.state("owner", message), "pending", "the words changed, so it is new to them")


class AgentExposureCase(AgentEditCase):
    """An agent's edit corrects exactly the agents that were handed its old words, as a person's does."""

    def corrected(self, agent, message):
        return [row[2:] for row in self.corrections(agent, message)]

    def test_an_agent_that_read_it_is_corrected_and_one_that_did_not_is_not(self):
        message = self.posted()
        self.saw("agent-b", message)
        self.assertEqual(self.sql("SELECT actor_id,revision FROM message_exposures WHERE message_id=?", (message,)), [("agent-b", 1)],
                         "an agent's read of another agent's words is recorded")
        result = self.committed(self.edit(message, FIXED, actor="agent-a"))
        self.assertEqual(result["corrections"], 1)
        self.assertEqual(self.corrected("agent-b", message), [(2, "pending")])
        self.assertEqual(self.corrected("agent-a", message), [], "never the editor")
        self.assertEqual(self.corrected("outsider", message), [])

    def test_an_agents_read_of_its_own_message_records_nothing(self):
        message = self.posted()
        self.saw("agent-a", message)
        self.assertEqual(self.sql("SELECT count(*) FROM message_exposures WHERE message_id=?", (message,)), [(0,)])

    def test_an_agents_message_from_before_the_record_counts_as_handed_to_every_agent_reader(self):
        message = self.posted()
        # As a store where this message was posted before the release that records agents' messages: the first post
        # after it set the key above this message.
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (message,))[0][0]
        self.sql("UPDATE metadata SET value=? WHERE key=?", (str(seq + 1), message_edit.AGENT_FROM_KEY))
        self.saw("agent-b", message)
        self.assertEqual(self.sql("SELECT count(*) FROM message_exposures WHERE message_id=?", (message,)), [(0,)], "nothing to record")
        self.committed(self.edit(message, FIXED, actor="agent-a"))
        self.assertEqual(self.corrected("agent-b", message), [(2, "pending")], "handed already, so corrected")

    def test_the_first_post_records_where_agents_messages_begin_and_no_later_post_moves_it(self):
        self.sql("DELETE FROM metadata WHERE key=?", (message_edit.AGENT_FROM_KEY,))
        first = self.posted()
        self.posted("Another line.")
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (first,))[0][0]
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key=?", (message_edit.AGENT_FROM_KEY,)), [(str(seq),)])


class AgentEditRefusalCase(AgentEditCase):
    """Negatives: another's message, a stale revision, the same words, an edit session, and a person's edit as before."""

    def records(self):
        return (self.sql("SELECT * FROM message_revisions ORDER BY message_id,revision"), self.sql("SELECT id,state FROM deliveries ORDER BY seq"),
                self.sql("SELECT * FROM message_exposures ORDER BY actor_id,message_id"))

    def test_an_agent_editing_anothers_message_is_refused_and_nothing_changes(self):
        message = self.posted()
        mine = self.post("The owner's own words.")
        self.read_through("owner", message)
        before = self.records()
        for target, body in ((message, FIXED), (mine, "Not mine to change.")):
            with self.subTest(target=target):
                refused = self.edit(target, body, actor="agent-b")
                self.assertEqual((refused.get("error", {}).get("code"), refused.get("error", {}).get("message")),
                                 ("FORBIDDEN", "Only whoever wrote a message edits it"))
        self.assertEqual(self.records(), before)

    def test_a_stale_expected_revision_is_refused_and_names_the_current_one(self):
        message = self.posted()
        self.committed(self.edit(message, FIXED, actor="agent-a"))
        self.read_through("owner", message)
        before = self.records()
        stale = self.edit(message, "Built on release 87, the checks are green.", revision=1, actor="agent-a")
        self.assertEqual((stale.get("error", {}).get("code"), stale.get("error", {}).get("current_versions")),
                         ("REVISION_CONFLICT", {"message_revision": 2}))
        self.assertEqual(self.records(), before)
        self.assertEqual(self.state("owner", message), "acknowledged", "nothing is unread again")

    def test_the_same_words_change_nothing(self):
        message = self.posted()
        self.read_through("owner", message)
        before = self.records()
        same = self.edit(message, FIRST, actor="agent-a")
        self.assertEqual((same.get("error", {}).get("code"), same["recorded"]), ("INVALID_ARGUMENT", False))
        self.assertEqual(self.records(), before)
        self.assertIsNone(self.item(message, actor="owner")["struck"])

    def test_an_agent_opens_no_edit_session(self):
        message = self.posted()
        refused = self.command("message.edit_open", {"holder": "h-agent"}, target={"message_id": message}, actor="agent-a")
        self.assertEqual((refused.get("error", {}).get("code"), refused.get("error", {}).get("message")), ("FORBIDDEN", message_edit.ONLY_PEOPLE))
        self.assertEqual(self.sql("SELECT count(*) FROM message_edit_sessions"), [(0,)])

    def test_a_persons_edit_behaves_as_before_nothing_struck_nothing_unread(self):
        message = self.post(FIRST)
        self.read_through("other-reader", message)
        result = self.committed(self.edit(message, FIXED))
        self.assertEqual(result["unread_again"], 0)
        self.assertEqual(self.state("other-reader", message), "acknowledged")
        self.assertIsNone(self.item(message, actor="other-reader")["struck"])
        self.assertEqual(self.people_rows(message), [])

    def test_a_message_between_others_is_never_unread_again(self):
        # agent-a tells agent-b: each person's delivery was settled when it was sent, never read.
        message = self.posted(addressees=["agent-b"], intent="tell")
        self.assertEqual(self.state("owner", message), "acknowledged")
        self.committed(self.edit(message, FIXED, actor="agent-a"))
        self.assertEqual((self.state("owner", message), self.item(message, actor="owner")["struck"], self.people_rows(message)),
                         ("acknowledged", None, []))

    def test_a_card_excerpt_strikes_only_what_it_shows_and_the_whole_message_strikes_all(self):
        tail = " More detail follows." * 80
        message = self.posted(FIRST + tail + " Ends on 85.")
        self.read_through("owner", message)
        self.committed(self.edit(message, FIXED + tail + " Ends on 86.", actor="agent-a"))
        item = self.item(message, actor="owner")
        self.assertTrue(item["preview"])
        self.assertEqual(item["struck"]["cuts"], [{"at": AT, "words": "85"}], "the change past the excerpt is not drawn there")
        whole = self.source({"kind": "message", "id": message}, actor="owner")["struck"]["cuts"]
        self.assertEqual(whole, [{"at": AT, "words": "85"}, {"at": len(FIXED + tail + " Ends on "), "words": "85"}])


class StruckWordsCase(unittest.TestCase):
    """message_edit.struck_words: where each run of words a reader read and the new words no longer hold stood."""

    def test_words_replaced_removed_added_and_respaced(self):
        cases = [
            ("release 85 today", "release 86 today", [{"at": 8, "words": "85"}]),
            ("ship it at 5 today", "ship it today", [{"at": 8, "words": "at 5"}]),
            ("ship it", "ship it now", []),
            ("ship  it", "ship it", []),
            ("release 85, green", "release 86, green", [{"at": 8, "words": "85"}]),
            ("can't stop", "cannot stop", [{"at": 0, "words": "can't"}]),
            ("one two three", "uno two tres", [{"at": 0, "words": "one"}, {"at": 8, "words": "three"}]),
            ("", "words", []),
            ("words", "", [{"at": 0, "words": "words"}]),
        ]
        for old, new, cuts in cases:
            with self.subTest(old=old, new=new):
                self.assertEqual(message_edit.struck_words(old, new), cuts)

    def test_places_count_utf16_units_as_a_page_does(self):
        # 🚀 is two UTF-16 units: "86" starts at 5 in the page's text, where a count of code points says 4.
        self.assertEqual(message_edit.struck_words("🚀 v 85", "🚀 v 86"), [{"at": 5, "words": "85"}])

    def test_a_long_rewrite_is_bounded(self):
        old = " ".join("w%d" % n for n in range(2000))
        new = " ".join("x%d" % n for n in range(2000))
        cuts = message_edit.struck_words(old, new)
        self.assertEqual(len(cuts), 1)
        self.assertEqual(len(cuts[0]["words"]), message_edit.STRUCK_CHARS + 1)


class BriefCase(unittest.TestCase):
    """The hosted agent's brief names the verb and the rule (docs/agent-guide.md)."""

    def test_the_brief_says_a_correction_to_ones_own_words_is_an_edit(self):
        words = " ".join(hosted_notice.developer_instructions("agent-x", "aim-next", "/abs/agent-x.json").split())
        self.assertIn("edit MESSAGE --expected N - fix words you wrote, in place: a correction to your own words is an edit of them, "
                      "not a follow-up message", words)
        self.assertIn("A correction says its author edited a message you were sent", words)


class EditVerbCase(test_agent_verbs.AgentVerbCase):
    """`edit MESSAGE --expected N TEXT|-` (docs/agent-cli.md)."""

    def posted(self):
        code, out, err = self.run_cli("post", "t1", FIRST)
        self.assertEqual((code, err), (0, ""))
        return out.split()[1]

    def test_edit_saves_new_words_in_place_as_one_message(self):
        message = self.posted()
        count = self.sql("SELECT count(*) FROM messages")
        code, out, err = self.run_cli("edit", message, "--expected", "1", FIXED)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, "edited %s to revision 2 (corrections: 0; unread again: 0)\n" % message)
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), count, "no second message")
        code, out, _ = self.run_cli("read", "t1")
        self.assertIn("%s agent-a (edited, revision 2)\n  %s\n" % (message, FIXED), out)
        # From stdin, fenced on the revision read.
        code, out, err = self.run_cli("edit", message, "--expected", "2", "-", stdin="Built on release 87.".encode("utf-8"))
        self.assertEqual((code, err), (0, ""))
        self.assertIn("to revision 3", out)

    def test_edit_refuses_a_stale_revision_anothers_message_and_no_revision(self):
        message = self.posted()
        self.assertEqual(self.run_cli("edit", message, "--expected", "1", FIXED)[0], 0)
        code, out, err = self.run_cli("edit", message, "--expected", "1", "Built on release 87.")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("REVISION_CONFLICT", err)
        code, out, err = self.run_cli("edit", message, "--expected", "2", "Not mine.", actor="agent-b")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        code, out, err = self.run_cli("edit", message, FIXED)
        self.assertEqual((code, out), (2, ""))
        self.assertEqual(self.sql("SELECT max(revision) FROM message_revisions WHERE message_id=?", (message,)), [(2,)])


if __name__ == "__main__":
    unittest.main()
