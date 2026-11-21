# Opening Review after writing (598)

Start from live release 210, `9808c517`. Retain current Review/Set aside
labels, the list's contents, recovery authority, saved writing and images.
There is no prior 598 piece or source branch on its current record. Original
6081/6087 reproduce the missing dialog and zero-sized action on both 84 and
85. Triage 6248 and ruling 6252 identify the cause: replacing a Review
button's text during the redraw triggered by leaving the writing field can
cancel Chrome's native click. A phone-sized mouse check is not a finger tap.

`reviewControl` must retain the button and its label node when the label
does not change. Labels that really change still update. The first mouse
press after typing, including a press held across the blur redraw, opens the
correct Review or Set aside list. Native phone taps and keyboard activation
also open it; Set aside and Undo remain pressable at the existing touch size.
Typing and images stay kept through opening, closing, Set aside and Undo.
Do not weaken the existing keyboard or layout assertions to accept a failed
opening. No Core, storage or schema change is intended.

Add focused native cases to `tests/set_aside_native.mjs` using its scratch
pending submissions. Observe native mouse/touch events and the actual dialog,
not handler calls or a fake DOM timing claim. Retain the old kept-line case
at laptop/320/375/390, light/dark. The release-210 shared native runner has
the same four-dot source-list syntax error repaired in approved 555; carry
that exact one-token test repair here to execute these checks, without a new
product dependency on 555.

## Verification

Unchanged release 210 fails the new native case after typing and pressing the
Set aside chip: the browser delivers `mousedown` and `mouseup`, replaces the
label twice during the held press, and delivers no `click`; the list stays
closed. The conditional label write fixes that actual failure.

Both native groups pass on the candidate: eight mouse/touch/theme scopes
(laptop mouse, 390-width mouse, 320 and 390 touch, light/dark), plus the
unchanged eight kept-line keyboard/layout scopes at 1280/320/375/390,
light/dark. Real native input opens Review and Set aside, Set aside and Undo
commit through scratch Core, exact typed writing and the pending image
remain, and the original touch-size/layout checks pass. This is emulated
Chrome for Testing input, with no physical-device or production timing claim.

The 14 existing Review wiring cases initially fail identically on unchanged
210 and the candidate: 935 uses CSSStyleDeclaration methods absent from
their test DOM. Reuse only the exact `setProperty`/`removeProperty` fixture
repair already approved with 932 (`eecc04039`), retaining all assertions.
The 14 cases then pass. The original `set_aside_native.mjs` bytes, with the
new case removed, compare exactly to 210; no old check was rewritten.

Evidence lives at
`/Users/commonfabric/.local/share/theseus/core-lane8/evidence/598`:
`red-live210`, `green01`, the three `node-review*` logs and
`retained-assertions.json`. Each launched browser closed with `Browser.close`;
fixture EOF exit 0, owned profile/child process absence and closed fixture
and debug ports were verified. No browser remains.

Focused native command (absolute owned scratch evidence path):

```sh
node tests/reader_persistence_native.mjs "$AIM_CHROME" "$AIM_EVIDENCE" \
  --rail 'rail (item 598|set aside kept looks right)'
```

The product diff changes only `reviewControl`. The two shared fixture
repairs are identical to approved 555 and 932 changes and should coalesce
with those carries. Fable owns carry/stage/deployment; no schema change.
