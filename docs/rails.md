# The two rails of a topic and a Conversation

A topic page and an outcome's Conversation have a rail on each side. On the
left is an outline of every outcome. On the right are the outcome's things.
Moving between topics, Conversations, outcomes and Outcomes home does not load
the page again: the outline stays the same element, and the page's main content
changes. Outcomes keep their visible side rail. Outcomes home keeps its current
full-main list and hidden rail, retaining that outline for the next move.
Pipeline and Health still load as before. The Outcomes home lists the outcomes with no
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

Each outcome has a row with a disclosure chevron, its light, its name and the
line that says where it stands (item 902). The chevron opens or folds its
topics in place, without navigation or reading the outcome page. Several
outcomes can stay open. The name opens the outcome's home. On a phone (item 654), a
tap on a collapsed outcome instead opens its topics in the drawer: the drawer,
its scroll, the current page and every other outcome's fold stay as they were.
A tap on an open outcome goes to its home, with its topics still open.
A topic tap goes straight to the topic. On a laptop a click still goes to the
outcome's home; Return does the same. The separate chevron only changes
expansion, on a phone as on a laptop. Under an open outcome are its
topics. They look as they do today:
unread counts, the work ring, Waiting on you and Ready for review, bold titles
while something in them is unread, and Done (N) and Archived (N) below. A
press on a topic's unread count opens it at its oldest unread message, here
and on the right rail's Build rows alike (item 613; docs/attention.md, "In the
browser").

