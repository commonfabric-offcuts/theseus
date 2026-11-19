# Outcome page, item 847

Tony's Releases 11426 and 11435, clarified by Warp 11431, 11438 and 11448.
No preview, browser or screenshots; the release describes the change in words.

The outcome's topic cards are a second presentation of the outline's own
TopicRail, not a second list or query. `TopicRail.presentation()` passes plain
row and group values plus activation/paging callbacks, with no DOM nodes
(Warp 11464). Only that owner knows its markup and computed filter result.
Cards follow its rendered row order,
including an order held under the pointer, the outline's filter, and its
open Done/Archived groups. The phone drawer being off screen does not remove
its logical rows. Folding the outcome or filtering it out removes its cards.
More, Retry and group toggles operate that same rail. A refusal clears cards;
a temporary failure retains the last rows with the rail's notice. A readable
outcome reached directly but absent from the outcome list reads its topics
through its existing provisional outline row, using the same owner.

Cards use the dossier folder background and inset without a folder tab.
Their title and marks come from the rail; message_count and activity_ms are
already in the same topic-list items. Native links and the rail's question /
unread destinations remain. Two columns fit between both desktop rails; a
phone has one. No Core or stored topic changes.

The existing OutcomeReferences list becomes a horizontal row of labeled
document icons, first under the outcome heading. Each icon says Cards or Text.
NotebookPage remembers the last view per instance, actor and page in this
browser. A new page defaults to Cards; an explicit link view takes precedence.
Unavailable browser storage falls back to Cards. This is a view preference,
not a page revision, and changing it never changes Draft or writing. Opening
the icon still opens the existing Notebook sheet. A changed preference updates
the icon without fetching another list.

The outcome Team uses the topic Team's PeoplePanel pill renderer and styles.
Its existing membership, fixed owner, Add, remove and Invite agent acts remain.

Evidence will distinguish source/DOM checks from native layout or gestures;
the latter are not run under the no-browser instruction.

## Build evidence

Base: release 133, `f1c80812126bd7681dbc733ecbd75d57478493ae`.
Seven existing focused JS families pass 146/146 on that base. With the eight
new checks, those families pass 154/154. Two selected actual app-initialization
checks pass 2/2, including the updated Notebook-first order, shared right rail,
and absence of a second topic-list owner. No failures or skipped tests.

Eleven applied mutations each fail an intended assertion; every byte-exact
restored control passes all ten selected new/app checks. These cover the old
app and NotebookPage code from 133, leaked DOM at the presentation boundary,
lost provisional owner, lost held order/filter, lost view persistence, shared
actor preference, ignored list/outline refusals, and the desktop column rule.
The column check is source evidence, not rendered browser geometry. Source
and DOM fixtures exercise link handlers, not native mouse/keyboard gestures.

Raw TAP, mutation source/hashes/results and the build asset hashes are at
`~/.local/share/theseus/auditor/evidence/847-*`. The build loader includes both
new modules under the same build stamp. Syntax and whitespace checks pass.
No Core, schema, data-history or page-revision changes; no native/browser,
screenshots, full suite or hosted CI.
