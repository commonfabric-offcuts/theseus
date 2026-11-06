# Tools

The tools under `tools/` check a commit, prove a check catches what it claims to, and deploy a checked commit. They use CPython 3.9 (`/usr/bin/python3`) and the standard library only, and each one's checks are in `tests/test_tools_*.py`. None of them names a machine path: the instance, profiles and browser come from arguments or a config file.

## Mutant helper: `tools/mutant.py`

A check is load-bearing only if it fails when the behaviour it covers is broken. The helper breaks it, runs the check, and puts it back:

```sh
tools/mutant.py --name drop-guard \
  --replace aim_next/marks.py 'if not pending:' 'if False:' \
  -- /usr/bin/python3 -m unittest tests.test_marks
```

- Each `OLD` must occur exactly once in its file, or nothing changes (exit 2). `--replace` can repeat; replacements in one file apply in order.
- The command runs with the mutant in place and its own `PYTHONPYCACHEPREFIX`. It kills the mutant only by exiting non-zero and printing a line matching `--killed-by` (default: unittest's `FAILED`, TAP's `not ok`, or node's `✖`). A crash or an exit without such a line is not a kill.
- The files are written back byte for byte, even when the run is interrupted, and the command runs again as a control with a fresh `PYTHONPYCACHEPREFIX`. It must pass.
- Exit 0: killed, restored, control passed. Exit 1: the mutant survived or the control failed. `verdict.json`, `mutant.log` and `control.log` are in `--evidence` (default: a new temporary directory), with a copy of each original file.

Run it in a worktree that nobody else is editing, since restoring writes the files back as they were when it started.
