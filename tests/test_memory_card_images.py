from __future__ import annotations

"""An image in a Notebook card (item 321, docs/decks.md "Images in a card"):
the card names one of the page's attachments by a line of its words,
![name](attachment:ID), and the page reads its bytes through the page
(`open_media` with the page's source_ref, which /api/media/read serves). So
only someone who may read the page gets the image: its writer and every
reader of the page do, and anyone else, or an image the page does not carry,
is refused, whatever the card's words name."""

from pathlib import Path

from aim_next.contract import Refusal
from reader_fixture import ReaderCase
import test_media

PNG = (Path(__file__).parent / "fixtures" / "media" / "one.png").read_bytes()
TOPIC = {"kind": "topic", "id": "t1"}


class CardImageCase(ReaderCase):
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
