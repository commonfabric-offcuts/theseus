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

The reviewed base policy has version 1, source_commit, required (the complete
release-check step list), source_hashes (Git blob hashes of inventory sources),
inventory (native/unit/deploy step to check identity lists), and reds. An identity records
name, phase, engine and expectedFailure, including null/false defaults. This is
an explicit inventory reviewed against the harness sources, not a count or an
attempt to parse arbitrary JavaScript names. Changing a test plan requires its
own reviewed policy update. A candidate cannot edit its own exceptions.

Every listed test source is compared with the candidate before classifying
ordinary passes as well as failures. Material assertion/helper edits require
reviewing the policy's source definition. The only automatic source equivalence
is insertion/removal of leading blank or line-comment lines before the first
code line; everything after that remains byte-for-byte reviewed. This allows a
harmless header line shift without trying to parse JavaScript or stripping
comment-looking text inside template literals. Other harmless edits may still
require review: uncertainty refuses validation.

Each unit/deploy check has a reviewed identity from the archived verbose Python
or Node TAP log. Every planned identity must execute with its reviewed
multiplicity; nested TAP checks include their parent names. Every observed
check must have an individual successful outcome and agree with the total.
New passing unit checks may be added alongside the complete reviewed set;
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
