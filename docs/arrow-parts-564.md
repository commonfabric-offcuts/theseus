# Arrow access to dossier parts and message words (564)

Warp13792 assigns the remainder of 301 on release220 (`73d3c2b34`). The
current item and its source5743 name a folded dossier's chevron and replies,
and controls inside message text. This change keeps the existing stack fold
keys and the up/down order of an unfolded dossier.

## Contract

- In a folded dossier, down from its compact header reaches its chevron,
  then its visible replies. Up reverses those stops. Navigation alone does
  not open or fold the dossier, and hidden replies are not stops.
- An unfolded dossier keeps its existing order: chevron, original message,
  replies. The stack's left/right open/fold action still happens first.
- Once a message is open, right from its card reaches the first visible
  link or button in its words. Left/right traverse those controls in reading
  order, including controls on different lines. Left from the first returns
  to the card; right past the last keeps the usual move to the right rail.
- A message without controls keeps its existing pane arrows. Up/down on links
  still moves between messages. Return still belongs to the focused control. Writing, dialogs, menus and hidden controls retain their own rules.
- Focus stays on the visible destination and has a keyboard focus indication.
  No record, writing, destination or server contract changes.

## Checks

`tests/arrow_parts_564_native.mjs`, registered with the existing rail native
owner, presses native arrows against isolated real HTTP/Core data. Folded
and unfolded dossiers and message text controls are checked in Chromium and
WebKit at 320/375/390/1280, light/dark. The native contract was written before
the product change. Each case uses actual key input, verifies the focused
element and its painted destination, and closes its owned page. A folded
head has a zero-height card by design: the check measures its visible title
row, while still requiring focus on the card and keyboard focus visibility.

## Evidence on release 220

Evidence root on the auditor seat:
`/Users/commonfabric/.local/share/theseus/auditor/evidence/`.

- `564-native-red2`: unchanged 220, 32 expected native failures (folded
  chevron skipped and right from the card skipping the first link), with all
  16 unfolded/plain negatives passing. Earlier probe/red directories contain
  fixture-setup diagnostics and are not acceptance evidence.
- `564-final-chromium` and `564-final-webkit`: 24/24 each through the existing
  repository rail runners. Widths 320, 375, 390 and 1280, light and dark;
  folded header/chevron/shown reply and back, unfolded order, plain-card
  left, both text links and code Copy in both directions, link Up, retained
  Tab order and right past the last control. Each destination is native
  keyboard focus and visibly drawn. Screenshots include the dossier ring
  and the first text link's focus outline. These are desktop engines at
  phone widths, not physical-phone keyboard or touch claims.
- `564-mutant-folded` and `564-mutant-words`: asserted one exact replacement
  in each real product source; each made four targeted native cases fail
  at its intended assertion (both engines, 320/1280 light). Mutation JSON
  records distinct before/mutant hashes and byte-exact restoration. The
  final registered-runner passes above are the restored controls.
- `564-node-restored.log`: 812/813 across 28 affected Node files. The sole
  failure is the existing `ui_reread_messages.test.mjs` exact refresh-string
  allowlist. `564-baseline-node` reruns that same test against a `git archive`
  of untouched 220; its actual and expected arrays match the current failure
  exactly (`comparison.json`). No new Node failure remains and no unrelated
  allowlist repair is bundled here.
- Every browser invocation has a cleanup receipt: Browser.close completed,
  owned browser/profile and fixture processes are absent, fixture EOF exit
  is zero with empty stderr, and its port is closed. The earliest setup
  probe lacks browser PID launch logging and is labeled diagnostic only.

Reproduce the registered native checks with the seat's Chrome for Testing
path and an empty absolute evidence directory (`AIM_PLAYWRIGHT_CORE` names
its installed Playwright core directory for WebKit):

```sh
node tests/reader_persistence_native.mjs "$CFT_564" "$EVIDENCE_564/chromium" --rail '^rail item 564'
node tests/webkit_native.mjs "$CFT_564" "$EVIDENCE_564/webkit" --rail '^rail item 564'
```

The final source manifest accompanies the freeze. The runners' source-copy
lists now include this check and all four product modules; the last edit to
those lists only expands provenance, after the final native runs. No product
or native case changed after those passes. No live instance or schema changes.
