from __future__ import annotations

"""What people record about messages as they read a topic in reply stacks, in Core (docs/reply-stacks.md).

The fixture outcome w1 is owned by owner, with agent-a and agent-b on its team;
its topic t1 has owner and agent-a taking part. other-reader and outsider are on
no team and read nothing there. Stars, a stack dealt with and a stack's place are
the reader's own; a stack's short name and its joins are the topic's, with who
did them. Each act is a new row, fenced on the revision its sender read.
"""

import json
import sqlite3
import unittest

import reader_fixture as fixtures


class StackCase(fixtures.ReaderCase):
    def post(self, body="Words", actor="agent-a", topic="t1", **args):
        return self.committed(self.command("message.post", dict({"body": body}, **args), target={"topic_id": topic}, actor=actor))["message_id"]

    def act(self, kind, message, args, revision=0, actor="owner", op=None):
        name = {"message.star": "star_revision", "message.deal": "deal_revision", "message.fold": "fold_revision",
                "stack.place": "place_revision", "stack.name": "name_revision", "stack.join": "join_revision"}[kind]
        return self.command(kind, args, target={"message_id": message}, expected={name: revision}, actor=actor, op=op)

    def star(self, message, on=True, revision=0, actor="owner", op=None):
        return self.act("message.star", message, {"starred": on}, revision, actor, op)

    def fold(self, message, on=True, revision=0, actor="owner", op=None):
        return self.act("message.fold", message, {"folded": on}, revision, actor, op)

    def name(self, message, text, revision=0, actor="owner"):
        return self.act("stack.name", message, {"name": text}, revision, actor)

    def join(self, message, into, revision=0, actor="owner"):
        return self.act("stack.join", message, {"into": into}, revision, actor)

    def acts(self, message, actor="owner", topic="t1"):
        """The message's `acts` as the reader's page of the topic carries them."""
        page = self.store.view(actor, "topic_messages", {"topic_id": topic, "direction": "before", "limit": 100})
        self.assertNotIn("error", page, page)
        return next(item["acts"] for item in page["items"] if item["id"] == message)

    def told(self, topic="t1"):
        """Who was sent an `acts` change for the topic, and in which scopes."""
        return sorted({tuple(row) for row in self.sql("SELECT scope_kind,scope_id FROM changes WHERE resource_kind='acts' AND resource_id=?", (topic,))})

    def rows(self, kind):
        return self.sql("SELECT message_id,owner,actor_id,value,revision FROM message_acts WHERE kind=? ORDER BY id", (kind,))


