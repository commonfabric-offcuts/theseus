# 979: confirmed card publication finishes its original opening

On release 302, a card reply can be published while its send response is lost.
The person then uses Review → Check confirmation, sees “Sent to Theseus” for
that exact operation, and closes Review. The empty card field remains open.
The retained native red commits a real isolated Core operation and fails the
hidden-field assertion after that explicit confirmation. Ordinary native
Command-Return on the reported agent-no-quote-only shape already passes on
302 in Chrome (one case) and WebKit (two cases). This repair addresses the
demonstrated later-confirmation path; Tony's screenshot does not establish
that he lost a response or checked confirmation.

`EditorSession` now notifies the presentation after accepting and durably
keeping a current-authority `message.send` receipt. The registry forwards the
exact editor/submission to the card owner. Direct Send and later confirmation
share the same completion guard, consumed once for the original opening.
New writing, a different cycle/source/opening, images, pickers, naming,
notices, detached submissions and authority recovery retain their controls.
Historical-authority receipt handling cannot finish a current surface.
Failed local persistence does not announce publication. There is no automatic
public replay or timer-based dismissal. Existing Reader Send-and-stay and
`finishPage` behavior is unchanged.

The source starts at live 302,
`962fb5912fc5efb7c6ff8bbb0db40904e7c6e01f`, in the new owned worktree
`page-lane6-979-inline-noquote-302-15125` and branch
`page-lane6/979-inline-noquote-302-15125`. Release 303 landed during the
verification boundary; Warp lifted it at 15208. Carry onto actual live remains
Warp's ordinary landing work. There are no Core, schema, hosted-seat, operator,
workflow or live-record changes in this source.

## Retained proof and limitations

Evidence directory:
`/Users/commonfabric/.local/share/theseus/page-lane6/evidence/979-15125`.
The attached review archive contains a per-file size/SHA256 manifest and the
following raw phases, source diff, commands and source manifest.

| Phase | Observed result |
| --- | --- |
| Untouched 302 native confirmed red | Real commit; response lost; explicit confirmation; empty field remains visible; hidden assertion fails after 6000 ms. |
| Exact 302 affected Node cohort | 796 tests, 785 pass, 11 fail. |
| Final affected Node cohort | 811 tests, 800 pass, the same 11 fail; 15 added passing checks. |
| Applied publication, opening and authority mutations | Each actually applied, caught, byte-restored and green after restoration in a fresh Node process. |
| Final isolated Chrome for Testing | 24/24 pass. |
| Final isolated WebKit | 24/24 pass. |

The complete eleven failure diagnostics and stacks match baseline after only
normalizing per-test duration. Ten are the existing inline-wiring assertions;
one is the Reader recipients fixture's missing `querySelector`. Both raw
cohort logs and `affected-final-comparison.json` are retained. These failures
are not waived and the affected cohort is not described as all green.

Changed test files are `tests/ui_session.test.mjs`,
`tests/ui_inline_send_937.test.mjs` and
`tests/inline_reply_975_979_native.mjs`. The 15-file cohort list is retained in
`commands.json` and `affected-base302-restore.json`. Session checks use the
real isolated Core fixture and durable journal: notification follows completed
local keeping, failed keeping suppresses notification, confirmation does not
replay Send, and an actually changed authority epoch cannot close recovery.
The inline checks cover original-owner completion once and later-owner guards.

The final native filter covers quote-only keyboard sending, lost responses,
explicit later confirmation, later writing/reopening, quoted card and Reader
sending, Reader no-quote, synthetic refusal, held-response writing and real
concurrent arrival. Both looks run at laptop width; two 390-point Bookends
controls run in each engine. Actual native keyboard/click input, real Core
source and exact operation receipts are retained. The refusal is a synthetic
transport response, not an actual Core refusal. Viewport emulation does not
establish physical-phone or native-finger behavior; no latency claim is made.

Every final native case verifies the response bytes of ten measured web
modules. All twelve producer hashes (those modules, the HTTP fixture and the
native harness) match before/after both runs and match the committed source.
This is a measured target list, not a full asset census. The original red
records four product hashes and its exact retained harness, not a full served
source census. Fable independently audited that original packet at 15178.

Final cleanup verifies Browser.close, all 79 observed owned Chrome PIDs absent,
all two observed owned WebKit PIDs absent, both profiles removed, fixture EOF
exit 0 and process absence, empty fixture stderr, and closed ports. No browser
or substantial workload remains. Four final captures were visually read:
Chrome confirmed card closed, WebKit confirmation and closed card, and Chrome
newer writing retained; their paths are in `native-final-verification.json`.

## Historical phases remain distinct

`red302-exact` and `webkit302-exact` are passing ordinary controls.
`red302-lost-answer` only establishes the unknown-response state, not the later
confirmed defect. `red302-confirmed`, its exact harness snapshot and immutable
`979-native-red302.tgz` are the actual native red. That archive is 285499 bytes,
SHA256 `fb5b22bd38a10616295ad61c16c971b7ee6a741ffdd500461c296223fa56d0da`.

`chrome-green`, `focused-green.log`, `affected-head.log` and the first two
mutation controls precede the final authority guard and are historical.
`authority-red.log` and `affected-final.log` retain an invalid first test setup
that called advance without moving the fixture epoch; they do not prove an
authority defect. The corrected check asserts the actual `e-979-next` epoch
change; `final-mutation-authority-red.log` is the applied mutation failure and
its restored control passes. `affected-final2.log`, `chrome-final` and
`webkit-final` are the final source results. No historical phase is relabeled
as current proof.

## Review correction 15240

Warp's importer cohort found a deterministic test regression omitted by the
original fifteen-file set: the Notebook owner's stand-in calls the composer's
`send` method but did not carry the new `finishSend` method. The named 871
case passes on 302 and fails on the first returned head with
`TypeError: this.finishSend is not a function`. The retained local correction
red reproduces that exact failure. The chosen repair adds
`finishSend: InlineComposer.prototype.finishSend` to that stand-in; no existing
assertion changes and no product or native-harness byte changes.

The complete Notebook owner file passes 17/17 both on exact 302 and after the
correction. A fresh discovery of direct touched-module importers, combined
with the original named cohort, yields a retained 33-file set. On exact 302
it reports 1163 tests, 1151 pass and 12 fail; the corrected source reports
1178 tests, 1166 pass and the same 12 fail, with no cancellations. All complete
failure diagnostics and stacks match after only per-test duration
normalization. This set includes the original eleven failures plus the
pre-existing 721 composition file's historical upload-body equality failure;
that assertion is retained unchanged. This independently recorded 33-file
set is distinct from Warp's own 27-file review set and canary inventory.

Correction evidence is under `correction15240/`: raw red, Notebook baseline
and green, raw expanded baseline and corrected logs, importer/command list,
comparison and exact source-restoration manifest. The previous fifteen-file
results remain historical evidence of that named set, not a complete importer
census. The corrected freeze manifest binds all 33 test files and verifies
that the twelve measured native producer hashes still match the committed
bytes. The existing Chrome24/WebKit24 proof and three mutation controls apply
to these identical product/native bytes; no further browser workload ran.
Release 304 (1018, ordinary/no restart) was reported during this correction;
the source retains its 302 base for Warp's carry onto actual live.
