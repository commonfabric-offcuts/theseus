from __future__ import annotations

"""Every command docs/agent-guide.md shows an agent is one the CLI takes (item 162).

The guide's commands are the lines of its sh blocks, and its code spans, that
start `aim-next `. Each is split as a shell splits it, with its optional parts
([...]) kept and each placeholder in capitals (OUTCOME, TOPIC, N) given as 1,
and read by the CLI's own parser: a verb, flag or choice the CLI does not have
fails here, naming the command."""

from pathlib import Path
import re
import shlex
import unittest

from aim_next import cli

GUIDE = Path(__file__).resolve().parents[1] / "docs" / "agent-guide.md"
PLACEHOLDER = re.compile(r"[A-Z][A-Z0-9_]*")


def guide_commands(text):
    """The commands the guide shows: sh block lines (a `$ ` prompt dropped) and code spans that start `aim-next `."""
    commands = []
    for block in re.findall(r"```sh\n(.*?)```", text, re.S):
        for line in block.splitlines():
            line = line[2:] if line.startswith("$ ") else line
            if line.startswith("aim-next "):
                commands.append(line)
    prose = re.sub(r"```.*?```", "", text, flags=re.S)
    commands += [" ".join(span.split()) for span in re.findall(r"`(aim-next [^`]+)`", prose)]
    return commands


def parses(command):
    """Whether the CLI's parser takes the command, read as described above."""
    words = shlex.split(command.replace("[", " ").replace("]", " "), comments=True)
    argv = ["1" if PLACEHOLDER.fullmatch(word) else word for word in words[1:]]
    try:
        options = cli._parser().parse_args(["--profile", "/absolute/you.json"] + argv)
    except cli.UsageError:
        return None
    return options.verb


class AgentGuideCommandsCase(unittest.TestCase):
    def test_every_command_the_guide_shows_is_one_the_cli_takes(self):
        commands = guide_commands(GUIDE.read_text(encoding="utf-8"))
        refused = [command for command in commands if parses(command) is None]
        self.assertEqual(refused, [], "docs/agent-guide.md shows commands the CLI refuses")
        # The guide's verbs are all read, the pipeline's among them, so a block or span the reading misses fails too.
        self.assertTrue({"watch", "read", "ack", "post", "reply", "whisper", "state", "notes", "note", "attachment", "retry",
                         "pipeline", "add", "add-source"} <= {parses(command) for command in commands})

    def test_a_wrong_verb_flag_or_choice_is_refused(self):
        self.assertEqual(parses('aim-next add OUTCOME --title "T" --from m-… "Words."'), "add")
        for wrong in ('aim-next add OUTCOME --title "T" --form m-… "Words."',
                      "aim-next pipeline OUTCOME --section candidate",
                      'aim-next raise OUTCOME --title "T" "Words."'):
            self.assertIsNone(parses(wrong), wrong)


if __name__ == "__main__":
    unittest.main()
