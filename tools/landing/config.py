"""One seat's landing settings, read from a single JSON file (1196).

Every path a landing step needs that differs from seat to seat or Mac to Mac lives here, so the kit itself holds
none. The file is $THESEUS_LANDING_CONFIG, else ~/.config/theseus/landing.json. config.example.json shows every key.

From a shell:  python3 tools/landing/config.py KEY      prints one value ('' for an optional key left out)
               python3 tools/landing/config.py cli      prints the board's CLI as this seat
               python3 tools/landing/config.py --check  names the file it read and refuses on a missing key
"""
import json
import os
import pwd
import sys
from pathlib import Path

KEYS = {
    'seat': 'the seat that lands, as the board names it (signs the posts)',
    'profile': "the seat's own profile file for the board's CLI",
    'workspace': 'the board workspace the pipeline lives in',
    'live': 'the live checkout the service runs (its bin/aim-next is the CLI)',
    'instance': "the live instance's folder (its data.sqlite3 and backups/)",
    'work': 'the folder holding one landing folder per item (NNNN-land)',
    'clone': 'the clone where carry worktrees are added',
    'worktrees': 'the folder carry worktrees are created in',
    'scratch': 'scratch space for exports and test runs',
    'remote': 'the push URL of the repository',
    'repo': 'owner/name of the repository on GitHub',
    'release_branch': 'the branch live is released from',
    'coordinator': "the coordinator folder holding the deploy guard files and deploy-trains.json",
    'guard': "the installed deploy tool's guard file in the coordinator folder (deploy-tool-<head>-installed.json)",
    'ship': 'the ship.py whose open_turns() reads hosted turns',
    'posts': 'the folder holding each item\'s dossier-NNNN.txt and card-NNNN.md drafts',
    'cards_note': 'the notebook page the cards are added to',
    'releases_topic': 'the topic dossiers are posted in',
    'dossier_tells': 'who a dossier is addressed to',
}
# A command run with the item and the release once a release is live, for the seat's own bookkeeping.
OPTIONAL = {'on_live': 'a command run as: on_live ITEM "live RELEASE"'}


def path():
    # Lanes run with HOME pointed at scratch, so the default comes from the account's own home.
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    return Path(os.environ.get('THESEUS_LANDING_CONFIG') or home / '.config' / 'theseus' / 'landing.json')


def load():
    source = path()
    try:
        values = json.loads(source.read_text())
    except FileNotFoundError:
        raise SystemExit('REFUSED: no landing config at %s; copy tools/landing/config.example.json there and fill it' % source)
    except ValueError as error:
        raise SystemExit('REFUSED: the landing config at %s is not JSON: %s' % (source, error))
    missing = [key for key in KEYS if not values.get(key)]
    if missing:
        raise SystemExit('REFUSED: the landing config at %s lacks %s' % (source, ', '.join(missing)))
    return values


def get(key):
    if key not in KEYS and key not in OPTIONAL:
        raise SystemExit('REFUSED: %r is not a landing config key; the keys are %s' % (key, ', '.join(list(KEYS) + list(OPTIONAL))))
    return load().get(key) or ''


def cli():
    """The board's CLI as this seat, as an argv prefix."""
    values = load()
    return ['/usr/bin/python3', '-I', str(Path(values['live']) / 'bin' / 'aim-next'), '--profile', values['profile']]


def main(argv):
    if argv == ['--check']:
        load()
        print('landing config %s: all %d keys present' % (path(), len(KEYS)))
        return 0
    if argv == ['cli']:
        print(' '.join(cli()))
        return 0
    if len(argv) != 1:
        raise SystemExit('usage: config.py KEY | cli | --check')
    print(get(argv[0]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
