# Current names in team and participant pickers

The outcome Team and topic Participants panels display each actor's registered
name. The stored actor ID still owns membership, color, history and delivery;
changing a label never creates a second actor or transfers those records.

The add filter matches both ID and name. Clicking a choice submits its ID.
Return resolves an exact ID first, then a unique exact display name, ignoring
case and an optional leading @. Shared names show IDs for disambiguation and
require an explicit choice or ID. An unknown typed ID still reaches Core for
validation as before; a substring match never silently chooses someone.

A repaint updates names without replacing their choice/remove controls.
These changes cover the Team and Participants panels, including the latter's
color/name button, feed author badges, dossier author labels and Reader author
provenance. Message text stays as written. The new-outcome form's datalist and
other ID-based surfaces are outside this change.

Checks: `tests/ui_people.test.mjs` and the native header case beginning
"header renamed agent" (real click, Return, Core membership and participant
readback).
