"""Lane test runs and landings on one Mac share locks instead of hold and FREE posts (1195).

A lane wraps each test run:   python3 tools/lane_lock.py run --label "1174 green" -- node --test ...
A landing wraps its suite:    python3 tools/lane_lock.py landing --label "398 1160" -- bash land-ordinary.sh ...
Anyone reads who holds what:  python3 tools/lane_lock.py status

A run waits while a landing is pending or running, then takes one of the run slots.
A landing first marks itself pending, so no new run starts, then waits for the runs
already started to end. Every lock is a kernel flock on an open file, and the wrapped command
inherits that file, so the lock is held until both the wrapper and its command have exited,
for any reason: a wrapper killed with kill -9 leaves the lock with its still-running command.
"""
import argparse
import fcntl
import json
import os
import pwd
from pathlib import Path
import signal
import subprocess
import sys
import time

SLOTS = 3
# Lanes run their tests with HOME pointed at scratch, so the default comes from the
# account's own home and every seat on this Mac meets the same files.
DEFAULT_DIR = Path(pwd.getpwuid(os.getuid()).pw_dir) / '.local' / 'share' / 'theseus' / 'locks'


def lock_dir():
    path = Path(os.environ.get('THESEUS_LOCK_DIR') or DEFAULT_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


class Held:
    """An open file whose flock is held; the label written into it names the holder."""

    def __init__(self, path, mode, blocking=True):
        self.path = path
        self.named = False
        self.fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
        try:
            fcntl.flock(self.fd, mode | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            os.close(self.fd)
            raise

    def name(self, label):
        record = json.dumps({'label': label, 'pid': os.getpid(), 'since': time.strftime('%Y-%m-%dT%H:%M:%S%z')})
        os.ftruncate(self.fd, 0)
        os.pwrite(self.fd, record.encode(), 0)
        self.named = True

    def release(self):
        if self.fd is not None:
            if self.named:
                try:
                    os.ftruncate(self.fd, 0)
                except OSError:
                    pass
            os.close(self.fd)
            self.fd = None


def holder(path):
    """The label in a lock file, or None when nobody holds it."""
    try:
        fd = os.open(path, os.O_RDWR)
    except FileNotFoundError:
        return None
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            data = os.pread(fd, 4096, 0).decode(errors='replace')
            try:
                return json.loads(data)
            except ValueError:
                return {'label': 'unnamed', 'pid': None, 'since': None}
        fcntl.flock(fd, fcntl.LOCK_UN)
        return None
    finally:
        os.close(fd)


def say(text):
    print('lane-lock: ' + text, file=sys.stderr, flush=True)


def take_slot(directory, label, slots, poll=1.0):
    """Wait for a free run slot. flock cannot wait on any one of several files, so a
    run with every slot taken tries them all again each second."""
    announced = False
    while True:
        for index in range(slots):
            try:
                slot = Held(directory / 'run-slot-{}'.format(index), fcntl.LOCK_EX, blocking=False)
            except BlockingIOError:
                continue
            slot.name(label)
            return slot
        if not announced:
            say('all {} run slots are in use; waiting'.format(slots))
            announced = True
        time.sleep(poll)


def run_child(command, held):
    # The command holds the same open files, so a lock outlives a killed wrapper while its command runs.
    child = subprocess.Popen(command, pass_fds=[h.fd for h in held])

    def forward(signum, _frame):
        child.send_signal(signum)
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, forward)
    return child.wait()


def admit(directory, label, slots):
    """A slot and the shared running lock, taken only while no landing is pending. A run waiting
    for capacity holds no landing lock, so it cannot keep a pending landing from draining."""
    while True:
        slot = take_slot(directory, label, slots)
        try:
            gate = Held(directory / 'landing-pending', fcntl.LOCK_SH, blocking=False)
        except BlockingIOError:
            slot.release()
            pending = holder(directory / 'landing-pending')
            say('a landing is pending ({}); waiting for it to end'.format((pending or {}).get('label')))
            # Passing through the pending lock means that landing has ended.
            Held(directory / 'landing-pending', fcntl.LOCK_SH).release()
            continue
        try:
            # With the pending lock held shared, no landing is pending or running, so this does not wait.
            return slot, Held(directory / 'landing-running', fcntl.LOCK_SH)
        finally:
            gate.release()


def run(label, command, slots=SLOTS):
    slot, running = admit(lock_dir(), label, slots)
    try:
        return run_child(command, [running, slot])
    finally:
        slot.release()
        running.release()


def landing(label, command):
    directory = lock_dir()
    pending = Held(directory / 'landing-pending', fcntl.LOCK_EX)
    pending.name(label)
    try:
        open_runs = [h for h in (holder(directory / 'run-slot-{}'.format(i)) for i in range(SLOTS)) if h]
        if open_runs:
            say('waiting for {} open run(s): {}'.format(len(open_runs), ', '.join(h.get('label', '?') for h in open_runs)))
        running = Held(directory / 'landing-running', fcntl.LOCK_EX)
        running.name(label)
        try:
            say('landing {} holds the lock; no lane run starts until it ends'.format(label))
            return run_child(command, [pending, running])
        finally:
            running.release()
    finally:
        pending.release()


def status():
    directory = lock_dir()
    lines = []
    for name in ('landing-pending', 'landing-running'):
        h = holder(directory / name)
        lines.append('{}: {}'.format(name, '{} (pid {}, since {})'.format(h.get('label'), h.get('pid'), h.get('since')) if h else 'free'))
    for index in range(SLOTS):
        h = holder(directory / 'run-slot-{}'.format(index))
        lines.append('run-slot-{}: {}'.format(index, '{} (pid {}, since {})'.format(h.get('label'), h.get('pid'), h.get('since')) if h else 'free'))
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='action', required=True)
    for action in ('run', 'landing'):
        p = sub.add_parser(action)
        p.add_argument('--label', required=True)
        p.add_argument('command', nargs=argparse.REMAINDER)
    sub.add_parser('status')
    args = parser.parse_args(argv)
    if args.action == 'status':
        print(status())
        return 0
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('a command follows --')
    return run(args.label, command) if args.action == 'run' else landing(args.label, command)


if __name__ == '__main__':
    sys.exit(main())
