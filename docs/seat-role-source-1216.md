# Repository seat roles (1216)

This successor to1213 uses the verified hosted actor's existing repository
seat file as its role. The path is the same absolute docs/seats/ACTOR.md
resolved from the configured CLI by1213, never the hosted cwd or a search.
When that path is a regular file, thread_settings keeps the trusted bound
CLI/identity instructions and seat-file bootstrap but omits the configured
Standing role text from both thread/start and thread/resume. Provisioning,
automatic recovery and explicit refresh use this same assembly.

The runtime does not inline or execute the seat file. The agent must read it
and recover actual work/current rules through its unchanged bound CLI. A file
with no read permission still selects the repository role: the pointer remains
and the agent reports an unreadable-file limitation, rather than receiving
stale configured instructions as an implicit fallback. A metadata access error
while establishing file existence is not converted to a successful fallback.
The synthetic host proof records actual serialized inputs, not a model's read.

Compatibility default: if the selected path is absent or not a regular file,
the existing configured role is delivered unchanged, with1213's seat-file
pointer still present. A same-named file in the cwd or another CLI tree cannot
suppress that role. Every settings assembly checks the selected path anew;
removal therefore restores this stated legacy behavior on a later resume.

No role/profile/route/metadata is rewritten. Actor, binding, owner, Stop and
Continue, pin/history, model, permissions and writable roots remain the
existing contracts. This does not operate a live refresh or authorize reboot.
Fable owns seat-file content reconciliation and Warp owns carry/landing after
1213 on its actual installed base.

Proof uses isolated temporary files and the real provisioning/runner host
against the synthetic app-server. Keep actual start/resume/fresh-start wire,
unchanged profile/configuration bytes, present/missing/unreadable and CLI-root
cases; apply an assembly mutation, observe the intended failure and restore.
Whole direct consumers run under the installed per-file lock; source identity,
body entry, failures and direct terminal/cleanup stay separately reported.
