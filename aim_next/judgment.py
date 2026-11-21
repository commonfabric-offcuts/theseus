from __future__ import annotations

"""One path policy for the train guard and Core's actual-diff freeze record."""
import re
import subprocess
from pathlib import Path

DEPLOY_TOOL = ("tools/deploy.py", "tools/release_check.py", "tools/unit_shards.py", "tools/known_reds.py", "tools/releases.py", "tools/train.py",
               "tools/checks.py", "tools/ci_known_reds.py", "tools/ci_input_reads.py", "tools/ci-input-reads.json",
               "tools/quarantine.py", "tools/steps_for.py", "tools/base_move.py", "tools/own_case_receipt.py", "tools/continuation_envelope.py",
               "tools/runner_runtime.py", "tools/gauntlet_admission.py", "aim_next/judgment.py")
CONTROLLER = ".github/"
MIGRATIONS = ("aim_next/migrations.py",)


def guarded(paths):
    return [path for path in paths if path in DEPLOY_TOOL or path in MIGRATIONS or path.startswith(CONTROLLER)]


def source_diff(repo, base, head):
    """Read actual source outside Core's transaction. Deletions/renames keep both paths."""
    if not Path(repo).is_absolute() or any(re.fullmatch(r"[0-9a-f]{40}", s or "") is None for s in (base, head)):
        raise ValueError("Name an absolute repository and full base/head commits")
    def git(*args):
        result = subprocess.run(['git', '-C', str(repo)] + list(args), capture_output=True)
        if result.returncode:
            raise ValueError("The frozen source could not be read: " + result.stderr.decode('utf-8', 'replace')[:300])
        return result.stdout
    git('merge-base', '--is-ancestor', base, head)
    # No external diff/filter, and no rename folding that could hide a guarded deletion.
    names = git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, head)
    try:
        return [name.decode('utf-8') for name in names.split(b'\0') if name]
    except UnicodeDecodeError:
        raise ValueError("Changed paths must be UTF-8")
