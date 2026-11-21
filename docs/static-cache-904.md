# Cached page code and outcome-list changes (904)

The existing web build stamp names the server's immutable startup snapshot.
The entry, imported modules and stylesheets use `/b/<stamp>/...` URLs. Only
successful assets under that exact stamp receive `public, max-age=31536000,
immutable`; the session-bearing index, unstamped compatibility URLs and APIs
remain `no-store`. Another stamp still refuses rather than mixing builds.
Static HTTP/1.1 requests may reuse their connection within the existing
bounded connection lifetime. API, media, refusal and Live behavior keep their
existing ownership. Connection slots and request deadlines remain bounded.

Core keeps an opaque outcome-list change key per reader in existing metadata,
in the same transaction as the change. Creating, renaming, ending, reaching,
changing team access or ordering outcomes updates the affected readers' keys.
Ordinary messages and topic ordering do not. Live reads the reader's key with
the commit snapshot; it carries no outcome identity or private record. No
schema change or history scan is required.

The page retains 923's scoped refresh, navigation, visibility and retry
behavior. An outcome-list key change additionally invalidates that list,
including changes made in another session. A failed load retains its pending
key; a key arriving during a read cannot be accepted by the older read.

Checks cover stamped headers and connection reuse with a scratch server,
unchanged API/refusal behavior, transactional keys and Live delivery, plus
actual outline refresh without rereading it for an ordinary commit. A separate
scratch-browser cold/warm measurement records actual requests and elapsed
time; these are observations, not a production latency promise.
