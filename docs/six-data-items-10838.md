# Six data-layer items: delivery

Tony's assignment 10838 covers 786, 756, 792, 774, 782 and 676 without using
the test suite. This composition includes 759's question-to-cover linkage,
which 782 requires. Earlier item specifications describe their historical
branches and verification plans; the schema numbers and observations here
describe this composition.

## Changes

- 786 requests an ordinary update from the original message's writer. A new
  ordinary revision of that same message completes it; replies do not.
- 756 counts linked cover waits for the person asked. Manual waits continue
  to count for the outcome owner.
- 792 adds personal stars, rename, retained deletion and Undo to Notebook
  pages. Undo restores the Text/Cards and Draft controls as well as writing.
  Existing draft policy remains: agents see titles and can personally star
  them; draft words, references and attachments remain withheld.
- 774 moves a dossier atomically while retaining its identities, writing,
  reactions, personal positions and cover/question routing. Expanded topic
  access is refused. Private messages and pointers retain their visibility.
- 782 requires an explicit CLI go-ahead choice for an Ask and offers the
  asked person Go ahead / Don't buttons on the linked cover. These use the
  existing revision-fenced answer command. Unrelated writing does not settle
  the question.
- 676 shows a static crossed-eye when a public message addressed and reached
  no agent at publication. Its accessible explanation describes notification
  at send time; it makes no claim about who may read the topic.

## Migration

731 owns 48→49. This composition adds 49→50 message updates, 50→51 cover-wait
index, 51→52 Notebook actions, 52→53 dossier moves and 53→54 question links.
Migration is an explicit admin operation. The earlier provisional schema
49–53 composition must not be deployed.

An actual schema49 product instance upgraded to54 retaining existing
messages, cover acts, Notebook revisions and positions. Downgrade to49 before
new records and re-upgrade both succeeded. After a new Notebook star,
downgrade refused with RECORDS_WOULD_BE_LOST and the database was unchanged.
Once new durable records exist, recovery is by fixing forward rather than
discarding them.

## Observed verification

No repository test suite, fixture/helper, test runner or CI was used for this
assignment. Disposable authorities were populated through product commands.
Direct command/view exercises covered exact retries, wrong authors, stale
answers, linked wait counts, move admission/routing and draft withholding.
SQLite integrity and foreign-key checks passed. CPython3.9 parsed the product
modules; Node parsed the changed JavaScript modules.

Chrome for Testing exercised laptop keyboard Enter and phone taps on cover
answers, including refresh on another device, dark phone rendering, the
crossed-eye explanation, Notebook Star/Rename/Delete/Undo, and the dossier
destination picker. Notebook Undo initially left its view and draft controls
hidden; this composition fixes that observed failure. Corrected interactions
completed without browser page errors. Browsers closed through Browser.close.

Evidence is retained on this Mac under
`~/.local/share/theseus/auditor/evidence/wake11402/`. The browser scripts and
direct exercises are standalone observations, not a replacement test-suite
pass. WebKit, exhaustive concurrency, and live deployment have not been
verified by these exercises. A release must record the actual live head and
schema; a pushed branch alone is not a shipped item.