- **Pencils.** A pencil means "new", the same glyph as New message and a new
  Notebook page (item 305). A quiet pencil beside an outcome's name starts a
  new topic there: a press opens the New topic title line under the row,
  folded or open, and Return starts the topic and opens it (docs/openings.md,
  "Client behavior"). The press opens and folds nothing, and the page stays.
  The pencil beside the Outcomes heading is New outcome: a press opens its
  title line under the heading. On a laptop a pencil shows while the pointer
  is on its row (or the heading) or the keys are on that row or on the pencil,
  and while its title line is open; on a phone's width, or wherever nothing
  hovers, every pencil shows. Each is 44px to press, named ("New topic in …",
  "New outcome"), with its tooltip. There is no + New topic row: the page's
  own New topic, pulled into the outline under the outcome being read, stays
  out of sight there, and stays on the outcome page and the pages with the
  side rail. Each title line has four states, at a phone's width as on a
  laptop: open and empty; refused, when Return finds no title ("Type the
  topic's title, then press Return."); busy, "Starting…" while its command is
  on its way, when a second Return sends nothing more; and refused by the
  server, in the server's words with the title kept as typed for Return
  again. In every one the line sits under its row or heading, clear of it
  and of its pencil, inside the rail or the open drawer, and Escape closes
  it and gives the pencil the keys.

An outcome's Build topics show once, in the right rail (item 297). On an
outcome whose pipeline is on, an agent-created topic some piece is built in
(a release's among them) is a Build topic, and the outline lists it not: it is a row of the
right rail's Pipeline section instead, from when the piece starts until the
topic is Done, when it folds into the outline's Done (N) as any topic does. An
archived one is under Archived (N). Reopened, it is the right rail's again.
Human-created topics stay in the ordinary sidebar even when a piece names
them; they leave its open list only through Archive or Done (item 837).
Core says which topics they are (`workspace_topics`, `build`;
docs/topic-list.md), so the outline asks for its topics without them and the
right rail for them alone. While the pipeline is off, or on an outcome with
none, no topic is a Build topic and the outline lists every topic as before.
The topic being read is a Build topic when Core says so, and is then marked in
the right rail, not the outline. Turning the pipeline on or off, or a topic's
first piece, moves that topic's version (docs/topic-list.md), so the page
reading it reads it again and it moves between the outline and the right rail
at once, never in neither and never in both. Done decides: a topic marked Done
while its piece is still under way is in the outline's Done (N), and not in the
right rail's Now. Pages that keep the side rail they had (the
outcome's own page, its pipeline) list every topic, since they have no right
rail.

- **Counts.** A folded outcome counts everything new inside it, and what was
  sent to the reader by name. An open outcome counts what has no row under
  it: its Conversation, and its Build topics, which the right rail lists in
  place of the outline. Each topic under it shows its own count. A screen
  reader hears where the count is ("in its Conversation and its Build
  topics"). The counts come from the `workspaces` view (its `build` part
  counts the open Build topics apart, docs/workspaces-query.md) and the
  `conversation` view, and change as the live feed announces each commit. A
  press on the outcome's row opens its Conversation, beside the right rail
  that lists those Build topics with their counts; on a phone and at middle
  widths "Pipeline & pages" carries their count to it.
- **Chips.** "N new" and "N waiting on you" at the top add up every outcome
  listed. Pressing one shows only the outcomes, and in them only the topics,
  that hold what it counts; what is new in an outcome's Build topics is on
  its row, as above. Pressing it again shows everything.
- **Open and folded.** Each outcome keeps its own open or folded state in
  localStorage on this device, scoped to the reader and instance. A new
  outcome starts folded except for the one being read. Arriving anywhere
  opens the current outcome without folding another; an explicit fold of
  the current outcome lasts until the next arrival. The existing keys open
  or fold one outcome or all known outcomes (⌘→ ⌘←, → ←, ⇧⌘→ ⇧⌘←;
  docs/interaction.md, "Keys across the panes"). Open-all records those
  outcomes individually, so a later new outcome still starts folded.
  New/Waiting filters temporarily open all outcomes they show and leave the
  kept choices intact. Each disclosure is an ordinary Tab-reachable button
  with `aria-expanded` and `aria-controls`; the name row also retains the
  tree's expanded state. If device storage is unavailable, choices hold for
  the current page. Cross-device dossier state is separate work (858).
- **Order.** Outcomes keep the order the `workspaces` view gives them, and
  topics their stable default position, newest topics first, until the reader places them with ⌘↑
  and ⌘↓: then their own order, which Core keeps for them on every device
  (docs/outline-order.md). A new message changes counts and lights, never the
  order. A topic new to the reader appears at the top once and stays there
  until the reader moves it. There is no "Not in an outcome" group.
- **Keys.** The outline's rows keep one roving Tab stop, with a separate Tab
  stop for each disclosure: ↑ and ↓ move through
  its rows, Return opens one, → and ← take the tree's steps and then move to
  the messages: → on a folded outcome opens it and shows its topics, the next
  lands on its pencil (ringed), and the next goes on into the messages; Return
  on the pencil opens the New topic line. ↑ from the first outcome lands on
  the Outcomes heading's pencil, where Return opens the New outcome line.
  ⌘Return starts a new message in the row's topic or the outcome's
  Conversation. A click or a tap on a row leaves the keys on it, wearing their ring (item 462), including a phone tap that
  only expands a collapsed outcome (item 654). A "Keys" line under the
  outline lists them in plain words.
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
its pencil and its topics, and then the next outcome, for the pointer and the
keys alike. The outcome's Notebook pages and their pencil are on the outcome's
own page.

On a phone the outline is a drawer behind "☰ Outcomes", which carries the
total count and the light. It opens on the row the keys or a tap chose last
there, ringed, while that is the person's last choice; after a move begun
elsewhere (back, forward, a link in the page, the right rail), or before any
choice, it opens on the place being read, with no ring.
In the header's row the outcome's name gives up
its room first, down to none, and its place then costs nothing beyond the one
gap between the pills, so "☰ Outcomes" and "Pipeline & pages" share the first
line whenever the two pills and one gap fit the row: at 375 and 390 in every
state, and at 320 with nothing new, with the light alone, with a count, or
with a count of two digits and nothing waiting. The name sits between them,
its words a gap from each pill. It is clipped only when its words are longer
than the room left there (about 37 to 102px at 375 and 390, less at 320); a
short name shows whole. Where the two pills and one gap do not fit, at 320
with the light and a count of one digit or two, "Pipeline & pages" goes
under, on the row's second line, whole and inside the screen. Nothing scrolls
sideways: at every width and in every state, no part of the page ends past
the screen's right edge. A line under the header says what is new in other
outcomes and what waits there, and tapping it opens the drawer.

The page's notices sit under the logo block at the top of the outline, as one
group (`index.html` `#page-notices`): the status line (a start that failed, an
act on a card not settled), the wakes', the updates' and why a move stayed.
At a laptop's width the rail keeps its scroll from page to page, so the group
is pinned at the top of the rail while any of them shows, on the page's own
paper; the notices stack one under the other there, and nothing scrolled under
them draws through. In the phone's drawer they stack at its top the same way
(`outcome_rail_native.mjs`, "rail the page's notices stack and never draw over
each other …", item 547). A reply whose send is not confirmed holds no move
(`docs/replies-in-doubt.md`; "rail a reply whose send is not confirmed holds no
move …").

### The rail's foot

The side rail ends with its foot (item 628): who you are on which instance,
the guide's "? Pointer, keys and taps" under it, and Health, below the rail's
last section (the outline on a topic and a Conversation, Skills and tools on a
page whose rail lists the outcome's sections), with the looks they had at its
top: one under the other on a laptop, and on a phone the name on its own line
with the guide's ? and Health side by side under it; the name and the guide's ? in
the quiet colour, Health in its own, lit in the alert colour while something
needs attention, and opening Health. The logo block, the wordmark with its
presence dot and Turn on notifications, stays at the top, and no section
moves. In the phone's drawer the foot ends the drawer; on a page with no rail
(the Outcomes home, an outcome's own page, Health) it ends the page. The keys
reach it last in the rail: Tab after the outline's Keys, and ↓ below Keys
(docs/interaction.md). `index.html` draws it last in the rail; the shell puts
the outline above it (`in-place-navigation.mjs`), and `placeBrand`
(`outcome-scope.mjs`) moves it to the end of the main column where the page
has no rail. Checks: `outcome_rail_native.mjs` (`native-rail`,
`native-webkit-rail`), "rail the rail's foot: who you are on which instance,
the guide's ? and Health sit below the side rail's last section …", at 320,
375, 390 and a laptop, light and dark, on a topic, a tool's page, an
outcome's page, the Outcomes home and a Notebook page's cards, where ↓ below
the last card goes on to the guide's ?; `health_native.mjs` (`native-health`,
`native-webkit-health`), "health lit at the foot of the side rail …".
Every page's run moves the foot to the end of the rail again, so a drawn page
never shows where the shell put the outline; what that placement holds is the
move in place itself, where the rail is put back in the order the shell first
gave it and the foot stays last throughout. That is checked by "rail the
outline keeps its scroll when it moves in place to a topic …", which watches
every state of the rail in the move.

### Starred dossiers under topics

The outline tucks the reader's starred dossier titles under each loaded topic,
with a star and the theme's distinct readable warning-text color. Equal names
keep their real dossier identities. The empty name uses the feed's first-message
preview. A title opens that dossier in its parent topic through the writing
guard; arrow Down visits these children and Left returns to their topic. Folded
or unloaded parents have no orphan titles. See [starred-outline.md](starred-outline.md)
for scoped paging, updates, access failures and the native checks (item 715).

## The right rail

The right rail starts with **Notebook**, **Pull requests**, and **Images**, then
shows **Waiting for…**, **Previews**, and **Skills and tools** when present.
**Pipeline** is last (item 788, revised in 12252). The right rail always shows
this topic's things, the Conversation included. The outcome's Notebook pages
and their pencil are on its page. The page resolves an old `?conversation=`
address and renames it to that Conversation's `?topic=` address before the Shell
hands the rail its route. There is no separate outcome scope in this rail.
If a non-topic route reaches the rail's ready step, including an address changed
during startup, the rail closes, hides and removes its opener through the same
cleanup used when beginning an outcome page. It starts no reads or subscription.
There is no Topic/Outcome switch, keyboard scope choice,
name row or Starred section; starred dossiers remain in the outline. The generic
arrow owner reaches the controls actually present, without a scope destination.
A section with nothing in it does not show, except a writable empty Notebook,
which keeps its pencil and says No pages yet. When none shows, one quiet line
says the place refers to nothing yet.

Notebook pages are no longer rendered at the bottom of the dossier feed. The
right rail lists them, and existing page links still open the shared Notebook
sheet. Initial bounded Notebook reads and admission checks remain: their cache
supports source reads and revision tracking, but memory updates do not repaint
the feed. The same current-topic pencil, permission check, paging, changed light,
creation receipt and retry identity remain owned by the existing Notebook code.

- **Pipeline** lists the outcome's Build topics, each once, with stages from
  the `pipeline` view: under
  Now each topic a piece is being built in, one row for it however many
  pieces it holds, its row its topic's (Core names these topics on every page,
  `building`, so however many Build topics there are, each carries its marks);
  then Ready for review, the Build topics that are, until someone marks them
  Done; then Other Build topics (a piece set aside, finished or held, a topic
  reopened). Each group is in the reader's own order of the outcome's topics
  where they have placed them with ⌘↑ and ⌘↓, as the outline is
  (docs/outline-order.md), and Core's otherwise (under Now, the pieces nearest
  to live first: docs/pipeline.md, "Now's order"). Each row
  carries what the outline's row would: the unread count, marked when part of
  it was sent to the reader by name, where it stands (Waiting on you, Ready
  for review…), the work ring, and the mark of the topic being read; one that
  waits on the reader opens at the question, as in the outline. The Build
  topics show on a topic as on its Conversation, since they stand in for the
  outline's rows. Live and Next remain on the outcome's pipeline page. Its
  heading names the current topic's stage, if any, and how many messages in
  all the Build topics are new to the reader ("Build · 3 new", from
  `workspace_topics`' `builds`), so a folded section still
  shows it. It lists 20 Build topics, and More topics brings 20 more; Return
  on More topics hands the keys to the first topic it brought. The keys reach
  each row like any other in the rail, and Return on one opens its topic in
  place with the keys staying on its row. Below 1181px, "Pipeline & pages"
  carries the same count.
- **Waiting for…** is the Now and Next items the reader raised in this
  topic, at their stage.
- **Notebook pages** come from `memory_items`: this topic's own pages, each
  with its light. Its heading carries the pencil that starts a new page in
  this topic's Notebook for someone Core lets write it (docs/notebook-pages.md), so it
  shows with No pages yet when that Notebook has none. It lists 20 pages, its
  count saying "20+" while there are more, and More pages brings 20 more.
- **Previews and pull requests** are links people posted in messages: a
  build on the tailnet or this machine, or an address that names a preview or
  a mockup, and GitHub pull requests. They come from the current topic's
  newest 50 messages. Core records no pull request's state, so the section says
  so and does not guess.
- **Images** come from `topic_images`. Clicking a displayed thumbnail opens
  its image in a new tab (item 651, docs/images.md). Return on the containing
  message link still opens that message in place.
- **Skills and tools** come from `topic_tools` (the tools linked to this
  topic), each opening its page; one linked to a topic whose record is gone
  is named, with no page ([skills-and-tools.md](skills-and-tools.md)).

Folds are kept per section on this browser. A section takes its kept fold as
it appears, and stays as the person leaves it after that. The rail reads only while it is
on screen, and reads a place's messages and images again only when that topic
has moved on (its version), when the page has read it again. A topic the
page can no longer read is not read here either, and what the rail showed and
kept of it goes as the page hides the topic's messages. It shows beside the page at 1181px and wider, as a panel from the
right between 761px and 1180px, and as a sheet from the bottom on a phone.
Below 1181px it opens from "Pipeline & pages" in the header, and Escape or a
tap on the dimmed page closes it. Beside it the outcome's name gives way
first; on a phone too narrow for both header buttons with their counts (320px,
with new messages in Build topics), "Pipeline & pages" goes to a line of its
own, inside the screen. At 320, 375 and 390px, with a count of one or two
digits on either, nothing in the header runs past the page's edge, in Chrome's
engine and Safari's. While it is open the page and the outline
under it take no keys, focus or presses, as under the outline's drawer. Its
arrows open and fold as the outline's do, without ⌘: → opens a folded
section or goes to its first row, ← folds an open one or goes from a row to
its section, and ← on a folded section goes back to the messages, closing
the rail first where it is open over the page.

## Moving in place

Each page is one run of `app.mjs`, which keeps its state in its module. A move
between topics, Conversations, outcomes and Outcomes home goes like this:

1. The page's guard (`TopicNavigation.openTarget`) decides first, as it does
   for a load. Unsent writing that cannot be kept stops the move. A send under
   way stops it with the same words as before. Where the move waits (it reads
   the served build first, below), the guard's last look is asked again just
   before it is made. The shell's existing registered writing guards also hold
   this move, including Notebook device writes on pages without an editor registry.
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
   scroll and its focus. The logo block above the outline and the rail's foot
   under it are put back as they read, the guide's ? included until the new
   run puts its own in its place, so the rail never grows shorter during the
   move: scrolled near its end, it would otherwise be pulled up to that end and
   carried past where it was.
   The retired run keeps finding its own elements by id, so work it still had
   under way lands there and never on the new page.
5. A fresh run of `app.mjs` (`app.mjs?place=N`) reads and draws the new place
   as a full load would: its live feed, its read tracking and its New line are
   a new page's.

Where the focus goes follows how the move began. Return on a row of the
outline or the right rail keeps the keys in that rail, on the row drawn for
the place reached. A click or a tap on a row of the outline does the same
(item 462): before the row's own act runs, the outline's tree selects the row
as the keys would (`web/key-tree.mjs`, `selectOnPress`), so the page opens
with the keys on the row, which wears their ring, and ↑ and ↓ go on from it
and → into the messages. A press on a control inside a row keeps that
control's own way, and what a row opens itself, such as a pencil's title
line or the Reader on a waiting question, has the focus as after Return on
the row. On a phone the drawer closes as the page moves and shows none of its
rows then, so a tap there lands as a load does; the drawer opens again on the
row tapped, ringed, until a move begun elsewhere (back, forward, a link in the
page) opens it on the place being read instead, with no ring (the shell tells
what it keeps where each move began, `leaving`). A row the outline or the
right rail draws again takes the focus back wearing the ring the row that
went wore: a press in the right rail rings nothing, nor once its section draws
again (an Unstar, say). Any other move (a press or a tap on a row of the right
rail, a link in the page, back or forward) lands as a load does: as the move
begins, the rail lets go of the focus, and once the run is up it is on the
page's heading (`#main h1`, focused with no ring), unless the page has put it
somewhere itself, such as the Reader on a message's link. Otherwise the row
pressed would keep the focus, and the next key, even one that scrolls, would
ring it. The shell tells these apart by the last thing the person did, a
press or a key, by where a press was, and by whether the focus was in a
rail. A press on a row whose move goes nowhere, the place already being read
or a move the guard refuses, keeps the keys on the row in the outline, and
lands on the heading from the right rail (`shell.stayed`). ⌘Return on another place's row
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
page. An entry from before this page, or a route outside these four kinds,
loads as it did before. Reload and copied links work because the
address is always the real one.

A move can come while the run before it is still on its way: a quick second
back, a back pressed before the page has drawn, a place chosen in the outline
or a link pressed meanwhile. None of these loads the page. The newest one
waits for the run, and the run takes it up, through its guard, as soon as it
is up. If the run has started on the place the address names by then (a back
and then a forward), there is nothing more to do. If the run cannot start, what
waited loads as it would with no feed page up. While a run starts, it renames
its own address only if a back or forward has not moved it on (`shell.rename`).

Every load the page decides goes through `shell.leave`: a route outside these
four kinds, a place chosen with no supported page up, an entry from before this page, a
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

Each rail sequences its reads (`oneAtATime`). Foreground API reads also share
a four-request ceiling across the page and retained rails, below the backend's
one reader plus eight waiting places. The right rail keeps its background lane;
commands keep their command lane.

On an outcome home (923), the current topics start before the global outcomes
list. The same checked topic rows paint its cards, and one Conversation answer
serves both those rows and the outline shortcut. Team, wakes and independent
panels start together after the workspace answer. The outline's outcome list
also supplies Also waiting; its refusal and Retry appear in the main column.

Workspace and actor change keys refresh only the affected outcome-home lists.
The named global-list default is navigation, becoming visible, manual retry,
and relevant current-workspace or current-actor changes. Another outcome's
rename or creation appears at that next refresh, rather than on every commit.
Private-writing changes do not reread those lists. A failed refresh stays owed
until its views succeed; an access refusal hides the outcome's content.

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
  same build. Before them, and before the page's stylesheets, where
  `index.html` names it, comes the page's boot (`web/boot.js`), written in
  whole, below: an inline script after a stylesheet would hold the page's
  parsing until the stylesheet came. The page's Content-Security-Policy allows
  those two inline scripts by their hashes.
- An address under another build is refused (404), and so is a module asked
  for with a query outside a build: the run of a page opened before builds
  were stamped. A module asked for plainly outside a build is still the file
  as it stands, for a document that is not a page.
- The page has one dynamic import, the run's `import('./app.mjs?place=N')`
  (`in-place-navigation.mjs`); every other module is a static import, loaded
  with the entry as the document opens. Under a build that import names the
  document's own build, so another server refuses it and the move loads
  instead (`shell.leave`). A page opened before builds were stamped imports
  `/app.mjs?place=N`, which is refused too, so its next move loads the new
  build.
- A page whose `index.html` came from one server and whose modules are asked
  for once the next one has started (a deploy between the two) gets refusals,
  and one asked for while the server restarts gets no answer. Either way the
  module graph fails as a whole: none of it runs, so nothing is assembled from
  two builds, and the browser says so only by an error on the entry's script
  element. The boot hears that error and reads the served build. On another
  build it loads the page afresh, which then comes up on that build alone. A
  load gets the build the server serves as it answers, so another load comes
  only from another deploy, never in a loop. On the page's own build, or with
  the server unread, it loads nothing by itself and says "Theseus could not
  open this page." with Reload, in the page's status line, which shows on a
  phone too. Nothing of the page has run, so no writing is in the document to
  lose; words this device kept from before stay in its stores and are offered
  by the next load, as after any load. The boot is inline, so it needs no
  request of its own however the server is, and it acts only on a module under
  a build: a page that loads reads no build.
- Before a move, the shell reads the served build. Meanwhile the phone's
  drawer closes and the page is not ready (`data-ready`), since a back has
  already changed the address. The page stays up meanwhile, so the person
  can write on. The page's guard therefore hands the move its last look
  (`still`, from `TopicNavigation.openTarget`), and the shell asks it again
  once the build is read, just before the move (`shell.decide`). The look is
  the guard's own last check: no send under way, the same writing in the
  same boxes with nothing typed since, images attached, and nothing unsafe.
  On the document's own build the move goes in place while the look stands.
  If the read fails, the move goes the same way, and the refusal above is
  what stops a run of another build. If what the guard cleared has changed,
  for example words typed while the read was out, kept on this device yet or
  not, the page stays where it is and says why, as a refused move does: "Keep
  this page open until your writing and selected images are safely saved,
  then choose the topic again.", by the topic line and in the Reader or New
  message sheet when one is open. A back or forward is put back. A move that
  a newer choice took over stays without a word. On another build the place
  is loaded (`shell.leave`), so the new release's modules load together.
  While a guard holds (writing not yet safe), or what the guard cleared has
  changed, the page stays instead. It says "Theseus updated." with Reload, in
  the same places, and puts back a back or forward that found the new build.
  Reload goes through the browser's own ask while the guard holds, and the
  words are kept as a load keeps them: words Theseus has come back in the
  box, and words kept on this device only are offered under Review versions,
  as after any load.

Native checks open a page on release 76 (`bb3a46da`), serve this build, move
once, and Edit; they move on one build and on another at 320, 375 and 390 by
touch and on a laptop, where the move to another build asks for no run of the
old one; they hold writing and press Reload, once Theseus has the words and
while only this device has them; they go back while writing in the open Reader
and in the New message sheet, at the same widths, and find the address put back
and Theseus updated said there; and they reload on one build with words on this
device only. On one build they type while a move reads the build, after a row
and after a back with the cursor left in the composer, with the device's copy
of the words kept and with it still being written. Each time they find the
page where it was, saying why, with the words in their box and no run asked
for, at 320, 375 and 390 by touch and on a laptop. Chosen again once the words
are safe, the move goes in place. On another build, words typed meanwhile and
kept on this device keep the page too, saying Theseus updated. They load a page
again with its modules held, its entry let through, and serve another build
before its imports go, on a laptop and at 390 by touch: the page loads once
more by itself and comes up with every module of the new build. They lose its
imports on its own build, and stop the server before they go: the page says it
could not open, with Reload, having loaded nothing by itself, and Reload brings
it up. A page with its modules held on one server, and one opened plainly,
loads once and reads no build.

## Known gaps

- Core records no pull request's state.
- Other routes still read some old hidden sections that supply their page
  context. Outcome homes share the outline's outcomes and Conversation answers.
- Waits in outcomes the reader cannot list are not in the outline's totals.
- On a laptop, ⌘→ opens another outcome's topics only from the keys; there
  is no pointer's way to look without going there. A phone's first tap can
  look in the drawer (item 654).
- A browser never unloads a module it has loaded, so each run's `app.mjs`,
  with what it held at the top level, stays in memory until the page loads
  again.
