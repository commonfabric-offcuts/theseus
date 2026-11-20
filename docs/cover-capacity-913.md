# Longer dossier covers (913)

On live181, the existing `stack.cover` command and every cover reader share
`cover_values.STANDS_CHARS`. Raise it from300 to32,000 characters, including
retained line breaks. Existing whitespace normalization, authority, revision
fences, no-op behavior, history and the bounds on other fields stay intact.
A larger value is refused with `INVALID_ARGUMENT` and the new number; no
partial cover update is recorded. No schema change is needed.

The shared cover sheet keeps the whole accepted text and scrolls inside the
card when its content exceeds a viewport. Warp12996 keeps literal plain text
and line breaks as769; richer covers belong to920. The short-cover layout and
existing refresh controls keep their owners.

The cover footer names the latest cover revision's `by` and `at_ms`, including
direct writes with no refresh request. A completed request adds no second
completion footer. A pending request retains its separate existing timed line
and control. Message-update request lines are unchanged. The repaint key
includes the revision writer and time, so a later direct write cannot leave
an older footer on screen.

Checks use isolated Core records and actual shared renderers:20,000 characters
and a twenty-line board remain whole through commands, projections and CLI;
32,000 succeeds and32,001 refuses atomically; long DOM text is complete and
the card has viewport-bounded overflow styling; direct writes and a stale
completed request show the cover revision's writer/time; pending and ordinary
message request behavior remains. Source/DOM checks do not claim native layout
or touch scrolling evidence.
