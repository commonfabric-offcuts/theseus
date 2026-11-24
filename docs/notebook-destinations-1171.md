# Notebook destinations follow the left rail

Move and Copy offer the outcome Notebook and the same topic lists as the left
rail. The active list excludes Build topics and includes the outcome's
conversation at its ordinary place. Done and Archived use the rail's existing
explicit lists. The person's saved or pending topic order applies to each list.

Destination reads use `readTopicList`, `listArgs`, `TopicPages`, `PAGE` and the
shared outline order book. More retains the loaded topics, adds the next server
page and keeps the conversation separate from the server cursor. Changing lists
starts that list from its first page. No destination filter is maintained here.

Choosing a destination still calls the existing transfer owner. A move to the
current Notebook remains disabled; a copy there remains available. A departed
writer cannot open the picker or transfer a page. Core still validates access,
source revisions and the selected destination in the transfer transaction.

The focused checks cover topic membership, conversation identity/order,
pagination, explicit groups, reader errors and the existing transfer controls.
The existing transfer browser driver runs in one isolated Chromium cell; it
does not establish physical-device behavior.
