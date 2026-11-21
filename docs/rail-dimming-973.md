# Browser-local personal rail dimming (973)

Base248: `b949e1f38780967c93526117aaa2117533aaa00e`.
Own branch: `core-lane7/973-rail-dimming`.
Sources: Tony14154/14164/14198, Warp14200/14216, designer handoff
`n-838502354c4c41cb9ca5061a13cb2eff` revision4. Contract preceded code.

## Behavior and defaults

Dim0 |1 |2 at the rail foot follows Compact | Roomy's button style.0 shows
all rows;1 and2 hold independent editable views. Command-click or Control-click
on an outcome name or topic toggles its dimming without navigation, a new tab,
reordering or disclosure changes. Editing with0 on selects1 first. An outcome
edit includes its topics and clears its previous child overrides; a subsequent
topic edit changes that topic alone. Shift-Command/Control-click replaces the
current view with everything else dimmed: a clicked topic and its outcome
remain full; a clicked outcome's branch remains full. Inverse also applies
to rows loaded later, without enumerating every outcome/topic.

Words and outcome chevron use15% ink mixed with the rail background; a dimmed
outcome uses weight500, its light and action glyph opacity.15. Counts/waiting
markers use visibility hidden, preserving geometry. Hover wakes only that
row; selected row wins. The vertical rail line stays unchanged. Bookends and
Paper use the same tokens, in both themes. Names and roles are unchanged.

`web/rail-dimming.mjs` owns the two browser-local views, painting and modified
press capture. OutlineRail creates/binds it; existing TopicRail data/link
handlers remain unchanged. It paints newly drawn rows using MutationObserver
and rebinds the listener-free footer copies on in-place navigation. Native
Control-click's contextmenu and click, where both occur, consume one press
only. Other controls and right-click menus retain their own handlers.

No Core table, command, schema or migration. localStorage key is
`aim-next.rail-dimming.v1:` plus JSON `[instance_id,actor_id]`. Version1 stores
selected0/1/2 and two sets of focus/typed overrides, with at most2048 outcome
and2048 topic exceptions per set. A compact inverse focus covers unseen rows.
Empty, malformed or unreadable storage starts at0. Failed writes retain this
page's view and the controls' tooltip says it lasts for the page. A matching
storage event rereads current storage; no timer or polling. This intentional
browser-local first version survives reload here, never crosses devices,
and never reads another actor's saved views. Warp14200 and handoff revision4
supersede the earlier Core/migration and reset-on-reload proposals.

## Verification

`tests/ui_rail_dimming_973.test.mjs` has10 state checks: independent sets and
0/edit defaults, inheritance/child overrides/inverse with later rows, reload,
instance/actor/browser isolation, malformed/unavailable storage, same-binding
reconstruction, storage refresh and invalid inputs. The directly obsolete
modified-click expectation in `tests/ui_outline_disclosure_902.test.mjs` now
requires prevention, dim/restore/inverse, unchanged disclosure/navigation and
zero reads. No unrelated assertion is weakened.

Actual unmodified248 native baseline: four failures (absent switch, normal
outcome/topic clicks do not dim, isolated inverse does not dim siblings), one
plain-navigation control passes. First candidate exposed real topic CSS
specificity; corrected scoped selectors pass. Separate harness diagnostics
for prepared inverse state and in-place arrival readiness are retained.

Applied owner mutation removes actor from the real storage key. The reload/
other-reader oracle fails with another actor inheriting selected2 instead of0.
Exact module restored, SHA256
`8fb2977a1bff3ce1734d285d8f82d39f609e850508e6bf414e8c51819fc4940c`;
final owner cohort53/53 passes across the new state tests,901 navigation,935
density,902/921/944 disclosure and outline order. Related inline-rail cohort
7/11 matches pristine2487/11 with the exact same four old847/923 projection
failures (missing expected card arrays). All five933 scoped-count checks pass.
Raw comparison retained; no broader green or fixture waiver is claimed.

`tests/rail_dimming_973_native.mjs`: final Chrome29/29 and WebKit29/29, both
looks/light/dark at1280px plus a390px touch-controls case. It uses actual
HTTP/Core fixture creation and native modifier clicks, hover, Tab/Space/Return,
taps, reload and in-place moves. Checks cover computed15% ink/weight/count
visibility with stable boxes, outcome/child/inverse, later rows, two views,
selected row, storage events between tabs, another browser, no popup or order
change, and re-created footer listeners. WebKit uses Option-Tab, its native
all-controls key, as the existing driver does. Earlier plain-Tab diagnostics
are retained. Touch is a desktop engine at phone width, not physical-phone
or timing evidence.

Commands: `node --test tests/ui_rail_dimming_973.test.mjs
 tests/ui_outcome_navigation_901.test.mjs tests/ui_rail_density_935.test.mjs
 tests/ui_outline_disclosure_902.test.mjs tests/ui_outline_order.test.mjs`.
Run the native file from this worktree with an absolute evidence-directory
argument, `AIM_PLAYWRIGHT_CORE` module path and Chrome for Testing executable
in `AIM_CHROME`; `AIM_ENGINE=webkit` selects WebKit. `AIM_973_BASELINE=1` runs
one Bookends/dark desktop cell. No live records or Tony browser are used.

Raw evidence: `/Users/commonfabric/aim-worktrees/core-lane7-973-evidence`.
Accepted red phase `red248-inverse`; final `owner-final.tap`,
`actor-key-final-mutant.tap`, `actor-key-final-restoration.json`,
`inline-rail-owner.tap`, `inline-rail-control248.tap`, `inline-comparison248.json`,
`chrome-final`, `webkit-final2`. Both final browsers closed through Browser.close;
all owned PIDs/profiles absent, fixtures90980/90038 stdin EOF/exit0, PIDs absent
and ports closed;0 page errors. Source freezes here for Warp's one review.
Coordinator owns973 Build/stages and Warp carries/deploys.
