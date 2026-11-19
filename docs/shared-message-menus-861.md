# Shared message menus and a new dossier (861)

Tony's Landing11626, approved11631; assignment11635. The Reader is the message
above the reply box. A dossier menu is the menu of its first message.

## One list, existing owners

The feed and Reader consume one list of message actions. Star/Unstar, Rename
on a loaded dossier's first message, Archive/Bring back, Fold/Unfold, Move to
topic, Copy Link, Edit, Update, Mark read/unread, Start a topic from this, Add to
pipeline, Start a new dossier and text display keep their existing owners and
eligibility. The label is Fold/Unfold in both places. Reader folding does not
move focus into the feed. Rename keeps the reply and closes the Reader before
opening the feed's existing title field. Fable840's cover request item stays in
cover-refresh. Archive is a shared first-level action on phones too; a title
bar's injected actions are deduplicated against the shared list.

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
