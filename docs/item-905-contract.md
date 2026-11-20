# Item 905: finish the Coordinator picker

Build from release 176, b6acf986a1cdfc27c0d03207c4b6c4fb9d69586d. This is the four-fix return of shipped item 899, under Warp 12476/12496. No new command, authority, persisted state, or navigation owner is introduced.

A keyboard user who chooses a coordinator returns to the same Coordinator row when the recorded change and current-state refresh finish. Disabling the pending choice can move focus out of the list; the settled action must retain the keyboard user's focus destination. Escape then closes the existing people panel. Existing dismissal, stale-page, pending, refusal and retry rules remain in force.

A recorded REVISION_CONFLICT displays exactly “Someone else changed this at the same moment. Try again.” The real Core message is “Writing changed; preserve this attempt and reconcile” (aim_next/contract.py, _revision). The Coordinator command remains one-shot; it never adopts setPresence's conflict retry. The refusal remains visible and the current coordinator is reread through the existing refresh owner. Other refusal reasons remain their actual reasons.

On an ordinary topic, after loadConversation accepts a fresh checked view into here.view, an open Reader immediately reflects the new coordinator in its “Answered by” fallback and its “X answers there” destination note. Reuse Reader.paintRecipients/paintChoice and the existing app callbacks. Do not add a second coordinator cache or a read for repainting. Existing explicit recipients and destination rules continue to own their behavior.

If the page learns a newer workspace revision before the user chooses, the single command sends that current revision and the resulting row names the committed coordinator. Report the actual baseline result for this guard: a guard already passing on 176 is not a red-before claim. A later applied opening-revision fault must be detected by this case.

## Preparation and proof limits

The initial bounded baseline selects five cases: four appended 905 cases plus the existing 899 stale-pick case. Two existing lines are deliberately corrected with parent admission: the invented refusal is replaced by Core's real message, and its invented-message regex is replaced by exact member-facing wording. All other prior test/helper/import/source-read/assertion bytes remain unchanged.

The fixture invokes actual app and CoordinatorChoice handlers and the actual imported Reader paint methods. Its local DOM ports model disabled-button focus and descendant queries. Return activation is represented by invoking the focused button's click handler; browser focus, native keyboard gestures, timing and hosted behavior remain unproven. The Reader's unrelated compose measurement/summary-line ports are inert; neither supplies the labels asserted here.

Preparation permits no product edit or test execution. The parent must first read the exact source bindings, tests and bounded runner and grant a runtime lease. Any unexpected setup failure is retained and reported, not counted as a behavior assertion or silently retried. Subsequent product work, controls and applied faults require their own authorized phases. No Core, store, server, HTTP, browser, native, hosted or whole-suite runtime is included.
