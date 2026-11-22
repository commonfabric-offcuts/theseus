# Wake replay root reasons (1086)

Fable17375 corrects the intake to actual application343
`dc1124bc36a9c91d95ba41208e27ff816d94e933`, tree
`d10e7c4ce6542d1c245ca89d2aa1fcb22dde9664`. Its replay owner, existing test
and captured traffic bytes match the three supplied Git blobs and SHA256s.
The clean earlier e46cb262 controller intake and missing-owner receipt remain
preserved separately. A later carry is Warp's; no live installation changes.

There is one replay `message.post` command, inside `serve`'s post handler.
`Copy.post` forwards scheduled traffic to it. That path deliberately posts
synthetic roots for captured post/tell/ask traffic; it does not reconstruct
original reply bodies or quotes. Topic opening/publication is separate.

For each replay root, carry a supplied `divergence_reason` unchanged from the
traffic item through Copy's request into Core. With no reason (or null), the
DEFAULT is `wake replay <wake-id>`. Prefer the traffic item's `wake_id`, then
its `id`; existing anonymized captures contain neither, so their stable replay
identity is `replay-message-<index+1>` using the schedule's existing index.
No random newly committed message id or wall-clock value supplies this identity.
An explicitly invalid non-null reason remains invalid; Core still decides its
validation and refuses it. Do not trim, normalize or truncate supplied words.

Keep Core's root divergence requirement, reply/quote validation, existing
actor/intent checks and operation identities intact. The existing serial
`replay-N` operation scheme does not change. Capture still strips private words
and does not start collecting reason text or original message ids. This change
does not reinterpret captured traffic as actual replies or fabricate quote
choices. Existing Core reply and operation-refusal checks remain applicable.

Red evidence must observe the actual intake owner's
`DIVERGENCE_REASON_REQUIRED`, with no falsely successful replay artifact.
Corrected scratch checks must read committed roots and exact reason covers,
exercise the real run/CLI entry with short synthetic traffic, and retain
`replay.json`, raw exits, command/source/input identities and owned cleanup.
Invalid reasons and other real refusals keep failure exit2 and do not produce
a successful artifact. Keep the existing schedule/measure checks and Core's
root/reply/refusal checks. Apply the actual old replay tool, observe meaningful
red, restore exact corrected bytes and rerun the affected cohort.

Only bounded sequential scratch checks are planned; a two-message entry is
separate from the captured fifty-message, long-turn measurement. No broad
suite, HTTP/native/browser workload or old refused production-run replay is
needed. Start below the standing load threshold. Substantial competing work
waits for an actual clean slot; the existing1082-to1089 handoff stays intact.
No 1079/1084/1088 controller parser/comparison change or green rewrite occurs.
Freeze when the required checks pass, push the exact source branch, and retain
all failed phases for canonical freeze and independent review before Warp carry.
