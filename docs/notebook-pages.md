# Notebook pages and what changed since you read them

An outcome's Notebook pages sit beside its topics. A page someone has read
and that has been revised since is marked changed for them, the way a topic
with unread messages carries a count, until they open it again, and the
Reader then shows what changed since the revision they last read.

## Core

Core keeps, for each person and each Notebook page, the last revision they
read (`memory_reads`, schema version 18). No row means they have not read
it. The revision only grows: reading an older revision, or the same one
again, leaves it where it is, so a late or repeated request never makes a
page look changed again.

- Command `memory.read`: target `{item_id}`, args `{revision}`, expected
  `{authority}` only. The revision must be an exact, existing revision of a
  page the reader can read (`FORBIDDEN` otherwise; a malformed one is
  `INVALID_ARGUMENT`). Result: `{item_id, previous_revision,
  read_revision, current_revision, changed}`. A read that moves the
  revision forward adds the change `memory_read` to the reader's own
  (`actor`) changes; one that moves nothing tells nobody.
- Writing a revision (`memory.create`, `memory.revise`) reads it for its
  writer, so a person's own edit never marks a page changed for them. The
  write is its own change; it adds no `memory_read` change.
- View `memory_items`: each item carries `read_revision`, the viewer's own,
  `0` when they have not read it. A page is changed for the viewer when
  `0 < read_revision < revision`. A page never read is not marked: the light
  is for what changed under someone, not for everything they have not read.

## The sidebar

On a topic's page the sidebar lists the outcome's Notebook pages under the
heading Outcome Notebook, below its topics (named for the outcome, so it is
not taken for the topic's own Notebook in the page beside it): one row per page, by title, as tall as
a topic row and in the same column, opening the page in the Reader. On a
phone the rows scroll sideways, as topics do. An outcome with no pages, or
one the reader cannot list, shows no Notebook section; a read that fails
says so above the rows and keeps what was shown. The list is read again
after every commit the live feed names, as the topics are.

## The changed light

A page the reader read before and that was revised since wears the number
of its new revisions in the sidebar, in the same badge a topic's unread
count wears, and screen readers hear ", changed since you read it, N new
revisions". A page never read, or read as it stands, wears nothing.

Showing a page in the Reader reads it once the person can see it, as a
message counts as read only then: the page sends `memory.read` with the
exact revision shown while the tab is visible and focused. One shown in the
background, such as a Reader restored on load, is read when the tab comes
forward, if the Reader still shows it; a page the Reader cannot show is not
read. The commit
reaches every open page through the live feed, whose next reload draws the
row without its light; a page without the feed reloads after the read is
recorded. A read Core did not record is said in the Reader, and the page
keeps its light until it is opened again.

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

## What changed, in the Reader

When the read answers a `previous_revision` older than the revision shown,
the Reader reads that revision (`source` with its exact `revision`) and
shows, above the page, "What changed since you read revision N": the page's
words with what was added marked and what was removed struck through
(screen readers hear "[added: …]" and "[removed: …]"), and a count of
additions and removals. Long unchanged stretches keep about a line of
context on each side of a change, with a gap for the rest, so the changes
read in place; the whole page as it now stands is below, to read and quote.
The panel is a disclosure, open at first, and scrolls on its own so a phone
keeps room for the page. The page remembers what each revision it showed was
compared with, so showing that revision again, once Core has it read, shows
the same changes; a page shown next carries none of them.

`web/page-changes.mjs` compares lines, then the words of the lines that
changed, each by a shortest edit script. A script longer than 2,000 edits is
not worked out: a stretch of changed lines among lines that stand is shown
removed and added whole, and a page whose lines differ that much, or whose
every line is one such stretch, says only "This page changed in too many
places since then to mark them here", which holds however much of it
changed, above the whole page as it now stands. A revision
that changed only the title or attachments says so. A Reader that has moved
to another source by the time the earlier revision arrives is left alone.

## On the outcome's own page

An outcome's page lists its topics in the page itself rather than the
sidebar, so its Notebook pages are listed right after them, as cards like
the topics', with the same light. There is no Reader on this page: a page
opens in place below the list (`web/page-here.mjs`), with its title, its
revision, what changed since the person last read it, and its words, and
opening it reads it as the Reader does. One page shows at a time; one opened
while another is still opening replaces it, and Close gives the focus back
to its row. The list is read again with the topics after every commit.

## Checks

Core: `tests/test_memory_reads.py` and the 17→18 step in
`tests/test_migrations.py`. Page: `tests/ui_outcome_references.test.mjs`,
`ui_page_reads`, `ui_page_changes`, `ui_page_here`, `ui_reader_changes`,
`ui_topic_notebook_light` and the wiring cases in `ui_inline_wiring`. In the browser: the `notebook` mode of
`tests/reader_persistence_native.mjs` (`tests/notebook_pages_native.mjs`):
the light coming on live and going out on opening, in the sidebar and in
the topic's own Notebook, the changes in the Reader and none of them on the
page opened next, 390 wide in light and dark with contrast measured, and the outcome
page.
