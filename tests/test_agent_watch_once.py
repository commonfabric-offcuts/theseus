from __future__ import annotations

"""`watch --once`: the next delivery waiting for the actor, or the next to arrive, then exit.
It waits on the native watch, never on a timer, so an agent can run it as its wake."""

import json
import os
import signal
import subprocess
import sys

import test_agent_verbs
from test_agent_verbs import ROOT, FakeWatch


class WatchOnceCase(test_agent_verbs.WatchReadingCase):
    def delivery(self, message):
        return self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-b'", (message[0],))[0][0]

    def line(self, message, text):
        return 'delivery "Topic" #%s agent-a: %s  [%s in t1]' % (message[1], text, self.delivery(message))

    def events(self, *steps):
        """A watch whose waits run each step in turn; a wait past the last
        fails the case, so a watch that keeps waiting is a failure, not a hang."""
        watch, steps = FakeWatch(), list(steps)

        def wait(timeout):
            if timeout == 0:
                return dict(dirty=False, stop=watch.stopped)
            if not steps:
                self.fail("the watch waited again after it should have ended")
            return steps.pop(0)()
        watch.wait = wait
        return watch, steps

    def test_once_prints_the_oldest_waiting_delivery_and_nothing_else(self):
        self.run_cli("post", "t1", "--tells", "agent-b", "First waiting")
        first = self.latest()
        self.run_cli("post", "t1", "--tells", "agent-b", "Second waiting")
        agent = self.agent()
        watch, _ = self.events()
        agent.watch_changes(watch, once=True)
        self.assertEqual(self.stdout.getvalue(), self.line(first, "First waiting") + "\n",
                         "the oldest delivery alone, with no watching line, and without waiting")
        self.assertEqual(self.stderr.getvalue(), "")

    def test_with_nothing_waiting_once_waits_for_the_next_delivery_skipping_acknowledgments_and_other_changes(self):
        posted = []

        def first():
            # A delivery that is acknowledged before the watch reads it, and a
            # post that is not to agent-b: neither ends the wait.
            self.run_cli("post", "t1", "--tells", "agent-b", "Answered already")
            self.assertEqual(self.run_cli("ack", self.delivery(self.latest()), actor="agent-b")[0], 0)
            self.run_cli("post", "t1", "Not for agent-b")
            # A change in agent-b's own scope that is not a delivery: it read a
            # Notebook page.
            self.committed(self.memory(item="read-page"))
            before = self.store.view("agent-b", "changes", {"scope": {"kind": "actor", "id": "agent-b"}})["checkpoint"]
            self.committed(self.command("memory.read", {"revision": 1}, target={"item_id": "read-page"}, actor="agent-b"))
            kinds = [change["resource_kind"] for change in self.store.view(
                "agent-b", "changes", {"scope": {"kind": "actor", "id": "agent-b"}, "cursor": before})["items"]]
            self.assertEqual(kinds, ["memory_read"])
            return dict(dirty=True, stop=False)

        def second():
            self.run_cli("post", "t1", "--tells", "agent-b", "This one\nwakes it")
            posted.append(self.latest())
            return dict(dirty=True, stop=False)
        watch, left = self.events(first, second)
        agent = self.agent()
        agent.watch_changes(watch, once=True)
        self.assertEqual(left, [], "it waited until the delivery: %r" % self.stdout.getvalue())
        self.assertEqual(self.stdout.getvalue(), self.line(posted[0], "This one wakes it") + "\n")

    def test_a_delivery_that_cannot_be_read_still_ends_the_wait_naming_why(self):
        def arrives():
            self.run_cli("post", "t1", "--tells", "agent-b", "Unreadable")
            return dict(dirty=True, stop=False)
        watch, _ = self.events(arrives)
        agent = self.agent()
        original = agent.store.view
        agent.store.view = lambda actor, name, args: ({"error": {"code": "FORBIDDEN", "message": "gone"}} if name == "delivery"
                                                      else original(actor, name, args))
        agent.watch_changes(watch, once=True)
        self.assertEqual(self.stdout.getvalue(), "delivery unavailable (FORBIDDEN)  [%s]\n" % self.delivery(self.latest()))

    def test_a_stop_while_waiting_ends_it_with_nothing_printed(self):
        agent = self.agent()
        watch, _ = self.events(lambda: dict(dirty=False, stop=True))
        agent.watch_changes(watch, once=True)
        self.assertEqual((self.stdout.getvalue(), self.stderr.getvalue()), ("", ""))

    def test_json_once_prints_one_delivery_event(self):
        self.run_cli("post", "t1", "--tells", "agent-b", "Waiting")
        message = self.latest()
        agent = self.agent(as_json=True)
        watch, _ = self.events()
        agent.watch_changes(watch, once=True)
        [line] = self.stdout.getvalue().splitlines()
        event = json.loads(line)
        self.assertEqual((event["event"], event["item"]["id"], event["item"]["message"]["id"]),
                         ("delivery", self.delivery(message), message[0]))

    def test_the_usage_names_once(self):
        code, _, err = self.run_cli("watch", "--twice", actor="agent-b")
        self.assertEqual(code, 2)
        self.assertIn("watch [--once]", err)


class WatchOnceProcessCase(test_agent_verbs.AgentVerbCase):
    def once(self, before=()):
        """`watch --once` as agent-b in its own process, with each of before run
        once it has started; its exit code and output."""
        prefix = os.environ.get("PYTHONPYCACHEPREFIX")
        interpreter = [sys.executable, "-I"] + (["-X", "pycache_prefix=" + prefix] if prefix else [])
        process = subprocess.Popen(interpreter + [str(ROOT / "bin" / "aim-next"), "--profile", str(self.profiles["agent-b"]), "watch", "--once"],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for step in before:
                step()
            try:
                # A guard against a hang only; the verb itself never waits on a timer.
                out, err = process.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                self.fail("watch --once did not exit after the delivery")
            return process.returncode, out.decode("utf-8"), err.decode("utf-8")
        finally:
            if process.returncode is None:
                process.send_signal(signal.SIGTERM)
                process.communicate()

    def test_once_with_a_delivery_waiting_prints_it_and_exits(self):
        self.run_cli("post", "t1", "--tells", "agent-b", "Already here")
        message = self.latest()
        delivery = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-b'", (message[0],))[0][0]
        self.assertEqual(self.once(), (0, 'delivery "Topic" #%s agent-a: Already here  [%s in t1]\n' % (message[1], delivery), ""))

    def test_once_in_another_process_exits_by_itself_after_the_next_delivery(self):
        # It prints nothing while it waits, so whether it was waiting or finds
        # the delivery already there, the delivery is its one line (the waiting
        # itself is WatchOnceCase's, through the watch).
        sent = []

        def post():
            self.run_cli("post", "t1", "Not for agent-b")
            code, out, _ = self.run_cli("post", "t1", "--tells", "agent-b", "Wake up")
            self.assertEqual(code, 0, out)
            sent.append(self.latest())
        code, out, err = self.once([post])
        delivery = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-b'", (sent[0][0],))[0][0]
        self.assertEqual((code, out, err), (0, 'delivery "Topic" #%s agent-a: Wake up  [%s in t1]\n' % (sent[0][1], delivery), ""))


for _case in (WatchOnceCase, WatchOnceProcessCase):
    for _base in _case.__mro__[1:]:
        for _name in list(vars(_base)):
            if _name.startswith("test_") and _name not in _case.__dict__:
                setattr(_case, _name, None)
del _case, _base, _name
