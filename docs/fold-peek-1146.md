# Fold ends a temporary look (1146)

The dossier header's New action can reveal a message whose saved personal
choice remains folded. Pressing Fold on that non-starred, peeked message ends
only its temporary reveal, draws its existing folded row, and follows the
existing focus option. It sends no `message.fold`, records no Undo, and shows
no status or announcement. A starred message keeps its existing refusal.
A saved-unfolded message continues through the existing fold command and Undo.

The source base is release 373, `b310f4bde9eabae1d20731613dc6e117984720ea`.
The change stays in `web/stack-feed.mjs`. Existing 1101 assertions are retained;
three 1146 checks cover close-peek, star refusal, and ordinary fold/Undo.
The below-browser checks do not prove native input, focus geometry or timing.

One separately routed isolated Chrome for Testing cell will press the dossier
New tag, observe the actual saved-folded message open, press its actual Fold
control, and verify the same message becomes a row without a new fold command
or notice. It will retain Core before/after records, trusted input, screenshot,
actual served hashes, response bodies and owned cleanup. The native cell and
its observer/runtime pins must be prepared and routed before execution.
