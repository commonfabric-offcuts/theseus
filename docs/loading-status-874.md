# Loading without moving the feed (874)

Tony11769 reports the loading line above the topic feed moving its contents.
While loading, the starred-dossier line and each dossier's first-message line
use the existing `sr-only` treatment: out of flow, clipped, and still exposed
as status text. Loading does not insert a visible line or expand a folded card.

Errors, refusal and missing-source notices remain visible in their original
place. Retry and the canonical source link keep their existing owners. A
successful load removes the dossier notice and hides the starred notice.
Changing from error back to loading restores the silent layout treatment.

Checks call the actual two app painters, including error and retry transitions,
and inspect the existing screen-reader-only CSS and folded-parent selector.
They fail on146 before the change; applied mutations and restored controls
hold the changed boundaries. No Core/schema change, browser, preview or native
geometry claim: the evidence establishes the markup and CSS declarations.
