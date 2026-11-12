from __future__ import annotations

"""Authority-bound operator intent for hosted seats; never delivery acknowledgement."""

import json

from .contract import Refusal, _identifier, _json
from . import delivery

PREFIX = "hosted_control.v1:"


class HostedControl:
    def _hosted_status(self, db, actor_id, viewer, runner_live):
        control = self._hosted_control(db, actor_id)
        thread = self._hosted_thread(db, actor_id)
        if control is None or thread is None:
            return None
        active = db.execute("SELECT handed_ms FROM hosted_turns INDEXED BY hosted_turns_open WHERE thread_id=? AND final_status IS NULL LIMIT 1", (thread,)).fetchone()
        claim = db.execute("SELECT claim_until_ms FROM recipient_schedule WHERE recipient_id=? AND claim_token IS NOT NULL", (actor_id,)).fetchone()
        claiming = claim is not None and claim[0] > delivery._now_ms()
        last = db.execute("SELECT substr(value,1,8193) FROM metadata WHERE key=?", ("hosted_activity.v1:" + actor_id,)).fetchone()
        last = json.loads(last[0]) if last else None
        if last and last.get("thread_id") != thread:
            last = None
        waiting = db.execute("SELECT q.ask_message_id FROM topic_waiting q INDEXED BY reader_waiting JOIN messages m ON m.id=q.ask_message_id "
                             "WHERE q.actor_id=? AND q.archived=0 AND m.author_id=? LIMIT 1", (control["owner_id"], actor_id)).fetchone()
        fault = db.execute("SELECT failed_wakes,failed_reason,failed_outcome FROM wake_facts WHERE recipient_id=?", (actor_id,)).fetchone()
        failure = None
        if fault and fault[0]:
            from .health import why_words
            failure = why_words(fault[1], fault[2])
        source = waiting[0] if waiting else None
        if source is None:
            row = db.execute("SELECT d.message_id FROM delivery_groups g INDEXED BY eligible_groups "
                             "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
                             "WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0 LIMIT 1", (actor_id,)).fetchone()
            source = row[0] if row else None
        work = None
        if source:
            try:
                item = self._message_access(db, viewer, source)
                work = {"topic_id":item["topic_id"], "message_id":source}
            except Refusal:
                pass
        if control["desired"] == "stopped":
            state = "stopping" if active or claiming else "stopped"
        elif active:
            state = "working" if runner_live else "unavailable"
        elif failure or (last and last["status"] in ("failed", "lost")):
            state = "failed"
        else:
            state = "waiting" if waiting else "idle"
        return {"state": state, "desired": control["desired"], "execution_revision": control["revision"],
                "can_control": viewer == control["owner_id"], "since_ms": active[0] if active else control["changed_ms"],
                "last_finished": last, "failure": failure, "work": work}

    def _record_hosted_completion(self, db, actor_id, thread_id, status, now):
        value = _json({"thread_id": thread_id, "status": status, "finished_ms": now})
        db.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   ("hosted_activity.v1:" + actor_id, value))

    def _hosted_control(self, db, actor_id):
        row = db.execute("SELECT substr(value,1,8193) FROM metadata WHERE key=?", (PREFIX + actor_id,)).fetchone()
        if row is None:
            return None
        try:
            value = json.loads(row[0])
            assert len(row[0]) <= 8192
            assert set(value) == {"v", "binding", "owner_id", "desired", "revision", "changed_ms"}
            assert value["v"] == 1 and value["desired"] in ("running", "stopped")
            assert type(value["revision"]) is int and value["revision"] >= 1
            assert type(value["changed_ms"]) is int
            _identifier(value["owner_id"], "owner_id")
        except (ValueError, TypeError, AssertionError, Refusal):
            raise Refusal("HOSTED_CONTROL_INVALID", "The hosted control record is invalid; preserve it for inspection")
        expected = dict(self.binding, instance_id=self.instance_id, actor_id=actor_id, db_path=str(self.path))
        # A copied database or a new authority cannot silently inherit control.
        if value["binding"] != expected:
            raise Refusal("HOSTED_CONTROL_BINDING_MISMATCH", "The hosted control belongs to another binding")
        return value

    def _provision_hosted_owner(self, db, actor_id, owner_id, now):
        owner = db.execute("SELECT kind,enabled FROM actors WHERE id=?", (_identifier(owner_id, "owner_id"),)).fetchone()
        if owner is None or owner["kind"] != "human" or not owner["enabled"]:
            raise Refusal("INVALID_OWNER", "A hosted seat's owner must be an enabled human")
        current = self._hosted_control(db, actor_id)
        if current is not None:
            if current["owner_id"] != owner_id:
                raise Refusal("HOSTED_OWNER_MISMATCH", "This seat already has another owner; never replace it implicitly")
            return False
        binding = dict(self.binding, instance_id=self.instance_id, actor_id=actor_id, db_path=str(self.path))
        value = dict(v=1, binding=binding, owner_id=owner_id, desired="running", revision=1, changed_ms=now)
        db.execute("INSERT INTO metadata(key,value) VALUES (?,?)", (PREFIX + actor_id, _json(value)))
        return True

    def _command_agent_execution(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"actor_id"} or set(args) != {"desired"} or args["desired"] not in ("running", "stopped"):
            raise Refusal("INVALID_ARGUMENT", "Name a hosted agent and running or stopped")
        agent = _identifier(target["actor_id"], "actor_id")
        current = self._hosted_control(db, agent)
        if current is None or self._hosted_thread(db, agent) is None:
            raise Refusal("HOSTED_CONTROL_MISSING", "This hosted seat has no operator controls provisioned")
        owner = db.execute("SELECT kind FROM actors WHERE id=?", (actor,)).fetchone()
        if current["owner_id"] != actor or owner["kind"] != "human":
            raise Refusal("FORBIDDEN", "Only this hosted seat's human owner may stop or continue it")
        if envelope["expected"]["execution_revision"] != current["revision"]:
            raise Refusal("REVISION_CONFLICT", "The agent's control changed since it was read", {"execution_revision": current["revision"]})
        if args["desired"] == current["desired"]:
            return {"actor_id": agent, "desired": current["desired"], "execution_revision": current["revision"], "changed": False}, []
        value = dict(current, desired=args["desired"], revision=current["revision"] + 1, changed_ms=delivery._now_ms())
        db.execute("UPDATE metadata SET value=? WHERE key=?", (_json(value), PREFIX + agent))
        if args["desired"] == "running":
            # A deliberate Continue releases parked or interrupted pending work,
            # while preserving an in-flight claim and every delivery record.
            db.execute("UPDATE recipient_schedule SET named_seq=NULL,retry_count=0,handed_seq=NULL,"
                       "next_due_ms=CASE WHEN claim_token IS NULL THEN ? ELSE claim_until_ms END "
                       "WHERE recipient_id=? AND pending_count>0", (value["changed_ms"], agent))
        self._change(db, "actor", actor, "agent_execution", agent, value["revision"])
        return {"actor_id": agent, "desired": value["desired"], "execution_revision": value["revision"], "changed": True}, [
            {"kind": "agent_execution", "id": agent, "version": value["revision"]}]

    def hosted_controls(self, guard, runner_token, recipients):
        """Recheck controls immediately before sending work, under the runner lease."""
        def action(db, now):
            status = self._ownership(self._runner_state(db), guard, runner_token, now)
            if status != "running":
                return {"status": status}, False
            return {"status": "ok", "controls": {agent: self._hosted_control(db, agent) for agent in recipients}}, False
        return self._effect(guard, action)
