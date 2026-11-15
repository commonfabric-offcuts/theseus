from __future__ import annotations

"""An image in a Notebook card (item 321, docs/decks.md "Images in a card"):
the card names one of the page's attachments by a line of its words,
![name](attachment:ID), and the page reads its bytes through the page
(`open_media` with the page's source_ref, which /api/media/read serves). So
only someone who may read the page gets the image: its writer and every
reader of the page do, and anyone else, or an image the page does not carry,
is refused, whatever the card's words name."""

import json
import sqlite3
from pathlib import Path

from aim_next.contract import Refusal
from aim_next.store import _connect
from reader_fixture import ReaderCase
import test_media

PNG = (Path(__file__).parent / "fixtures" / "media" / "one.png").read_bytes()
TOPIC = {"kind": "topic", "id": "t1"}


class CardPage(ReaderCase):
    # owner, a person, started t1 and takes part in it with agent-a; agent-b is on
    # the outcome's team and reads t1 without taking part; outsider and
    # other-reader are on neither.
    begin, publish, ready, read_all = test_media.MediaCase.begin, test_media.MediaCase.publish, test_media.MediaCase.ready, test_media.MediaCase.read_all

    def write(self, revision, body, attachments, actor="owner"):
        target = {"item_id": "cards"}
        if revision == 0:
            target["owner_scope"] = TOPIC
        return self.committed(self.command("memory.create" if revision == 0 else "memory.revise", {
            "title": "Cards", "body": body, "attachments": [{"id": media} for media in attachments], "references": []},
            target=target, expected={"item_revision": revision}, actor=actor))

    def image(self, actor, media, revision=None):
        """The image's bytes as the page reads them for actor: through the page as it stands, or at a revision."""
        ref = {"kind": "memory", "id": "cards", "revision": revision or self.store.view(actor, "memory_current", {"item_id": "cards"})["source_ref"]["revision"]}
        with self.store.open_media(actor, {"media_id": media, "source_ref": ref}) as resource:
            return self.read_all(resource)

    def refused(self, actor, media, revision):
        with self.assertRaises(Refusal) as error:
            with self.store.open_media(actor, {"media_id": media, "source_ref": {"kind": "memory", "id": "cards", "revision": revision}}):
                pass
        self.assertEqual(error.exception.code, "FORBIDDEN")

    def setUp(self):
        super().setUp()
        self.ready("card-image", PNG, content_type="image/png")
        self.write(0, "## Plan\n\nShip it.\n![chart.png](attachment:card-image)\n", ["card-image"])


