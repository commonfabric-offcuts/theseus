# Phone pencil sheet: tiles and steady writing (1168)

The selected design is the forwarded Tony/designer choice in Landing20263,
implemented from `pencil-iphone-fix.patch` (SHA256
`e277b904010bc7db76a3acde788571f01ccf151ac8ca65c49bb7554939f716ed`).
The supplied before/after images show the phone pencil's + tiles beneath its
header, above the writing and Send, instead of a keyboard-height block.

The draft began on release390, `14ec87d3e55c291f2d6975b6b3986c0c8aa4c4d1`,
and fast-forwarded to actual391, `166dabb848438d3edb74a0132021fbb59e6025e3`.
The nine-file 1163 release delta changes no selected ComposeBar, CSS, fixture
or existing consumer input. All draft bytes survived that fast-forward.
The original patch does not apply to its viewport hunk: 1173 now arbitrates
person-owned inline-reply scrolling. Preserve that owner and its touch/wheel
listeners. Preserve Reader and Notebook viewport behavior too. The new
height/focus-versus-pan policy applies to a textarea inside a non-Notebook
`dialog.composer-home`; other surfaces keep their existing viewport policy.

The phone pencil ignores a visual-viewport pan alone. A keyboard height change
or focus may settle writing in either direction. Typing may lift a grown foot
above the keyboard, but does not push already visible writing down. Coalesced
focus/resize takes precedence over a typing-only request. Width changes reset
the keyboard baseline. Existing inline scroll ownership still stops queued
settling until the person focuses or types again.

Shared `ComposeBar.fit` measures the field's natural height on a hidden,
non-tabbable, read-only textarea in the same box, with the current field's
classes, placeholder, value and width. It never transiently collapses the
active textarea. The existing height cap, tall-field choice, scroll retention,
holds callback and `--fit:none` behavior remain. Reuse one measurement twin per
owner; replace it if the field changes parent and remove it on disposal.

Only the phone non-Notebook pencil gets the compact wrapping tile row. Reader,
Notebook, desktop, caret/focus/input/send ownership, and all1119 Archive behavior
remain with their existing owners. No Core, guarded command or schema change.

Checks will exercise the actual ComposeBar and viewport owner with explicit
DOM/geometry ports, retain relevant existing Reader/inline-scroll controls
without assertion changes, and propose one separately bounded Chromium cell
at390x844. Model checks establish owner decisions, not native gestures or
timing. Chromium establishes its actual viewport layout/focus/typing behavior;
it does not establish physical iPhone Safari or software-keyboard behavior.

The inherited 975 height fixture now supplies a textarea's measuring owner,
parent and width ports. Its mutable natural-height input still drives the
same seven auto-fit assertions. Its CSS-owned and resize/disposal cases retain
their separate paths. Existing assertion bodies are unchanged.