class StarCase(StackCase):
    def test_a_star_is_the_readers_own_held_in_core_and_no_one_else_sees_it(self):
        message = self.post()
        starred = self.committed(self.star(message))
        self.assertEqual((starred["starred"], starred["star_revision"], starred["changed"]), (True, 1, True))
        self.assertEqual((self.acts(message)["starred"], self.acts(message)["star_revision"]), (True, 1))
        self.assertEqual((self.acts(message, actor="agent-a")["starred"], self.acts(message, actor="agent-a")["star_revision"]), (False, 0),
                         "another reader of the topic sees no star and no revision of it")
        self.assertEqual([item["message_id"] for item in self.store.view("owner", "stars", {})["items"]], [message])
        self.assertEqual(self.store.view("agent-a", "stars", {})["items"], [], "and lists none")
        # agent-a's own star is its own: owner's stays as it was.
        self.committed(self.star(message, actor="agent-a"))
        self.assertEqual((self.acts(message)["star_revision"], self.acts(message, actor="agent-a")["star_revision"]), (1, 1))
        self.assertEqual(self.told(), [("actor", "agent-a"), ("actor", "owner")], "each told only of their own star")
        unstarred = self.committed(self.star(message, on=False, revision=1))
        self.assertEqual((unstarred["starred"], unstarred["star_revision"]), (False, 2))
        self.assertEqual(self.store.view("owner", "stars", {})["items"], [])
        self.assertEqual(self.acts(message, actor="agent-a")["starred"], True, "taking owner's back leaves agent-a's")
        self.assertEqual([row[4] for row in self.rows("star") if row[1] == "owner"], [1, 2], "every act is a new row")

    def test_a_reader_stars_their_own_message_too_and_the_stars_list_says_where_each_is(self):
        mine = self.post("My own note", actor="owner")
        self.committed(self.star(mine))
        listed = self.store.view("owner", "stars", {})["items"]
        self.assertEqual([(item["message_id"], item["topic_id"], item["topic_title"], item["author_id"], item["excerpt"], item["conversation"])
                          for item in listed], [(mine, "t1", "Topic", "owner", "My own note", False)])

    def test_a_star_is_fenced_on_its_revision_and_a_retry_answers_what_was_recorded(self):
        message = self.post()
        first = self.star(message, op="star-once")
        self.assertEqual(self.star(message, op="star-once"), first, "the same operation is answered with what it recorded")
        conflict = self.star(message, on=False, revision=0)
        self.rejected(conflict, "REVISION_CONFLICT")
        self.assertEqual(conflict["error"]["current_versions"], {"star_revision": 1})
        again = self.committed(self.star(message, revision=1))
        self.assertEqual((again["star_revision"], again["changed"]), (1, False), "starring a starred message changes nothing")
        self.assertEqual(len(self.rows("star")), 1)

    def test_a_star_names_one_message_and_whether_it_is_starred(self):
        message = self.post()
        for args in ({}, {"starred": "yes"}, {"starred": True, "note": "x"}):
            self.rejected(self.act("message.star", message, args), "INVALID_ARGUMENT")
        self.rejected(self.command("message.star", {"starred": True}, target={"message_id": message}), "INVALID_ARGUMENT")
        self.rejected(self.command("message.star", {"starred": True}, target={"message_id": message, "topic_id": "t1"},
                                   expected={"star_revision": 0}), "INVALID_ARGUMENT")
        self.assertEqual(self.rows("star"), [])

    def test_a_reader_who_cannot_see_a_message_cannot_act_on_it_and_hears_nothing_of_it(self):
        message = self.post()
        asked = self.post("Between us?", actor="owner", addressees=["agent-a"], whisper=True)
        whisper = self.post("Between us", addressees=["owner"], whisper=True, reply_to=asked)
        for kind, args in (("message.star", {"starred": True}), ("message.deal", {"dealt": True}), ("message.fold", {"folded": True}), ("stack.place", {"key": 3}),
                           ("stack.name", {"name": "Ours"}), ("stack.join", {"into": None})):
            self.rejected(self.act(kind, message, args, actor="other-reader"), "FORBIDDEN")
            self.rejected(self.act(kind, whisper, args, actor="agent-b"), "FORBIDDEN")
            self.rejected(self.act(kind, "m-unknown", args), "FORBIDDEN")
        self.assertEqual(self.sql("SELECT count(*) FROM message_acts"), [(0,)])
        self.rejected(self.store.view("other-reader", "message_acts", {"topic_id": "t1"}) | {"status": "x"}, "FORBIDDEN")
        # A star made while the reader could read it is not listed once they cannot.
        self.committed(self.star(message, actor="agent-b"))
        self.assertEqual(len(self.store.view("agent-b", "stars", {})["items"]), 1)
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-b", "present": False}, {"workspace_id": "w1"},
                                    {"workspace_revision": self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]}))
        self.assertEqual(self.store.view("agent-b", "stars", {})["items"], [])


