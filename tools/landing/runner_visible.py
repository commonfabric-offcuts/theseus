"""ensure(land_dir): the runner is one the deploy can see, or the landing stops before anything is stopped.

Until item 1149 is live, the deploy finds the runner's supervisor only by its planned argv; a runner resumed with
--resume-version is invisible to it, and a deploy then stops the server and meets the runner's guard.
normalize_runner.py swaps a resumed runner to the planned argv; this runs it, then its --check, and
returns only when the check reads VISIBLE. Anything else raises NotVisible with both answers, so land.py stops with the
server still up. hold(land_dir) keeps the keepalive out from before the check until the deploy ends, a cycle already
under way included."""
import contextlib, fcntl, json, subprocess
from pathlib import Path


class NotVisible(RuntimeError):
    pass


def _state(out):
    lines = out.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]).get('state') if lines else None
    except ValueError:
        return None


def ensure(land_dir, run=subprocess.run):
    land_dir = Path(land_dir)
    argv = ['/usr/bin/python3', '-I', str(Path(__file__).resolve().parent / 'normalize_runner.py')]
    swap = run(argv, capture_output=True, text=True, cwd=str(land_dir))
    check = run(argv + ['--check'], capture_output=True, text=True, cwd=str(land_dir))
    if check.returncode == 0 and _state(check) == 'VISIBLE':
        return {'normalize': _state(swap), 'normalize_exit': swap.returncode, 'check': 'VISIBLE'}
    raise NotVisible('the runner is not visible to the deploy: normalize exit %s %s; check exit %s %s' % (
        swap.returncode, swap.stdout.strip()[-200:], check.returncode, check.stdout.strip()[-200:]))


@contextlib.contextmanager
def hold(land_dir):
    land_dir = Path(land_dir)
    path = land_dir / '.runner-hold'
    held_before = path.exists()
    path.touch()
    try:
        # The keepalive checks the hold file under this lock (runner-keepalive.sh), so passing through it waits for a
        # cycle already past its check; every later cycle sees the hold file and does nothing.
        with open(land_dir / '.runner-cycle.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
        yield
    finally:
        if not held_before:
            path.unlink()
