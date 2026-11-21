# Inline reply height and completion coverage (975, 979)

Base: release 252, `3d8756b464971dd16b064591e4d6693564768fd5`.

The card inline reply and the Reader show their existing height control only
when the writing reaches the normal maximum field height. Shrinking below that
height hides it again. Its layout space stays reserved; other controls do not
move sideways. Expanded height remains a choice until the existing close/reset
owner resets it; the visibility threshold stays the normal height while tall.
The existing wide Reader and private-note height controls keep their behavior.

`ComposeBar.fit` measures the normal CSS maximum, including while expanded,
and marks a full field. The field width observer remeasures wrapping without
an input event, coalesced into an animation frame outside observer delivery.
Height-only notifications do not refit, and disposal cancels a pending frame.
The reply CSS
hides the existing control with `visibility`, preserving its grid slot.
No Core, schema, API, send or completion owner changes.

A successful Send from a card inline reply closes that opening with or without
a quote. Refused publication retains its preparation and recovery; a late
confirmation cannot close newer writing. The native checks read successful
messages back from isolated Core, asserting exact body, parent and quote shape.

## Item 979 disposition

979 is **unreproduced on release 252 and remains open**, not fixed by this change.
Before restoring the 975 product change, pristine 252 passed twenty Chromium
and twenty WebKit cells: desktop 1280 and phone width 390, Bookends and Paper,
direct no-quote, image-only source, inline-origin Reader, named dossier/reply
control and keyboard Send. Warp14342 authorized shipping 975 with retained 979
coverage and leaving 979 open for a further sighting. The additional attachment
with siblings and same-dossier live arrival checks also pass. The arrival is a
real isolated Core message displayed while the committed Send response is held.

The failed-send control simulates a rejected publication response after real
preparation; it checks the actual recovery UI contains the exact sent writing.
It does not claim a real Core policy refusal. Quoting uses source click and
Return, Send uses the visible control or Meta-Return, and late-writing uses a
held real Core confirmation. Desktop browser engines at phone widths do not
prove physical iPhone keyboard or touch behavior.

## Checks

Owner checks: 154 passed, including nine new height/lifecycle cases.
`node --test tests/ui_reply_height_975.test.mjs` plus the affected
compose, inline-send, card-reply and Reader owner tests listed in the freeze
record. The 975 baseline was red in the owner check and actual Chromium page:
a short 33px field displayed the height control.

Native: set `AIM_PLAYWRIGHT_CORE` to the installed Playwright core module and
`AIM_CHROME` to Chrome for Testing, then run:

```
node tests/inline_reply_975_979_native.mjs /absolute/evidence/path
AIM_BROWSER=webkit node tests/inline_reply_975_979_native.mjs /another/evidence/path
```

Final result: Chromium 44/44 and WebKit 44/44, with no page errors.

An optional third argument is a cell-name regular expression. Each full run
has 44 cells, across both widths and looks. Height checks exercise short/full,
expansion, shrinkage, actual wrapping across the cap on a width change without
input, restored writing, stable control columns, and the Reader/private-note
negative controls. Each case has its own dossier so deliberately retained
recovery/new writing cannot fold another case's source. The existing 907 and
937 native checks now grow the writing before pressing the height control.

Applied controls changed the CSS to expose a short field, removed width refit,
and suppressed the existing confirmed card-close callback. Each actual
mutation failed its native assertion and was restored byte for byte. The
completion mutation proves the send-closure instrument detects an open field;
it is not a reproduced 979 baseline. Restored full runs follow the mutations.

Evidence is in the auditor evidence directory, indexed by
`975979-freeze252.json`. It retains the pristine baselines, applied mutations,
final runs, owner log and browser/fixture cleanup. Earlier harness diagnostics
are retained too: an incorrect form ancestor/toolbar selector, phone Reader
not expanded, quote selection attempted while the textarea owned Return,
recovery sought at the obsolete inline location, and one shared-dossier run
that failed before Send on a folded source. They are not product-red claims.
The first complete candidate WebKit run found resize-observer loop errors in
29 cells; fitting synchronously inside the observer was the cause. The new
lifecycle owner check was also red before moving fits to an animation frame.
These are resolved product failures, retained separately from harness diagnostics.
One earlier baseline ended on an unhandled response timeout; owned processes
were checked absent and its profile removed, while complete later runs supply
the accepted cleanup receipts.