class FoldCase(StackCase):
    def test_a_fold_is_the_readers_own_held_in_core_and_no_one_elses_view_changes(self):
        message = self.post()
        folded = self.committed(self.fold(message))
        self.assertEqual((folded["folded"], folded["fold_revision"], folded["changed"]), (True, 1, True))
        self.assertEqual((self.acts(message)["folded"], self.acts(message)["fold_revision"]), (True, 1), "the reader's page reads it folded")
        theirs = self.acts(message, actor="agent-a")
        self.assertEqual((theirs["folded"], theirs["fold_revision"]), (False, 0), "another reader of the topic sees it as it was")
        self.assertEqual(self.store.view("agent-a", "message_acts", {"topic_id": "t1"})["items"], [], "and has no act on it to read")
        self.assertEqual(self.told(), [("actor", "owner")], "only the reader is told")
        # agent-a's own fold is its own: owner's stays as it was.
        self.committed(self.fold(message, actor="agent-a"))
        self.assertEqual((self.acts(message)["fold_revision"], self.acts(message, actor="agent-a")["fold_revision"]), (1, 1))
        unfolded = self.committed(self.fold(message, on=False, revision=1))
        self.assertEqual((unfolded["folded"], unfolded["fold_revision"]), (False, 2))
        self.assertEqual(self.acts(message)["folded"], False)
        self.assertEqual(self.acts(message, actor="agent-a")["folded"], True, "unfolding owner's leaves agent-a's")
        self.assertEqual([row[4] for row in self.rows("fold") if row[1] == "owner"], [1, 2], "every act is a new row")
        # A fold leaves the reader's star, and every other act, as it was.
        self.assertEqual((self.acts(message)["starred"], self.acts(message)["star_revision"]), (False, 0))

    def test_a_fold_is_fenced_on_its_revision_and_a_retry_answers_what_was_recorded(self):
        message = self.post()
        first = self.fold(message, op="fold-once")
        self.assertEqual(self.fold(message, op="fold-once"), first, "the same operation is answered with what it recorded")
        conflict = self.fold(message, on=False, revision=0)
        self.rejected(conflict, "REVISION_CONFLICT")
        self.assertEqual(conflict["error"]["current_versions"], {"fold_revision": 1})
        self.assertEqual(self.acts(message)["folded"], True, "a late unfold undoes nothing")
        again = self.committed(self.fold(message, revision=1))
        self.assertEqual((again["fold_revision"], again["changed"]), (1, False), "folding a folded message changes nothing")
        self.assertNotIn("acts_version", again)
        self.assertEqual(len(self.rows("fold")), 1)

    def test_a_fold_names_one_message_and_whether_it_is_folded(self):
        message = self.post()
        for args in ({}, {"folded": "yes"}, {"folded": 1}, {"folded": True, "note": "x"}, {"starred": True}):
            self.rejected(self.act("message.fold", message, args), "INVALID_ARGUMENT")
        self.rejected(self.command("message.fold", {"folded": True}, target={"message_id": message}), "INVALID_ARGUMENT")
        self.rejected(self.command("message.fold", {"folded": True}, target={"message_id": message}, expected={"star_revision": 0}), "INVALID_ARGUMENT")
        self.assertEqual(self.rows("fold"), [])

    def test_a_reader_who_cannot_read_a_message_cannot_fold_it(self):
        message = self.post()
        asked = self.post("Between us?", actor="owner", addressees=["agent-a"], whisper=True)
        self.rejected(self.fold(message, actor="other-reader"), "FORBIDDEN")
        self.rejected(self.fold(asked, actor="agent-b"), "FORBIDDEN")
        self.rejected(self.fold("m-unknown"), "FORBIDDEN")
        self.assertEqual(self.rows("fold"), [])
        self.committed(self.fold(asked, actor="agent-a"))
        self.assertEqual(self.told(), [("actor", "agent-a")], "a whisper's reader folds it for themselves alone")

    def test_a_fold_moves_nothing_in_the_topic_and_saves_in_a_reached_outcome(self):
        head = self.post()
        before = self.sql("SELECT version FROM topics WHERE id='t1'") + self.sql("SELECT version FROM workspaces WHERE id='w1'")
        changes = self.sql("SELECT count(*) FROM changes WHERE scope_kind IN ('topic','workspace','outcome')")
        self.committed(self.fold(head))
        self.assertEqual(self.sql("SELECT version FROM topics WHERE id='t1'") + self.sql("SELECT version FROM workspaces WHERE id='w1'"), before)
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE scope_kind IN ('topic','workspace','outcome')"), changes)
        version = lambda: self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, {"workspace_id": "w1"}, {"workspace_revision": version()}))
        self.committed(self.command("outcome.reach", {"words": "Done", "unmet_confirmed": True}, {"workspace_id": "w1"}, {"workspace_revision": version()}))
        self.committed(self.fold(head, on=False, revision=1))

    def test_the_acts_view_carries_a_fold_for_its_reader_alone(self):
        folded, plain = self.post("Folded"), self.post("Plain")
        self.committed(self.fold(folded))
        page = self.store.view("owner", "message_acts", {"topic_id": "t1"})
        self.assertEqual([(item["message_id"], item["acts"]["folded"], item["acts"]["fold_revision"]) for item in page["items"]], [(folded, True, 1)])
        self.assertEqual(self.acts(plain)["folded"], False)


class PersonalCase(StackCase):
    def test_a_stack_dealt_with_and_its_place_are_the_readers_own(self):
        message = self.post()
        self.committed(self.act("message.deal", message, {"dealt": True}))
        placed = self.committed(self.act("stack.place", message, {"key": 12.5}))
        self.assertEqual((placed["key"], placed["place_revision"]), (12.5, 1))
        mine, theirs = self.acts(message), self.acts(message, actor="agent-a")
        self.assertEqual((mine["dealt"], mine["placed"], mine["deal_revision"], mine["place_revision"]), (True, 12.5, 1, 1))
        self.assertEqual((theirs["dealt"], theirs["placed"], theirs["deal_revision"], theirs["place_revision"]), (False, None, 0, 0),
                         "another reader keeps newest on top and folds as they read")
        # Let new replies move it: the place is taken back, as a new row.
        back = self.committed(self.act("stack.place", message, {"key": None}, revision=1))
        self.assertEqual((back["key"], back["place_revision"]), (None, 2))
        self.assertEqual(self.acts(message)["placed"], None)
        self.assertEqual(self.told(), [("actor", "owner")])

    def test_a_place_is_a_finite_number_within_bounds_or_none(self):
        message = self.post()
        for key in (True, "3", float("inf"), 1e16, [1]):
            self.rejected(self.act("stack.place", message, {"key": key}), "INVALID_ARGUMENT")
        self.rejected(self.act("stack.place", message, {}), "INVALID_ARGUMENT")
        self.committed(self.act("stack.place", message, {"key": -4}))
        self.assertEqual(self.acts(message)["placed"], -4)


