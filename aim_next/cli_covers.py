from __future__ import annotations

"""A dossier's cover as an agent verb (item 624; docs/agent-cli.md, "A dossier's cover").

`cover MESSAGE` prints the cover of the dossier MESSAGE is in; with any of its options it sets or clears those fields
(`stack.cover` on the dossier's first message, read through `dossier_cover`), fenced on --expected or else on the
revision read now, and prints the cover as Core recorded it. Done is never an option: the outcome's owner gives it, by
a 👍 on the payload's message or by their own reply to it, which the writer names with --done-by; Core refuses a
--done-by that is not the owner's reply to that message. Times are absolute local times.
"""

import time

from .cover_values import PAYLOAD_KINDS


def _at(ms):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000.0)) if isinstance(ms, int) else "(time unknown)"


def register(verb):
    cover = verb("cover")
    cover.add_argument("message")
    cover.add_argument("--expected", type=int)
    # Where it stands, in one line; "" clears it.
    cover.add_argument("--stands")
    # What waits on the owner, each with its default: --waits TEXT --default TEXT, once per thing waiting, in order.
    cover.add_argument("--waits", action="append", default=[])
    cover.add_argument("--default", dest="defaults", action="append", default=[])
    cover.add_argument("--no-waits", dest="no_waits", action="store_true")
    # What the dossier produced, the message that delivered it, and its link and kind.
    cover.add_argument("--payload")
    cover.add_argument("--from", dest="payload_from")
    cover.add_argument("--link")
    cover.add_argument("--kind", choices=PAYLOAD_KINDS)
    # The owner's own reply to the payload's message that made it done, named by its id.
    cover.add_argument("--done-by", dest="done_by")
    cover.add_argument("--no-payload", dest="no_payload", action="store_true")


def done_words(done, owner):
    """How the payload was done, or that it is proposed, in the words the page says."""
    if not done:
        return "payload proposed: Done when %s gives its message a 👍, or replies to it and the cover names that reply" % owner
    if done["how"] == "thumb":
        return "done: %s's 👍 at %s" % (done["by"], _at(done["at_ms"]))
    return "done: %s's word%s at %s" % (done["by"], " (%s)" % done["message_id"] if done.get("message_id") else "", _at(done["at_ms"]))


def cover_lines(root, revision, cover, owner):
    """The cover as plain lines: where it stands, what waits on the owner and the payload with how it got done."""
    if cover is None:
        return ["no cover on the dossier of %s (revision %d)" % (root, revision)]
    lines = ["cover of the dossier of %s (revision %d, by %s at %s)" % (root, revision, cover["by"], _at(cover["at_ms"]))]
    if cover["stands"]:
        lines.append("  stands: %s" % cover["stands"])
    for wait in cover["waiting"]:
        lines.append("  waits on %s: %s (default: %s)" % (owner, wait["text"], wait["default"]))
    payload = cover["payload"]
    if payload:
        lines.append("  payload%s: %s  [%s #%s]%s" % (" (%s)" % payload["kind"] if payload.get("kind") else "", payload["text"],
                                                    payload["message_id"], payload["seq"], "  " + payload["link"] if payload.get("link") else ""))
        lines.append("    " + done_words(payload.get("done"), owner))
    return lines


class CoverVerbs:
    def cover_args(self):
        """The fields this run sets or clears, from its options; {} when it only reads."""
        options, args = self.options, {}
        if options.stands is not None:
            args["stands"] = options.stands
        if options.no_waits and options.waits:
            self.refuse("INVALID_ARGUMENT", "--no-waits clears what waits on the owner; it takes no --waits; nothing was sent")
        if len(options.waits) != len(options.defaults):
            self.refuse("INVALID_ARGUMENT", "Each --waits names its --default, what holds if the owner says nothing; nothing was sent")
        if options.waits:
            args["waiting"] = [{"text": text, "default": default} for text, default in zip(options.waits, options.defaults)]
        elif options.no_waits:
            args["waiting"] = []
        named = options.payload is not None or options.payload_from or options.link or options.kind or options.done_by
        if options.no_payload and named:
            self.refuse("INVALID_ARGUMENT", "--no-payload clears the payload; it takes no --payload, --from, --link, --kind or --done-by; nothing was sent")
        if named:
            if options.payload is None or not options.payload_from:
                self.refuse("INVALID_ARGUMENT", "A payload is --payload TEXT --from MESSAGE (the message that delivered it), with "
                            "--link, --kind and --done-by as it has them; nothing was sent")
            args["payload"] = dict({"text": options.payload, "message_id": options.payload_from},
                                   **({"link": options.link} if options.link else {}), **({"kind": options.kind} if options.kind else {}),
                                   **({"done_by": options.done_by} if options.done_by else {}))
        elif options.no_payload:
            args["payload"] = None
        return args

    def do_cover(self):
        args = self.cover_args()
        found = self.view("dossier_cover", {"message_id": self.options.message})
        if not args:
            for line in cover_lines(found["root_id"], found["cover_revision"], found["cover"], found["owner"]):
                self.out.plain(line)
            return
        expected = found["cover_revision"] if self.options.expected is None else self.options.expected
        result = self.command("stack.cover", {"message_id": found["root_id"]}, args, {"cover_revision": expected})
        self.out.plain("%s the cover of the dossier of %s" % ("wrote" if result["changed"] else "no change to", result["message_id"]))
        for line in cover_lines(result["message_id"], result["cover_revision"], result["cover"], found["owner"]):
            self.out.plain(line)
