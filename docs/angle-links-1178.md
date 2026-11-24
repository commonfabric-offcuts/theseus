# Angle bracket link destinations (1178)

1190 adds clipboard copying to these local references. Their click behavior
is now specified in [local-file-copy-1190.md](local-file-copy-1190.md); the
1178 inert-reference language below records the original parsing change.

Tony21061 reports a named Markdown link whose local destination contains spaces
and a :28 suffix being displayed as its raw source. I read his actual attached
image through the bound CLI. Warp21064/21065 and Fable21078/21134 assign the fix
to Core8 after1176: messages, Notebook pages and Notebook cards in Display mode.
This contract is written before product or test changes. The isolated source is
live381, 8dc2b1e82d710a19cdfe1a29da09c217df9f0b93;1176 proof remains preserved.

## Behavior

Read [words](<destination>) using the angle-destination rule in
[CommonMark0.31.2 section6.3](https://spec.commonmark.org/0.31.2/#link-destination).
Spaces belong to the destination; parentheses inside its angle delimiters do
not close the surrounding link. A line ending or an unescaped angle delimiter
inside the destination prevents that form from being recognized. Existing
punctuation escapes, label formatting and code-literal precedence remain.

An accepted http/https destination uses the existing ordinary anchor, including
its original internal/external navigation, author-written label, target/rel and
propagation rules. Existing accepted Theseus query links keep their current
owner. For an angle-wrapped local destination beginning /, ~ or file:, display
its label as a reference, retaining the entire path and :line in its hover title.
It has no navigation, href, opener, file access or extra keyboard stop. A press
on that reference must not bubble into the surrounding message fold or Notebook
card editing/selection acts. Ordinary text selection remains available.

The local-reference affordance belongs only to this explicit authored angle
form. Keep current unwrapped links, rejected unwrapped relative/query forms,
bare web links, topic naming, nested-link rules, adjacent text and unsupported
schemes unchanged. Never create HTML from either label or destination. Keep the
exact authored Markdown in Core and in Notebook writing; sourcePosition,
passage/range mapping and quoted selections retain the full authored link when
its displayed label is atomic. No Core, database, schema or migration change.

## Existing owners and expected edit surface

web/message-format.mjs owns bracket/escape/code reading and mapped source spans;
its current parenthesis pass clears at whitespace, which cannot read this input.
web/links.mjs owns writtenLink, node creation and navigation. Local references
must use a distinct inert node path, while existing web-anchor shapes remain.
web/aim.css owns the current words-link decoration/cursor; reuse the text style
without promising navigation for an inert reference.

Message cards use formatWords through app.mjs/card-scroll.mjs; the Reader uses
drawPassages. NotebookPage uses formatWords and composes mapped card passages;
DeckPage.paint formats the opening and each deck-words card. These are consumers
of the same formatter. No separate Notebook parser or data rewrite is planned.
DeckPage's current parent handlers exclude a/button and otherwise enter editing,
so proving only the label text is insufficient: reference event isolation must
be checked through that owner. Page5's1156 DeckPage boundary work stays separate.

The initial test-consumer read includes tests/ui_message_format.test.mjs escaped
parentheses/named links/atomic quote mapping, tests/ui_links.test.mjs ordinary
and query routes (including rejected unwrapped relative targets), pipeline's
literalLinkNodes consumer and Notebook Display rendering/selection owners.
Preserve existing exact web-anchor assertions and product behavior rather than
weakening an unrelated assertion to accept a new local span.

## Bounded proof to prepare after Build binding

Return the exact product/test delta and finite registration/import inventory
with pinned source/runtime/caller/output and cumulative counters before any
execution. The intended red will exercise the actual reported angle-local form
through the real formatter and fail on label/reference behavior. Green covers
angle-web and local /, ~/ and file: destinations with spaces/:line, parentheses
and escapes, the exact reported input, malformed boundaries, code/markup safety,
unchanged authored source/atomic mapping, and actual message/Notebook page/card
Display consumers. Existing plain/query-link and Notebook editing/selection
owners are controls. Retain actual native Node identities and strict process
observations; no discovery import, helper, test, parser control or browser has
run during this source intake.

Source/DOM event checks do not establish native pointer/hover/layout behavior.
Warp21165 and Fable21178 explicitly set Browser NONE for1178: real formatter and
real DeckPage handler checks on miniDOM are the requested proof, with title
equality establishing the complete hover text. This does not establish native
hover behavior. Keep every existing ui_message_format/ui_links assertion intact.
Build/source preparation and later bounded execution are separate Fable
dispositions. Current1178 starts and allowance are zero;1163 remains held
after1178, then1172, with1028 parked.
