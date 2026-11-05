# What waits for the reader

Unread counts come from the deliveries Core already keeps; nothing new is
stored. A message is unread for a reader while its delivery to them is
pending. Reading through it on screen, or acknowledging it, settles it.

- `workspace_topics` items carry `unread` and `addressed`: the reader's
  pending deliveries in that topic, and how many of those name the reader.
- `workspaces` items carry the same two counts summed over the outcome's
  topics.
- The `attention` view takes no arguments and returns the reader's totals,
  `unread` and `addressed`, and `latest_addressed`: up to five pending
  deliveries that name the reader, newest first, each with its message, its
  topic, and `topic_readable`. A topic the reader can reach only as a
  participant, outside any outcome they belong to, counts in the totals and
  never names its outcome.

A person sent a message by name keeps reading that message after they lose
its topic, but can no longer read through the topic; `topic_readable` is
false, and they settle it with `delivery.ack`.

A list view counts only the topics or outcomes on its page. The topic list
finds each topic's subscription group by its key, so its cost follows the
page; the outcome list starts from the reader's eligible groups, indexed by
recipient, so its cost follows the number of topics with something pending.
A subscription group keeps its own pending total. The one direct group per
reader is found by its key and counted row by row, so that part of every
count follows the number of pending messages that name the reader.
`latest_addressed` reads the newest five of them in index order.

## In the browser

The page reads `attention` at start, after each announced commit, when the
stream comes back and when it becomes visible again. It reads in the foreground
lane, which queues: the background lane sheds reads that keep a retry timer of
their own, and this one keeps none. Every open page asks after the same commit,
and the server lets identical waiting reads share one, so many pages cost one
waiting place. The tab title carries the unread total, and each topic and
outcome row shows its count, marked when part of it names the reader; the open
topic's row carries the count its list read for it. A visible page reloads its
outcome and topic lists after each commit, on topic pages as on outcome pages,
keeping the rows loaded with More; a hidden one reloads them when shown again.

Outcome pages list the newest messages sent to the reader by name. One in a
topic they can open links there, where reading it settles it; one in a topic
they have lost shows its words and a "Mark read" button. A Mark read that is
refused or whose answer is lost says so in the page's status, and the list is
read again either way.

A message that names the reader raises a system notification when it arrives
while the page is in the background, once the person has allowed
notifications. The page asks only when they press "Turn on notifications".
Delivery numbers only grow, so the page announces only deliveries newer than
any it has already seen: what was already waiting when the page opened is never
announced, even when it first comes into view after newer ones are read. The
page learns where it started from `/api/bootstrap`: `attention.after` is the
newest delivery naming the reader that waited then (the `capabilities` view's
`attention.after`, one read through the pending index), so a delivery that
arrives after the page opened is announced even when the page's first
`attention` read failed.
Clicking a notification opens the topic, or, for a topic the reader has lost,
the outcomes page. Neither the title, the counts nor a notification marks
anything read.
