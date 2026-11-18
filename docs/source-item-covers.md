# Automatic source-item cover rows (757, ruling 9553)

Default: **Automatic source-item rows**. No setting or posting step. Core derives
one row per readable actual (workspace_id, number) linked by message sources to
the reader's current dossier. Notes and Notebook sources produce no message IDs.
A piece's topic is never a message dossier. The existing item route works at filing.

Default ordering: manual stands, manual payload, generated item rows ordered by
workspace ID then ascending item number, then manual waits with their defaults.
Each generated row links its short name (the item's title, whitespace folded) to
its existing item record and says its plain state. Identity is never a title.
All actual visible source IDs in that dossier are retained per row, without
repeating the item for multiple sources. Other dossiers retain their own rows.

Manual fields, revision, author, time and acceptance remain manual. Generated-only
covers have null by/at_ms; no actor or message is invented. No cover acts are
written. Projection reads the same SQLite snapshot as the underlying records;
command refusal, rollback and retry keep the original operation semantics.

State precedence: actual release Live, non-release Done, current configured stage
and rounds (including release stages after combine), then actual placement with
set-aside disposition when recorded. Undo of set-aside does not restart work.
A stage called Live/Deploy is a stage, never evidence of shipping.

Core filters destination workspace access before projecting titles, states or IDs.
Source access alone grants none. Projection follows reader-visible indexed reply
and current join edges for requested roots and reverse source indexes; it does
not reconstruct global pipeline facts or scan every pipeline for each card.
Schema 48 adds two source lookup indexes and a normalized, indexed release-item
relation, backfilled from actual release records and populated by an INSERT
trigger in the same transaction as each record. Step-down drops only these
reconstructible derived indexes/relations; it loses no source or release facts.
There is no scan of all releases on a card read.

Source-topic cover invalidations carry no destination identity or content and
refresh only loaded positions. Read snapshots fence late generated rows.

Source-only handoff: actual feel preview remains required, at 1280×800 and
320×844, 375×844, 390×844, light/dark. Show two items in Build/Review together with
Cabin is booked, Cabin decision, Choose the cabin and Keep the current booking;
then each lifecycle/privacy/join state. No browser or geometry proof in this seat.