class CardImageCase(CardPage):

    def test_every_reader_of_the_page_gets_the_cards_image_through_the_page_and_no_one_else_does(self):
        for reader in ("owner", "agent-a", "agent-b"):
            with self.subTest(reader=reader):
                self.assertEqual(self.image(reader, "card-image"), PNG)
        for stranger in ("outsider", "other-reader"):
            with self.subTest(stranger=stranger):
                # They may not read the page, so its image is not theirs either: the same refusal as an image that is not there.
                self.rejected(self.store.view(stranger, "memory_current", {"item_id": "cards"}), "FORBIDDEN")
                self.refused(stranger, "card-image", 1)
                self.refused(stranger, "no-such-image", 1)

    def test_a_card_line_naming_an_image_the_page_does_not_carry_opens_nothing(self):
        # agent-a's own image, named in a card by the person, is not on the page: through the page it opens for nobody.
        self.ready("agents-own", PNG, content_type="image/png", actor="agent-a")
        self.write(1, "## Plan\n\nShip it.\n![chart.png](attachment:card-image)\n![theirs.png](attachment:agents-own)\n", ["card-image"])
        for reader in ("owner", "agent-a", "agent-b"):
            with self.subTest(reader=reader):
                self.refused(reader, "agents-own", 2)
                self.assertEqual(self.image(reader, "card-image", 2), PNG)

    def test_an_image_taken_off_the_page_no_longer_opens_through_the_page_as_it_stands_and_still_does_at_the_revision_that_carried_it(self):
        self.write(1, "## Plan\n\nShip it.\n", [])
        for reader in ("owner", "agent-b"):
            with self.subTest(reader=reader):
                self.refused(reader, "card-image", 2)
                # Revisions keep their history, attachments among it, for whoever may read the page.
                self.assertEqual(self.image(reader, "card-image", 1), PNG)
        self.refused("outsider", "card-image", 1)

    def test_a_reader_keeps_the_cards_image_when_they_revise_the_page_though_another_uploaded_it(self):
        # agent-a revises the page, keeping the person's image as it stands; Core takes the image it did not upload.
        self.write(1, "## Plan\n\nShip it Friday.\n![chart.png](attachment:card-image)\n", ["card-image"], actor="agent-a")
        self.assertEqual([item["id"] for item in self.store.view("owner", "memory_current", {"item_id": "cards"})["attachments"]], ["card-image"])
        self.assertEqual(self.image("agent-b", "card-image"), PNG)

    def test_a_writer_attaches_again_an_image_an_earlier_revision_carried_though_another_uploaded_it_and_no_image_the_page_never_carried(self):
        # agent-a's image goes on the page, the person takes it off with ×, then Undo puts the card line back with it.
        self.ready("agents-chart", PNG, content_type="image/png", actor="agent-a")
        line = "![theirs.png](attachment:agents-chart)"
        self.write(1, f"## Plan\n\nShip it.\n![chart.png](attachment:card-image)\n{line}\n", ["card-image", "agents-chart"], actor="agent-a")
        self.write(2, "## Plan\n\nShip it.\n![chart.png](attachment:card-image)\n", ["card-image"])
        self.write(3, f"## Plan\n\nShip it.\n![chart.png](attachment:card-image)\n{line}\n", ["card-image", "agents-chart"])
        self.assertEqual([item["id"] for item in self.store.view("owner", "memory_current", {"item_id": "cards"})["attachments"]], ["card-image", "agents-chart"])
        self.assertEqual(self.image("agent-b", "agents-chart"), PNG)
        # An image someone else uploaded that no revision of this page carried is still refused, the page unchanged.
        self.ready("never-here", PNG, content_type="image/png", actor="agent-a")
        receipt = self.command("memory.revise", {"title": "Cards", "body": "## Plan\n\nShip it.\n", "attachments": [{"id": "card-image"}, {"id": "never-here"}],
                                                 "references": []}, target={"item_id": "cards"}, expected={"item_revision": 4})
        self.rejected(receipt, "FORBIDDEN")
        self.assertEqual(self.store.view("owner", "memory_current", {"item_id": "cards"})["source_ref"]["revision"], 4)


class RevisionRows:
    """A connection handed to one revise, counting the rows of memory_revisions its statements hand back, and the
    steps SQLite takes for them (its progress handler, set on this connection only)."""

    class Rows:
        def __init__(self, cursor, owner):
            self.cursor, self.owner = cursor, owner

        def _seen(self, rows):
            self.owner.rows += len(rows)
            return rows

        def fetchone(self):
            row = self.cursor.fetchone()
            return self._seen([row])[0] if row is not None else None

        def fetchall(self):
            return self._seen(self.cursor.fetchall())

        def __iter__(self):
            for row in self.cursor:
                self.owner.rows += 1
                yield row

    def __init__(self, db):
        self.db, self.rows, self.steps = db, 0, 0
        db.set_progress_handler(self._step, 1)

    def _step(self):
        self.steps += 1
        return 0

    def execute(self, sql, *params):
        cursor = self.db.execute(sql, *params)
        return self.Rows(cursor, self) if "memory_revisions" in sql and sql.lstrip().upper().startswith("SELECT") else cursor

    def __getattr__(self, name):
        return getattr(self.db, name)


