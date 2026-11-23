# Arrow keys beside a dossier (967)

With a Notebook docked beside the feed, Right from the feed enters the
Notebook; Left from the Notebook returns to the feed's retained message.
The Notebook retains its own place. Up and Down continue within the pane
holding focus, including cards being displayed without an editor.

The existing card tree gets first use of Left/Right; an unused outward Left
from a top-level card hands focus back to the feed. Page controls also have
an outward route. An editor retains its writing keys;1058 finishes a Card
editor on Left at its collapsed start or Right at its collapsed end,
displaying that card in the same pane. Modal sheets retain
their focus boundary, and hidden/closed Notebook pages are never entered.
Without a docked Notebook, the existing feed/outline/right-rail routes stay
unchanged. No persisted data or Core commands change.

Build on release 266 (fd6a3f74456bb4e0aef327201925548af10ea4a2),
including the released 962 passage owner. Earlier 252 work and red evidence
remain preserved in the original worktree.
First reproduce the missing feed-to-Notebook route through native keys on
that base. Check actual focus, retained card/message, within-pane movement,
editing, modal/closed sheets and existing card tree behavior. Apply and
restore a routing mutation to prove the checks detect a broken handoff.
Record actual browser engines and verified owned-process/fixture cleanup.

## Implementation and evidence

The sheet registers its current page with the existing pane navigator while
docked, replacing the hidden right rail in that route. Entry uses the page's
existing focus owner, preserving its picked card or unfinished editor. A
plain Left at a top-level card's tree boundary hands focus back to the feed;
folding and parent selection precede that handoff. The spatial navigation
owner also recognizes the sheet's page controls. Modal isolation is unchanged.

An editor arrow stops before the window's spatial fallback.1058's collapsed
Card-end commands finish in the same pane, including an empty fresh box;
other unused arrows retain their native caret action. Text view keeps its
writing keys even when empty. No changes to passage selection, quote provenance, card
selection paint, saved writing, or Core records are involved.

Actual native reds on 252 and 266 leave focus outside the shown Notebook
after Right from the feed. The expanded negative also exposed empty-editor
escape before the caret guard. The six new owner checks cover entry, return,
unfinished writing, lifecycle, empty pages, tree boundaries and caret keys.
Three applied controls remove entry, outward handoff and the caret guard
separately; each fails its owner check, and exact restoration passes.

Native scenarios run at 1280/1600 (docked) and 1100/390 (modal) in Bookends
and Paper, through real keys, with the released 962 passage owner present.
They check within-pane Up/Down, tree folding, retained places and writing,
page controls, text view, resize and closed-sheet routes. The feed's first
Left folds its dossier; the next Left crosses to the outline. An early
negative incorrectly expected that crossing on the first Left; its failure
is retained, and the corrected test asserts both existing steps. Phone
widths use desktop browser engines with a keyboard, not physical devices.


Final checks on this 266-based source:

- Focused owner checks: 33/33, including all six new cases.
- Native Chromium and WebKit: 8/8 each. Both the requested engine and
  actual browser type are recorded and agree. Every source/harness hash
  matches the tested files. Browser.close, owned PID/profile absence and
  fixture EOF/exit 0/PID absence/closed port are verified for each run.
- Three applied mutation controls fail as intended; byte-exact restoration
  returns the focused checks to 33/33.
- The broader 81-file candidate cohort has 1,730 tests: 1,714 pass and 16
  fail. Pristine 266 has 1,724 tests: 1,708 pass and the same 16 fail, with
  matching names and normalized cause diagnostics. No failure is introduced
  or waived; this is not a claim that the whole cohort is green.

Raw evidence is under
`/Users/commonfabric/.local/share/theseus/auditor/evidence/`:
`967-red266/`, `967-chromium-final266/`, `967-webkit266/`,
`967-owner-restored266.log`, `967-applied-mutations266.json`, and
`967-cohort-comparison266.json`. The corresponding cohort command manifest
and raw logs preserve the complete file lists, diagnostics and exit codes.
The native harness is run from the worktree as
`node tests/notebook_arrows_967_native.mjs <evidence-directory>`, with
`AIM_PLAYWRIGHT_CORE` pointing to Playwright, `AIM_BROWSER` set to `chromium`
or `webkit`, and `AIM_CHROME` pointing to Chrome for Testing for Chromium.
