# Outcome Links (1021)

Tony15234 and Warp15241 assign the right rail's Links section to page-lane6.
The existing `previews` section key and saved fold remain; its visible name
becomes Links. Current previews continue to come from the current topic's
messages. Added links belong to the outcome, so all its topics show them.
979 stays frozen separately at `8d96c3ea`.

The fresh owned tree started on304/df70d792 and fast-forwarded through305 to
live306/5ccd5432284200e823c123c5689383d13f1c8fb7 under Warp15261/15268 before
any product edit. Page5 owns1020's mention toast; this piece owns the Links rail,
new Core link collection and its client, avoiding the composer and feed owners.

## User behavior

The Links heading has a pencil. It opens a small form for a URL and title;
the user can enter the title, with the site's address as a suggested name.
No Core transaction fetches another website. Only HTTP/HTTPS URLs without
embedded credentials or control characters are accepted. A site's favicon is
drawn in a browser-shaped tile with its title; an unavailable icon falls back
to the browser/globe vector asset. Icon requests have no referrer. The favicon
requires an explicit HTTP/HTTPS image source policy in the page's CSP; scripts,
connections and framing keep their existing rules.

Both looks and laptop/phone keep the archived-dossier icon grammar: a visible
icon above a bounded title, with a full accessible name. Each tile is an
ordinary external link. Return opens it. Right-click and the touch/keyboard
menu offer Open, Copy link, Rename and Remove. Left/right move within the drawn
row; up/down move to the adjacent drawn row. Resize and unequal title heights
use current rectangles, not a remembered column count. Menus and the form own
their keys; modified browser gestures retain their browser meaning.

Removing a derived preview hides that URL in this outcome without changing
its source message. Renaming it supplies an outcome-wide title. An explicitly
added link survives reload and another device. Unknown writes retain the same
operation for an explicit retry; a stale view or old route cannot overwrite a
newer title, reset the form or paint another outcome. Refusal keeps the form
and writing. A closed outcome is read-only.

## Core shape and checks

Use a dedicated `workspace_links` table, keyed by outcome and canonical URL,
with a stable sequence, title, revision, removed flag and last actor/time.
This is user data, not a browser preference, hidden Notebook page or instance
metadata. Removed rows preserve the override that keeps a derived preview
hidden. Existing workspaces, message links and permissions are preserved.
Outcome owner/team can read and manage Links, matching the existing shared
outcome Notebook writer scope; topic-only participation does not grant outcome
link access. Every command rechecks that scope and the authority pin.

`workspace.link_set` targets `{workspace_id}` and takes
`{url,title,removed}` with `expected.link_revision` (zero when absent).
It changes only that URL, returns the exact saved row and keeps normal
operation replay. A conflict returns the current revision without a write.
`workspace_links` reads bounded pages of that outcome, with a stable sequence
cursor, item revisions, and `reader_may_write`. Limits are owned and advertised
by Core (500 saved rows including removal overrides; URL4096 and title1024 UTF-8 bytes). Core-kept URL spelling remains the write identity even when the browser normalizes its navigation address differently. The rail merges active rows with existing previews, deduplicates
canonical URLs and applies removed/title overrides. No unrelated history scan.

Retain a failing real-Core check before product edits, then exercise restart,
shared reads, URL validation, exact retry, stale revisions, authority/membership
loss, closed outcomes, pagination and permission isolation. Client checks cover
merge/removal, form and late-route ownership, menu choices and spatial arrows.
Native Chrome for Testing and WebKit use isolated records and profiles, both
looks, phone and laptop, exact served bytes/receipts, and verified Browser.close,
owned PID/profile absence, fixture EOF/exit/port cleanup. Applied/restored
controls must catch scope, revision and navigation failures. A handler check
does not establish a native gesture or physical-phone behavior.

## Migration and landing classification

There is no existing Core link collection in306/schema65. The dedicated table
requires a migration and occupied downgrade protection: an empty collection
may step back; retained link/removal rows cannot be dropped. Reads and servers
never migrate. Warp15268 explicitly assigns65→66 against actual live306; if
another schema step lands before freeze, rebase once and take the next number.

The initial assignment said ordinary, but `docs/landing.md` classifies a new
schema/`SCHEMA_VERSION` change as judged-first, and `aim_next/judgment.py`
guards `aim_next/migrations.py`. Warp15268 settles this as judged. The complete source must retain the required
data authority and report the actual classification. Fable owns binding/stages
and exact freeze readback; Warp owns the route ruling, candidate integration,
independent read and landing. No live migration or installation edit is part
of this builder's work.