class SharedCase(StackCase):
    def test_a_short_name_is_everyones_says_who_typed_it_and_every_rename_is_kept(self):
        head = self.post("Can we lock the cabin for the week of July 12 before Friday?")
        named = self.committed(self.name(head, "  Cabin\n week  ", actor="agent-a"))
        self.assertEqual((named["name"], named["name_revision"]), ("Cabin week", 1), "one line, its spaces made single")
        for reader in ("owner", "agent-a", "agent-b"):
            shown = self.acts(head, actor=reader)
            self.assertEqual((shown["name"]["text"], shown["name"]["by"], shown["name_revision"]), ("Cabin week", "agent-a", 1), reader)
        self.assertEqual(self.told(), [("actor", "agent-a"), ("actor", "agent-b"), ("actor", "owner")], "everyone who reads it is told")
        self.committed(self.name(head, "The cabin", revision=1))
        self.assertEqual(self.acts(head, actor="agent-a")["name"]["by"], "owner")
        cleared = self.committed(self.name(head, "", revision=2))
        self.assertEqual((cleared["name"], self.acts(head)["name"]), ("", None), "cleared, the stack goes back to its first line")
        self.assertEqual([(json.loads(row[3])["name"], row[2], row[4]) for row in self.rows("name")],
                         [("Cabin week", "agent-a", 1), ("The cabin", "owner", 2), ("", "owner", 3)], "every rename is a row of its own, with who")
        stale = self.name(head, "Late", revision=1)
        self.rejected(stale, "REVISION_CONFLICT")
        self.assertEqual(stale["error"]["current_versions"], {"name_revision": 3})
        self.rejected(self.name(head, "x" * 201, revision=3), "INVALID_ARGUMENT")
        self.rejected(self.name(head, 7, revision=3), "INVALID_ARGUMENT")

    def test_a_join_is_everyones_says_who_and_splits_back_out(self):
        first, second, third = self.post("First stack"), self.post("Second stack"), self.post("Third stack", actor="owner")
        joined = self.committed(self.join(second, first, actor="agent-a"))
        self.assertEqual((joined["into"], joined["join_revision"]), (first, 1))
        for reader in ("owner", "agent-b"):
            self.assertEqual({k: v for k, v in self.acts(second, actor=reader)["joined"].items() if k != "at_ms"}, {"into": first, "by": "agent-a"})
        self.committed(self.join(third, second))
        # A stack never joins one inside itself, nor itself, nor another topic's.
        self.rejected(self.join(first, third), "INVALID_ARGUMENT")
        self.rejected(self.join(first, first), "INVALID_ARGUMENT")
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"}))
        reply = self.post("A reply in the second stack", reply_to=second)
        self.rejected(self.join(first, reply), "INVALID_ARGUMENT")
        self.rejected(self.join(first, "m-unknown"), "INVALID_ARGUMENT")
        split = self.committed(self.join(second, None, revision=1))
        self.assertEqual((split["into"], split["join_revision"], self.acts(second)["joined"]), (None, 2, None))
        self.assertEqual(self.acts(third)["joined"]["into"], second, "a stack joined to it stays joined to it")
        self.committed(self.join(first, third))
        self.assertEqual(self.acts(first)["joined"]["into"], third, "split out, it may take the other way round")

    def test_a_join_stays_in_its_topic(self):
        here = self.post("Here")
        source = {"kind": "new_topic", "id": "opening-two", "workspace_id": "w1"}
        self.committed(self.save_draft("opening-two-draft", source, "t2", "Second topic",
                                       opening={"workspace_id": "w1", "title": "Two", "participants": ["agent-a"]}))
        self.committed(self.prepare("opening-two-draft", "t2", submission="opening-two", send_op="open-two"))
        there = self.committed(self.command("topic.create_and_send", {"submission_id": "opening-two"}, target={"topic_id": "t2"}, op="open-two"))["message_id"]
        self.rejected(self.join(here, there), "INVALID_ARGUMENT")

    def test_a_reached_outcome_keeps_its_names_and_joins_while_stars_go_on(self):
        head, other = self.post("Head"), self.post("Other")
        version = lambda: self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, {"workspace_id": "w1"}, {"workspace_revision": version()}))
        self.committed(self.command("outcome.reach", {"words": "Done", "unmet_confirmed": True}, {"workspace_id": "w1"}, {"workspace_revision": version()}))
        self.rejected(self.name(head, "Late name"), "OUTCOME_REACHED")
        self.rejected(self.join(other, head), "OUTCOME_REACHED")
        self.committed(self.star(head))

    def test_nothing_in_the_topic_or_outcome_moves(self):
        head = self.post()
        before = self.sql("SELECT version FROM topics WHERE id='t1'") + self.sql("SELECT version FROM workspaces WHERE id='w1'")
        changes = self.sql("SELECT count(*) FROM changes WHERE scope_kind IN ('topic','workspace','outcome')")
        self.committed(self.name(head, "Named"))
        self.committed(self.star(head))
        self.assertEqual(self.sql("SELECT version FROM topics WHERE id='t1'") + self.sql("SELECT version FROM workspaces WHERE id='w1'"), before)
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE scope_kind IN ('topic','workspace','outcome')"), changes)


