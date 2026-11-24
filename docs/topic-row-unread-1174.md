# Topic rows with unread messages

A left-rail topic row showing an unread count opens the same oldest unread
message as its count, including when the topic also waits on a question.
The row link carries that destination for browser-owned modified presses.
A row with no unread count keeps its existing topic/question destination.

TopicRail uses the record it drew and passes the existing `at: unread`
navigation target. The existing application landing owner loads the message
and its dossier, reveals the message whole, focuses it, and clears only the
captured unread-mark revision when it is actually read. No second scroll or
new reading/mark owner is added.
