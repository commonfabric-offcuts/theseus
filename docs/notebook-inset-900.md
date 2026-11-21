# Notebook inset (900)

The Notebook sheet keeps its existing header and layout. The same dossier
cover inset continues down both sides and across the bottom, in Cards and
Text, docked and at phone widths. The full-page Notebook has no such frame.

The dialog's shadow remains responsible for the header. The opaque page area
gets a pointer-transparent shadow above its contents. Its top extends beyond
the page area's clip so it adds no horizontal seam below the header. Separate
paint contexts keep positioned card contents below the inset. No padding,
dimensions or page gestures change.

`tests/notebook_inset_900_native.mjs` opens the real index, styles,
NotebookSheet, NotebookPage and NotebookWriting with memory API responses and
isolated IndexedDB. It measures actual shadow pixels beside Cards and Text
at 320, 390 and 1280 pixels in light and dark themes, compares the header and
content pixels and geometry against a baseline, and uses native edge clicks
and wheels. The opening animation finishes before geometry is measured.
The full-page frame assumption is checked on a loaded NotebookPage.

Run with `AIM_PLAYWRIGHT_CORE` pointing to Playwright's module and arguments
for the Chrome for Testing executable, output directory, and optional baseline
directory. To collect a baseline with the same harness, set
`AIM_900_BASELINE_CSS` to the prior revision's `web/aim.css`; that run should fail
the side/bottom paint checks. The fixture records screenshots, computed styles,
pixel counts and owned browser/profile/server cleanup. It closes the browser
through Browser.close. This is Chromium layout/gesture evidence, not live
publishing, Safari or a physical phone keyboard/touch claim.
