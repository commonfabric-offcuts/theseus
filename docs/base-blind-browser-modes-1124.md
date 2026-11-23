# Authenticated zero-case base modes (1124)

Owner: fable (codex), under Warp Landing18392/18393. Auditor18390 is the
review contract. This changes controller judgment policy, not application
behavior or the truth of previously recorded verdicts.

The executable destination is the controller branch `codex/aim-next` in
`commonfabric-offcuts/theseus`, starting at
`b671da108fc085412a8c1be6f71c31b2cb74aecf`. Work is isolated in this checkout;
Warp's checkout, live tooling, application release history and old artifacts
are preserved. Delivery requires the auditor's read of the exact built source.

For each browser mode, use the authenticated eligible base-run set already
selected by the judge. An exclusion requires a nonempty set, every selected
record present, well formed, correctly bound to its run/source/receipt, with
valid counts, direct exit and cleanup, and exactly zero cases. Any selected
record with cases defeats this condition. Missing artifacts or mode records,
malformed JSON, partial evidence, incorrect identities and failed cleanup
must refuse rather than become evidence that the base cannot observe a mode.

For an eligible excluded mode, validate the candidate's original evidence,
including counts, errors, direct exit, source and cleanup, whether it contains
zero cases or actual passing/failing cases. Report the mode, candidate
observations, selected base run identities and the exclusion reason in the
verdict. The mode contributes neither passes nor synthetic quarantine/known-red
evidence. Exclusion does not establish that the observed failures are old,
safe or harmless. Keep all original raw artifacts and earlier refusals.

All observed-mode case identity, profile, harness, fingerprint, comparison,
noise and other evidence rules remain effective. Do not remove the existing
empty-results check globally or use a missing-record default as qualification.
The new policy must be reached through the real validation flow after base
evidence validation, with failures in unrelated modes retaining their effect.

Warp18417 narrows the proof workload: extend the existing judge unit tests,
run the bounded cases once, then return exact diff/output for auditor read.
No production-flow campaign or mutation/restoration runs are scheduled.

Proof covers candidate zero cases and candidate nonzero cases including reds;
observed base with zero-case candidate; observed base with a new/unmatched red;
mixed zero/nonzero history; empty eligible set; absent/partial/corrupt/wrong-source
evidence; failed cleanup; and unchanged other modes. Ordinary unit cases cover these evidence failures and the unchanged comparison
rules. Retain raw argv/source identities/direct exit for the bounded run. No broad suite,
user browser, live instance, test message or application deployment is needed.

The reviewed controller commit and the actual eventual Verdict workflow SHA
must be recorded with the new evaluation. A new application commit identity
with the same tree is not a source repair. No existing judgment becomes green
by editing this contract, and no application release is implied by controller
delivery. The separate 1123 fixture repair is outside this item.
