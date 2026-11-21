# Dossier header star correction (951)

Base: release236, `96b286654ed3029af8c9c4bdf8afdc3af186aa6c`, schema59.
Warp13870 assigns Tony13867's regression; Warp13899 resumes work on236.

The header star follows the message card's existing visual rule: the hollow
text glyph uses the row's quiet colour, and the filled text glyph uses the
star mark colour. Both explicitly request text presentation. The transparent
natural glyph box, separator, title padding and card star remain unchanged.

A second press in the same visit must unstar the actual first message after
the first press commits. It must not require reload. The existing revision
fence, bounded named read and uncertain-result handling still own the command.
A separately starred reply must remain starred while the header is hollow.

Before product changes, native checks on unchanged236 will record computed
colours and consecutive presses without reload. Extend the646 owner checks
with this regression and retain its identity, pending and stale-result
negatives. Verify native pointer/touch/keyboard behavior in light/dark and
wide/narrow views, apply meaningful mutations and restore exact bytes.
Record artifact paths, engine limits and owned browser/fixture cleanup.

## Cause and retained behavior

The header unconditionally used `--stack-star`, unlike the card star. Its
hollow state now uses `--stack-meta-ink`; `aria-pressed=true` selects the mark
colour. U+FE0E requests text presentation for both header glyphs. The card
glyphs and their rules are unchanged.

The header also canceled `pointerdown`. WebKit suppresses a touch click when
that event is canceled: a keyboard press could fill the star, but the next
tap sent no command. The existing message toolbar already avoids this by
canceling `mousedown` instead. The header now uses the same focus-preserving
pattern. No Core, command routing, pending-operation or revision logic changed.

The original646 native check used Chrome only, reloaded between star/unstar,
and did not compare computed colours. Its existing runner now covers both
engines, same-position consecutive presses without reload, and an initially
filled star reached by Space then unstarred by pointer/touch. It records the
actual command targets, revisions and stored first/reply state, computed
colours, source hashes and copied test/product inputs. The optional third
argument filters cases, for example `^390-light$`.

WebKit setup exposed a floating toolbar over the centre of the folded row,
and its touch/keyboard setup did not open the intended inline reply. Setup
now opens the exposed row edge, then mouse-clicks exposed body text. The
writing assertion still uses a native header **tap** on narrow views and
checks the exact text and active textarea. Return opens Reader; it is not
the inline-reply setup. All intermediate failures remain in the evidence.

## Validation

- Final native: four cases per engine, Chrome for Testing156 and WebKit2359,
  1280/390px × light/dark. All eight pass after exact product restoration.
  Native mouse, touch and Space; computed hollow/filled/emptied colours;
  same-point star/unstar; actual first-message commands and durable state;
  reply-only hollow with the reply still starred; card glyphs unchanged;
  reload persistence, folded dossier state, title geometry, navigation,
  keyboard focus and unfinished inline writing all retain their assertions.
- Applying the original236 product with the final runner reproduces the
  filled-star touch failure in WebKit390-light. Applying only the original
  CSS with the corrected handler reproduces the colour failure. Applied
  bytes differ and exact restoration is checked by SHA-256 for both files.
- The nine646 owner/cohort files pass137 checks, including two additional
  same-visit loaded/unloaded first-message cases. The wider cohort including
  all inline wiring passes623/632. Its nine outcome/outline failures also
  occur on untouched236 (621/630); the complete failure blocks match after
  path/timing normalization. They concern outcome cards and923 read traces,
  not951. Separately, ui_folder_colour fails identically before/after because
  its old agent-folder selector is absent on236. Neither pre-existing test
  is changed or described as green. Core-lane7's945 work owns outline changes.
- All13 browser invocations, including retained baseline/setup failures,
  closed through Browser.close. Owned browser PIDs from launch logs are
  absent; Chrome profile processes are absent; WebKit reports graceful exit
  and temporary-directory cleanup. Every fixture exits on EOF with code0,
  no stderr, absent PID and closed origin port. No live browser or data used.
- `git diff --check` passes; fetched release/live73 remains the236 base.

Evidence root: `/Users/commonfabric/.local/share/theseus/auditor/evidence/`.
Final inputs, hashes, results and screenshots: `951-final-chromium/` and
`951-final-webkit/`. Applied red/restore: `951-mutations.json`,
`951-baseline236-final-runner/`, `951-colour-mutation/`. Cleanup:
`951-cleanup-verified.json`. Node: `951-node-final.log`,
`951-baseline-cohort/run.log`, `951-node-baseline-comparison.json`, and
`951-baseline-colour-test/run.log`.

Run the retained646 native owner with `AIM_PLAYWRIGHT_CORE` pointing at
Playwright's index.mjs, `AIM_CHROME` to Chrome for Testing, and an absolute
evidence destination. Run each engine sequentially:

```
DEBUG=pw:browser AIM_BROWSER=chromium node tests/dossier_header_star_646_native.mjs /absolute/chromium-evidence
DEBUG=pw:browser AIM_BROWSER=webkit node tests/dossier_header_star_646_native.mjs /absolute/webkit-evidence
```

Limits: native first messages are loaded; unloaded identity is checked below
the browser. No device Safari, full Core suite, deployment or live verification
is claimed. The filled mark intentionally keeps the existing card star colour.
