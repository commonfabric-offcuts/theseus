#!/usr/bin/python3 -I
"""check_inputs.py [--record] FOLDER

A landing folder's input contract, checked before any suite or preflight. The kit's own files run every step, so
INPUTS.json (written with --record when new_folder.sh makes the folder) names each kit file (.py, .sh, .mjs) with its sha256 and the
kit's commit; every one must still hash as recorded, so a kit changed between the folder's making and its landing
refuses instead of landing with code nobody read. SPEC.json must parse and MERGE-BODY.txt must be readable (both are
the item's own, so they carry no recorded hash). The external helpers config.py names (the ship tool, the deploy
config and its guard, the CLI) must exist and be readable; land.py checks the guard's bytes itself.
Exit 0 prints INPUTS OK; anything else prints STOP and exits 2.
To land with a kit changed on purpose, read the change, then --record again."""
import hashlib, json, os, subprocess, sys
from pathlib import Path

KIT = Path(__file__).resolve().parent
sys.path.insert(0, str(KIT))
import config  # noqa: E402


def stop(why):
    print('STOP: %s: %s' % (F.name, why)); sys.exit(2)


def readable(path):
    return path.is_file() and not path.is_symlink() and os.access(path, os.R_OK)


def kit_files():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(KIT.iterdir())
            if p.is_file() and p.suffix in ('.py', '.sh', '.mjs')}


RECORD = sys.argv[1:2] == ['--record']
F = Path(sys.argv[2 if RECORD else 1]).resolve()
manifest = F / 'INPUTS.json'
if RECORD:
    head = subprocess.run(['git', '-C', str(KIT), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    manifest.write_text(json.dumps({'kit': str(KIT), 'kit_head': head or None, 'files': kit_files()}, indent=1) + '\n')
    print('INPUTS recorded: kit %s at %s, %d files' % (KIT, (head or 'no commit')[:8], len(kit_files())))
    sys.exit(0)
if not readable(manifest):
    stop('no INPUTS.json; make the folder with new_folder.sh')
inputs = json.loads(manifest.read_text())
if inputs.get('kit') != str(KIT):
    stop('the folder was made with the kit at %s, not this one at %s' % (inputs.get('kit'), KIT))
now = kit_files()
changed = sorted(n for n in set(now) | set(inputs.get('files') or {}) if now.get(n) != (inputs.get('files') or {}).get(n))
if changed:
    stop('the kit changed since the folder was made: %s' % ', '.join(changed))
for name in ('SPEC.json', 'MERGE-BODY.txt'):
    if not readable(F / name):
        stop('%s is missing or unreadable' % name)
try:
    json.loads((F / 'SPEC.json').read_text())
except ValueError as error:
    stop('SPEC.json does not parse: %s' % error)
settings = config.load()
for path in (Path(settings['ship']), Path(settings['coordinator']) / 'deploy-trains.json',
             Path(settings['coordinator']) / settings['guard'], Path(settings['live']) / 'bin' / 'aim-next'):
    if not readable(path):
        stop('external helper %s is missing or unreadable' % path)
print('INPUTS OK: kit %s at %s, %d files unchanged' % (KIT, (inputs.get('kit_head') or 'no commit')[:8], len(now)))
