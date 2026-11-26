# Starred reads recover when Theseus answers again

The outline's visible starred dossiers and Notebook pages retry an interrupted
read after newer server contact. This is a Page change on release 468. The
existing `OutlineDossiers.load` owns pagination and publication; the API owns
contact and validated session renewal. Recovery neither renews a session nor
sends a command, reloads the page, or changes a writing owner.

Only an actual unanswered API attempt classified retry/reconnect is eligible.
An explicit session refusal also waits for a different validated active token.
The original attempt's start clock is retained, including when contact returned
before its failure arrived. Each state has at most one recovery. Taking it
removes it before reading; another failed attempt waits for newer contact.
Normal refresh, Retry, More, navigation and reset retire the old recovery.

Recovery preserves the failed More cursor and loaded extent. It is fenced by
the original handles, epoch, instance, actor and authority, and requires a
visible connected group and an allowed current topic. A late answer cannot
paint after those conditions change. Other diagnostic, malformed, forbidden
and authority failures keep their existing explicit notices. Unrelated outages
are never described as releases.

The same owner serves dossier and Notebook-page groups reached by pointer,
keyboard, touch or focus in the outline. Retry and More use their existing
callbacks. Recovery keeps another control's focus; if the focused Retry is
removed after success, focus returns to its topic row. Unit checks execute
these owner/DOM paths, delayed failure/contact orderings, repeated outage,
session validation, retirement and cursor preservation. Actual native gesture,
geometry and real isolated restart evidence remain unrun. Parent 1236 retains
the installing metadata producer, general panel recovery and guarded Reload.
