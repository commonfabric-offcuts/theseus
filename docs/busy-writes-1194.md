# Busy writes

Connections are opened for a known use: reads retain a 250 ms lock wait;
commands and transaction writers wait up to 5,000 ms. The live feed keeps its
explicit read wait. SQLite rollback journaling, EXTRA synchronization,
fullfsync and foreign keys remain checked on every connection.

The hosted CLI response budget is 15 seconds: an optional activity write and
the command can each spend five seconds waiting, with response framing margin.

Each page mutation call, including uploads, retries a definite, unrecorded busy
answer up to three times after 250, 750 and 1,500 ms. It snapshots the original
envelope once, retaining the operation ID, authority, expected revisions and
contents. The caller's promise stays pending between attempts. Exhaustion returns
the final busy answer/error; lost, unreadable, recorded or other refused answers
are not automatic retry authority. Cancellation stops a pending backoff.

HTTP Health reports DATABASE_BUSY replies from this server during the preceding
60 seconds, with one-second bucket precision. Counts include both Core retryable receipts and HTTP errors, but not
SERVER_BUSY or AUTHORITY_BUSY. This bounded, in-memory meter resets on server
restart, contains no operation or actor history, and counts generated replies,
not proof that a client received them. Health shows the count at its last read;
it is not a new red lamp or a database statistic.
