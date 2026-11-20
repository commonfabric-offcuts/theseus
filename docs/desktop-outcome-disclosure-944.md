# Desktop outcome disclosure stays manual (944)

Tony's13781 report and Warp13785 replace the queued564 work. A desktop outcome
name opens its destination and keeps every outcome's disclosure choice exactly
as the person set it. Navigation, topic arrival and reload never write an open
mark. Outcomes without a saved choice start folded on desktop. Existing921
per-reader/instance/device marks, all-open/fold defaults, cross-tab merging and
unavailable-storage handling remain. A shared browser keeps that same record
when its viewport changes; no new preference or schema is introduced.

At the existing760px phone boundary,654 stays as shipped: first tap on a folded
outcome expands it in place without closing the drawer, next tap opens it;
arrival opens its current outcome. Explicit chevron and keyboard disclosure
commands still change the kept choice on either device. New/Waiting remain
temporary projections of it. Name clicks and Return navigate independently.

Real native outline clicks on220 must first show the desktop outcome wrongly
expanding. Final Chrome/WebKit checks cover desktop/phone and both themes,
collapsed and open choices across navigation and reload, explicit chevrons,
and unchanged phone taps. Retain921 choice/merge/all tests and654 native phone
controls. Apply the old arrival mutation, observe failure, restore exact bytes
and run its control. Freeze on meaningful green. No Core/schema change.
