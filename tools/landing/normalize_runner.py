#!/usr/bin/python3 -I
"""normalize_runner.py [--check]

Until item 1149 lands, the deploy finds the runner's supervisor only by a command line that ends with its planned argv
(tools/deploy.py find). A supervisor resumed from a pause ends with --resume-version N instead, so the deploy sees no
runner: a keep policy refuses at its plan, and a restart policy stops only the server and the upgrade meets the
runner's guard. land.py runs it (runner_visible.ensure) before the merge and again before the deploy.

VISIBLE (exit 0): the deploy already finds exactly one supervisor; nothing is done.
RESUMED (exit 0 after the swap; exit 3 with --check): exactly one supervisor of this profile ends with the planned argv
plus --resume-version N. Without --check it is stopped with TERM by PID, its run record's final line must read
stopped, and start_runner_with.py starts it again from the planned argv; the deploy's own find must then see it.
Anything else refuses with exit 2 and changes nothing. .runner-hold in the seat's landing work folder is held for
the swap, so the keepalive stays out."""
import hashlib, json, pathlib, re, subprocess, sys

CHECK = '--check' in sys.argv
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import config as landing  # noqa: E402
CO = pathlib.Path(landing.get('coordinator'))
guard = json.loads((CO / landing.get('guard')).read_text())
assert hashlib.sha256(pathlib.Path(guard['tool']).read_bytes()).hexdigest() == guard['tool_sha256']
for relative, digest in guard['verified_file_sha256'].items():
    assert hashlib.sha256((pathlib.Path(guard['checkout']) / relative).read_bytes()).hexdigest() == digest
sys.path.insert(0, guard['checkout'])
from tools import deploy as deployment  # noqa: E402

config = deployment.load_config(str(CO / 'deploy-trains.json'))
planned = deployment.supervisor_argv(config)[1:]


def say(state, code, **fields):
    print(json.dumps(dict(state=state, **fields))); sys.exit(code)


rows = deployment.processes()
visible = deployment.find(rows, planned)
if len(visible) == 1:
    say('VISIBLE', 0, supervisor=visible[0])
if visible:
    say('REFUSED', 2, why='more than one supervisor matches the planned argv', pids=visible)
tail = ' '.join(planned)
resumed = [(pid, command) for pid, _, command in rows
           if re.search(re.escape(tail) + r' --resume-version \d+$', command) and 'deploy.py' not in command]
if len(resumed) != 1:
    say('REFUSED', 2, why='no single supervisor ends with the planned argv or its resume form', found=[p for p, _ in resumed])
pid = resumed[0][0]
if CHECK:
    say('RESUMED', 3, supervisor=pid, command_tail=resumed[0][1][-40:])
hold = pathlib.Path(landing.get('work')) / '.runner-hold'
held_before = hold.exists()
hold.touch()
try:
    import os
    os.kill(pid, 15)
    exited = deployment.wait_exit(pid)
    last = deployment.run_dirs(config, 'runner')[-1]
    final = (last / 'stdout.log').read_text().splitlines()[-1]
    if json.loads(final).get('status') != 'stopped':
        say('REFUSED', 2, why='the resumed runner did not stop cleanly; nothing started', final=final[:200], exited=exited)
    started = subprocess.run(['/usr/bin/python3', '-I', str(pathlib.Path(__file__).resolve().parent / 'start_runner_with.py'),
                              '--seat-template', config.seat_template], capture_output=True, text=True)
    after = deployment.find(deployment.processes(), planned)
    if started.returncode != 0 or len(after) != 1:
        say('REFUSED', 2, why='the restarted runner is not visible to the deploy', exit=started.returncode,
            stderr=started.stderr[-300:], found=after)
    say('SWAPPED', 0, stopped=pid, final=json.loads(final).get('status'), supervisor=after[0], run=last.name)
finally:
    if not held_before:
        hold.unlink()
