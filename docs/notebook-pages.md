# Notebook pages and what changed since you read them

An outcome's Notebook pages sit beside its topics. A page someone has read
and that has been revised since is marked changed for them, the way a topic
with unread messages carries a count, until they open it again, and the
Reader then shows what changed since the revision they last read.

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
  revise, and an outcome's are its team's, the owner among them, people and
  agents alike. Each revision is kept with its author, so an edit never
  loses what was there; the Reader shows any revision and what changed.
  Anyone else, including someone on the team who does not take part in the
  topic, is refused (`FORBIDDEN`) and nothing is written.
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
a topic row and in the same column, opening the page in the Reader. On a
phone the rows scroll sideways, as topics do. An empty outcome Notebook keeps its heading and creation pencil. A Notebook
the reader cannot list shows no section; a read that fails
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
the topics', with the same light. There is no Reader on this page: a page
opens in place below the list (`web/page-here.mjs`), with its title, its
revision, what changed since the person last read it, and its words, and
opening it reads it as the Reader does. One page shows at a time; one opened
while another is still opening replaces it, and Close gives the focus back
to its row. The list is read again with the topics after every commit.

## A page's link

Each page has a link, latest or at a revision, that opens it in the Reader on
its topic's page or in place on its outcome's page
([links.md](links.md#a-notebook-pages-link)); the Reader's ⋯ copies it.

## Checks

Core: `tests/test_memory_reads.py` and the 19→20 step in
`tests/test_migrations.py`. Page: `tests/ui_outcome_references.test.mjs`,
`ui_page_reads`, `ui_page_changes`, `ui_page_here`, `ui_reader_changes`,
`ui_topic_notebook_light` and the wiring cases in `ui_inline_wiring`. In the browser: the `notebook` mode of
`tests/reader_persistence_native.mjs` (`tests/notebook_pages_native.mjs`):
the light coming on live and going out on opening, in the sidebar and in
the topic's own Notebook, the changes in the Reader and none of them on the
page opened next, 390 wide in light and dark with contrast measured, the outcome
page, and a page's link opening the page as it stands and at a revision, in
the Reader and in place, from the address and from a message, with the
Reader's ⋯ copying both links.

## Start a page (296)

A pencil beside a Notebook heading opens a single title line in place. Return
creates an empty page in that exact outcome or topic using `memory.create`
with item revision zero, then opens Cards with the first card ready to write.
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
