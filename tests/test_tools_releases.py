from __future__ import annotations

import subprocess
import tempfile
import unittest

from tools import releases


class PipelineTrailers(unittest.TestCase):
    """A change names its items in a `Pipeline:` trailer, read by git's own trailer rules, from a real repository."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name
        self.git("init", "-q", ".")
        self.git("commit", "-q", "--allow-empty", "-m", "Base")
        self.base = self.git("rev-parse", "HEAD").strip()

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        done = subprocess.run(["git", "-C", self.repo, "-c", "user.name=t", "-c", "user.email=t@example.com",
                               "-c", "commit.gpgsign=false"] + list(args), capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout

    def commit(self, message):
        self.git("commit", "-q", "--allow-empty", "-m", message)

    def shipped(self):
        head = self.git("rev-parse", "HEAD").strip()
        log = subprocess.run(releases.log_argv(self.repo, self.base, head), capture_output=True, text=True)
        self.assertEqual(log.returncode, 0, log.stderr)
        return releases.shipped(log.stdout)

    def test_only_the_trailer_paragraph_names_items(self):
        self.commit("Docs: how a change names its items\n\nWrite a line such as\n\nPipeline: 87, 2\n\n"
                    "in the last paragraph.\n\nCo-Authored-By: x <x@example.com>\n")
        self.commit("Prose that ends a message\n\nThe last paragraph is prose.\nPipeline: 9\n")
        self.commit("Close keeps the writing\n\nPipeline: 88, 3\nCo-Authored-By: x <x@example.com>\n")
        self.commit("Lower case\n\npipeline: 4\npipeline: 5,\n  6\n")
        try:
            items, commits = self.shipped()
        except releases.Malformed as error:
            self.fail("a line outside the trailers was read: %s" % error)
        self.assertEqual(items, [88, 3, 4, 5, 6])
        self.assertEqual([commit["items"] for commit in commits], [[], [], [88, 3], [4, 5, 6]])
        self.assertEqual(commits[2]["subject"], "Close keeps the writing")

    def test_a_malformed_value_outside_the_trailers_is_not_read_inside_them_it_refuses(self):
        self.commit("Prose\n\nPipeline: none, as an example.\n\nNo trailer here.\n")
        self.assertEqual(self.shipped()[0], [])
        for value in ("none", "88.", "#88", "87 and 2", "087", "2,"):
            with self.subTest(value):
                self.commit("Something\n\nPipeline: %s\nCo-Authored-By: x <x@example.com>\n" % value)
                with self.assertRaises(releases.Malformed) as caught:
                    self.shipped()
                self.assertIn("Something", str(caught.exception))
                self.git("reset", "-q", "--hard", "HEAD~1")

    def test_a_revert_trailer_takes_back_an_earlier_claim_and_a_later_claim_ships_it_again(self):
        self.commit("Dossiers\n\nPipeline: 412\nCo-Authored-By: x <x@example.com>\n")
        self.commit("Composer\n\nPipeline: 464\n")
        self.commit("Docs: a revert says\n\nTrain-Item: Revert 464\n\nin its last paragraph.\n")
        self.commit("Train-Item says what a train carried\n\nTrain-Item: 464 the composer\n")
        self.commit("Train 8: revert 412\n\nTrain-Item: Revert 412\nCo-Authored-By: x <x@example.com>\n")
        items, commits = self.shipped()
        self.assertEqual(items, [464])
        self.assertEqual([commit["reverts"] for commit in commits], [[], [], [], [], [412]])
        self.assertEqual(releases.reverted(commits, [398]), [{"item": 412, "commit": commits[4]["commit"], "by": "trailer"},
                                                            {"item": 398, "commit": None, "by": "flag"}])
        self.commit("Dossiers again\n\nPipeline: 412\n")
        self.assertEqual(self.shipped()[0], [464, 412])
        self.commit("Both back out\n\ntrain-item: revert 412, 464\n")
        self.assertEqual(self.shipped()[0], [])

    def test_a_revert_trailer_that_names_no_items_refuses(self):
        for value in ("Revert next", "Revert 412 and 413", "Revert #412", "Revert", "revert  "):
            with self.subTest(value):
                self.commit("Take it back\n\nTrain-Item: %s\n" % value)
                with self.assertRaises(releases.Malformed) as caught:
                    self.shipped()
                self.assertIn("Take it back", str(caught.exception))
                self.git("reset", "-q", "--hard", "HEAD~1")


if __name__ == "__main__":
    unittest.main()
