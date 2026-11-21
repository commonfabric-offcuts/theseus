# 952 · Outline topics stay rail rows

## Contract and ownership

Tony13872's actual picture shows outcome-home topic cards, including their
title, message count and time, inside the left outline. The main Topics area
is empty. These are `OutcomeTopicCards`, not feed message bodies. Keep the
outline's real navigation rows and the home projection in their own places;
preserve feed cards, both looks, disclosure and scoped navigation reads.

The intake contract preceded construction in the preserved own236 tree.
It distinguished a warm home → topic → same-home ownership defect from a
missing stylesheet or a load crossing a server restart. Core_lane7 owns945's
retirement/adoption/place methods; do not duplicate its fix. Page_lane6's
initially delegated restart helper was deferred in14008; this seat performed
the bounded restart control. Fable/Warp own pipeline, carry and deployment.

The final proof branch starts from live240,
`875cc8d952b1b7a88bbd37380159a7840ca25dc9`. It contains only this contract/report
and `tests/outline_cards_952_native.mjs`; no product change. Warp14042 closed952
as covered by945, shipped in release239 (`3c37d03034872bc34d3348238845649f048b3830`).

## Cause and observed result

On unchanged236, opening a home, clicking an outline topic, then clicking
that same outcome's name reproduces the picture in Bookends and Paper dark.
Cold home has four normal rail rows and no outline cards. Warm home has four
home cards in the outline and no normal rail rows. All six stylesheets have
rules, and their requests return200. Reload restores the normal rail.

`OutlineRail.begin()` made the retired adopted list inert but left its ids.
The next home's document lookup could reach that nested retired list;
`place()` retained the adoption while `loadTopics()` updated Conversation
rather than its actual list. A prior nonempty home projection produces952's
cards;945's empty projection is the related arrival case. The945 fix removes
retired ids and clears adoption on the workspace route. Current240 keeps the
home cards in the main area and real rows in the outline.

An actual mutation replaced only this own240 tree's `web/outline-rail.mjs`
with236 bytes. That restores the two warm-history failures, while six
controls pass. Current K CSS and945 null-projection copy remained in place.
The original file was restored byte for byte, with no product diff remaining.

- Before and restored SHA256:
  `ffd01695e8b5e8beef9a13c02bd0d26c3a599301a21d221e02f44758d84154d3`
- Applied mutant SHA256:
  `b30f0129b92d270e4fb9df9683b679b8758a3168e952e096a764e8b4f022bea6`

## Checks actually run

All native results use isolated headless Chrome for Testing and scratch Core
and HTTP records. Raw JSON, screenshots, TAP and copied restart assets live
outside the repository, under this seat's `artifacts/` directory.

| Run | Result |
| --- | --- |
| `952-native/before945-live236-bookends` | 2 genuine warm-home failures; 6 controls pass |
| `952-native/current-live240` | 8/8 pass |
| `952-native/ownership-mutation240` | Same 2 failures; 6 controls pass; exact restoration verified |
| `952-native/final240-complete` | 11/11 pass, zero page errors |
| `952-node-owners.tap` | 19/19 pass: boot,935 density and901 navigation owners |

The final native run includes a real same-port fixture stop/start while old
build module and style requests are held. Releasing them exercises the
existing523 boot recovery: one automatic reload, two document loads, all
styles from the new build and normal rail ownership. Build ids changed from
`80ab3de2bf7f27cb75ab` to `1a4ea9d0b2e269f801c9`.

A separate control aborts only `rail-dense.css`: it changes density but does
not create the black-card DOM. A manual reload restores that stylesheet.
This is not a claim of automatic individual stylesheet recovery.

The first baseline attempt used the wrong look-button label and the first
extended restart run did not catch CSSOM SecurityError for an intentionally
failed sheet. These harness diagnostics are retained separately at
`952-native/before945-live236` and `952-native/final240-restart`; both cleaned
up completely. The corrected final run reports the failed sheet explicitly.

Final cleanup: Browser.close returned; all seven owned browser PIDs and the
temporary profile are absent. Fixture37527 ended on stdin EOF with exit0,
its PID is absent and port59723 is closed. Every completed native run records
its own cleanup. No live records or Tony browser/profile were used.

Run the retained harness from this branch with `AIM_PLAYWRIGHT_CORE` pointing
to playwright-core's entry module and `AIM_CHROME` to Chrome for Testing:

```sh
node tests/outline_cards_952_native.mjs /absolute/scratch/evidence --restart
node --test tests/ui_boot.test.mjs tests/ui_rail_density_935.test.mjs tests/ui_outcome_navigation_901.test.mjs
```

`AIM_952_ROOT` may point at a separate own unchanged checkout for the baseline
without modifying this branch. The restart option copies only its web assets
into the evidence directory. The native geometry evidence is limited to a
1280px desktop, Bookends/Paper dark, and the pictured route; no phone, timing
or cross-engine claim is made.
