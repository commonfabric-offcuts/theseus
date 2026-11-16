# CI expected browser failures

The aggregate is green only for a complete, source-verified run with no unexpected
failures. Raw shard and case verdicts are never rewritten. The classifier reads
the whole-run `release-check/summary.json`, its `provenance.json`, and the original
`shards/check-N/{run.json,summary.json,native/...,native-*.log}` artifacts.

Run `python3 base/tools/ci_known_reds.py --summary release-check/summary.json
--provenance release-check/provenance.json --shards shards
--baseline base/.github/check-baseline.json --base-checkout base
--candidate-checkout candidate --out validation.json`. Both source checkouts must
be clean; base is the PR event's exact base SHA, candidate the tested merge SHA.
The workflow supplies the original event JSON and GitHub run environment. A retry
must use the same event base policy, not a moving branch. Missing evidence refuses
validation, including when every reported case passed.

The protected `workflow_run` controller additionally passes `--producer
producer.json`. That file is built from GitHub's attempt-specific API and the
independent merge rebuild before reading candidate artifacts. It contains:

```json
{
  "producer": {"run_id": 123, "run_attempt": 1, "event": "pull_request", "conclusion": "failure", "workflow_path": ".github/workflows/checks.yml", "workflow_name": "Checks", "head_sha": "<PR-head>", "head_branch": "feature", "created_at": "<API-created-at>", "pull_request": {"number": 6, "head_sha": "<PR-head>", "base_sha": "<original-event-base>", "base_ref": "release/live72"}},
  "controller": {"run_id": 999, "run_attempt": 1, "workflow_sha": "<controller-workflow-sha>", "workflow_ref": "owner/repo/.github/workflows/verdict.yml@refs/heads/main", "sha": "<controller-sha>", "repository": "owner/repo"},
  "merge": {"sha": "<original-tested-merge>", "tree": "<independently-rebuilt-tree>", "first_parent": "<original-event-base>", "second_parent": "<PR-head>", "fetched": "<original-tested-merge>", "rebuilt": "<independently-rebuilt-tree>"}
}
```

The controller identity must match its ambient job and default-branch workflow;
the producer run/head/base must match the triggering workflow_run event. Its
original fetched merge, both parents and expected rebuilt tree must match the
candidate checkout. A newer base refuses pending a fresh producer run. Producer
receipts and combined provenance carry sha, tree, first_parent and second_parent;
their workflow commit/ref and reviewed workflow blob are checked too. The
returned status_head_sha is the authenticated producer PR head, never the
controller's SHA. The current protected controller refuses producer attempts
above 1 before reading artifacts: it must get a fresh producer run from a new
push, and never supplies --history. Controller reruns are a separate identity.
Constructed CLI integration tests are not a substitute for a real hosted
controller/status check on the intended head.

Every producer receipt must contain summary_sha256 matching the exact original
summary bytes. Receipt run/attempt identity alone does not authenticate a
different summary placed beside it.

For a standalone advisory/diagnostic caller, attempt 2 or later requires
`--history history/history.json`. This retained history interface is not used by
the current protected controller. The manifest's paths are relative to its
directory:

```json
{
  "run": {"id": 123, "attempt": 2, "workflow": "Checks", "event": "pull_request", "repository": "owner/repo"},
  "base": {"ref": "release/live72", "sha": "<original-event-base-sha>"},
  "merge": {"sha": "<tested-merge-sha>", "tree": "<tested-tree-sha>"},
  "attempts": [{"attempt": 1, "summary": "attempt-1/summary.json", "provenance": "attempt-1/provenance.json", "shards": "attempt-1/shards"}]
}
```

Exactly attempts 1 through N-1 must be present once; absolute or escaping paths
are refused. Every original attempt is revalidated using its own original
receipts and complete evidence against the same pinned policy and source.
Missing or refused earlier evidence keeps the run red. An earlier unexpected
failure cannot be cleared by a later pass. Expected failures remain visible in
the attempt union and raw_passed remains false if any attempt failed. A case
that failed in one attempt and passed in another appears in passed_on_retry,
with failed_attempts, rather than as a clean healed case. A retry containing
only reviewed expected failures can validate, while retaining those failures.

