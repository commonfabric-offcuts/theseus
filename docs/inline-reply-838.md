# Inline reply follow-ups (838)

Reply keeps the source card at its normal reading height. Its words scroll in
place above the reply field; an explicit Show full choice remains expanded.
The one Reader and its existing draft, destination and upload ownership still
move into that card. Reply itself never invokes Show full.

After Reply focuses the field, scroll the page only if the field is outside the
visible window, aligning its bottom with the visible bottom. A shrinking visual
viewport repeats this adjustment above the phone keyboard. Ordinary page
scrolling must not pull the person back to the field. A fully visible field
causes no movement. Full Reader and new-message composition keep their behavior.

Only the in-card address button and How / To / In panel inherit the dossier's
folder color and foreground. Selected chips use a stronger shade, including in
dark mode. The full Reader keeps its current colors.

Base: release 120, `5e62cd5c65380e019bd36ed0cb8827e5acf6e870`.
Tony's accepted scope is recorded in Landing #11172. Validation is limited to
focused quick checks compared by failing test name to that base. No preview or
prelanding browser run, as directed. Source review precedes Fable's landing.

Validation: six existing focused files on live 120 ran 270 tests, 153 passing
and 117 failing. The candidate with the new inline-reply cases ran 278 tests,
161 passing and the identical 117 failing names; none added or removed. The
eight new cases pass. Reverting the product to actual live 120 makes seven of
those eight fail; preserving an already expanded card passes on both versions.
These are Node checks with stand-in geometry, not native layout or touch proof.
The original and final TAP files and exact comparison are under
`~/.local/share/theseus/auditor/evidence/838-*`.

The five changed product files package as build `f9fe06d6103dde3e7bb9`, 131
assets. Full Reader colors and its internal keyboard-scroll path are untouched.

The final review head also carries 832's test-only merge `6202e0c3`. Its product
base is identical to live 120. With those fixture corrections the same focused
candidate run has 278 tests: 277 pass, one fails. The remaining existing failure
is `the origin line names the author, a Notebook page and its revision, and when
a message was sent, and leaves out a time it does not have`; its Reader stand-in
omits `sessions.reply.context.actor` required by the unchanged `paintOrigin`.
It also fails on actual live 120. `838-with832.tap` retains that result.
