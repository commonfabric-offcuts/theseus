# Browser case history window (1088)

Own controller branch starts at the actual 1084 merge
`97799c96421741da30462e446bee8a65bc8cea78`. Warp17320 and Fable17324
correct the opening: the new window applies only to browser cases.
The 1079 completion/tail parsers and 1084 unit/replay identity parsers stay fixed.
This work changes the protected collector, validator and verdict report; it
does not install a controller, release the app or replay an old refused run.

## Selection and boundaries

Keep the existing newest-three complete controls for every required step.
Additionally select the newest ten complete controls for each browser step,
ordered by creation time then numeric run id, descending. The manifest names
both selections and discloses window counts below five and below ten. The
window shares the existing authenticated artifact collection, not a second
history source. Run ids cannot repeat or be relabeled between selections.

Only first-attempt completed pushes to the authenticated comparison branch,
in its ancestor history and the producer's repository/workflow, begun before
the judged producer, are eligible. A cancelled or missing shard contributes
no observation for its step; complete other steps can still contribute. Every
partition of a selected step must pass the existing disjoint whole-step and
source/receipt/profile checks. Expired or absent combined artifacts are named
unavailable and older runs may fill the window. Malformed present evidence,
failed reads, wrong bindings and digest mismatches refuse rather than becoming
passing observations. Candidate evidence retains whole-run completeness and
all existing refusal rules.

## Case identity and decision

Browser identity is the existing step plus name, phase, engine and
expectedFailure flag. Expected-failure mutation cases never supply noise.
For the new window, a candidate case must have one explicit observation in
every selected step run, with the same stable execution profile and the same
committed browser harness path/blob as the candidate. A missing case, changed
identity, profile or harness does not count as a pass. It leaves the candidate
failure unexpected with a named reason. This is a conservative source boundary;
the window does not combine observations across changed harness bodies.

At least five complete step runs enables the window (five through ten are a
disclosed partial window). Explicit passes and failures for that case make it
noise only if a failed observation also matches the candidate's existing exact
assertion fingerprint, including verified test frames and normalized values.
A new fingerprint is unexpected even on a case that flipped differently.
All observations red uses the existing same-fingerprint match for known red;
all observations green makes a candidate red new. No missing result is guessed.
Synthetic `fixture exit N` diagnostics from 1079 remain under their existing
three-control comparison; their absence is not a passing browser case.

Fewer than five complete step runs, including zero, uses today's browser
any-of-three same-case/same-fingerprint/profile rule exactly. Legacy manifests
without a window also use that rule. Unit and replay failures always use the
original three-control selection and require EVERY eligible control to agree;
extra browser history never expands or shrinks that selection.

## Evidence and output

The verdict separately names noise and includes the step/case, candidate run,
ordered window run ids, explicit passing and failing run ids, and the runs
whose failure fingerprint matches. Known reds, unexpected failures and window
shortfalls remain visible. Raw candidate and base verdicts and reports retain
their original failed state. No median, invented outcome or blanket flaky
exemption is used. Unmeasured or malformed candidates cannot reach comparison.

Before freeze, bounded sequential scratch checks retain commands, exits,
loaded input bodies/hashes and actual red/corrected outcomes: pass/fail flips,
all-pass/new red, all-red/known, three/four-run fallback, ten-run cutoff and
ordering, per-step gaps, cancelled/partial/misbound/changed-source evidence,
case/profile/fingerprint differences, and unchanged unit/replay and 1079 rules.
Apply the exact old production owners to the new checks, observe red, restore
the exact corrected bytes, and rerun the affected cohort. No browser, fixture
server, native harness or live data workload runs. Fable owns canonical freeze,
auditor the independent clean read, and Warp controller merge.
