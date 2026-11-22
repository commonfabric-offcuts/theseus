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
browser-equivalent navigation addresses and applies removed/title overrides, while preserving each exact Core URL as its write identity. If equivalent Core spellings already exist, newest update time then sequence chooses their one icon/override; no rows are rewritten. No unrelated history scan.

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

## Review15423 correction contract

Rejected source9c089b1b remains retained history. The same source branch takes
one corrected head covering all four faults. Core serialization must preserve
browser-produced credential-free HTTP/HTTPS hrefs across the printable URL
character class, including empty query/fragment markers. Host validation must
refuse forbidden domain characters and invalid numeric IPv4 spellings before
a row is written. The client skips an individually unusable URL while retaining
valid rows, bounded pagination, authority and structural-response checks.
Legacy exact Core URL identities and revision fences remain unchanged.

A touch hold opening the shared sheet consumes its own release, as ImageRailMenu
does; the next deliberate press works. A second pencil press closes the form
and reopening retains unsent URL/title, including after an Escape/Cancel close;
a successful save may clear it. Route/reset and lost-authority clearing remain.
Retain actual native hold/pencil failures and the browser/Core spelling property
red before product edits. Final native matrices drive those gestures and real
query-bracket preview Rename/Remove/Add with Core readback and no duplicate row.
Chrome native touch proves the hold path; any WebKit touch-driver limitation is
explicit rather than replacing it with dispatched DOM handlers.

Include the bounded adjacent15423 corrections: reject title controls/bidi marks,
44px coarse-pointer menu targets, Copy success feedback, removal focus to the
next tile (previous at the end), and classify workspace_links in the three
explicit view inventories. No unrelated inventory deficiencies are weakened.
The judged65→66 route and15268 contract remain; no live installation writes.

Review15443 also requires the seat-migration fixture's scratch predecessor to
drop the empty later workspace_links table, matching step_back_by_hand in
test_migrations.py. Only that setup SQL changes; the upgrade, predecessor-data,
recorded-seat, roundtrip and byte-preservation assertions remain unchanged.
Actual pre-edit errors in both named tests are retained.

## Review15569 fourth-head correction contract

Rejected e5f2b9f3 remains retained history. Same source branch takes the three
remaining fixes and the bounded followups before a single new frozen head.
A hold's opening release stays suppressed, but a later sheet Open or the first
Return after Escape must navigate. Clear this Links door's stale suppression
at a new deliberate pointer/key gesture and when its held release is consumed;
keep the shared menu implementation and all other menu owners unchanged.
Native touch release can move focus outside the sheet. Links handles Escape
for its still-open menu at document capture, restores the tile and keeps the
rail open; the next Return opens it without an intervening pointer or focus
assignment. Retain that natural-sequence red separately from the earlier
controlled-focus navigation checks.
Escape stops propagation to the rail, while other document capture listeners
still observe keyboard use. Stopping those listeners too makes the existing
Return owner take the following Return to the page composer.

At phone/coarse widths the44px dots control must have its own area outside the
browser icon's rectangle, with both icon and title keeping native link taps.
Place it in a separate row below the title; preserve the desktop control.
Retain before/after390px screenshot and geometry/native hit observations.

Each changed Link publishes workspace_link in both workspace and outcome
change scopes with its stable row sequence identity and row revision. It never
bumps workspaces.version or the global outcomes-list hint. Settings opened
before a teammate's add/rename/remove still save at their original revision;
Link CAS and operation replay remain. Topic change pages admit this known key
without treating it as Notebook content, and outcome invalidation does not
re-list unrelated panels. The rail's existing Live listener repaints Links.
No schema or changes-cursor-shape addition, no weakening scope/authority checks.

Menu Rename over an Add form keeps its exact unsent URL/title for reopening.
Copy confirms in a Links-owned status line: a background rail refresh cannot
hide the confirmation. It clears on the next Link menu or route reset. The
native check copies, commits another isolated Link from another client and
waits for that Live repaint before checking the confirmation is still shown.
Title control/bidi refusal names the cause. Browser-produced A-label hosts,
including RTL labels ending in digits, survive validation without IDNA2003's
stricter whole-label bidi rule; prohibited Unicode host scalars still refuse.
Direct raw-Unicode API input retains its named stdlib-IDNA deviation limit.
It may map or refuse a raw Unicode host before an A-label exists; the browser
form supplies its ASCII href. The RTL digit check follows the relevant label
rules in [RFC5893 section2](https://www.rfc-editor.org/rfc/rfc5893.html#section-2),
within the existing bounded parser rather than claiming complete UTS46 parity.
Keep actual pre-edit native/Core reds, small scoped client tests, final producer
hashes, paired relevant cohorts, recovery controls and strict owned cleanup.
1037 and1034 stay conditional on approval, not part of this correction.

## Review15783 fifth-head correction contract

This supersedes the fourth head's dual-scope Link emission. Publish Link row
keys only in the workspace scope. Team and topic-only readers' topic change
feeds receive no Link key, keeping the strict306 client running across an
upgrade and revealing no Link activity to a reader denied the collection.
Settings/list identity, row revision/replay and Live rail repaint remain.

Every menu act resolves the current attached tile by its exact Core URL and
uses that tile's current row/revision. A removed tile performs no stale act.
Menu refusals and Copy failures use the Links-owned status, so another write
and Live repaint cannot erase them. edit() refuses to repurpose the form while
an Add is busy, preserving the pending response, exact writing and refusal.

Host failures identify the host rather than credentials. Contextual ZWNJ/ZWJ
joiners remain a named parser limit: browser-valid names containing them may
be refused, with that cause stated in the form's error and this page. No full
CONTEXTJ/UTS46 parser is added in this correction.

Retain actual fourth-head reds before product edits. Add scoped client checks
for suppression clearing, capture Escape/document keyboard observation,
Rename-over-Add retention, busy editing, current-tile acts and own status.
Native checks retain stale-menu repaint, actual busy Add refusal and refusal
surviving another real write/Live repaint. Same branch/base306/schema65→66;
one exact fifth frozen source follows green checks.1042 follows that freeze
under15787 and needs Fable binding;1037's separate approval gate stays.
