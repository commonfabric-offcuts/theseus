# Notebook card selection (983)

Initial reproduction/bisect used252 (`3d8756b464971dd16b064591e4d6693564768fd5`).
After deployment hold14437, resume14461 carries the narrow fix onto actual
release266 (`fd6a3f74456bb4e0aef327201925548af10ea4a2`) in a NEW own tree.
The252 worktree and all historical/native evidence remain untouched.
Reproduce Tony14308 with real keyboard input on the current full app, then
bisect the relevant released sources before changing the product. Record the
first failing release and distinguish lost selection state from lost paint.

DeckPage owns the existing selected set, range anchor, picked card and
keyboard/click gestures. NotebookPage supplies its surface/key scope;
arrowReach owns the surrounding pane handoff, and961 owns secondary clicks.
Restore or reuse these owners rather than adding a separate selection state.

Shift-Up/Down extends or shrinks the visible-card range from the initial
anchor. Modifier-click toggles one card; Cmd is the default on macOS and Ctrl
elsewhere. Mac Control-click retains the961 context menu. Plain clicks and
arrows retain their current behavior, and editable text retains Shift-arrows.
Folded descendants stay outside the visible range. Show the actual selected
cards and selected count in every Notebook look/theme and in full page,
sheet, dock and readonly mode. Links and controls keep their own actions.

Keep962 passage selection/quoting intact; check the approved962 composition
where this change shares that surface. Auditor owns967 pane navigation;
this change does not take its pane-focus or arrow handoff work.

Before freeze, retain actual current red and release-bisect evidence, focused
selection/control tests and native gestures. Compare affected existing owner
tests to pristine266 without weakening assertions. Use only isolated fixtures and
headless browser profiles; verify Browser.close and owned fixture cleanup.
Fable owns stages; Warp owns independent review and carry.

Native released-source comparison:232 (`51030a340`) passes18/18;233
(`de52dbe97`, item948 Notebook looks) and252 each pass16/18. Both failing
checks observe a selected noncurrent card with exactly its unselected
background and border. All native range, reversal, Cmd-click add/remove,
plain-arrow and editing controls pass in every run. The selection state did
not regress: the look stylesheet obscured it. Restore selected-card paint
after both material rules; no keyboard or click handler changes are needed.

Final266 evidence: pristine266 reproduces the same16pass/2paint-red quick
checks. Corrected266 passes108 native matrix assertions across full page,
sheet/dock, both looks and themes, plus18 edge assertions for folded cards,
the actual count, body Cmd-click, Mac Control-click menus, real second-tab
readonly and390px/coarse contexts. Phone cases now choose actual Bookends
and Paper under landed985; landed962 is the actual source composition.
Reports record actual engine chromium156.0.8078.47 and product/harness
hashes. This is desktop Chrome for Testing and phone-width/coarse emulation;
physical phone handles, software keyboard, WebKit and Windows native gestures
are not established. Existing non-Mac Ctrl handling is unchanged.

All23 UI test files directly naming look.css or selected Deck/Notebook
owners run identically on pristine266 and the candidate:744 tests,
729pass/15fail, no skip/cancel. Failed names and normalized full diagnostics
match exactly; the15 old failures remain failed and unwaived. All owned
browser PIDs/profiles and fixture EOF/exit0/PIDs/ports are verified clean.
