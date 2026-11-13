from __future__ import annotations

"""A draft Notebook page (item 391): a person who may write a page marks it a
draft, as a revision of its own. While its latest revision is marked, an agent
listing the Notebook gets its title and that it is a draft, and no agent is
given its words: not in a listing, not by reading the page or any revision of
it (a link to a page is read the same way), not as a quote's source and not
through its attachments. People read and write it as ever. Clearing the mark,
another revision, gives agents the words again."""


from reader_fixture import ReaderCase
import test_agent_verbs
import test_media

TOPIC = {"kind": "topic", "id": "t1"}
WORDS = "The plan nobody should act on yet.\nSecond line."


class DraftCase(ReaderCase):
    # owner, a person, started t1 and takes part in it with agent-a; agent-b
    # is on the outcome's team, and reads t1 without taking part.
    begin, publish, ready, status = test_media.MediaCase.begin, test_media.MediaCase.publish, test_media.MediaCase.ready, test_media.MediaCase.status

    def write(self, revision, draft=None, actor="owner", body=WORDS, item="plan", attachments=(), references=()):
        args = {"title": "The plan", "body": body, "attachments": [{"id": media} for media in attachments], "references": list(references)}
        if draft is not None:
            args["draft"] = draft
        target = {"item_id": item}
        if revision == 0:
            target["owner_scope"] = TOPIC
        return self.command("memory.create" if revision == 0 else "memory.revise", args, target=target,
                            expected={"item_revision": revision}, actor=actor)

    def page(self, actor, revision=None, item="plan"):
        answer = (self.store.view(actor, "memory_current", {"item_id": item}) if revision is None else
                  self.store.view(actor, "source", {"source_ref": {"kind": "memory", "id": item, "revision": revision}}))
        self.assertNotIn("error", answer, answer)
        return answer

    def listed(self, actor, item="plan"):
        answer = self.store.view(actor, "memory_items", {"owner_scope": TOPIC})
        self.assertNotIn("error", answer, answer)
        [found] = [row for row in answer["items"] if row["id"] == item]
        return found

    def drafted(self):
        """A page with words, an attachment and evidence, then marked a draft by its writer: revision 2."""
        self.ready("plan-file", b"An attached plan")
        evidence = {"kind": "message", "id": self.opening["id"]}
        self.committed(self.write(0, attachments=["plan-file"], references=[evidence]))
        marked = self.committed(self.write(1, draft=True, attachments=["plan-file"], references=[evidence]))
        self.assertEqual(marked["revision"], 2, "the mark is a revision of its own")
        return evidence

    def test_agents_listing_the_notebook_get_the_title_and_the_mark_and_never_the_words(self):
        self.drafted()
        for agent in ("agent-a", "agent-b"):
            with self.subTest(agent=agent):
                row = self.listed(agent)
                self.assertEqual((row["title"], row["draft"], row["withheld"], row["body"], row["preview"], row["revision"]),
                                 ("The plan", True, True, "", False, 2))
        # The person who reads it sees it as ever, with the mark.
        row = self.listed("owner")
        self.assertEqual((row["title"], row["draft"], row["withheld"], row["body"]), ("The plan", True, False, WORDS))

    def test_no_read_of_the_page_gives_an_agent_its_words_and_a_person_reads_it_whole(self):
        evidence = self.drafted()
        for agent in ("agent-a", "agent-b"):
            # As it stands, and at each revision, the one from before the mark too; a link to the page is read so.
            for revision in (None, 1, 2):
                with self.subTest(agent=agent, revision=revision):
                    source = self.page(agent, revision)
                    self.assertEqual((source["title"], source["withheld"], source["body"], source["attachments"], source["references"]),
                                     ("The plan", True, "", [], []))
                    self.assertNotIn("nobody", repr(source))
            # Its attachment is not theirs to open through it.
            self.rejected(self.status("plan-file", actor=agent, source_ref={"kind": "memory", "id": "plan", "revision": 2}), "FORBIDDEN")
            # Nor are its words a quote's source: an agent cannot carry them, or test a guess against them.
            self.rejected(self.command("message.post", {"body": "Quoting the draft", "quotes": [
                {"source": {"kind": "memory", "id": "plan", "revision": 1}, "excerpt": "The plan nobody"}]},
                target={"topic_id": "t1"}, actor="agent-a"), "INVALID_QUOTE")
        person = self.page("owner")
        self.assertEqual((person["body"], [item["id"] for item in person["attachments"]], person["references"], person["draft"], person["withheld"]),
                         (WORDS, ["plan-file"], [evidence], True, False))
        self.assertEqual(self.page("owner", 1)["body"], WORDS)
        self.assertEqual(self.status("plan-file", actor="owner", source_ref={"kind": "memory", "id": "plan", "revision": 2})["media_id"], "plan-file")

    def test_clearing_the_mark_gives_agents_the_words_again_and_a_page_never_marked_was_always_theirs(self):
        self.drafted()
        cleared = self.committed(self.write(2, draft=False, attachments=["plan-file"], references=[{"kind": "message", "id": self.opening["id"]}]))
        self.assertEqual(cleared["revision"], 3)
        for revision in (None, 1, 2, 3):
            with self.subTest(revision=revision):
                source = self.page("agent-a", revision)
                self.assertEqual((source["body"], source["withheld"]), (WORDS, False))
        row = self.listed("agent-a")
        self.assertEqual((row["body"], row["draft"], row["withheld"]), (WORDS, False, False))
        self.committed(self.command("message.post", {"body": "Quoting it now", "quotes": [
            {"source": {"kind": "memory", "id": "plan", "revision": 2}, "excerpt": "The plan nobody"}]}, target={"topic_id": "t1"}, actor="agent-a"))
        # Each revision says whether it was marked: the mark and its clearing are both kept.
        self.assertEqual([self.page("owner", n)["draft"] for n in (1, 2, 3)], [False, True, False])
        # A page nobody marked reads as ever.
        self.committed(self.write(0, item="open", body="Open words"))
        self.assertEqual((self.page("agent-a", item="open")["body"], self.listed("agent-a", item="open")["draft"]), ("Open words", False))

    def test_a_revision_that_leaves_the_mark_out_keeps_it_and_the_mark_must_be_true_or_false(self):
        self.drafted()
        self.committed(self.write(2, body=WORDS + "\nMore."))
        self.assertEqual((self.page("owner")["draft"], self.page("agent-a")["body"]), (True, ""))
        for wrong in ("yes", 1, None):
            with self.subTest(draft=wrong):
                receipt = self.command("memory.revise", {"title": "The plan", "body": WORDS, "attachments": [], "references": [], "draft": wrong},
                                       target={"item_id": "plan"}, expected={"item_revision": 3})
                self.rejected(receipt, "INVALID_ARGUMENT")

    def test_only_a_person_marks_or_clears_it_and_no_agent_writes_a_draft_page(self):
        self.committed(self.write(0, actor="agent-a", body="An agent's page"))
        # An agent who may write the Notebook neither marks a page, nor starts one marked.
        self.rejected(self.write(1, draft=True, actor="agent-a", body="An agent's page"), "FORBIDDEN")
        self.rejected(self.write(0, item="agent-draft", draft=True, actor="agent-a"), "FORBIDDEN")
        self.committed(self.write(1, draft=False, actor="agent-a", body="Saying it is no draft is no change"))
        # A person marks it; then no agent writes it or clears its mark, and Core tells them so before they try.
        self.committed(self.write(2, draft=True, body="Saying it is no draft is no change"))
        before = self.sql("SELECT item_id,revision,author_id,body FROM memory_revisions ORDER BY item_id,revision")
        self.assertIs(self.page("agent-a")["reader_may_write"], False)
        self.assertIs(self.page("owner")["reader_may_write"], True)
        self.rejected(self.write(3, actor="agent-a", body="Writing over what I cannot read"), "FORBIDDEN")
        self.rejected(self.write(3, draft=False, actor="agent-a", body="Clearing it myself"), "FORBIDDEN")
        self.assertEqual(self.sql("SELECT item_id,revision,author_id,body FROM memory_revisions ORDER BY item_id,revision"), before)
        # The person clears it, and the agent writes it again.
        self.committed(self.write(3, draft=False, body="Cleared"))
        self.assertIs(self.page("agent-a")["reader_may_write"], True)
        self.committed(self.write(4, actor="agent-a", body="The agent's next revision"))
        self.assertEqual(self.page("owner")["draft"], False, "an agent's revision keeps the page as it was")


