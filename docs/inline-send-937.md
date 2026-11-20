# Inline reply after Send

A confirmed publication closes its unchanged, empty per-message reply field.
The sent message takes the light and keyboard focus if the person was still
using that field. Reopening the parent starts an empty four-line field.
A later opening, new writing, image action, notice, or destination keeps its
ownership; a late answer cannot close it or pull focus back.

Preparation, refusal and unknown publication retain recovery controls. The
Reader and the topic composer keep their existing sending behavior. Send
records no manual dossier placement and does not clear a pre-existing place.

`ui_inline_send_937.test.mjs` checks publication and stale-answer gates.
`inline_send_937_native.mjs` sends through the real isolated HTTP/Core page
with native mouse and keyboard input, checks field visibility, focus, light,
placement commands/labels and reopening height, and verifies fixture cleanup.
