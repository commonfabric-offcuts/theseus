# Withdrawing a question (366)

Only the asker may permanently withdraw their own public question, whether the
asker is a person or an agent. There is no confirmation and no Undo. Asking again
is a new message. Canonical source access, authorship and open-outcome checks
apply; ownership or coordination gives no override. A tell, whisper or inaccessible
source cannot be withdrawn. An answered question can still be withdrawn.

`message.withdraw`, target `{message_id}`, args `{}`, and the expected authority
pin records an immutable `{by, at_ms}` fact. The CLI is
`withdraw MESSAGE [--operation ID]`; HTTP uses the same Core command. An exact
operation retry returns its recorded receipt. A fresh duplicate returns the
existing withdrawal with `changed: false` and makes no new withdrawal or changes.

Withdrawal ends only this question's waits in the same transaction as its record,
receipt and scoped notifications. The original words, replies, reactions, deliveries,
proposal/stage records, Conversation items/takes and prior cover revisions remain.
Explicit waits and other questions remain. A late answer can coexist with the
withdrawal; thumb-off, reply, retry and attention recovery cannot reopen its wait.

Current integration, approved by Warp11780 (`m-ab894603093448a282930a9b4e9a65a7`):
retire this ask's active `ask_cover_links` and remove only their matching cover
waits. Each resulting cover act belongs to the withdrawing asker, never to the
recipient as a fabricated answer. Other questions in the same dossier and explicit
cover waits remain, as does every prior act. Cover changes, topic attention,
withdrawal and operation commit or roll back together.

All readable source/feed/delivery views carry `withdrawal: null` or `{by, at_ms}`.
The existing card/right-click and Reader menus offer **Withdraw question** for
one's own unwithdrawn ask, using the existing Undo-arrow glyph. The original body
stays; the origin reads **Question withdrawn** after commit. Pending says
**Withdrawing question…**. An interrupted transport says **Whether the question
was withdrawn is unknown. Press Withdraw question again.** Retry preserves the
exact operation. A late receipt updates only its message and never overwrites
another opened source or unsent writing. Old reads cannot remove a known withdrawal.

The recut starts at release146 `b38c8db9c6e3ae2f67aa6dc708895a1c73c04a93`,
schema54. The additive54→55 migration creates `message_withdrawals` and immutable
update/delete triggers. New code refuses an unmigrated54 store. An empty withdrawal
table permits55→54; any withdrawal refuses rollback without record loss. Actual
schema54 source seeds the existing-data migration test; changing a version stamp
does not establish that fixture.

Focused Core tests cover records, permissions, linked/legacy waits, recovery,
adapters and migration. Node tests cover menu eligibility, terminal reads,
transport retries and late-source isolation below the browser. Applied mutants
must fail assertions and exact restored controls must pass. This recut has no
new browser, layout, physical-device, preview or whole-suite claim. Historical
native acceptance remains bound to original source e9e243fc, not this composition.
