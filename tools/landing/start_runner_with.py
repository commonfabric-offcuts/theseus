#!/usr/bin/python3 -I
# Start the runner's supervisor through the deploy tool's own start(), with extra arguments appended to the last
# recorded canonical argv (no resume flag; the runner state must be stopped). Usage: start_runner_with.py ARG...
import json, sys, hashlib, pathlib, time
EXTRA = sys.argv[1:]; assert EXTRA
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import config as landing  # noqa: E402
CO = pathlib.Path(landing.get('coordinator'))
guard = json.loads((CO / landing.get('guard')).read_text())
assert hashlib.sha256(pathlib.Path(guard['tool']).read_bytes()).hexdigest() == guard['tool_sha256']
for relative, digest in guard['verified_file_sha256'].items():
    assert hashlib.sha256((pathlib.Path(guard['checkout']) / relative).read_bytes()).hexdigest() == digest
sys.path.insert(0, guard['checkout'])
from tools import deploy as deployment
config = deployment.load_config(str(CO / 'deploy-trains.json'))
last = deployment.run_dirs(config, 'runner')[-1]
launch = json.loads((last / 'launch.json').read_text())
final = (last / 'stdout.log').read_text().splitlines()[-1]
assert json.loads(final).get('status') in ('stopped', 'fatal_unsaved', 'exited', 'ownership_lost'), final
prev_pid = json.loads((last / 'pid.json').read_text())['pid']
assert deployment.identity(prev_pid) is None, 'the previous runner is still alive'
source = json.loads((last / 'source.json').read_text()) if (last / 'source.json').exists() else None
base = [a for a in launch['argv'] if a not in ('--resume-version',) and not a.isdigit()]
if '--seat-template' in base:
    i = base.index('--seat-template'); del base[i:i+2]
argv = base + EXTRA
runs = [int(p.name.rsplit('-', 1)[1]) for p in deployment.run_dirs(config, 'runner')]
run_dir = config.instance / ('run-runner-%02d' % (runs[-1] + 1))
print('previous', last.name, 'pid', prev_pid, '| new', run_dir.name, '| argv tail', argv[-8:])
proc = deployment.start(config, launch['revision'], argv, run_dir, {'pid': prev_pid, 'restarted_from': last.name, 'extra': EXTRA}, source=source)
first = deployment.wait_line(run_dir / 'stdout.log', proc)
print('first line:', first)
time.sleep(5)
print('alive:', proc.poll() is None)
print((run_dir / 'stdout.log').read_text()[-600:])
