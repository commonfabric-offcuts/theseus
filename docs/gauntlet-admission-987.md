# Gauntlet admission (987)

Base: release271, 90f48a872fa02b98ac8f7b317d007de6107cb1a2.
Assignment14516; source Tony Releases14479; scope rulings Warp14528/14530.
Read docs/the-gauntlet.md whole. This change itself is judged and pays its
own gauntlet. The builder changes only its own source worktree, never the
installed guard, external launchers, controller or live accounts.

The callable seam is `tools.deploy.admit(config, candidate)`, also exposed as
`python3 tools/deploy.py admit CANDIDATE --config CONFIG`. `deploy()` calls
it after local evidence validation, before host policy and rereads immediately before reporting/stopping effects. Warp and
Fable own the external launchers: after installation they add a call after
runner_policy and before their boundary/merge/combine. A human starting a
hosted judged run calls the CLI first. These are read-only checks at each
caller's boundary, not a reservation or interception of arbitrary dispatch.
Runner policy and installed files are not changed by this builder.

The config names `pipeline_outcome`, `pipeline_instance` and exactly one
absolute `pipeline_broker` or `pipeline_profile`. Ordinary candidates need
none of these and do not read the pipeline. Judged candidates without them
refuse, as do incomplete, foreign or changing paged reads. Missing legacy
freeze metadata never counts as proved ordinary.

A judged candidate is refused while any ordinary approved, unshipped item
waits to combine in the authoritative pipeline, read through the broker.
Name the blocking pieces and say to land them first, then carry/rerun the
judged head on live. Each installed caller invokes admission before dispatch, stop, merge or
release allocation; direct deploy retains its own floor. Ordinary work remains eligible during a judged run.

Classification comes from the actual head's diff against its release base
at freeze, supplied by Checks or the freeze binder and retained by Core as
a judged flag on the piece. No planned-path declaration or mark at binding.
Core combine and the card read that same flag. Combine refuses every set
holding a judged item and anything else, including multiple items inside a
single supplied piece. The card says nothing before freeze. Warp adds the
gauntlet's hour on its cover when the mark appears; there is no ETA code.

Checks use isolated stores/repos and executable stubs. No real dispatch, PR,
merge, installation or live fixture write. Red controls: ordinary approved
work prevents a judged launch before any external effect; ordinary work
proceeds during a judged run; mixed/multiple-judged bundles refuse atomically;
freeze classification, Core views and card agree; stale/foreign/malformed
classification cannot change the accepted record. Apply/restore the admission
and classifier controls. Native card checks follow the Core contract and
do not prove scheduling correctness or wall-clock gauntlet duration.

The command is `pipeline.freeze`, target `{piece_id}`, required expected
`piece_revision`, args `{base_commit, head_commit, files}`. The binder reads
the actual Git diff; Core validates the bounded paths and derives `judged`
through the same pure policy as tools/train.py. Core appends the source,
classification, actor and time in a dedicated freeze table; it never executes
Git inside its transaction. The view is `pipeline_freeze` with `piece_id`.
The existing pipeline piece views include `freeze`, null until recorded.
An unchanged re-record is a no-op; changing an already approved freeze
requires returning the piece to an earlier stage first.

Legacy unclassified pieces have no card mark. Combine retains their existing
behavior, but a known judged piece rejects every other item regardless of
the other's classification. The deploy preflight treats an approved piece
with missing classification as unresolved and refuses a judged candidate
until it is classified or landed, naming that limitation. Ordinary deploys
do not acquire this read or wait. A judged candidate declaring multiple
items is refused independently of the Core mark.

The freeze CLI is `aim-next freeze PIECE --repo ABSOLUTE_REPO --base FULL_SHA
--head FULL_SHA`. It reads Git ancestry and the actual no-renames diff,
including guarded deletions and renamed old paths. The builder/coordinator/
owner is the trusted source producer; Core derives the flag from their
bounded file list, never accepts a caller-supplied flag, and retains their
identity. Core cannot independently authenticate a remote Git repository.

Judged verification follows Warp14558: completed exact-head Checks and the
actual refusing protected Verdict, plus the local owner/mutation gauntlet and
two clean-clone runs on the frozen head. A producer-tools refusal stays a
refusal; this build does not change the controller to manufacture green.

Existing failed-evidence handling remains intact: a candidate that cannot
pass its checks does not start a landing, and its failure measurements may
still be reported by the existing deploy path. Eligible heads run admission
before host policy and again before candidate/report/stopping effects.

Review correction14637: a successfully authenticated `--train` merge is an
already-started landing. Both deploy floors retain actual classification,
ancestry and one-item checks, but omit the waiting-piece read on that path;
a later ordinary approval cannot strand that merge before deployment.
Pre-merge launcher, human-start CLI and direct-summary deployment continue
to check waiting pieces. The internal `started_landing` argument defaults
false; only deploy's successfully returned `take_train` result selects true.
A refused freeze view uses the normal CLI view/refusal path (coded error,
exit2), with no attempted freeze write or traceback.
