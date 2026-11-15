# The two rails of a topic and a Conversation

A topic page and an outcome's Conversation have a rail on each side. On the
left is an outline of every outcome. On the right are the outcome's things.
Moving between topics and Conversations does not load the page again: the
outline stays where it was, and only the middle and the right rail change.
Every other page (the Outcomes home, an outcome's own page, its pipeline,
Health) keeps the side rail it had. The Outcomes home lists the outcomes with no
heading of its own above them; a press on one, or Return on its row, opens its
Conversation, and one with no Conversation yet opens its page (`outcome_rail_native.mjs`,
"rail on the Outcomes home a press on an outcome opens its Conversation …").

The code: `web/in-place-navigation.mjs` (the shell that keeps the rails across
moves), `web/outline-rail.mjs` (left), `web/things-rail.mjs` (right),
`web/rails.mjs` (wires the two into the shell) and `web/rails.css`. The page
itself, `web/app.mjs`, changed in only a few ways. It begins a run of the
shell as it starts, and tells the shell when it is up or that it could not
start. Its guard hands a confirmed move to the shell, and loads the page as
before when the shell declines. It renames its own address through the shell.

## The outline

Each outcome has one row: its light, its name and the line that says where
it stands, and the whole row is one thing to press, which opens the
outcome's Conversation with its topics under it. When Core says the outcome
has no Conversation, it opens the outcome's page instead. There is no fold
triangle: the name has the rail's width. Under an open outcome are its
topics. They look as they do today:
unread counts, the work ring, Waiting on you and Ready for review, bold titles
while something in them is unread, and Done (N) and Archived (N) below.
Each outcome ends with + New topic.

- **Counts.** A folded outcome counts everything new inside it, and what was
  sent to the reader by name. An open outcome counts only its Conversation,
  because each topic under it shows its own count. Both counts come from the
  `workspaces` and `conversation` views and change as the live feed
  announces each commit.
- **Chips.** "N new" and "N waiting on you" at the top add up every outcome
  listed. Pressing one shows only the outcomes, and in them only the topics,
  that hold what it counts. Pressing it again shows everything.
- **Open and folded.** The outline tidies itself. Outcomes are folded, with
  their counts and Waiting on you rolled up into their rows, but for the one
  being read, whose topics show. Arriving anywhere, by a press on a row,
  Return, a topic, a link, back or forward, or the phone's drawer, opens the
  outcome of the place reached and folds every other. The keys can open
  another outcome for a look, fold the one being read, or open or fold every
  one (⌘→ ⌘←, → ←, ⇧⌘→ ⇧⌘←; docs/interaction.md, "Keys across the panes");
  the next place reached tidies those away. While a chip shows only what is
  new or waiting, every outcome it shows is open. Nothing about folds is
  kept on the browser. Whether an outcome is open is on its row for a screen
  reader (`aria-expanded`), and on screen in its topics under it.
- **Order.** Outcomes keep the order the `workspaces` view gives them, and
  topics the order their lists give, until the reader places them with ⌘↑
  and ⌘↓: then their own order, which Core keeps for them on every device
  (docs/outline-order.md). A new message changes counts and lights, never the
  order. There is no "Not in an outcome" group.
- **Keys.** The outline is one tree with one Tab stop: ↑ and ↓ move through
  its rows, Return opens one, → and ← take the tree's steps and then move to
  the messages (→ on an open outcome goes straight there, as on a topic), and
  ⌘Return starts a new message in the row's topic or the outcome's
  Conversation. A "Keys" line under the outline lists them in plain words.
  The row the keys reach comes into view by the one rule for what the keys
  select (docs/interaction.md, "What the keys select comes into view"), in the
  rail's own scrolling, never the page's under it.
- **The outcome being read** always has its row. Before the outline's list has
  reached it, a provisional row with the page's title for it stands in its
  place. Its topic list is the page's own (`TopicRail`). Once that list has
  loaded and the outline has drawn the outcomes above it, the list moves into
  the outline under its outcome, so nothing above it pushes it down as it is
  pressed, and its guard, its paging and its live updates are the page's own.

