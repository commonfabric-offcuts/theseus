from __future__ import annotations

import hashlib
import io
from pathlib import Path
import unittest

from aim_next import conversation
from reader_fixture import ReaderCase

MEDIA = Path(__file__).parent / "fixtures" / "media"


class TopicImagesCase(ReaderCase):
    """The images #img offers (docs/conversation.md, "Images to pick")."""

    def ready(self, media_id, name, actor="owner", content_type="image/png", data=None):
        data = data if data is not None else (MEDIA / name).read_bytes()
        publish = "publish-" + media_id
        self.committed(self.command("media.begin", {"name": name, "content_type": content_type, "size_bytes": len(data),
                                                    "sha256": hashlib.sha256(data).hexdigest(), "publish_operation_id": publish},
                                    target={"media_id": media_id}, expected={"media_revision": 0}, actor=actor))
        envelope = self.envelope("media.publish", {"media_id": media_id}, {}, {"media_revision": 1}, op=publish)
        return self.committed(self.store.publish_media(actor, envelope, io.BytesIO(data)))

    def post(self, body, actor="owner", **args):
        return self.committed(self.command("message.post", dict({"body": body}, **args), target={"topic_id": "t1"}, actor=actor))["message_id"]

    def images(self, actor="owner", **args):
        return self.store.view(actor, "topic_images", dict({"topic_id": "t1"}, **args))

    def test_images_newest_first_once_each_with_the_message_that_carries_them(self):
        self.ready("png-one", "one.png")
        self.ready("gif-two", "one.gif", actor="agent-a", content_type="image/gif")
        self.ready("notes", "notes.txt", content_type="text/plain", data=b"plain words")
        first = self.post("A picture", attachments=[{"id": "png-one"}, {"id": "notes"}])
        second = self.post("Another", actor="agent-a", attachments=[{"id": "gif-two"}])
        answer = self.images()
        self.assertNotIn("error", answer, answer)
        self.assertEqual([item["attachment"]["id"] for item in answer["items"]], ["gif-two", "png-one"], "newest first, images only")
        self.assertEqual(answer["items"][0]["source_ref"], {"kind": "message", "id": second})
        self.assertEqual(answer["items"][0]["author_id"], "agent-a")
        self.assertEqual(answer["items"][1]["source_ref"], {"kind": "message", "id": first})
        self.assertEqual(set(answer["items"][1]["attachment"]), {"id", "name", "content_type", "size_bytes", "sha256", "inline"})
        # The descriptor reads the bytes through the message that carries it.
        with self.store.open_media("agent-b", {"media_id": "png-one", "source_ref": answer["items"][1]["source_ref"]}) as resource:
            self.assertEqual(resource.descriptor["name"], "one.png")
        self.assertEqual([item["attachment"]["id"] for item in self.images(limit=1)["items"]], ["gif-two"])

    def test_a_whisper_s_image_shows_only_to_its_two_people_and_an_outsider_is_refused(self):
        self.ready("secret", "one.png")
        self.post("Just between us", attachments=[{"id": "secret"}], addressees=["agent-a"], whisper=True)
        self.assertEqual([item["attachment"]["id"] for item in self.images("owner")["items"]], ["secret"])
        self.assertEqual([item["attachment"]["id"] for item in self.images("agent-a")["items"]], ["secret"])
        self.assertEqual(self.images("agent-b")["items"], [], "a team member outside the whisper sees none of it")
        self.assertEqual(self.images("outsider")["error"]["code"], "FORBIDDEN")

    def test_only_the_newest_window_of_messages_is_read(self):
        self.ready("old", "one.png")
        self.post("Old picture", attachments=[{"id": "old"}])
        original = conversation.IMAGE_WINDOW
        self.addCleanup(setattr, conversation, "IMAGE_WINDOW", original)
        conversation.IMAGE_WINDOW = 3
        for n in range(3):
            self.post("Words %d" % n)
        self.assertEqual(self.images()["items"], [], "the picture is older than the window")
        conversation.IMAGE_WINDOW = 4
        self.assertEqual([item["attachment"]["id"] for item in self.images()["items"]], ["old"])

    def test_a_bad_count_is_refused(self):
        for limit in (0, 51, True, "3"):
            self.assertEqual(self.images(limit=limit)["error"]["code"], "INVALID_ARGUMENT", limit)

    def test_pdfs_are_opt_in_and_use_the_verified_source_of_the_newest_attachment(self):
        self.ready("png", "one.png")
        self.ready("plan", "Project plan.pdf", content_type="application/pdf", data=b"%PDF-1.4\n%%EOF\n")
        self.post("Earlier plan", attachments=[{"id": "plan"}])
        self.post("Reference image", attachments=[{"id": "png"}])
        newest = self.post("Newest plan", attachments=[{"id": "plan"}])
        self.assertEqual([item["attachment"]["id"] for item in self.images()["items"]], ["png"])
        files = self.images(include_pdfs=True)["items"]
        self.assertEqual([item["attachment"]["id"] for item in files], ["plan", "png"])
        self.assertEqual(files[0]["source_ref"], {"kind": "message", "id": newest})
        self.assertEqual([item["attachment"]["id"] for item in self.images(include_pdfs=True, limit=1)["items"]], ["plan"])
        with self.store.open_media("agent-b", {"media_id": "plan", "source_ref": files[0]["source_ref"]}) as opened:
            self.assertEqual(opened.descriptor["name"], "Project plan.pdf")
        self.assertEqual(self.images(include_pdfs="yes")["error"]["code"], "INVALID_ARGUMENT")

    def test_a_newer_conversation_pdf_cannot_spend_the_viewed_topics_file_limit(self):
        self.ready("seen-image", "one.png")
        self.ready("conversation-pdf", "Conversation.pdf", content_type="application/pdf", data=b"%PDF-1.4\n%%EOF\n")
        self.post("An image on this topic", attachments=[{"id": "seen-image"}])
        conversation_id = self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND kind='conversation'")[0][0]
        self.committed(self.command("message.post", {"body": "A later Conversation file",
            "attachments": [{"id": "conversation-pdf"}]}, target={"topic_id": conversation_id}))
        self.assertEqual([item["attachment"]["id"] for item in self.images(limit=1, include_pdfs=True)["items"]], ["seen-image"])
        direct = self.store.view("owner", "topic_images", {"topic_id": conversation_id, "limit": 1, "include_pdfs": True})
        self.assertEqual([item["attachment"]["id"] for item in direct["items"]], ["conversation-pdf"])


if __name__ == "__main__":
    unittest.main()
