# Topics before outcome setup

Item 842 follows Tony11322/11326, the final Warp11331/11336 direction and
Tony11333 agreement. It changes display order only on live 128 (835).

The outcome title and its overflow menu remain the page heading. Below them:
Team and invitations; Notebook and page reading; Topics; Skills and tools;
Where it stands (including ended/Bring back); editable purpose; target and
checks; Pipeline. The secondary group remains Also waiting, improvement
loop, pre-check problems, More from this outcome.

Onboarding stays in the title menu; unfinished work and saved writing keep
their existing recovery paths. All section readers, editors and commands
retain their owners. No Core, schema, stored data, new modal or other content
change belongs here. A later settings modal is separate.

A focused page-wiring check must fail on the old order before the change and
pass afterwards. Compare the relevant section/wiring checks against live.
No preview, browser/native suite, full suite or CI; Warp reads the frozen
source and Tony checks the live page.

Validation on release 128 (`9ee4cfaf3b363c12b7af138181c027e4cc65e7f8`):
the focused order check fails before the edit and passes after it. The nine
relevant UI families pass 303/303 on live and 303/303 on the candidate, zero
failures or skips. The first candidate pass found one old Notebook-after-topics
expectation; it now checks Notebook-before-topics while retaining the same
page-reading and commit-reload assertions. The retained-content and image
callback checks from 835 still pass. Only web/app.mjs changes in the product.

Raw evidence is under `~/.local/share/theseus/auditor/evidence/`:
`842-live128-red.tap`, `842-order-green.tap`, `842-baseline128.tap`,
`842-candidate128.tap` (the obsolete expectation), and
`842-candidate128-fixed.tap`. No native layout or focus claim is made.
