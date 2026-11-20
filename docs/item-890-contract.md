# Edit from a message

On a lit message the person wrote and may edit, Edit's pencil is the first
hover-bar button, before thumbs, Reply and More. It uses the shipped pencil
glyph. Tab follows the visible bar order. The bar consumes the existing
shared message-menu Edit descriptor and rechecks that descriptor at activation;
it creates no second eligibility or editing-session owner.

A desktop double-click on that message's own body opens the same Reader Edit.
Other authors, unavailable or reached outcomes, agent readers and an already
active Edit remain governed by the shared menu. On the first click, a link, image, button, card
control or writing field retains its own action. Dragging keeps
selection. Phone double-tap is unchanged. Own editable body double-click
replaces word selection.

The first eligible desktop body click opens Reader immediately, with no delay.
A second click anywhere, including the overlay, turns that exact Reader into
Edit when its detail is at least two or it arrives within **400 ms**, and it
lands within **6 px** of the first click. These are Warp's 12237 defaults.
A slow click outside that interval with reset detail leaves Reader open; Edit
is still available from its menu. A qualifying second click is consumed even
on Reader controls, including Close, previous/next, More, the topic button and
reply writing. It takes the Reader presentation's own shared Edit descriptor,
exactly as its More menu does. Save, Cancel, Use saved and Escape keep that
Reader open and return focus to its More button (review12296). A pencil whose
shared Edit descriptor disappeared is removed when its late press rechecks. An opening
that fails, a replaced or closed Reader, loss of eligibility, a cancelled
pointer or keyboard activation cannot transfer the gesture to another source.

Focused in-memory checks use actual owners and event registration, with red on
exact release167 and applied assertion-failing mutations followed by byte-exact
restoration. They do not prove native pointer, keyboard, word-selection or
phone gestures. No Core, store, server, browser or full-suite workload belongs
to this build.
