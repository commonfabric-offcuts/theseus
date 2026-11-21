# Question withdrawal on release150 (366)

Warp11855 (`m-85ee6f4c493b41caae9c74380ffb796d`) approves the release146
source `b1ed74352bb352e5b82cd6a5a1ec6fe98e0c8b54` and requires two changes
in its carry to release150 `13d415921c338709bfbeb6f2e93894b8fb37733d`.
The original source remains frozen. This new worktree preserves both parents.

An addressed person cannot send either go-ahead decision on a withdrawn
question. After canonical access, go-ahead and asked-person checks, Core
refuses with `QUESTION_WITHDRAWN`, before the answer-revision fence or any
reaction, reply, delivery, mark or notification effect. "Record nothing"
means `recorded: false`: no operation receipt is persisted and no sign-of-life
or health side effect commits. This follows existing unrecorded refusals such
as `MESSAGE_HELD` and `ASK_WAIT_REQUIRED`; it is a permanent business refusal,
not a retryable transport result. Retrying its exact request stays refused.
An already committed decision's operation replay still returns its original
receipt. A later reply in words remains allowed and cannot revive the ask.

The withdrawal menu item belongs once in861's `sharedMessageMenuItems`.
Cards, dossier menus and the Reader consume that owner; `openReaderMenu`
does not append a second withdrawal item. Other shared actions, source fences
and saved writing retain release150's behavior.

The original schema54→55 migration and permanent asker-only/no-confirmation/
no-Undo default stay unchanged. Focused checks must show the new decision
refusal failing on original b1ed7435, the combined source working on150,
and applied assertion-failing mutants with exact restored controls. Tests
wait for the coordinator's serial slot. No browser, preview or broad suite
claim is added by this carry.
