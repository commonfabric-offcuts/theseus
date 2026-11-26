# Supplied runtime and task paths

Use the inputs selected for this seat and its current assignment. A machine's
account name, the shell's working directory and an old report do not select a
Theseus instance.
The [retained board relocation catalog](board-relocation.md) describes history-preserving tools and their execution limits separately from supplied task paths.

## Launch inputs

The trusted launch supplies the actor, the exact bound CLI invocation (including
its interpreter, CLI script and selected profile or broker), and the working
directory. Keep that invocation intact. `BOUND_CLI` in the seat guides means
that complete supplied invocation; it is notation, not an executable, a shell
variable to discover, or a replacement profile. The first bound command for a
hosted seat is `inbox`.

Read the role file at the absolute path selected by the launch. Hosted startup
derives it from the configured CLI script: for `ROOT/bin/aim-next`, it is
`ROOT/docs/seats/ACTOR.md`; for `ROOT/aim-next`, it is
`ROOT/docs/seats/ACTOR.md`. The interpreter, profile directory and hosted cwd
are not that repository root. Do not search other checkouts for a role when the
selected file is unavailable. Report the selected path and exact read failure
through the unchanged working channel.

A supplied profile or broker remains the selected identity. Do not derive one
from the repository root, account home, actor name or another seat's files.
Keep profile contents private. A binding refusal stops the affected operation;
retain its exact request/refusal and ask the coordinator through a working
bound channel. Never change a binding or retrieve refused content elsewhere.

## Assignment inputs

The current assignment supplies the source-worktree and durable evidence
destinations. The trusted working directory can hold evidence when the
assignment explicitly selects it. Record the exact worktree, branch/base,
dirty or untracked writing, evidence destination, original clocks and pending
operation IDs in the piece's existing board stack. Keep indispensable work out
of temporary directories.

Use those supplied destinations for new work. If the assignment has not supplied
a required destination, report that missing input before creating files. If a
supplied destination is unavailable, report the concrete filesystem failure.
Do not choose another home, search for a profile, or invent a global
worktree/evidence default.
These destinations are task inputs: they do not widen permissions or change
the legacy hosted `writable_roots`, an authority binding or an instance.
A supplied path alone grants no permission to edit another owner's tree.

For interrupted work, first recover the exact source and evidence references
already recorded on its piece. Missing old files remain a recovery gap, not
permission to recreate a completed producer or replace its evidence. Preserve
parked work and the original Build/forecast anchors.

## Current instructions and historical paths

Relative documentation links resolve within the selected repository. Commands
use the exact supplied invocation and explicit task inputs. Keep paths with
spaces or shell punctuation as single arguments; preserve the supplied quoting
or use an argument array. An unresolved placeholder is not a runnable command.

Historical receipts, source reports, evidence paths, saved operations and launch
records retain their original literal paths, bytes and identities. Do not
globally substitute a new account/root into them. An old path identifies what
was observed; it is not a default for a new task. Recover an uncertain send
from the original bound outbox under the same operation ID before any retry.
A changed path does not establish that an operation failed or can be replayed.

The role files' explicitly historical deployment references have this meaning
even when the original location is unavailable. A move needs its own supported
continuity contract and current operator authority; this guide neither
relocates credentials/authority nor changes installed kickoffs, refresh scripts,
services or runners. Missing supplied inputs and binding refusals stay visible.

## Two supplied mappings

These are synthetic reading examples, not live destinations or instructions
to create files. The launch and assignment supply all values in each column.

| Input or result | Mapping A | Mapping B |
| --- | --- | --- |
| Selected CLI script | `/fixture/a/repo/bin/aim-next` | `/fixture/Other Account/repo/bin/aim-next` |
| Selected actor | `page-lane5` | `page-lane5` |
| Selected profile | `/fixture/a/instance/seat.json` | `/fixture/Other Account/instance/seat.json` |
| Selected role | `/fixture/a/repo/docs/seats/page-lane5.md` | `/fixture/Other Account/repo/docs/seats/page-lane5.md` |
| Supplied working directory | `/fixture/a/work` | `/fixture/Other Account/work` |
| Assigned source destination | `/fixture/a/sources` | `/fixture/Other Account/sources` |
| Assigned evidence destination | `/fixture/a/work/proof` | `/fixture/Other Account/work/proof` |

In each mapping, append `inbox` to that launch's complete bound invocation.
Read the selected role, then current rules, the assigned piece and its request
stack. Create new source/evidence only at that assignment's supplied
destinations. Neither mapping discovers or changes the profile's actor,
instance or authority. A historical path or original operation referenced by
the recovered piece remains unchanged in either mapping. This walkthrough is
prose/link verification, not proof of a hosted launch, command formatter,
account move or native behavior.
