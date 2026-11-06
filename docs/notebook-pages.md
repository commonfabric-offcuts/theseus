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
heading Notebook, below its topics: one row per page, by title, as tall as
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

Showing a page in the Reader reads it: the page sends `memory.read` with the
exact revision shown (a page the Reader cannot show is not read). The commit
reaches every open page through the live feed, whose next reload draws the
row without its light; a page without the feed reloads after the read is
recorded. A read Core did not record is said in the Reader, and the page
keeps its light until it is opened again.

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
keeps room for the page.

`web/page-changes.mjs` compares lines, then the words of the lines that
changed, each by a shortest edit script. A script longer than 2,000 edits is
not worked out: a stretch of lines is shown removed and added whole, and a
page whose lines differ that much says it was mostly rewritten. A revision
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