class ReviseCostCase(CardPage):
    """What one memory.revise reads (docs/decks.md "Images in a card"): the revision it follows, and the history of the
    page only to attach again an image someone else uploaded that the revision it follows does not carry. Autosave
    writes a page many times, so a revise whose cost grew with the page's history would slow every save."""

    def grow(self, revisions):
        """The page given revisions more, each carrying the card's image, written straight to the fixture's file."""
        with sqlite3.connect(str(self.path)) as db:
            item = db.execute("SELECT current_revision FROM memory_items WHERE id='cards'").fetchone()[0]
            attachments = db.execute("SELECT attachments FROM memory_revisions WHERE item_id='cards' AND revision=?", (item,)).fetchone()[0]
            db.executemany("INSERT INTO memory_revisions(item_id,revision,author_id,operation_id,title,body,attachments,refs,draft) "
                           "VALUES ('cards',?,'owner',?,'Cards',?,?,'[]',0)",
                           [(n, "grow-%d" % n, "## Plan\n\nShip it, take %d.\n![chart.png](attachment:card-image)\n" % n, attachments)
                            for n in range(item + 1, item + revisions + 1)])
            db.execute("UPDATE memory_items SET current_revision=? WHERE id='cards'", (item + revisions,))
        return item + revisions

    def revise(self, revision, body, attachments, actor="owner"):
        """One memory.revise run on a connection that counts what it reads; rolled back, so the page stays as it was."""
        db, _ = _connect(self.path)
        try:
            counted = RevisionRows(db)
            db.execute("BEGIN IMMEDIATE")
            envelope = self.envelope("memory.revise", {"item_id": "cards"}, {
                "title": "Cards", "body": body, "attachments": [{"id": media} for media in attachments], "references": []},
                expected={"item_revision": revision})
            try:
                result, _ = self.store._command_memory_revise(counted, actor, envelope)
                kept = [ref["id"] for ref in json.loads(db.execute(
                    "SELECT attachments FROM memory_revisions WHERE item_id='cards' AND revision=?", (result["revision"],)).fetchone()[0])]
            finally:
                db.execute("ROLLBACK")
            return counted, kept
        finally:
            db.close()

    def test_an_ordinary_edit_reads_the_revision_it_follows_alone_however_long_the_pages_history(self):
        body = "## Plan\n\nShip it Friday.\n![chart.png](attachment:card-image)\n"
        short = self.grow(20)
        few, kept = self.revise(short, body, ["card-image"])
        self.assertEqual(kept, ["card-image"])
        long = self.grow(380)
        many, kept = self.revise(long, body, ["card-image"])
        self.assertEqual(kept, ["card-image"])
        # The revision it follows, and no other: 21 revisions or 401, the edit reads one row of them.
        self.assertEqual((few.rows, many.rows), (1, 1), "revision rows read with 21 and with 401 revisions")
        # Nor does SQLite step through the history without handing it back: the work is the same whatever its length.
        self.assertLess(many.steps - few.steps, 100, (few.steps, many.steps))

    def test_a_text_only_edit_by_another_reader_keeps_the_image_and_a_dropped_image_is_not_kept(self):
        # agent-a did not upload the person's image; its revise keeps it because the revision it follows carries it.
        revision = self.grow(300)
        counted, kept = self.revise(revision, "## Plan\n\nShip it Friday.\n![chart.png](attachment:card-image)\n", ["card-image"], actor="agent-a")
        self.assertEqual((kept, counted.rows), (["card-image"], 1))
        # A revise that drops it carries nothing, and reads no more of the history for it.
        counted, kept = self.revise(revision, "## Plan\n\nShip it Friday.\n", [], actor="agent-a")
        self.assertEqual((kept, counted.rows), ([], 1))

    def test_a_revise_still_refuses_more_than_the_limits_and_an_image_no_revision_carried(self):
        revision = self.grow(300)
        for n in range(8):
            self.ready("extra-%d" % n, PNG, content_type="image/png")
        receipt = self.command("memory.revise", {"title": "Cards", "body": "## Plan\n", "attachments": [{"id": "card-image"}] + [{"id": "extra-%d" % n} for n in range(8)],
                                                 "references": []}, target={"item_id": "cards"}, expected={"item_revision": revision})
        self.rejected(receipt, "TOO_MANY_ATTACHMENTS")
        self.ready("never-here", PNG, content_type="image/png", actor="agent-a")
        receipt = self.command("memory.revise", {"title": "Cards", "body": "## Plan\n", "attachments": [{"id": "card-image"}, {"id": "never-here"}],
                                                 "references": []}, target={"item_id": "cards"}, expected={"item_revision": revision})
        self.rejected(receipt, "FORBIDDEN")
        self.assertEqual(self.store.view("owner", "memory_current", {"item_id": "cards"})["source_ref"]["revision"], revision)