The outline lists no Notebook (item 464): under the outcome being read come
its topics and New topic, and then the next outcome, for the pointer and the
keys alike. The outcome's Notebook pages are in the right rail's Notebook
section, which has its own pencil, and on the outcome's own page.

On a phone the outline is a drawer behind "☰ Outcomes", which carries the
total count and the light. A line under the header says what is new in other
outcomes and what waits there, and tapping it opens the drawer.

## The right rail

The right rail has folding sections: Starred, Pipeline, Waiting for…,
Notebook pages, Previews, Pull requests, Images, and Skills and tools. On a Conversation they
hold the outcome's things. On a topic they hold the topic's, and the chip
"All of this outcome" switches to the outcome's. A section with nothing in it
says so in one quiet line.

- **Starred** is the reader's own stars, shown to no one else: this topic's
  (on a Conversation, this outcome's) first, then the rest under Elsewhere.
  A press lands on the message, opening its stack; Unstar beside each takes
  the star off (docs/reply-stacks.md).
- **Pipeline** is what is live, and what is in Now (with its stage) and Next,
  from the `pipeline` view.
- **Waiting for…** is the Now and Next items the reader raised, at their
  stage, and the reader's Conversation posts nobody has taken up yet.
- **Notebook pages** come from `memory_items`: the topic's own pages on a
  topic, the outcome's otherwise, each with its light. Its heading carries the
  pencil that starts a new page in the Notebook it lists, the topic's or the
  outcome's, for someone Core lets write it (docs/notebook-pages.md), so it
  shows with No pages yet when that Notebook has none. It lists 20 pages, its
  count saying "20+" while there are more, and More pages brings 20 more.
- **Previews and pull requests** are links people posted in messages: a
  build on the tailnet or this machine, or an address that names a preview or
  a mockup, and GitHub pull requests. On a whole outcome they come from its
  Conversation and its six most recently active topics, the newest 50
  messages of each. Core records no pull request's state, so the section says
  so and does not guess.
- **Images** come from `topic_images`.
- **Skills and tools** are not recorded by Core yet, and the section says so.

Folds are kept per section on this browser. A section takes its kept fold as
it appears, and stays as the person leaves it after that. The rail reads only while it is
on screen, and reads a place's messages and images again only when that topic
has moved on (its version): for the open topic, when the page has read it
again; elsewhere, by the version the outcome's topic list gives. A topic the
page can no longer read is not read here either, and what the rail showed and
kept of it goes as the page hides the topic's messages. It shows beside the page at 1181px and wider, as a panel from the
right between 761px and 1180px, and as a sheet from the bottom on a phone.
Below 1181px it opens from "Pipeline & pages" in the header, and Escape or a
tap on the dimmed page closes it. While it is open the page and the outline
under it take no keys, focus or presses, as under the outline's drawer. Its
arrows open and fold as the outline's do, without ⌘: → opens a folded
section or goes to its first row, ← folds an open one or goes from a row to
its section, and ← on a folded section goes back to the messages, closing
the rail first where it is open over the page.

## Moving in place

Each page is one run of `app.mjs`, which keeps its state in its module. A move
between two feed pages (topics and Conversations) goes like this:

1. The page's guard (`TopicNavigation.openTarget`) decides first, as it does
   for a load. Unsent writing that cannot be kept stops the move. A send under
   way stops it with the same words as before.
2. The address changes with `pushState`. Each entry the page makes carries
   its place in the page's history (`aimPlace`).
3. The old run ends as an unload ends a page. Its `pagehide` listeners run,
   which stop its live feed, its saves and its recovery locks. Then every
   listener it added is removed. The shell keeps that record by wrapping
   `addEventListener`. Listeners on what the shell keeps are not the run's,
   except on the page's topic list, which the outline only holds for it.
4. The body's parts go back to how `index.html` drew them. The outline, the
   right rail and the drawer's backdrop stay as the same elements. The rail
   that holds the outline is never taken out of the page, so it keeps its
   scroll and its focus. The retired run keeps finding its own elements by
   id, so work it still had under way lands there and never on the new page.
5. A fresh run of `app.mjs` (`app.mjs?place=N`) reads and draws the new place
   as a full load would: its live feed, its read tracking and its New line are
   a new page's.

Where the focus goes follows how the move began. Return on a row of the
outline or the right rail keeps the keys in that rail, on the row drawn for
the place reached. Any other move (a press or a tap on a row, a link in the
page, back or forward) lands as a load does: as the move begins, the rail
lets go of the focus, and once the run is up it is on the page's heading
(`#main h1`, focused with no ring), unless the page has put it somewhere
itself, such as the Reader on a message's link. Otherwise the row pressed
would keep the focus, and the next key, even one that scrolls, would ring
it. The shell tells the two apart by the last thing the person did, a press
or a key, and by whether the focus was in a rail. A press on a row whose
move goes nowhere, the place already being read or a move the guard refuses,
lands on the heading too (`shell.stayed`). ⌘Return on another place's row
moves to it as Return does, and once its run is up opens its New message box
(`shell.write`).

### What a move ends, and what it leaves

A run is `app.mjs` alone. Every other module is loaded once for the whole
visit, before the first run begins, and keeps its own state across every run,
which is why a visit stays on one build (below).
Two rules follow, so nothing a module remembers disagrees with what a move
ends.

- **A listener for the whole page is added as its module loads.** The shell
  ends only what was added once a run began. A module that keeps one listener
  for the page (the guard on picture buttons in `image-rows.mjs`, the tap that
  puts away "You replied at…" in `card-reading.mjs`, the reader of a phone's
  keyboard in `compose-bar.mjs`) adds it at load, never
  later behind its own note that it has, since a move would take the listener
  and leave the note. A native check compares the window's and the document's
  listeners after moves with a fresh load of the same place, after the same
  acts.
- **What a module keeps across runs is an answer, let go when the page says
  it is gone.** Thumbnails (`image-pick.mjs`) keep a picture only once it was
  read whole, never a read that brought nothing, whether it failed or a move
  cancelled it. A picture is let go as soon as none of its images is in the
  page, as the page says (`isConnected`, heard through a `MutationObserver`
  while any picture is kept), however its rows went. Each image reads its own
  bytes, through the run that drew it.

Back and forward to an entry the page made also go through the guard. If the
guard refuses, the page goes back to the entry it was on, by as many entries
as the person moved, and says why where the person is looking: in the rail,
and also in the Reader or the New message sheet when one is open over the
page. An entry from before this page, or a page that is not a
feed, loads as it did before. Reload and copied links work because the
address is always the real one.

A move can come while the run before it is still on its way: a quick second
back, a back pressed before the page has drawn, a place chosen in the outline
or a link pressed meanwhile. None of these loads the page. The newest one
waits for the run, and the run takes it up, through its guard, as soon as it
is up. If the run has started on the place the address names by then (a back
and then a forward), there is nothing more to do. If the run cannot start, what
waited loads as it would with no feed page up. While a run starts, it renames
its own address only if a back or forward has not moved it on (`shell.rename`).

Every load the page decides goes through `shell.leave`: a page that is not a
feed, a place chosen with no feed page up, an entry from before this page, a
new topic or outcome opened after its write commits. From the moment it asks
for the load, the page starts no read (`web/api.mjs` `depart`): a read asked
for then waits, unsent, and one the browser cancels as the load begins tells
no one and doubts nothing. The page it loads reads afresh. Safari's engine
begins a load a moment after the page asks for it and cancels what the page
started in that moment; the commit of the page's own write lands just then,
and the reads it started could lose the load itself, leaving the old page up
at its old address. A native check records every read and feed the page
starts and asserts that none begins once it has asked for the new outcome's
page, while a page that stays still reads a commit made elsewhere.

A load the page asked for can still be stopped, and then the page must read
and send as before. While one of the run's guards on leaving holds
(`shell.guard`: writing not yet safe, a reply on its way), the browser asks
the person before the page goes and the person may stay, so the page does
not hold its reads at all. Otherwise it holds them until it goes or is seen
to stay (`stay`): a back or forward it hears, or a fresh key or press of the
person's (who stopped the load). What waited is sent then. Two native
checks stay from such a load and stop one, and send a reply afterwards.

Each run owns what the rails draw for it. As a run begins, the rails forget
the place before: the outline knows no outcome as the one being read until
the run is up, and the right rail empties its sections and names only the
kind of place. Each run reads through its own handles. A read it asked for
that is still waiting for its turn when a newer run is up is never sent
(`Superseded`), and whatever it did read lands only while its run is still the
page. Which outcome is being read, which topic is open, and whose topic list
sits under which outcome are found again from the run that is up each time
the outline draws. The outline's own topic lists and an outcome's
Conversation are not any one place's, so they read through whichever run is
up when their turn comes.

The rails read one read at a time (`oneAtATime`), so they never crowd the
page's own reads out of the server's admission lanes. The outline reads in
the foreground lane. The right rail reads in the background lane.

### One build per document

A fresh run of `app.mjs` finds every other module already loaded, from the
build the document was opened on. After a deploy, a run of the new release's
`app.mjs` would call the old release's modules: the next release's Edit
called `start()` on release 76's `MessageEditWriting`, which had none
("writing.start is not a function"). So every module a document loads is of one build, and a
move to another build is a load.

- The server reads `web/` once as it starts and names what it serves with a
  stamp, a hash of those bytes (`aim_next/web_build.py`). A deploy restarts the
  server, so a new release is a new stamp. `GET /api/build` says it, without a
  session.
- Every module is served under its build, `/b/<stamp>/<name>`. `index.html`
  names its entry that way, so each relative import, the run's
  `./app.mjs?place=N` included, carries the build. An import map before the
  entry sends an absolute address (`/api.mjs`, as a check imports it) to the
  same build. The page's Content-Security-Policy allows that one inline script
  by its hash.
- An address under another build is refused (404), and so is a module asked
  for with a query outside a build: the run of a page opened before builds
  were stamped. A module asked for plainly outside a build is still the file
  as it stands, for a document that is not a page.
- Before a move, the shell reads the served build. Meanwhile the phone's
  drawer closes and the page is not ready (`data-ready`), since a back has
  already changed the address. On the document's own build the move goes in
  place. If the read fails, the move goes on, and the refusal
  above is what stops a run of another build. On another build the place is
  loaded (`shell.leave`), so the new release's modules load together. While a
  guard holds (writing not yet safe), the page stays instead. It says
  "Theseus updated." with Reload, by the topic line and in the Reader or New
  message sheet when one is open, and puts back a back or forward that found
  the new build. Reload goes through the browser's own ask while the guard
  holds, and the words are kept as a load keeps them.

Native checks open a page on release 76 (`bb3a46da`), serve this build, move
once, and Edit; they move on one build and on another at 320, 375 and 390 by
touch and on a laptop; and they hold writing and press Reload.

## Known gaps

- Core records no pull request's state, and no skills or tools.
- The old sections the outline stands for (the outcomes list, the
  Conversation and Pipeline rows) are still read by the page, hidden, since
  other parts of the page follow them.
- Waits in outcomes the reader cannot list are not in the outline's totals.
- ⌘→ opens another outcome's topics only from the keys; there is no
  pointer's way to look without going there.
- A browser never unloads a module it has loaded, so each run's `app.mjs`,
  with what it held at the top level, stays in memory until the page loads
  again.
