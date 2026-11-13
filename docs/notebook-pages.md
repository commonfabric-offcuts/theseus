# Notebook pages and what changed since you read them

An outcome's Notebook pages sit beside its topics. A page someone has read
and that has been revised since is marked changed for them, the way a topic
with unread messages carries a count, until they open it again, and opening
it then shows what changed since the revision they last read.

## Core

Core keeps, for each person and each Notebook page, the last revision they
read (`memory_reads`, schema version 20). No row means they have not read
it. The revision only grows: reading an older revision, or the same one
again, leaves it where it is, so a late or repeated request never makes a
page look changed again.

- Command `memory.read`: target `{item_id}`, args `{revision}`, expected
  `{authority}` only. The revision must be an exact, existing revision of a
  page the reader can read (`FORBIDDEN` otherwise; a malformed one is
  `INVALID_ARGUMENT`). Result: `{item_id, previous_revision,
  read_revision, current_revision, changed}`. A read that moves the
  revision forward adds the change `memory_read` to the reader's own
  (`actor`) changes; one that moves nothing tells nobody. The CLI's
  `note read` sends it for the revision it prints
  ([agent-cli.md](agent-cli.md#notebook-pages)).
- Who writes: a topic's pages are its active participants' to create and
  revise, and its owner's (who started it) and its outcome's owner's, taking
  part in it or not; an outcome's are its team's, the owner among them,
  people and agents alike. Each revision is kept with its author, so an edit
  never loses what was there; the Reader shows any revision and what changed.
  Anyone else, including someone on the team who does not take part in the
  topic, is refused (`FORBIDDEN`) and nothing is written, as is everyone once
  the outcome is reached (`OUTCOME_REACHED`). The rule is one query in Core
  (`aim_next/memory.py`, `WRITERS`).
- Core answers the rule as `reader_may_write`, on `memory_items` (for the
  Notebook: whether the reader may start a page) and on a page from
  `memory_current` or `source` (whether they may revise it). It is true
  exactly when Core would take that write from them now, so a page shows its
  pencil, Edit page and its writing controls only to someone Core lets write,
  and never guesses.
- Writing a revision (`memory.create`, `memory.revise`) reads it for its
  writer, so a person's own edit never marks a page changed for them. The
  write is its own change; it adds no `memory_read` change.
- View `memory_current`: args `{item_id}`, a page as it stands, in the
  `source` view's shape, its `source_ref` naming the current revision; the
  same rule for who may read it (`FORBIDDEN` otherwise). A `source_ref`
  without a revision still reads nothing, so a page is read at its latest
  only when that is asked for by name.
- View `memory_items`: each item carries `read_revision`, the viewer's own,
  `0` when they have not read it. A page is changed for the viewer when
  `0 < read_revision < revision`. A page never read is not marked: the light
  is for what changed under someone, not for everything they have not read.

## The sidebar

On a topic's page the sidebar lists the outcome's Notebook pages under the
heading Outcome Notebook, below its topics (named for the outcome, so it is
not taken for the topic's own Notebook in the page beside it): one row per page, by title, as tall as
a topic row and in the same column, opening the page in the composer over the
feed ([decks.md](decks.md#where-it-opens)). On a
phone the rows scroll sideways, as topics do. An empty outcome Notebook keeps its heading and, for someone who may write it, its creation pencil. A Notebook
the reader cannot list shows no section; a read that fails
says so above the rows and keeps what was shown. The list is read again
after every commit the live feed names, as the topics are.

## The changed light

A page the reader read before and that was revised since wears the number
of its new revisions in the sidebar, in the same badge a topic's unread
count wears, and screen readers hear ", changed since you read it, N new
revisions". A page never read, or read as it stands, wears nothing.

Showing a page, in the composer over the feed or in the Reader, reads it once
the person can see it, as a message counts as read only then: the page sends
`memory.read` with the exact revision shown while the tab is visible and
focused. One shown in the background, such as a Reader restored on load, is
read when the tab comes forward, if it still shows; a page that cannot be
shown is not read. A revision that reaches a page while it shows in the
composer (a commit elsewhere, taken in as the page is read again) is read
the same way, so watching an agent revise a page leaves no light on it; the
person's own revisions are read already, and send nothing. The commit
reaches every open page through the live feed, whose next reload draws the
row without its light; a page without the feed reloads after the read is
recorded. A read Core did not record is said where the page shows, and the
page keeps its light until it is opened again.

## A topic's own Notebook

A topic's own Notebook, in the topic beside its messages, wears the same
light on each page's card, with the same words for screen readers. A
revision reaches the card through the topic's own changes. A read is the
reader's own change, not the topic's, so after every commit the live feed
names the page reads the reader's read state of the loaded pages again
(`memory_items` from the start of the Notebook through the last page
loaded, never past it); a page read here or on another device loses its
light. An answer older than the one shown, at the same revision, never
relights a page read since. As with the person's marks, a topic they can
no longer read is not read again, so its refusal never fills the page's
status at each commit, and while the runtime has changed the read waits,
owed, until the saved writing is reviewed.

## What changed

When the read answers a `previous_revision` older than the revision shown,
the page reads that revision (`source` with its exact `revision`) and shows,
above the page, "What changed since you read revision N", in the composer
above the cards (`web/notebook-sheet.mjs`) and in the Reader above the page's
words: the page's
words with what was added marked and what was removed struck through
(screen readers hear "[added: …]" and "[removed: …]"), and a count of
additions and removals. Long unchanged stretches keep about a line of
context on each side of a change, with a gap for the rest, so the changes
read in place; the whole page as it now stands is below. The panel is a
disclosure, open at first; in the Reader it scrolls on its own so a phone
keeps room for the page, and in the composer it scrolls with the cards, whose
bar stays at the top. The page remembers what each revision it showed was
compared with, so showing that revision again, once Core has it read, shows
the same changes, as long as it is still the latest revision the person has
read; once they have read a later one, here or elsewhere, it shows none. A
page shown next carries none of them.

`web/page-changes.mjs` compares lines, then the words of the lines that
changed, each by a shortest edit script. Past what both sides share at the
start and the end, a change that only adds or only removes is written out
whatever its length, since that is linear work. Otherwise a script longer
than 2,000 edits is not worked out: a stretch of changed lines among lines that stand is shown
removed and added whole, and a page whose lines differ that much, or whose
every line is one such stretch, says only "This page changed in too many
places since then to mark them here", which holds however much of it
changed, above the whole page as it now stands. A revision
that changed only the title or attachments says so. A Reader that has moved
to another source by the time the earlier revision arrives is left alone.

## On the outcome's own page

An outcome's page lists its topics in the page itself rather than the
sidebar, so its Notebook pages are listed right after them, as cards like
the topics', with the same light. A row opens its page in the composer over
this page, as anywhere ([decks.md](decks.md#where-it-opens)), and ✕ gives the
focus back to the row. A link to a page at a revision opens it in place below
the list (`web/page-here.mjs`), with its title, its revision (named a draft
while the revision is one), what changed since the person last read it, and
its words, and, to someone who may write the page, Edit page; opening it reads
it as the Reader does. One page shows at a time; one opened while another is still
opening replaces it, and Close gives the focus back to its row. The list is
read again with the topics after every commit.

## A page's link

Each page has a link, latest or at a revision
([links.md](links.md#a-notebook-pages-link)). The latest opens the page in the
composer over its topic's page or its outcome's; one at a revision opens it in
the Reader on its topic's page or in place on its outcome's page, and the
Reader's ⋯ copies both and offers, to someone who may write the page, Edit page, which opens it as it stands in
the composer.

## Checks

Core: `tests/test_memory_reads.py` and the 19→20 step in
`tests/test_migrations.py`. Page: `tests/ui_outcome_references.test.mjs`,
`ui_page_reads`, `ui_page_changes`, `ui_page_here`, `ui_reader_changes`,
`ui_topic_notebook_light` and the wiring cases in `ui_inline_wiring`. In the browser: the `notebook` mode of
`tests/reader_persistence_native.mjs` (`tests/notebook_pages_native.mjs`):
the light coming on live and going out on opening, in the sidebar and in
the topic's own Notebook, the changes in the composer and none of them on the
page opened next, 390 wide in light and dark with contrast measured, the outcome
page, and a page's link opening the page as it stands in the composer and at a
revision in the Reader and in place, from the address and from a message, with
the Reader's ⋯ copying both links and editing the page. The composer itself:
`tests/notebook_sheet_native.mjs` ([decks.md](decks.md#where-it-opens)).

Who writes and a draft page: `tests/test_memory_write_rule.py`,
`tests/test_memory_drafts.py`, `tests/test_memory_team_edit.py` and the 37→38
step in `tests/test_migrations.py`; on the page, `ui_notebook_writing` (the mark
saved and merged, a reader who may not write writing nothing, and each read
of the page, Discard my writing among them, saying whether they may),
`ui_outcome_references` (the pencil) and `ui_topic_navigation` (the listing's
mark); in Chrome and WebKit, laptop and phone, the cases "the pencil and writing
show only to someone Core lets write", "a writer marks a page a draft" and "a
draft page in a reached outcome reads as a draft" (the Draft mark without its
toggle, To read, an image without Remove, and in place no Edit page) in
`tests/notebook_pages_native.mjs`; and the composer's head standing clear at
every width from 320 to 1024 in `tests/notebook_sheet_native.mjs`.

## A draft page

A person who writes a page can mark it a draft, while it is not ready for
agents to act on (item 391). The mark is a revision of its own, written by
`memory.create` or `memory.revise` with `draft: true`, and cleared by another
with `draft: false`; a revision that leaves `draft` out keeps the mark as it
was. Each revision records whether it was marked (`memory_revisions.draft`,
schema version 39), and the page is a draft while its latest revision is.

While a page is a draft, Core gives an agent its title and that it is a
draft, never its words: `memory_items` lists it with `draft: true`,
`withheld: true` and an empty body, and `memory_current` and `source`, at any
revision of it (a link to the page is read this way), give it with an empty
body and no attachments or references. Its words are no quote's source for
an agent (`INVALID_QUOTE`), and its attachments do not open for one through
it (`FORBIDDEN`). Only a person sets or clears the mark, and no agent revises
a draft page (`FORBIDDEN`; `reader_may_write` is false for an agent there).
People read and write it as ever: its revisions, Undo and what changed since
are unchanged. Clearing the mark gives agents the words again, every
revision of them.

On the page the mark is the word Draft beside Text and Cards, in the
composer's head and on the full page: a toggle (its state `aria-pressed`) for
someone who may write the page, dashed while the page is a draft, and for
someone who reads it a dashed Draft that shows only while it is one. Its
tooltip says agents do not read the page until the mark is cleared. Marking
or clearing it is an act the cards' Undo takes back; in the Text view the
toggle itself does. A draft page's cards offer no speech bubble to ask an
agent about them; a reply stack a card already has still opens. Wherever the
page is listed, its title wears a small dashed "draft", and the Reader, and
the page opened in place on its outcome's page, name its revision
`Notebook · revision N · draft`.

## Start a page (296)

A pencil beside a Notebook heading opens a single title line in place: the
outcome's beside Outcome Notebook in the outline, a topic's beside the
Notebook section of the right rail, which then shows for the topic even before
it has a page (its one line says No pages yet) and opens if it was folded. The
rail shows the topic's pencil only while it lists that topic's own pages, not
the whole outcome's. Either pencil shows only to someone Core lets write that
Notebook (its `reader_may_write`): a teammate who reads a topic without taking
part in it has none, and a topic's owner who has stepped out of it keeps
theirs. Return
creates an empty page in that exact outcome or topic using `memory.create`
with item revision zero, then opens it in the composer over the page, in Cards
with the first card ready to write.
Escape or a press outside closes the line. The author, owner scope and item
identity come from the bound page; there is no implicit fallback to another
Notebook. The outcome heading remains visible when its Notebook is empty.

An uncertain create retains its exact operation and item identity for Return
to retry, including its original title. Changing that title first does not
start a second page. A confirmed refusal keeps the typed title and permits a
new attempt. The title cannot change during an in-flight create. Closing the
line retains its pending request for reopening on this page; this control is
not an autosaved draft across a browser reload.

`?cards=ID&write=new` requests the initial blank card editor only when that
page's body is still empty. Existing Cards links and nonempty pages keep their
normal behavior. This creates a Notebook page; it adds no Cards mode to message
drafts. The shared Notebook Text/Cards editor is the separate item 302.
