# Shared message menus and a new dossier (861)

Tony's Landing11626, approved11631; assignment11635. The Reader is the message
above the reply box. A dossier menu is the menu of its first message.

## One list, existing owners

The feed and Reader consume one list of message actions, with their existing
eligibility and exact owners. Item1091 presents each “This message” menu as
marks (Star, Read/Unread, Archive, Copy link), ordinary action rows, two
independent Topic/Dossier starts when both are offered, a final destructive
row, and grouped actionable keys. The dossier pencil owns Rename; it is no
longer a message-menu row. Paragraphs is Joined | Broken out at the rail foot,
using the same device preference and source redraw. Reader Wide/Stacked stays
in its own menu. Cover requests stay in cover-refresh. Reader folding does
not move focus into the feed. A title bar's injected actions are deduplicated
against the shared list. See message-menu-palette-1091.md for the presentation
contract and its current evidence limits.

Feed arrangement (Show latest/all, Split back out, moves, joins, stack levels,
Reset, Undo and Show full message) stays in the feed menu. Wide/Stacked and
Quote selection stay in the Reader menu. Notebook page menus retain their
page actions. An unavailable source offers no new writing action. Opening a
Reader-owned action from the feed first opens that exact source and rechecks
that it is still current before using the existing action.

## Start a new dossier

The action uses the current topic's existing New message editor and sheet.
It inserts the chosen source's full body as a Markdown quote and a link to
that message, followed by the Reader reply's existing body when invoked
there. The dossier menu quotes its first message. Existing quoted text in a
reply remains text. No structured quote, reply_to, exchange_id or opening
field moves into the topic editor: its source identity remains the topic,
so sending starts a root message through the existing send path.

Recipients and the effective Ask/Tell/Whisper choice move with Reader writing.
A private source's quotation must not silently become public merely because
the destination has a different default. The action does not send anything.

The destination must have no existing writing or chosen image. Neither draft
is replaced or merged. A conflict, unavailable editor, recovery, in-flight
send, or chosen image in the reply refuses the move with a plain explanation;
both drafts remain intact. Images belong to their original composition, so a
page-only transfer does not reassign them or discard them.

Before transfer, the registry owns a bounded transition that stops editing,
sending and images. It retains the source locally, writes the destination
locally, and only after that succeeds clears the source reply and keeps that
clear. An interrupted or failed destination save leaves the reply intact.
Generation and editor identity checks prevent late work from modifying a
different source, topic or newer writing. A cleared source that cannot be
kept still has the destination copy; the failure is visible. Only a successful
current transition closes the Reader and opens New message. A repeated press
cannot duplicate the prefix or start two transfers.

## Checks

Handler tests compare both menus and invoke their existing owners; cover
requests use840's item unchanged. They check feed-only and Reader-only acts,
source availability, privacy and exact-source guards on asynchronous opens.
Real Editor/registry tests cover the root identity, quote/link/body order,
recipients and choice, destination-first persistence, occupied drafts, each
image state, save refusal, repeated presses and a superseded transition.
Assertions fail on the previous source; load-bearing changes have applied
mutation failures and restored controls with final source hashes.

No Core/schema changes. Handler and source checks do not claim native browser
gesture, layout or focus acceptance. No browser, preview, full suite or hosted
CI is part of this slice.
