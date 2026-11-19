# Conversation background reading (830)

A page loading older history can discover several missing dossier heads at
once. Its head reads run one at a time, leaving the bounded background lane
room for the change feed. Before a queued read starts, it checks that the
visit and its exact head record are still current. History that already
loaded the head, a changed dossier or navigation can retire that request.
An older answer cannot replace a later record. Refused and failed heads
retain their existing visible state and Retry action.

Starred history still uses the ordinary bounded topic-message frontier and
loads every admitted message, as specified in item 803. Each page updates
the cache and yields to other refresh keys and foreground reading. The
accumulated history is drawn when that load completes, rather than rebuilding
the growing card list and requesting extra heads for every older page.
Ordinary initial, More, anchored and live message pages still paint as they
arrive. A failed fill paints the history already read before offering Retry,
unless access or authority is being rechecked. A paused load retains its
frontier and its pending paint; resets and retries cannot strand the messages
it already read.

No Core view, data format, read-lane capacity or writing operation changes.
Verification uses direct observations on an explicitly isolated copy of
release 114. No repository test suite or CI is run, under Tony's instruction.
