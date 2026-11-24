# Rail topic creation opens writing (1165)

After Core confirms a topic created with an outcome's rail pencil, open that
topic and its existing inline New message sheet, with the caret at the end of
its writing. An empty new topic starts with an empty field. Creation still uses
`TopicStart`'s `opening.save` and `opening.publish`, including the same operation
and destination after a lost answer. There is no Core command or schema change.

The rail retains the page run and navigation choice that began creation. A
cancelled title line, retired page, or newer navigation choice takes precedence
over a late receipt, including a late refusal. The confirmed topic still exists;
its old title line may close without taking focus. Refused or unknown creation
keeps the title and exact retry owner and opens no destination.

Use the existing topic navigation guard for saved writing, sends and images.
Carry the UI-only `topic-write` action through the existing menu-route fragment
so both an in-place move and a load onto a changed web build retain the request
to write. On arrival, consume it once, after topic confirmation and inline owner
initialization. A newer pending navigation, unavailable destination, replaced
inline owner or retired arrival opens no sheet. Reuse `Shell.compose` and
`InlineComposer.pop`; do not invent a second editor or change sending defaults.
`Shell.ready` keeps a per-run veto for a choice queued before readiness, even
after handing that choice to a microtask. A later refused departure retains
the veto. Only a new `Shell.begin` resets it for the next page run.

Owners: `OutlineRail.topicLine` owns the title and confirmed creation;
`TopicStart` owns kept envelopes and receipts; `app.mjs` owns the navigation
serial and topic startup; `TopicNavigation.openTarget` and `Shell` own departure
and loading; `menu-route.mjs` owns the consumed UI fragment;
`topic-writing.mjs` admits the arrival; `InlineComposer.pop` owns the sheet and
caret. The ordinary topic row, outcome creation and source-message opening
keep their existing actions. The later 1172 Escape behavior is separate.

Planned modeled checks cover the real rail line and creation owner, confirmed
save/publish, unknown/refused/mismatched receipts, exact retry after an unknown
publish, cancellation, retired run, newer navigation before confirmation,
departure refusal, once-only arrival, unavailable/replaced writing, a newer
queued move, route round-trip, and the real compose/pop caret handoff.
The readiness cases queue through actual `Shell.open`, call actual
`Shell.ready`, then call the arrival helper before and after actual queued
settlement, including a refused departure; they check no compose or focus.
Existing creation, departure and rail cases remain controls. These do not establish
native input, browser layout or durable Core mutation.
