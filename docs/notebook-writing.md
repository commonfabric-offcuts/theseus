# One Notebook page, Text and Cards (302)

Text and Cards are two views of the same Notebook body, in one writing place.
Changing the view writes no revision and does not convert or normalize the
words. Existing Cards links still open Cards. The page's writing controls
offer both views; a new page starts ready to write.

The writing place stands in two places with the same writing and saving: the
composer over the feed, where a page opens from the outline, the topic's
Notebook, the right rail, the outcome's page, a link or Edit page (item 396,
[decks.md](decks.md#where-it-opens)), and the full page at `?cards=ITEM`. The
composer's close keeps the page and its unfinished writing for its next
opening; a page closed there goes on saving what is not yet confirmed but is
not read again until it opens.

Both views save while writing, including an unfinished card. Each confirmed
save is a normal `memory.revise` revision, immediately readable by agents.
The saving sign distinguishes a device copy, an in-flight save, a confirmed
revision, and writing that needs attention. The existing writing keys,
including Option-arrow line moves, remain available. Images and `#img` use
the page's topic (or its outcome's Conversation) and become page attachments.
There is no Cards view of a message draft.

A reload with a pending choice draws the retained writing in both views before
accepting input; an edit without that displayed snapshot is refused. Card
gestures replay their acts on the latest deck, retaining card identity. Remote
card rewrites follow the card through moves and insertions, and a same-card
conflict still keeps both versions. Discard removes the paused-writing status.

An edit carries the revision and content its visible surface was computed
from. The writer applies it against that snapshot, not whichever revision
arrived most recently: a stale Cards edit merges disjoint card changes, while
overlapping Cards or Text edits keep both versions for a choice. Slow device
writes, redraws and revision-conflict reloads cannot remove this fence.
Changed/settled compares content fields, never object key order. Merging
preserves untouched card bytes and separators. A permission refusal pauses
writing only for the current opening; Try again rechecks access, Discard my
writing takes the saved page, and reload retries once with a fresh request.
An authority refusal requires reopening under the current instance binding.

Before sending, the browser retains the complete request and current writing
in a scoped device journal. A retry uses that exact request, including title,
attachments, references, expected revision, authority and operation identity.
A late confirmation advances the saved revision but cannot replace words
typed since. Reloading resumes an uncertain request before starting another.
One tab at a time owns this page's device journal; another tab may read it.
Separate devices use Core's existing revision comparison.

Cards merge changes to different cards while the current box stays open; the
person can keep writing while an agent changes another card. Changes to the
same card on both sides, or overlapping Text changes, retain both versions for
an explicit choice. Focusing an unchanged field never creates a conflict or
allows stale words to overwrite a newer revision. Choosing the saved version
ends card writing and its image picker cleanly.

A definite rejected save drops its request, whether Core recorded the refusal
or not, and retains the writing. Only an uncertain transport/receipt or a
retryable response retains the exact request. Permission and authority refusals
make writing read-only. Storage failure prevents claiming a device copy or
discarding in-memory writing. Confirmed pages have no recovery record. Pending
image bytes are immutable, stored once separately from the changing journal;
confirmation removes their local copy. A browser back-forward-cache return
reloads before writing resumes, reacquiring the journal's ownership.

No Core command, schema, actor or Notebook ownership rule changes. Revisions
remain immutable; the device journal only retains unconfirmed work.
