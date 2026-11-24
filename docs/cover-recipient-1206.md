# First cover recipient (1206)

Ask for a cover defaults to the author of the latest agent reply visible to the
requester in that dossier's current membership. The opening message and a later
human reply do not count. Replies in another dossier do not count; replies in a
dossier joined into this one do. The existing enabled-agent, source-access,
current-root and self-delivery checks still apply.

If that last replier is unavailable, retain the existing recorded-writer then
configured-coordinator fallback. With no agent reply and no written cover, this
is the configured coordinator; without an eligible fallback, refuse honestly.
Refreshing an already written cover keeps its recorded writer preference.

The existing empty-argument `stack.cover_refresh` command, request identity,
coalescing, pending delivery and completion rules are unchanged. No client
recipient override, schema change, new permission or historical rewrite is
introduced. Real temporary-Core cases live in `test_cover_recipient_1206.py`.
