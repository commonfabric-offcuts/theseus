# Silence the waiting pulse (722)

Tony7847 and Warp13706 request one popover action on the actual waiting-for-
reply dots: **Silence**, with the existing check glyph. The action stops only
the three dots' animation. Their waiting words and visible static dots stay.
It neither sends a command nor changes the request, reply or Core wait.

This is a fresh build on release220, `73d3c2b34da8b6d69e1d541833ebd7be88cee189`.
The previous722 set-aside source and native-input failures remain historical;
none of that workflow is resumed or its red outcome reclassified.

`paintAwaiting` owns the message's indicator. Current Core explicitly excludes
Conversation messages from `awaiting_reply` (`stacks.py`, release220); those
cards retain their current question tags and receive no manufactured pulse.
It will offer a semantic button around the existing shared dot mark, using
`openMessageMenu` for pointer/keyboard dismissal and the single check-marked
Silence action. The generic `waitingDots` stays a noninteractive mark for
cover-refresh buttons and other consumers.
The two message-menu control exclusions include this button, so a first
touch opens it and click-focus claiming does not take its keyboard focus.
Auditor's approved646 adds `.stack-star` at those same two sites; carry keeps
both exclusions, with no change to menu construction.

Silence is private to this document and this message's waiting episode. It
survives ordinary repainting; another request starts unsilenced. A completed
wait drops its silence choice. Reload starts unsilenced. There is no storage,
cross-device preference, unsilence toggle or cancellation command.

Native checks start with a click on release220's real pulsing element. Then
topics at laptop and touch-phone widths, light and dark check
the one popover action/glyph, CSS animation stopping, unchanged Core request
facts and no Silence network mutation. A real reply must still arrive and
complete the request; a different request must still pulse. Conversation
negative cases retain the Core exclusion and draw no new pulse/control. Keyboard reach
and Escape use the shared menu behavior. Fixture records, isolated headless
Chrome for Testing and the seat's own profile/port only; Browser.close and
fixture/process/port cleanup are retained. No fake-DOM timing claim.