class DraftCLICase(test_agent_verbs.AgentVerbCase):
    """What an agent's CLI shows of a draft page: its title and the mark in `notes`, and no words in `note read`."""

    def test_notes_marks_a_draft_and_note_read_prints_no_words(self):
        args = {"title": "The plan", "body": WORDS, "attachments": [], "references": []}
        self.committed(self.command("memory.create", args, target={"item_id": "plan", "owner_scope": TOPIC}, expected={"item_revision": 0}))
        self.committed(self.command("memory.revise", dict(args, draft=True), target={"item_id": "plan"}, expected={"item_revision": 1}))
        code, out, err = self.run_cli("notes", "t1", "--topic")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, 'plan  "The plan"  revision 2 by owner  [draft: its writer keeps its words from agents]\n')
        for argv in (("note", "read", "plan"), ("note", "read", "plan", "--revision", "1")):
            with self.subTest(argv=argv):
                code, out, err = self.run_cli(*argv)
                self.assertEqual((code, err), (0, ""))
                self.assertNotIn("nobody", out)
                self.assertIn("This page is a draft: its writer keeps its words from agents until the draft mark is cleared.\n", out)
        code, out, err = self.run_cli("note", "revise", "plan", "--expected", "2", "-", stdin=b"Blind words")
        self.assertEqual(code, 2, (out, err))
        self.assertIn("FORBIDDEN", err)
        self.assertEqual(self.sql("SELECT max(revision) FROM memory_revisions WHERE item_id='plan'"), [(2,)])
