from __future__ import annotations

"""The color a person chooses for an agent: theirs alone, fenced on its revision, and only from the palette."""

from pathlib import Path
import re
import unittest

import test_store as fixtures


ROOT = Path(__file__).resolve().parent.parent
PALETTE = ["green", "blue", "indigo", "violet", "rose", "peach", "cyan", "olive"]


class ColorCase(fixtures.StoreCase):
    def choose(self, agent, color, expected, actor="owner", op=None):
        return self.command("color.set", {"color": color}, target={"actor_id": agent},
                            expected={"color_revision": expected}, actor=actor, op=op)

    def committed(self, receipt):
        self.assertEqual(receipt.get("status"), "committed", receipt)
        return receipt["result"]

    def refused(self, receipt, code):
        self.assertEqual(receipt.get("error", {}).get("code"), code, receipt)
        self.assertNotEqual(receipt.get("status"), "committed", receipt)
        # The person reads a refusal beside "Color for"; it spells the word as the page does.
        self.assertNotIn("colour", receipt["error"]["message"].lower(), receipt)
        return receipt["error"]

    def choices(self, actor="owner", **args):
        answer = self.store.view(actor, "colors", args)
        self.assertNotIn("error", answer, answer)
        return answer

    def rows(self):
        return self.sql("SELECT actor_id,subject_id,color,revision FROM color_choices ORDER BY actor_id,subject_id")

    def test_a_choice_is_the_choosers_own_and_the_view_reads_it(self):
        self.assertEqual(self.choices(), {"instance_id": "test-instance", "palette": PALETTE, "items": [], "next_cursor": None})
        result = self.committed(self.choose("agent-a", "indigo", 0))
        self.assertEqual(result, {"actor_id": "agent-a", "color": "indigo", "color_revision": 1, "changed": True})
        self.assertEqual(self.choices()["items"], [{"actor_id": "agent-a", "color": "indigo", "color_revision": 1}])
        # Another reader, an agent here, sees none of it.
        self.assertEqual(self.choices("agent-b")["items"], [])
        # The choice tells only the chooser's own changes.
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes WHERE resource_kind='color'"),
                         [("actor", "owner", "color", "agent-a", 1)])

    def test_going_back_to_the_default_keeps_the_revision_growing(self):
        self.committed(self.choose("agent-a", "rose", 0))
        self.assertEqual(self.committed(self.choose("agent-a", None, 1)),
                         {"actor_id": "agent-a", "color": None, "color_revision": 2, "changed": True})
        self.assertEqual(self.choices()["items"], [{"actor_id": "agent-a", "color": None, "color_revision": 2}],
                         "a reset choice is listed, so a page knows its revision")
        self.assertEqual(self.committed(self.choose("agent-a", None, 2)),
                         {"actor_id": "agent-a", "color": None, "color_revision": 2, "changed": False}, "the same choice changes nothing")
        self.assertEqual(self.committed(self.choose("agent-a", "rose", 2))["color_revision"], 3)
        self.assertEqual(self.rows(), [("owner", "agent-a", "rose", 3)])

    def test_a_late_request_never_undoes_a_newer_choice(self):
        self.committed(self.choose("agent-a", "indigo", 0))
        self.committed(self.choose("agent-a", "peach", 1, op="other-device"))
        error = self.refused(self.choose("agent-a", "cyan", 1, op="late"), "REVISION_CONFLICT")
        self.assertEqual(error["current_versions"], {"color_revision": 2})
        self.assertEqual(self.rows(), [("owner", "agent-a", "peach", 2)])
        self.refused(self.choose("agent-b", "cyan", 3), "REVISION_CONFLICT")
        self.assertEqual(self.rows(), [("owner", "agent-a", "peach", 2)], "a revision ahead of the record is refused too")

    def test_a_retry_with_the_same_operation_is_one_choice(self):
        first = self.choose("agent-a", "violet", 0, op="choose-once")
        self.assertEqual(self.choose("agent-a", "violet", 0, op="choose-once"), first)
        self.assertEqual(self.rows(), [("owner", "agent-a", "violet", 1)])

    def test_only_a_palette_color_for_an_agent_is_accepted(self):
        for color in ("red", "#ff0000", "Green", "green; background:url(x)", "", 3, True, ["green"], {"name": "green"}):
            with self.subTest(color=color):
                self.refused(self.choose("agent-a", color, 0), "INVALID_ARGUMENT")
        for agent, why in (("owner", "the chooser's own"), ("missing", "no such actor")):
            with self.subTest(agent=agent):
                self.refused(self.choose(agent, "green", 0), "INVALID_ARGUMENT")
        self.refused(self.choose("owner", "green", 0, actor="agent-a"), "INVALID_ARGUMENT")  # a person is never tinted
        self.refused(self.choose("agent-a", "green", 0, actor="agent-a"), "INVALID_ARGUMENT")  # nor one's own messages
        self.refused(self.command("color.set", {"color": "green", "extra": 1}, target={"actor_id": "agent-a"},
                                  expected={"color_revision": 0}), "INVALID_ARGUMENT")
        self.refused(self.command("color.set", {"color": "green"}, target={"actor_id": "agent-a"}), "INVALID_ARGUMENT")
        self.refused(self.command("color.set", {}, target={"actor_id": "agent-a"}, expected={"color_revision": 0}), "INVALID_ARGUMENT")
        self.assertEqual(self.rows(), [])
        self.committed(self.choose("agent-a", "green", 0))
        self.committed(self.choose("agent-a", "blue", 0, actor="agent-b"))
        self.assertEqual(self.rows(), [("agent-b", "agent-a", "blue", 1), ("owner", "agent-a", "green", 1)])

    def test_a_kept_choice_of_a_color_no_longer_offered_reads_as_the_agents_own(self):
        # Orchid left the palette (item 91b); a choice of it made before then
        # is still a row. It reads as the agent's own, at its revision, and the
        # revision keeps growing from there.
        self.refused(self.choose("agent-a", "orchid", 0), "INVALID_ARGUMENT")
        self.committed(self.choose("agent-a", "rose", 0))
        self.committed(self.choose("agent-b", "violet", 0))
        self.sql("UPDATE color_choices SET color='orchid' WHERE subject_id='agent-a'")
        self.assertEqual(self.choices()["items"], [{"actor_id": "agent-a", "color": None, "color_revision": 1},
                                                   {"actor_id": "agent-b", "color": "violet", "color_revision": 1}])
        self.assertEqual(self.committed(self.choose("agent-a", None, 1)),
                         {"actor_id": "agent-a", "color": None, "color_revision": 1, "changed": False},
                         "the agent's own is what it already reads as")
        self.refused(self.choose("agent-a", "orchid", 1), "INVALID_ARGUMENT")
        self.assertEqual(self.committed(self.choose("agent-a", "cyan", 1))["color_revision"], 2)
        self.assertEqual(self.rows(), [("owner", "agent-a", "cyan", 2), ("owner", "agent-b", "violet", 1)])

    def test_the_view_pages_by_agent(self):
        self.committed(self.choose("agent-b", "olive", 0))
        self.committed(self.choose("agent-a", "indigo", 0))
        first = self.choices(limit=1)
        self.assertEqual((first["items"], first["next_cursor"]), ([{"actor_id": "agent-a", "color": "indigo", "color_revision": 1}], "agent-a"))
        second = self.choices(limit=1, cursor="agent-a")
        self.assertEqual((second["items"], second["next_cursor"]), ([{"actor_id": "agent-b", "color": "olive", "color_revision": 1}], None))
        self.assertEqual(self.store.view("owner", "colors", {"owner": "agent-b"})["error"]["code"], "INVALID_ARGUMENT")

    def test_the_browser_draws_every_palette_color_and_no_other(self):
        source = (ROOT / "web" / "author-colors.mjs").read_text()
        listed = re.search(r"export const AGENT_PALETTE = \[([^\]]*)\]", source).group(1)
        self.assertEqual(re.findall(r"'([a-z]+)'", listed), PALETTE)
        css = (ROOT / "web" / "aim.css").read_text()
        dark = css[css.index("@media(prefers-color-scheme:dark){.agent-"):]
        for name in PALETTE:
            self.assertIn(".agent-%s{--agent-card:" % name, css[:css.index("@media(prefers-color-scheme:dark){.agent-")], name)
            self.assertIn(".agent-%s{--agent-card:" % name, dark, name)
        drawn = re.findall(r"\.agent-([a-z]+)\{--agent-card:", css)
        self.assertEqual(sorted(set(drawn)), sorted(PALETTE), "a color the palette does not offer is not drawn")


# Do not rerun the inherited StoreCase tests.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_"):
        setattr(ColorCase, _name, None)


if __name__ == "__main__":
    unittest.main()
