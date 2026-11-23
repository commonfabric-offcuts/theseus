from __future__ import annotations

"""Private fixture cleanup: restore owned Builds, retain every independent error."""
import hashlib
import json
from pathlib import Path
import sys
import traceback


def runtime_snapshot(server):
    return {"stamp": server.build.stamp,
            "hashes": {name: hashlib.sha256(data).hexdigest() for name, data in server.build.files.items()},
            "csp_sha256": hashlib.sha256(server.csp.encode()).hexdigest()}


class FixtureCleanupError(RuntimeError):
    pass


class FixtureCleanup:
    def __init__(self, destination=None):
        self.destination = Path(destination) if destination is not None else None
        self.errors = []
        if self.destination is not None:
            # An existing run's proof is never truncated or appended to.
            with self.destination.open("x", encoding="utf-8"):
                pass

    def __enter__(self):
        return self

    def __exit__(self, kind, error, trace):
        # Entered before TemporaryDirectory: the final observation is written
        # after its cleanup, and an original exception is allowed to propagate.
        self.finish(error)
        return False

    def error(self, stage, error):
        self.errors.append({"stage": stage, "type": type(error).__name__, "message": str(error),
                            "traceback": "".join(traceback.format_exception(type(error), error, error.__traceback__))})

    def record(self, event, **facts):
        if self.destination is None:
            return
        try:
            with self.destination.open("a", encoding="utf-8") as output:
                output.write(json.dumps(dict(facts, event=event)) + "\n")
                output.flush()
        except BaseException as error:
            self.error("evidence-write", error)

    def attempt(self, stage, action):
        try:
            answer = action()
        except BaseException as error:
            self.error(stage, error)
            self.record("cleanup-stage", stage=stage, status="error", error=self.errors[-1])
            return None
        self.record("cleanup-stage", stage=stage, status="ok")
        return answer

    def restore_650(self, runtime):
        if runtime.active is None:
            return
        owner, candidate, csp = runtime.active
        before = runtime_snapshot(owner)
        receipt = runtime.select(owner, "restored")
        assert runtime.active is None and owner.build is candidate and owner.csp == csp
        self.record("runtime-restored", owner="650", needed=True, before=before,
                    after=runtime_snapshot(owner), expected_hashes=receipt["hashes"])

    def restore_runtime(self, server, candidate, csp, owner, selections):
        before = runtime_snapshot(server)
        needed = server.build is not candidate or server.csp != csp
        server.build, server.csp = candidate, csp
        after = runtime_snapshot(server)
        assert server.build is candidate and server.csp == csp, "Exact fixture candidate must be restored"
        assert after["hashes"] == {name: hashlib.sha256(data).hexdigest() for name, data in candidate.files.items()}
        self.record("runtime-restored", owner=owner, needed=needed, before=before, after=after,
                    expected_hashes=after["hashes"], selections=selections)

    def finish(self, body_error=None):
        self.record("cleanup-complete", errors=list(self.errors),
                    fixtureBodyError=None if body_error is None else {
                        "type": type(body_error).__name__, "message": str(body_error)})
        for error in self.errors:
            print("Fixture cleanup stage: " + error["stage"], file=sys.stderr)
            print(error["traceback"], end="", file=sys.stderr)
        if self.errors and body_error is None:
            raise FixtureCleanupError("Fixture cleanup failed: " + ", ".join(error["stage"] for error in self.errors))
