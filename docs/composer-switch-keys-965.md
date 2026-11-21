# Composer switch keys (965)

Base: release 240, `875cc8d952b1b7a88bbd37380159a7840ca25dc9`.
Source: Tony14045 and Warp14051; own topic965, ahead of955.

The Message | Note switch chooses once for a Left or Right press, without
wrapping at either end or acting again for a held key. Home/End still choose
the first/last option. Up and Down reach the nearest control in that direction
through the existing arrow owner, keeping the choice. Tab keeps its native
route. Escape leaves the inline switch for its writing field; in the popped
sheet it retains the sheet's existing dismissal and focus return.

Keep pointer switching, writing, roving tab stop and the feed's arrows outside
the switch. Start in InlineComposer's existing listener; do not change the
shared feed route without an actual failure showing it is necessary.

Use native keys on the actual app in an isolated ui_http instance. Retain the
240 red from a single Right press at Note, vertical/Escape failures, then
exercise single-step/pointer/boundaries, Tab and feed negatives in Chrome for
Testing and WebKit, laptop and phone width, light/dark. Phone width in a desktop
engine is not physical-device evidence. Verify Browser.close and owned profile,
PIDs, fixture EOF/port cleanup. No production records or installation changes.

## Retained verification

`tests/composer_switch_keys_965_native.mjs` loads the actual HTTP app, keeps
writing throughout, and uses native keyboard/pointer input. `AIM_965_BASELINE=1`
runs the one laptop/light cell; otherwise it runs1280/390px and light/dark.
`AIM_ENGINE=webkit` selects WebKit; the default is Chrome for Testing, from
`AIM_CHROME`. `AIM_PLAYWRIGHT_CORE` names the installed Playwright module.
The sole argument is an absolute evidence directory. Run from this worktree.

Actual untouched240:6 failures,3 controls pass. One Right at Note wraps to
Message; Up/Down switch choice; Escape does not leave; boundary/repeat checks
also fail. Tab, feed navigation and sheet dismissal pass. Candidate single
cell9/9; final Chrome36/36 and WebKit36/36. Final affected Node61/61:
`node --test tests/ui_arrow_reach.test.mjs tests/ui_inline_send_937.test.mjs
tests/ui_quoted_inline_send_941.test.mjs tests/ui_inline_reply_838.test.mjs`.
No existing test was edited. No Python/Core or shared feed route changed.

Raw observations, actual failure screenshots, logs and cleanup receipts:
`/Users/commonfabric/aim-worktrees/core-lane7-965-evidence`, phases
`actual-red240`, `candidate1`, `chrome-final`, `webkit-final` and
`affected-node.tap`. Every browser closed through Browser.close; final Chrome
fixture40991 and WebKit41180 exited0 via stdin EOF, their PIDs/profiles and
owned child processes absent, their ports closed. There is no live-install,
physical-phone or timing claim. Source freezes here for Warp's one review.
