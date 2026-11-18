# Item 721 — approved behavior and test ownership

Testing starts from approved preview 93825af00eee9bfb7dc1c67afb27c3e13e6cf787.
Tony #8502 (`m-c083ba0ec2cf4e95b9f4abce3b9b6d14`) says “yes - full approval”,
replying to revised same-copy request #8482. Warp #8503 starts this stage.
The original #7824 mockup gate and its #8399 named-default waiver remain in
card-reply-preview.md and the historical reports. The held a7 preview is not
an approval. The addressing row shown in 938 remains the named default.

`reader_compose_native.mjs` includes `item_721_compose.mjs` in native-compose,
filtered by “item 721”, in both engines. It uses native hover/tap Reply,
keyboard, writing selection, source drags, image choice and real HTTP/Core.
The fixture switches immutable public builds; it never replaces an event
handler with a test call. It archives the actual a958 original and held a7
public source with SHA-256 manifests. Every mutant asserts its source change,
uses the behavioral oracle, and restores all candidate public bytes and CSP.
`tests/acts.json` declares the new acts. Dimensions use named CSS-pixel
rounding tolerances in `ITEM721_TOLERANCE`.

The existing Reader/ComposeBar, EditorRegistry, sessions and uploads own
placement, writing, addressing, destination, drafts and publication. The
request-boundary contracts appended to ui_app.test.mjs exercise the real
registry/HTTP/Core, preserving its editor/session/upload identity, exact words,
source, destination, quotes and caret; an answer lost after real publication
retains newer writing and reconciles one message.

This document declares cases, not results. REPORT.md and ACCEPTANCE.json in
the assigned external evidence folder record exact executed heads, failures,
screens inspected and remaining limits. Unrun states are never marked passed.
Native IDB adoption/read-only recovery and recipient/destination permutations
outside these own cases remain explicit evidence gaps until exercised.
Only the two allocated compose calls and single node-units call may run.
