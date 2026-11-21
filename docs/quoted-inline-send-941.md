# Quoted inline replies after Send (941)

After confirmed publication, the unchanged empty inline reply closes and the
sent message takes light and focus. This applies when its Reader was opened to
quote a passage. Preparing, refused or uncertain publication keeps the Reader
and recovery controls; later writing, image choices, notices and openings keep
their ownership. Ordinary Reader sends and explicit Send-and-stay are unchanged.

## Cause and change

On release 210, direct inline Send after quoting and returning already worked.
The failing path was: open an inline field, open its Reader, select a real quote,
replace the visible quoted text with “done”, and send from that Reader. Core
retained the quote and published “done”, but the Reader closed at preparation.
The underlying field stayed visible because its submission was pending, and no
publication callback finished that card. It also missed sent-card focus/light.

An inline-origin Reader now waits for confirmed publication before asking the
card owner to close. The owner keeps the Reader's registered writing, checks
that the same opening and writing still own the result, hides the inline field,
and uses the existing sent-card landing. Images owned by the submission do not
hold its empty successor open. A selected successor image does. No Core record,
quote, destination, schema or delivery behavior changes.

## Evidence

Raw logs and screenshots live under
`/Users/commonfabric/.local/share/theseus/auditor/evidence/941-*`.

- `native-reader-red01`: untouched 210 reproduces the visible empty field and
  missing focus/light, while Core records the quote and exact “done” words.
- `native-red02`: the direct-inline control already passes on 210 in all four
  1280/390 light/dark cases. This is a control, not a regression failure.
- `native-reader-final`: four corrected cases plus a real held send response:
  the pending Reader remains, newer writing stays focused when confirmation
  arrives, and closing it returns those exact words to the inline field.
- `unit-baseline-red02`: reverting only the Reader implementation to 210 gives
  six failures in the new lifecycle checks. `guard-mutant` removes the actual
  current-opening guard and gives thirteen failures; `guard-restored` passes
  thirty checks after byte-exact restoration.
- `native-937-verified` and `native-929`: unchanged regression scripts cover
  plain Send, late confirmation, resting composer/Reader behavior, Reader
  round trips, actual DOM construction and disposal.

The first native setup selected the synthetic parent's CLI preface instead of
its intended passage. The first unit fixture assigned a getter and subsequent
mini-DOM/image fixture iterations needed their real state shapes. These setup
failures are retained in separate logs and are not counted as product failures.

Each native run uses one isolated Chrome for Testing profile and scratch
HTTP/Core origin. Browser.close, process/profile absence, fixture EOF exit 0
and closed fixture port are checked. Viewport emulation is not a physical-phone
claim. The final freeze receipt records the exact source and final cohort.

Final Node cohort: 260/261 across 18 Reader/app/inline files. The one failure is
`ui_reader_recipients.test.mjs`’s old origin-line fixture missing querySelector;
unchanged 210 produces the same TypeError at paintWithdrawal (3/4 in that file).
The 67 focused 941/937/929-related checks are green. This change does not claim
to repair that existing fixture or to make the whole repository suite green.
