# Recorded-action secondary reads (1246)

Local recorded callbacks and socket commits use the same followCommits owner.
They consume authorized, bounded workspace/topic/actor change windows rather
than trusting a local command name. Each cursor advances only after every
selected secondary read succeeds. Marks, delivery/waiting, read/New and
Conversation consequences are therefore selected from recorded resources too.

Initial/manual/visibility reads are full. Missing read admission keeps the old
full path. Unsupported, malformed, failed or resyncing windows fall back to full
reads without accepting the failed window; resync discards the checkpoint.
Page retirement and authority review fence reads and checkpoint acceptance.
The existing topic Freshness, shell/sidebar and Attention owners remain separate.
Change windows use RecoveryCleanup.read's serialized background lane; selected
lists retain their own foreground/background owners. A foreground deferral
falls back without accepting its change checkpoint. Recorded mark refusals
explicitly request full confirmation even when they produced no change key.

Private writing and reaction-only keys do not reload unrelated secondary views.
Mark/delivery keys select marks/read/unread and the topic/Conversation projections;
workspace/topic/participation/unknown keys are conservative. Notebook changes
select page/read state. A Notebook source shown in the Reader may belong outside
these scopes, so its existing current-revision check is deliberately retained
on every processed window while it is shown. No negative claim is made for it.

OutcomeScope.load optionally accepts section names; omitted selection keeps its
existing all-section behavior. The topic secondary owner passes selected names
without bypassing each section's read/access checks. Local callbacks ask the
scoped path, while explicit full refresh and the socket's retry behavior keep
their original followCommits owner. No command envelope or operation changes.

The focused fixture executes the real app setup, followCommits, Marks callback,
RecoveryCleanup and changes controller. It covers supported and capability-
absent/unsupported paths, initial full loading, selected section/count read
ports, in-flight local/socket coalescing, positive/negative consequences,
continuations, failures and stale authority/page responses. Its folded count
model is not a Sidebar cache or DOM acceptance test.

Interaction inventory: local mark/thumb/answer and the other recorded action
callbacks retain their original command and gesture owners; their confirmation
requests join the same owner as socket commits. Visibility requests a full
refresh. A changed commit after stream return establishes a new baseline and
full views; quiet repeated live notices start no producer. A shown Notebook
retains its revision read, including sources outside these scopes. Pointer,
keyboard, touch, focus, scroll, image and Reader acceptance remain native proof
for those owners. This fixture proves read selection and checkpoint retention,
not CPU savings.
