from __future__ import annotations

"""Future isolated compose producer. Not invoked during source preparation.

Requires an explicit immutable group and runtime paths. No production defaults,
network, installation, dispatch, store access, profile or key discovery.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def run(root, group, evidence, chrome, playwright, node='node'):
    from tools import compose_groups as c
    root, evidence = Path(root).resolve(), Path(evidence).resolve()
    if 'cases' not in group:
        prepared = c.partition(c.enumerate_source(root, group['source']['head'], node), group['source'])
        choices = [g for g in prepared['groups'] if g['id'] == group['id']]
        if len(choices) != 1 or any(choices[0].get(k) != v for k, v in group.items()):
            raise c.Refused('compact group differs from reconstructed source inventory')
        group = choices[0]
    if root == evidence or root in evidence.parents:
        raise c.Refused('compose evidence must be outside disposable source checkout')
    if not Path(chrome).is_absolute() or not Path(playwright).is_absolute():
        raise c.Refused('compose runtime paths must be explicit absolute paths')
    source = group['source']
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root)] + list(args)).decode().strip()
    if git('rev-parse', 'HEAD') != source['head'] or git('rev-parse', 'HEAD^{tree}') != source['tree']:
        raise c.Refused('group actual checkout differs from product source')
    if git('status', '--porcelain'):
        raise c.Refused('compose group requires a clean disposable source checkout')
    if not group['cases'] or c.digest(group['cases']) != group['cases_sha256']:
        raise c.Refused('group cases digest differs')
    evidence.mkdir(parents=True, exist_ok=False)
    harness = root / 'tests/reader_compose_native.mjs'
    original = harness.read_bytes()
    tools = Path(__file__).resolve().parent
    patched = evidence / 'instrumented-reader.mjs'
    helper = tools / 'compose_deadline_775.mjs'
    subprocess.run([node, str(tools / 'compose_instrument.cjs'), str(harness), str(patched), helper.as_uri()], check=True)
    binding = {'product': source, 'original_harness_sha256': hashlib.sha256(original).hexdigest(),
               'instrumented_harness_sha256': hashlib.sha256(patched.read_bytes()).hexdigest(),
               'instrument_sha256': hashlib.sha256(helper.read_bytes()).hexdigest(),
               'supervisor_sha256': hashlib.sha256((tools / 'compose_worker_775.mjs').read_bytes()).hexdigest(),
               'wrapper_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'base_at_run_authority': 'job run.json; no wrapper substitution', 'actual_runtime': None, 'admitted': False}
    (evidence / 'source-binding.json').write_text(json.dumps(binding, indent=2))
    group_path = evidence / 'group.json'; group_path.write_text(json.dumps(group, indent=2))
    started = time.monotonic()
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    env = dict(os.environ, AIM_COMPOSE_GROUP=str(group_path), AIM_PLAYWRIGHT_CORE=playwright,
               PYTHONPYCACHEPREFIX=str(evidence / 'pyc'))
    try:
        harness.write_bytes(patched.read_bytes())
        # No subprocess timeout/signal: the instrument owns terminal cleanup and
        # exits itself. Whole-job capacity remains the runner's external ceiling.
        with (evidence / 'native-compose.log').open('w') as log:
            result = subprocess.run([node, str(tools / 'compose_worker_775.mjs'), str(harness), chrome, str(evidence), str(group_path)], cwd=str(root), env=env,
                                    stdout=log, stderr=subprocess.STDOUT)
    finally:
        harness.write_bytes(original)
    if git('status', '--porcelain'):
        raise c.Refused('group source changed beyond instrument restoration; retain raw evidence')
    binding['actual_runtime'] = {'node': subprocess.check_output([node, '--version']).decode().strip(),
                                 'python': sys.version.split()[0], 'platform': sys.platform,
                                 'chrome_executable': chrome, 'playwright_directory': playwright}
    (evidence / 'source-binding.json').write_text(json.dumps(binding, indent=2))
    terminal = evidence / 'group-timeout.json'; report = evidence / 'native.json'
    data = json.loads((terminal if terminal.exists() else report).read_text()) if terminal.exists() or report.exists() else {}
    binding['actual_runtime']['browser_engines'] = data.get('scope775', {}).get('runtime', [])
    package = Path(playwright) / 'package.json'
    try:
        package_bytes = package.read_bytes()
        binding['actual_runtime']['playwright_version'] = json.loads(package_bytes)['version']
        binding['actual_runtime']['playwright_package_sha256'] = hashlib.sha256(package_bytes).hexdigest()
    except (OSError, ValueError, KeyError) as error:
        binding['actual_runtime']['playwright_version'] = None
        binding['actual_runtime']['version_error'] = str(error)
    (evidence / 'source-binding.json').write_text(json.dumps(binding, indent=2))
    rows = data.get('results', [])
    planned = {r['name']: r for r in group['cases']}
    rows = [dict(r, phase=planned[r['name']]['phase'], engine=planned[r['name']]['engine'])
            for r in rows if r.get('name') in planned]
    complete = (not terminal.exists() and data.get('scope775', {}).get('groupCompleted') is True
                and data.get('scope775', {}).get('group') == group['id']
                and data.get('scope775', {}).get('cases_sha256') == group['cases_sha256']
                and len(rows) == len(planned) and {r['name'] for r in rows} == set(planned))
    cleanup = (data.get('browserClosed') is True and data.get('fixtureExitCode') == 0
               and data.get('fixtureExitSignal') is None and not data.get('fixtureErrors')
               and data.get('shortFixture', {}).get('exitCode') == 0
               and data.get('shortFixture', {}).get('exitSignal') is None
               and not data.get('shortFixture', {}).get('errors') and not terminal.exists())
    receipt = {'group': group['id'], 'source': source, 'cases_sha256': group['cases_sha256'],
               'complete': complete, 'cleanup': cleanup, 'results': rows, 'planned_cases': group['cases'], 'exit': result.returncode,
               'seconds': time.monotonic() - started, 'binding': binding, 'terminal': data.get('terminal'),
               'started_at': started_at, 'finished_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'passed': complete and cleanup and result.returncode == 0 and all(r['passed'] is True for r in rows)}
    (evidence / 'group-receipt.json').write_text(json.dumps(receipt, indent=2))
    return receipt


def main():
    p = argparse.ArgumentParser()
    for name in ('root', 'group', 'evidence', 'chrome', 'playwright'):
        p.add_argument('--' + name, required=True)
    p.add_argument('--node', default='node')
    p.add_argument('--release-out')
    a = p.parse_args()
    if __package__ in (None, ''):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    receipt = run(a.root, json.loads(Path(a.group).read_text()), a.evidence, a.chrome, a.playwright, a.node)
    if a.release_out:
        from tools import release_check as check
        target = Path(a.release_out); target.mkdir(parents=True, exist_ok=True)
        step = {'name': 'native-compose', 'tool': 'tools/run_compose_group.py',
                'passed': receipt['passed'], 'exit': receipt['exit'],
                'counts': {'tests': len(receipt['results']), 'failed': sum(r['passed'] is False for r in receipt['results'])},
                'compose_receipt': receipt}
        summary = {'tool': check.TOOL, 'commit': receipt['source']['head'], 'checkout': str(Path(a.root).resolve()),
                   'chrome': a.chrome, 'playwright': a.playwright, 'tools': check.tools_of(Path(a.root), a.chrome, sys.executable, a.node),
                   'started_at': receipt['started_at'], 'finished_at': receipt['finished_at'],
                   'required': list(check.REQUIRED), 'only': ['native-compose'], 'steps': [step],
                   'compose_group': json.loads(Path(a.group).read_text()),
                   'tree_unchanged': True, 'tree_after': {'head': receipt['source']['head'], 'changes': ''},
                   'passed': receipt['passed'], 'failed': [] if receipt['passed'] else ['native-compose']}
        (target / 'summary.json').write_text(json.dumps(summary, indent=2))
    return 0 if receipt['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
