# Inline reply lifetime (929)

Closing a Reader opened from a click-opened inline reply leaves that inline
field closed when its registered reply is still empty. The Reader close has
already kept its writing before the UI changes visibility. Words, recipients,
quotes, images, selected upload work and pending submissions keep the inline
field. Writing begun in the Reader therefore returns to the same inline field.
A later explicit click may reopen an empty field.

Retiring a card releases its DOM adapter, window focus and outside-click
listeners, media-query listener and resize observers. The registry continues
to own writing; reattaching a replacement card reuses its registered session.
Disposing an adapter prevents a late source load from creating another one.

Checks instantiate actual CardReplies and InlineComposer against a browser DOM
with a small registry boundary. Separate real-page native input verifies the
empty/writing Reader round trip; retained app wiring checks cover keyboard and
modifier boundaries of the 907 click model.
