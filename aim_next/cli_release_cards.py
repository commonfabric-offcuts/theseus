from __future__ import annotations

"""Bound Release-card writer/read adapters; no alternate publication journal."""

import json


def register(verb):
    actions = verb("release-card").add_subparsers(dest="release_action", required=True)
    for action in ("create", "update", "read", "history"):
        parser = actions.add_parser(action)
        parser.add_argument("identity")
        if action in ("create", "update"):
            parser.add_argument("file")
            parser.add_argument("--operation")
        if action == "create":
            parser.add_argument("--divergence-reason", required=True)
        if action == "update":
            parser.add_argument("--expected", type=int, required=True)
        if action == "read":
            parser.add_argument("--revision", type=int)
        if action == "history":
            parser.add_argument("--cursor", type=int)
            parser.add_argument("--limit", type=int)


class ReleaseCardVerbs:
    def do_release_card(self):
        options = self.options
        action = options.release_action
        if action in ("read", "history"):
            args = {"message_id": options.identity}
            for name in ("revision", "cursor", "limit"):
                value = getattr(options, name, None)
                if value is not None:
                    args[name] = value
            answer = self.view("release_card_history" if action == "history" else "release_card", args)
            if action == "read":
                self.out.plain(answer["body"])
            else:
                for item in answer["items"]:
                    self.out.plain("revision %d: %s" % (item["revision"], item["body"]))
                if answer["next_cursor"] is not None:
                    self.out.plain("more before revision %d" % answer["next_cursor"])
            return
        try:
            payload = json.loads(self.read_file(options.file, 8192))
        except (ValueError, UnicodeError):
            self.refuse("INVALID_ARGUMENT", "A release card payload is one bounded JSON object")
        args = {"payload": payload}
        expected = {}
        if action == "create":
            target = {"topic_id": options.identity}
            args["divergence_reason"] = options.divergence_reason
        else:
            target = {"message_id": options.identity}
            expected["message_revision"] = options.expected
        kind = "release_card." + action
        result = self.command(kind, target, args, expected, operation=self.operation_of())
        mid = result["message_id"]
        answer = self.read_back("release_card", {"message_id": mid, "revision": result["revision"]},
                                {"what": "Release card recorded", "kind": kind, "it": mid},
                                "release-card read %s --revision %d" % (mid, result["revision"]))
        if answer["release_card"] != result["release_card"]:
            self.refuse("READ_BACK_MISMATCH", "Read the retained release-card operation; its readback differs")
        self.out.plain("release card %s revision %d; read back matches" % (mid, result["revision"]))
