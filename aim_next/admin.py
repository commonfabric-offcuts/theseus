from __future__ import annotations

"""Local operator program: schema upgrades, actor registration, release records and starting an older outcome's conversation. Never exposed over HTTP."""

import argparse
import json
from pathlib import Path
import sys

from .authority import AuthorityError
from .contract import Refusal, StoreError
from .migrations import migrate
from .profile import ProfileError, load_profile, read_binding
from .store import StoreOpenError


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


def _parser():
    parser = Parser(prog="aim-next-admin", add_help=False)
    verbs = parser.add_subparsers(dest="verb", parser_class=Parser)
    upgrade = verbs.add_parser("migrate", add_help=False)
    upgrade.add_argument("--db", required=True)
    upgrade.add_argument("--instance", required=True)
    upgrade.add_argument("--binding", required=True)
    upgrade.add_argument("--to")
    actor = verbs.add_parser("add-actor", add_help=False)
    actor.add_argument("--profile", required=True)
    actor.add_argument("--id", required=True)
    actor.add_argument("--kind", required=True)
    actor.add_argument("--name", required=True)
    release = verbs.add_parser("record-release", add_help=False)
    release.add_argument("--profile", required=True)
    release.add_argument("--record", required=True)
    conversation = verbs.add_parser("conversation-start", add_help=False)
    conversation.add_argument("--profile", required=True)
    conversation.add_argument("--outcome", required=True)
    conversation.add_argument("--coordinator")
    conversation.add_argument("--replaces")
    return parser


def _record(path):
    """The release record in a JSON file (docs/releases.md); an unreadable file is refused, not an empty record."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refusal("INVALID_ARGUMENT", "No readable release record at %s: %s" % (path, error))


def _run(options):
    if options.verb == "migrate":
        profile = read_binding(options.binding)
        if profile.db_path != Path(options.db).resolve() or profile.instance_id != options.instance:
            raise Refusal("BINDING_MISMATCH", "The profile binds another database or instance")
        return migrate(profile.db_path, options.instance, profile.binding, options.to)
    profile = load_profile(options.profile)
    if options.verb == "record-release":
        return profile.store().record_release(_record(options.record))
    if options.verb == "conversation-start":
        replaces = [topic for topic in (options.replaces or "").split(",") if topic]
        return profile.store().start_conversation(options.outcome, options.coordinator, replaces)
    return profile.store().register_actor(options.id, options.kind, options.name)


def main(argv=None, *, stdout=None, stderr=None):
    stdout = sys.stdout if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        options = _parser().parse_args(argv)
        if options.verb is None or any(not Path(path).is_absolute() for path in (
                getattr(options, "db", "/"), getattr(options, "binding", "/"), getattr(options, "profile", "/"),
                getattr(options, "record", "/"))):
            raise ValueError("absolute paths")
    except ValueError:
        stderr.write("usage: aim-next-admin migrate --db /abs/db --instance ID --binding /abs/profile.json [--to VERSION]\n"
                     "       aim-next-admin add-actor --profile /abs/profile.json --id ID --kind human|agent --name NAME\n"
                     "       aim-next-admin record-release --profile /abs/profile.json --record /abs/release.json\n"
                     "       aim-next-admin conversation-start --profile /abs/profile.json --outcome W [--coordinator NAME] [--replaces T1,T2]\n")
        return 2
    try:
        result, code = dict(_run(options), ok=True), 0
    except Refusal as error:
        result, code = {"ok": False, "error": {"code": error.code, "message": error.message, "retryable": False}}, 2
    except (AuthorityError, ProfileError, StoreOpenError) as error:
        retryable = bool(getattr(error, "retryable", False))
        result = {"ok": False, "error": {"code": getattr(error, "code", None) or "PROFILE_UNAVAILABLE",
                                         "message": str(error), "retryable": retryable}}
        code = 75 if retryable else 2
    except (StoreError, OSError) as error:
        result, code = {"ok": False, "error": {"code": "UNCONFIRMED", "message": str(error) or "The outcome could not be confirmed",
                                               "retryable": False}}, 1
    stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    stdout.flush()
    return code


if __name__ == "__main__":
    sys.exit(main())
