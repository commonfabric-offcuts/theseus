# Mention nonreceivers (1020)

Send proceeds as written. After Core confirms publication, the page checks the
exact frozen submission and shows one left-rail notice for that send if any
recognised @names are outside this message's active-participant/delivery audience.
The existing leading-name addressing rule, Send envelope, receipt, saved writing,
confirmation recovery and card-close callback stay authoritative.

`submission_mention_reach` is a read-only view accepting `submission_id`, optional
integer `cursor` (Unicode body offset) and `limit` (normal page bounds). It reads
only the caller's submission, requires its committed send and readable message,
and checks that frozen body. Each page resolves at most `limit` standalone ASCII
@tokens, case-insensitive actor ID first, then an unambiguous enabled display
name. Unknown, ambiguous, disabled and self names are ignored. Repetitions are
coalesced by actor. Mentions anywhere in the body count; email addresses and
embedded words do not. This is advice, not new addressing syntax. Whisper sends
produce no membership warning because their private audience is deliberate.

The view returns `items` (actor_id/name), `next_cursor`, `message_id`, and `scope`
(kind/id/title/revision, add command/target/revision field, may_add). Only active
topic participants and noncancelled deliveries for this exact message count as
reached. Conversation uses its synced humans/coordinator, not every team agent.
A pending explicit delivery already counts, including to a removed creator.

Membership is checked when the view runs; this is not a historical delivery audit.
Actor ID lookups use the key where spelling matches; case/display-name fallback
uses the public actor directory, at most two matching rows per token. No history
scan, schema migration or write is added to the view.

The page uses 979's durable current-authority publication hook for pencil sheet,
inline card replies and topic-foot sends. It starts the check without awaiting it
from Send, drains bounded pages sequentially, and deduplicates by send operation.
One notice holds all names for a send. It names the sent scope and its audience
limit, offers the permitted explicit membership action, and stays until
Dismiss. It does not take focus or open the phone rail drawer. Both looks use
the existing page-notices host, which remains visible above a closed phone rail.
After a transient optional read failure (retry, defer, resync or superseded),
the page waits 500 ms and automatically tries the whole bounded read once more.
It paints no error notice or Check again control. A second failure stops quietly;
a complete answer paints the existing outsider list and explicit Add controls,
or nothing if there are no outsiders. Paging restarts at zero after a failed
page so an incomplete name list is never painted. Repeated publication of the
same send cannot start another check or retry. Disposal cancels its pending
timer; retirement, dismissal and a changed authority prevent a delayed read or
late result from taking effect. A terminal refusal (including UNKNOWN_VIEW or
FORBIDDEN after unsend) removes the advice without a retry and never changes the
confirmed send.

Adding is a separate, explicit existing Core command bound to the sent scope,
not whatever topic is now open. A normal-topic reader may add a participant;
only an outcome organiser may add an outcome-team member. Core rechecks current
permission, enabled status, capacity and scope revision. An uncertain transport result keeps its exact operation for Check add. A rejected receipt is definitive regardless of recorded:false: its reason stays visible and Add stops. A first revision conflict may build one fresh attempt; a second refusal stops. Adding does not resend the old message.
A retired page or changed authority cannot paint a late result or start an add.

Checks: real isolated Core send/view cases cover routing preservation, scope,
permissions, aliases, duplicate names, pagination, privacy and delivery evidence;
UI tests cover publication dedupe, late results, read errors, bound membership
acts and uncertain identity. Native isolated Chrome/WebKit checks use Meta-Return Send
and native pointer/touch notice/add/dismiss controls on laptop/phone, both looks. Retain
red before product edits and actual applied mutation/restoration for reach logic.

Native touch limitation: on pristine306 and this source alike, a first phone
foot Send tap after saved writing had touch down/up on Send, then focusout and
a click retargeted to main, with no send receipt. Exact paired event/receipt
evidence is retained. The feature matrix uses native Meta-Return Send; it does
not claim to fix or prove that existing first-tap Send path or a software keyboard.

Build2 routing clarification: outcome-team membership enables future addressing;
it does not subscribe an agent to the Conversation. The notice names that limit
in visible words. An agent already on the team has no repeated Add action.
An outsider may still explicitly be added to the team for future addressing;
that action does not resend this message or promise future broadcast delivery.
Core returns actor kind and per-person membership-action eligibility with names.
