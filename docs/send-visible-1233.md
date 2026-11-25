# Sending keeps submitted writing visible (1233)

Send freezes one exact submission synchronously. Its local card appears in the topic as Sending, independently of the editable successor. It is not a Core message: it has no message id, sequence, unread count or confirmed reaction controls. The pencil sheet closes only after this visible handoff. Pending placement, sheet closure and confirmed message placement are distinct measurements.

The card keeps exact words and attachment identities through preparation, unknown confirmation, failure and reload. A recorded refusal restores the words only into the unchanged empty successor; newer writing and images win. An unknown response never authorizes a fresh operation or a public resend. The existing confirmation/recovery owner retains every operation and authority pin.

Private saves remain serialized. Preparation still requires the exact acknowledged writing and revision; send still requires recorded preparation. A committed save may satisfy the frozen submission only when source, slot, generation, revision and effective sent writing match. No changed words or images are credited by a version counter alone. During a send, status notifications are deferred/coalesced; state and durable journal barriers remain immediate and ordered.

Confirmed placement reads the exact committed identity under the current topic/access/generation fence. The local sending card remains until that actual message is drawn. A failed placement offers Check confirmation; it never repeats message.send. Reader, inline reply and bottom pencil share the submission owner. Pointer and keyboard paths retain later focus/navigation/writing.