class ReadCase(StackCase):
    def test_the_acts_view_pages_the_readers_and_the_topics_acts_newest_first_with_a_version_that_grows(self):
        messages = [self.post("Message %d" % n) for n in range(4)]
        self.committed(self.star(messages[0]))
        self.committed(self.name(messages[2], "Two", actor="agent-a"))
        self.committed(self.star(messages[3], actor="agent-a"))
        page = self.store.view("owner", "message_acts", {"topic_id": "t1", "limit": 1})
        self.assertEqual([item["message_id"] for item in page["items"]], [messages[2]], "agent-a's star is not owner's to read")
        rest = self.store.view("owner", "message_acts", {"topic_id": "t1", "limit": 5, "cursor": page["next_cursor"]})
        self.assertEqual(([item["message_id"] for item in rest["items"]], rest["next_cursor"]), ([messages[0]], None))
        self.assertEqual(rest["items"][0]["acts"]["starred"], True)
        before = page["version"]
        self.committed(self.name(messages[1], "One", actor="agent-a"))
        self.assertGreater(self.store.view("owner", "message_acts", {"topic_id": "t1"})["version"], before)
        theirs = self.store.view("agent-a", "message_acts", {"topic_id": "t1"})
        self.assertEqual(sorted(item["message_id"] for item in theirs["items"]), sorted([messages[1], messages[2], messages[3]]))
        for bad in ({"topic_id": "t1", "cursor": "x"}, {"topic_id": "t1", "limit": 0}, {"topic_id": "t1", "other": 1}):
            self.assertIn("error", self.store.view("owner", "message_acts", bad))

    def test_a_whisper_between_others_carries_no_acts_to_anyone_else(self):
        asked = self.post("Between us?", actor="owner", addressees=["agent-a"], whisper=True)
        self.committed(self.name(asked, "Ours"))
        self.assertEqual(self.store.view("agent-b", "message_acts", {"topic_id": "t1"})["items"], [])
        self.assertEqual(self.told(), [("actor", "agent-a"), ("actor", "owner")], "a whisper's two people only")

    def test_a_row_a_later_core_wrote_with_more_in_it_is_read_for_what_this_core_knows(self):
        message = self.post()
        with sqlite3.connect(str(self.path)) as db:
            seq = db.execute("SELECT seq FROM messages WHERE id=?", (message,)).fetchone()[0]
            for kind, value in (("star", {"starred": True, "colour": "gold"}), ("place", {"key": 4, "anchor": "x"}), ("fold", {"folded": True, "until": "later"}),
                                ("name", {"name": "Later", "suggested_by": "agent-a"}), ("join", {"into": None, "why": "tidy"})):
                db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) VALUES (?,?,?,?,?,?,?,?,1)",
                           (kind, message, "t1", seq, "owner" if kind in ("star", "place", "fold") else "", "owner", json.dumps(value), 1))
        shown = self.acts(message)
        self.assertEqual((shown["starred"], shown["placed"], shown["folded"], shown["name"]["text"], shown["joined"]), (True, 4, True, "Later", None))
        self.assertEqual(set(shown), {"aside", "aside_revision", "starred", "star_revision", "dealt", "deal_revision", "folded", "fold_revision", "placed", "place_revision",
                                      "name", "name_revision", "joined", "join_revision"})
        # And the next act is fenced on it as on any other.
        self.committed(self.name(message, "Typed", revision=1))


if __name__ == "__main__":
    unittest.main()
