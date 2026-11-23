# Card editing boundaries (1058)

In Notebook Cards, an unmodified Left at a collapsed caret at offset zero
finishes the card and displays it. An unmodified Right at a collapsed caret
at the field's complete text length does the same. Neither key folds children
or hands focus to the feed in that act. Finishing uses the existing save,
card identity, display focus and empty/fresh-card behavior.

Shift-Tab at a collapsed caret at the complete text length outdents the card
one level and retains its editor, exact words and caret. It uses the existing
moveWriting/applyAct/placeNew owner, including children, saving and Undo.
A top-level card cannot outdent; its words, editor, selection and focus stay.
The empty fresh box is both its start and end; existing placement rules apply.

These are defaults. Nonempty selections, interior carets, modified arrows,
composition/229, already-handled keys and other fields retain their existing
routes. Start Tab/Shift-Tab (966), display tree and pane arrows (967), Text
view, line editing and Notebook edit history (1073) retain their other
meanings. Read-only/base/field/writer checks remain on outdent. No Core,
schema, storage format, user preference or product dependency on 1089 changes.

## Owners and intake before implementation

The own branch is `page-lane5/1058-card-boundary-347`, based on actual live347
`7b890758f36e5dc30fbf6c27594b75f64626ef92`, tree
`7711749934b9fd5fcb993d919efe1197c3b2404f`, schema65. Own bound Health
1795383791237 confirms that intake. All1732 tracked input bodies are mapped
in `artifacts/1058/intake-input-manifest.json` and retained in the exact
intake archive; no1089 source or proof is inherited.

The product owner is `DeckPage.key` in `web/deck-page.mjs`, specifically its
editing-field route before WritingInput's line indentation. `finish`,
`moveWriting`, `act`, `placeNew` and `applyAct` remain the existing operations.
`NotebookPage.key` retains the editor's propagation boundary and1073 history
wrapper. `WritingInput` retains non-boundary line keys. The old editing-arrow
fold route becomes unused and will be removed if it has no other caller.

Tony's bound16188 screenshot (107817 bytes, SHA256
7a3fecf003944a505b20eec8d9deae9cc264c2b47fe7193741bd55eb5353f8e4)
was downloaded and visually read. It shows Left and truncates the later
clauses. The canonical1058 full description and Fable17488 supply the full
Right/Shift-Tab requirements. This does not infer text hidden in the image.

## Intended checks before implementation

New named owner checks will first fail on untouched347 for a leaf's Left,
Right and end Shift-Tab. They will cover same-card display with children
unfolded, saved changes, empty/fresh placement, selection/interior/modifier
and composition guards, read-only outdent, subtree movement and existing Undo.
These handler checks do not establish native interaction.

Existing866 tests explicitly asserted folding and the old leaf/fresh/empty
Right behavior; those affected expectations move to1058 display checks.
The966 native line-indentation controls will position the caret inside the
last line, because end Shift-Tab is the requested new card command. The967
unused-arrow controls retain interior/nonempty-selection and Text behavior;
empty Card boundary arrows are explicitly1058 commands, covered separately.
Unrelated assertions remain intact.

An own native harness will use isolated scratch Core/HTTP and actual headless
Chrome for Testing and WebKit keyboard gestures. It will record actual
engine/version, served owner bytes, complete source maps before/after each
phase, editor/display focus, caret/selection and Core-read persisted card
depths, plus reload. Full page, sheet and dock share the owner; Bookends and
Paper, light/dark and desktop-keyboard phone width are bounded coverage.
No physical-phone, timing or exhaustive browser claim follows.

Retain direct commands, exits, raw stdout/stderr, every failed/held attempt
and original fixture stderr. Run small focused966/967/history controls;
update only their explicitly superseded boundary expectations, keeping
interior editing, pane and card placement assertions. Record unchanged
baseline failures separately. No broad suite is planned.

After meaningful corrected greens, apply the entire real347 DeckPage owner
in this own worktree, observe the actual failure, then restore its exact
fixed bytes and rerun. Every Python phase has a unique effective cache
prefix. Keep one shared native/fixture workload, wait when load exceeds12
on18 cores, announce browser-in-use:1058 in Landing, close via Browser.close,
and verify owned PIDs/profile/fixture EOF and exit/scratch TCP absence before
browser-free. Stop browser use if cleanup fails. No live records or Tony
browser are used.

The source freezes on its own meaningful greens and is pushed only to this
exact branch for Warp's independent diff/test read. Fable owns canonical
freeze/stages/carry and landing; Links' current judged run is not disturbed.

## Built and retained verification

Only `web/deck-page.mjs` changes product behavior: it recognizes the exact
collapsed boundaries, reuses finish/outdent and removes the now-unused
editing-arrow folding helper. Existing displayed tree navigation stays.
The affected866/966/967 expectations and current key documentation now name
the deliberate1058 replacement; other assertions remain.

The own focused eight-file Node cohort passes175/175. With the entire
real347 DeckPage and the two original changed unit files applied, the
original seven-file baseline passes137/137. The42 new1058 checks on untouched
347 retain29 passes/13 meaningful failures; applying that entire real old
owner again repeats the same13 failures. Exact fixed-byte restoration returns
175/175. This is a focused comparison, not a whole Node-suite claim or a
waiver of the broader live suite's known failures.

Actual native CFT156.0.8078.47 and WebKit26.6 each pass112/112 cases:16 named
checks at seven cells (full page, sheet and dock at1360 in Bookends/Paper,
light/dark, plus a390-wide sheet). These use actual keyboard input, focus,
collapsed/nonempty selection, displayed card identity, saved subtree depth,
reopened persisted Core bodies, start-Tab/line controls and Undo. Desktop
engines at390 do not establish physical-phone or native-IME behavior.
Each engine first failed all three requested boundary cases on untouched347;
applying the entire old owner repeats those three failures. Byte-exact
restoration returns all three to passing in each engine. Native matrix
and restoration run bodies are identical for the owning runtime/harness.

Seventeen phase folders retain direct commands/exits and whole repository
input maps with original/new bodies. Phase01 held at load13.205 before
launch and ran no tests. Phase06 is107passes/5 failures at an incorrect bare
sheet reload expectation: screenshots show the underlying outcome after
the sheet consumes its opening query. The harness now reopens its explicit
topic/page address; the Core body assertions were already passing. Phase07
is111passes/1 source-byte-probe socket reset before that interaction. The
separate source probe now requests `Connection: close` and checks that
response header; native app requests retain normal policy. Both failures
remain as raw evidence, with no product/HTTP change or transport-reliability
claim. All executed phases retain stable start/end source maps.

All ten native phases, including intentional reds and failed harness phases,
close their browser and verify the observed owned descendants absent,
private profile removed, fixture EOF/exit0/empty stderr/PID absence and
scratch TCP refusal. Early ownership sets also retain short-lived observer
subprocesses; later phases exclude the observer itself. No process was
signaled. Historical random profile suffixes are not emitted in the raw
reports; each phase verifies its exact path before reporting removal. The
final handoff separately rechecks recorded PIDs/ports and each phase's own
profile prefix for remaining directories or processes. Compiled caches are excluded from publication; unique
effective phase prefixes remain in raw command/fixture receipts. The exact
full intake archive and phase reconstruction manifests retain source bodies;
external installed runtime identity is separate, not an exhaustive external
dependency closure claim.

Runtime and test execution preceded the final explanatory documentation
updates and source commit. The publication records those later doc-only
joins explicitly. No full browser release suite, physical device,
performance result,1089 dependency, deployment or Tony acceptance is claimed.