The controller must execute only trusted code and independently authenticate
the producer run, original event base/head, precise tested merge/tree and
reviewed producer workflow/helpers. Neither a candidate-controlled workflow
nor this Python tool's self-equality checks establish that outer authority.
The producer adapter is available; real hosted controller/status integration
remains under joint review. This draft is not yet the required GitHub verdict.

The reviewed base policy has version 1, source_commit, required (the complete
release-check step list), source_hashes (Git blob hashes of inventory sources),
inventory (native/unit/deploy step to check identity lists), and reds. An identity records
name, phase, engine and expectedFailure, including null/false defaults. This is
an explicit inventory reviewed against the harness sources, not a count or an
attempt to parse arbitrary JavaScript names. Changing a test plan requires its
own reviewed policy update. A candidate cannot edit its own exceptions. The
frozen source set covers **every file under tests/** (including JSON, SQL and
media), everything under tools/, checks.yml, the four documentation inputs
(tools, agent-cli, agent-guide, team-assessments), and all six bin/aim-next*
launchers. Literal references in read-bearing test modules conservatively add
other non-product repository files. The policy's exact event-base bytes are a
separate authority binding, rather than a recursively self-hashing test input.
Product web/ and aim_next/ code remains free to change.

`tools/ci-input-reads.json` declares recognized filesystem read expressions,
including import aliases and each repeated occurrence. Python uses AST
signatures; Node uses balanced read-call spelling. `ci_input_reads.read_calls`
returns the signatures and expressions for a file. A new expression fails with
its filename, expression and an instruction to declare repository inputs or its
generated/system/product scope. Add any non-product source dependencies to the
entry's inputs list; these files become frozen irrespective of extension or
location. This manifest and its scanner are trusted event-base verifier code,
not candidate-supplied permissions. Updating a declaration is itself a producer
tool change and requires the corresponding reviewed plan/controller update.
The initial declarations cover the production and bootstrap sources; dynamic
expressions are a review obligation, not a claim that arbitrary Python/JS can be
fully analyzed statically. In particular this validator is not a sandbox for
hostile product code that mutates a test runner or assertion library.

Source-set additions/deletions also require a reviewed complete plan. This
includes files already added on the authenticated event base: an older snapshot
cannot implicitly authorize or omit them. Bootstrap additions with runnable
checks need a complete transition that lists their expected identities. A
transition may include `retired_sources` (default empty): that list must exactly
match paths present on the event base and absent from the plan. A retained older
review cannot implicitly retire a later base addition.

Optional transitions contains `{review, plan}` entries. Each plan is a complete
six-field policy snapshot (version, source_commit, source_hashes, required,
inventory, reds), without nested transitions. Validation must select exactly
one complete matching snapshot; partial old/new mixtures and ambiguous matches
refuse. A transition cannot add or change failure admissions; it may retire an
old admission. All referenced source commits must be available in the checked
out Git history. Required-step protocol changes need a coordinated verifier
update; source transitions do not add support for an unknown harness mode.

For a legitimate feature test edit: keep the feature pending, independently
review its exact new test definition/inventory, then merge a separate base-policy
PR containing that complete snapshot and review reference alongside the old
snapshot. After the feature adopts that policy base, both the old base and the
exact reviewed new feature can validate. Retire the old snapshot after landing.
The feature's own policy edits never authorize its definition change. Producer
workflow/tool edits also need the protected controller's independent review.

Every listed test source is compared with the candidate before classifying
ordinary passes as well as failures. Material assertion/helper edits require
reviewing the policy's source definition. The only automatic source equivalence
is insertion/removal of leading blank or line-comment lines before the first
code line; everything after that remains byte-for-byte reviewed. Files with a
shebang or Python encoding declaration use exact bytes, preserving interpreter
and encoding semantics. Producer tools/workflows always use exact blobs. This allows a
harmless header line shift without trying to parse JavaScript or stripping
comment-looking text inside template literals. Other harmless edits may still
require review: uncertainty refuses validation.

Each unit/deploy check has a reviewed identity from the archived verbose Python
or Node TAP log. Every planned identity must execute with its reviewed
multiplicity; nested TAP checks include their parent names. Every observed
check must have an individual successful outcome and agree with the total.
New passing unit checks may occur within the complete selected reviewed sources;
substituting a new name for an omitted planned check or duplicating one refuses
validation. There are no skip exceptions: skipped-only, partially skipped,
expected-failure, todo or cancelled checks refuse validation.

The replay's routed actors come from the traffic file at the policy's reviewed
source commit. Each repetition must report exactly that set, with an explicit
empty lost list for each actor, positive completed wakes and matching delays.
Missing actors and missing loss records fail even if the actors that appear
completed successfully. Candidate traffic must match the reviewed traffic.

Each red records step, case identity, owner, why, review, observed_profile,
target_profile, source_commit, evidence_sha256, fingerprint and completion.
The fingerprint contains the full chain of test source frames (file, stripped
source text, occurrence index and multiplicity) and the assertion text including
actual/expected values. Only the verified checkout root and generated m/t/p/d IDs
are normalized; generated ID equality is preserved. No frame-less or ambiguous
source evidence is admitted. The evidence digest and review identify the
separately reviewed admission. Profiles include the runner image, architecture,
OS, scroll bar mode, reduce motion, CPU count and runtime/browser versions.
The stable key uses runner_os, runner_arch, image_os, image_version,
scroll_bars, reduce_motion, cpus, python, node, chrome and playwright. Paths,
platform diagnostics and load_after remain alongside the evidence and do not
form the admission key. Missing stable settings refuse validation.
A different observed profile requires a
runner_evidence_sha256 receipt reviewed for that exact target profile. A Mac
seed is provenance, not permission for an unrelated runner failure.

An admitted case passing is reported healed. A missing, duplicate, renamed or
materially changed case refuses validation. New failures, different assertion
values or helper/call-site chains, setup/cleanup failures, escaped mutants and
non-browser failures are unexpected. Units, deploy refusals and wake replay
cannot be excepted. The initial policy has no admissions: historical step-wide
waivers and by-name overlap cannot make the first GitHub run green. Admissions
are a separate baseline PR, backed by release 72's three archived Mac runs and
reviewed runner comparisons. The two PR1 WebKit keyboard-quote regressions are
not admissions.

The initial inventory's archival report digests are in
`docs/ci-inventory-evidence.json`. The real first-run setup refusal fixture is
from [run 43560453742](https://github.com/tonyespinoza1/theseus/actions/runs/43560453742),
artifact 14099924147 (`check-6`), zip SHA256
`1dc1a49f883b13ae870b995f45ed2fc04ebeb4874015a07b1c028d36722ee22b`.
It must remain red: no checks ran. This fixture is not a claim that the entire
historical run has been replayed through a provenance contract it predates.

Compose requires native.json fields browserClosed and harnessCompleted true,
fixtureExitCode exactly integer 0, fixtureExitSignal null, and plannedPhases and
completedPhases equal this ordered plan: run:chromium, run:webkit,
runAnswering:chromium, runAnswering:webkit, runSending:chromium, runSending:webkit.
Completion is recorded only after the phase and browser close succeed. Cleanup
on an exceptional path is not completion. Both sides of a Compose admission
must carry this attestation; the eight historical Compose failures remain
unexpected until then. Other harnesses retain their existing end-of-run checks.

## The quarantine

Admissions above are matched only by this classifier, only on a pull request's
event, and only once the candidate's whole test source set is a plan the policy
reviewed; at every commit since the policy's last reviewed plan (including the
live release's own) no plan matches, so they admit nothing. The Checks run on a
push reads no admissions at all: each shard's `release_check.py` exits 1 on any
failed case, and the combine job exits 1 when any step failed. That is why the
push run of train 20 (run 43782751036 at 7ef81586) went red although 19 of its
27 failed cases had also failed in release 82's push run 43771952998. Its Verdict
check, from the default branch's controller, compares a push with the base's
last three push runs instead of this policy, and on that push refused before it
compared anything ("python-units: duplicate executed identity").

The quarantine is the release check's own list, `quarantine`, in this same
policy file. An admission cannot carry it: an admission is keyed on the whole
reviewed test source set, the hosted runner's image version and the failure's
exact values, so every train that edits a test or meets a new runner image
voids every admission, and none of that holds a case whose cause is live's.

The release check reads the list at the event base (`--quarantine-at event`: a
pull request's base, or the commit a push moved its branch from), never the
candidate's copy, so a change can never quarantine its own reds; the base must
be an earlier commit of the checked one. A quarantined case still runs and
still records its failure: raw case and step verdicts are never rewritten. A
step whose only failures are quarantined cases, each failing at the stage it
was quarantined at in a run that ended as one with failed cases does, has a
green quarantine record, and its shard and the whole run exit green; the step's
output names each such case. A quarantined case failing at another stage or
with no stage to read (a stack that names no test source line, or no error at
all), a case on the list only under another phase or engine, a case not on the
list, a run that did not reach its end, and any unit, deploy refusal or wake
replay failure stay red, and so does a run with a required step missing or a
checkout a step changed. A list that cannot be read (no event
base, as on a manual run; a later or unrelated commit; a malformed entry)
quarantines nothing and the summary says why. With the list in place the push
run on a merged head is expected green, so any red left is the train's own.
docs/tools.md ("The quarantine") has the summary's fields.

An entry:

```json
{"step": "native-inline",
 "case": {"name": "…", "phase": null, "engine": null, "expectedFailure": false},
 "owner": "runner lane",
 "leave": "after ten of ten whole-step passes on live once it is fixed; …",
 "red_in": [{"run": 43762908423, "commit": "<full sha>", "release": 81,
             "stage": [{"path": "tests/…", "text": "<stripped source line>", "count": 1, "index": 0}, …]}, …]}
```

A case enters only when it is among the live release's known reds and was red
in two of the last three push runs on live, each named by run id with its
failure's stage: the chain of test-source frames its stack names, each frame by
file, stripped source text and which occurrence of that text it is
(`ci_known_reds.fingerprint`), so a line that moved still matches and an edited
one does not. Every run an entry names must show the same stage; one red at two
different stages was not red at one stage twice. A mutant's result is never
quarantined. The runner lane owns the list. A case leaves it when it has passed
ten of ten whole-step runs on live after its fix: every run's summary records
each quarantined case's pass or failure (`steps[].quarantine.cases`), and
`tools/quarantine.py passes SUMMARY…` counts them. `tools/quarantine.py count`
prints the list's length, one plain number, for the board.

The list is under `.github/`, the controller, so a change to it rides a
judged-first train, as a change to the admissions does.

The initial list holds the 18 cases among release 82's known reds that failed
at one stage in all three live push runs of releases 80 (run 43756859856 at
31cecd33), 81 (43762908423 at e73e6e1e) and 82 (43771952998 at 24a7d9da): two
of native-colors, eight of native-compose (the phone and laptop-stacked line
counts, light and dark, in both engines), one of native-conversation, six of
native-inline and one of native-webkit-colors. The native-webkit-notebook case
"a page opened from the right rail's whole outcome …" failed in 81 and 82 at
two different stages and is not on it, nor are the 82-only reds. Read over
train 20's push run, the list holds exactly those 18 failures and leaves its
other 9 red.
