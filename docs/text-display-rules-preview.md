# Text display rules — source-only preview contract

The approved preview contract is retained below. Its current frozen731
composition, DEFAULT OFF, base keeps and acceptance limits are recorded in
[768 preparation](text-display-768-preparation.md).

This implements Warp's draft at Text Display Rules, message 9118, and selection
copy clarification 9138/9139, menu correction 9149/9150/9155 and section 4
extension 9215/9217/9218 for Tony's preview only. It does not settle the
product questions left in that draft.

Message Markdown is read into blocks with mapped words. Top-level paragraphs
also receive sentence passages `{from, to}` in mapped-word offsets, using the
pointer light's current Intl.Segmenter (and its existing line fallback), with
boundaries inside protected inline spans joined. A display rule is a pure
blocks-to-blocks function. Each module exports its id, name, description and
apply function; `web/text-display-rules.mjs` lists the ordered rules.

Break out paragraphs partitions top-level paragraphs at those boundaries and
before inline enumerators: numbers or single letters ending in `)` or `.`,
including parenthesized forms such as `(a)`, preceded by whitespace and followed
by whitespace and a word. A leading enumerator stays with its words too; a
sentence boundary after its period cannot strand it. The existing inline span
reading protects links, code and emphasis, including nested marks. A following
word can itself be marked or linked. No punctuation-based guess replaces that
span reading. The rule does not require a sequence of matching enumerators.
Markdown list items keep their markers, task states and depths, with sentence
paragraphs drawn inside each item's words. Inline enumerators are a running-
paragraph rule; list items use sentence boundaries only. Quoted blocks and their
children, headings, fences, tables and images pass through unchanged.
Every mapped character belongs to exactly one output slice, including spaces,
line ends and CRLF source positions. No inline span is reparsed across a new
boundary. Paragraphs needing no changed boundary and protected block kinds keep
their identity.
Applying the rule again has no further effect. Card lights use the actual drawn
rule choice, as the Reader does; list items retain their existing whole-item
light. The registry checks each output
against the input's mapped partitions before drawing; a contract failure throws
instead of drawing changed words. Inputs are frozen before each rule so in-place
mutation cannot bypass that comparison. This guard supports protected paragraph
partitions and sentence partitions within otherwise intact list items. It checks
mapped slices and rejects boundaries inside the reading's protected spans.
Future joining or kind-changing rules need
an expanded guard and explicit source-gap representation. Source text and quote
passage ranges remain the authority, including whitespace the existing Reader
does not draw.

One switch per registered rule is off by default. Its device key includes the
instance and reader, never a topic or author. The existing message ⋯ menus on
cards and in the Reader expose the same one-line toggle. Switching redraws already drawn
message words from retained source and options, without a reload, a Core read,
or a writing/session repaint. Later card expansion also uses that choice.
Notebook reading and writing in progress do not opt in.

While a message is drawn with a rule on, native selection Copy uses the existing
quote projection (`Reader.selectedPassage` or `FeedPassages.selected`) at the
actual Range endpoints. It copies that exact body slice as plain text, retaining
original whitespace and covered Markdown syntax, including the existing atomic
named-link behavior. It adds no drawn paragraph separators and does not trim.
It never substitutes the whole body for a selected fragment. Off leaves native
selected Copy alone. Cross-message selections, writing, Notebook content,
lit-passage Copy, whole-message Copy and fence Copy retain their existing paths.
The copy event serves keyboard, browser-menu and touch Copy alike; no new key
binding or formatted clipboard projection is introduced.

Warp9149/9150 supersedes the original gear/reading-menu placement. The preview
adds no gear, Reading control or settings surface. Original HTML and phone
header layout are retained. The switch stays in the existing message menus;
no menu or engine behavior is claimed from source inspection.

After Tony's word, the draft calls for mapping, idempotence, protected-span,
mutation and native selection/quote/copy/persistence checks on both surfaces.
None are authored or run in this preview phase. Preview defaults, scope, names
and possible author opt-out remain Tony/Warp decisions. This document records
the implementation contract; it does not replace Warp's spec.
