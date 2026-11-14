# Copy fenced text in reading views

Requested by Tony, 13 November 2026. Work starts from ee7e51e6 in an isolated
worktree. Implement only after an independent adversarial review of this plan
has no blocking findings; repeat review after revisions. Review actual code
after implementation too.

## Contract

- Each Markdown fence in the Reader's source (message or Notebook revision),
  topic and outcome-conversation feed, Notebook card display/opening, and
  Notebook revision shown in place offers Copy. No control in textareas,
  contenteditable, message editing, Notebook Text mode or a card being edited.
- Copy only the displayed fence payload, not fence markers, info/language,
  quote prefixes, surrounding prose or UI. Preserve tabs, indentation, spaces,
  internal blank lines, Unicode and literal markup. Match the existing renderer:
  CRLF becomes LF; the line break separating the last payload line from the
  closing fence is not included. Empty fences copy the empty string. Full
  messages with an unclosed fence copy the payload through EOF.
- A truncated feed excerpt must never copy an incomplete fence. Parser metadata
  distinguishes a definitely closed fence from an open fence in a partial
  document. For partial input a closing line is trusted only if its terminating
  newline is present; a delimiter at the very end may be a cut-off prefix of
  a non-closing line. Unconfirmed fences show a noninteractive "Open message
  to copy" cue. Existing card hover/tap/keyboard expansion loads full text;
  Copy appears only once complete. No fetch belongs to the new control and
  no clipboard write occurs after fetching text.
- A compact top-right Copy affordance shows on mouse hover and keyboard focus;
  on touch/no-hover devices it is always visible with a 44px minimum target.
  Space and Enter activate a real button once. Copy must not open a Reader,
  select/edit/fold a card, quote a passage, send, or lose unsent writing.
- Show Copied only after the clipboard write resolves; show a short honest
  refusal with manual-select guidance on failure. No permission preflight,
  clipboard reads, hidden textarea focus tricks, or async work before writeText.
  Call the clipboard synchronously inside the native click/tap activation.
  HTTPS tailnet and localhost are the supported contexts. Keep normal text
  selection, native Copy and code horizontal scrolling intact.

## Implementation

1. In message-format.mjs mark fenced code separately from box-drawn tables,
   and mark whether a fence ends in truncated input. Keep original source
   offsets and the exact mapped code text. Add an opt-in copyFences option to
   formatWords/formatNodes/drawPassages, recursively carried into quotes.
   Enable only on the requested reading surfaces. Inline code and box tables
   receive no controls. PageHere keeps its existing linked source text, using
   the shared renderer only for fenced blocks (not its revision diff).
2. One fence-copy.mjs helper creates the control and clipboard behavior. Use
   an outer fence wrapper with the original mapped code as its own child and
   the control as a sibling outside the horizontal scroller. Reserve a small
   control lane so no payload is covered and hover never changes geometry.
   No innerHTML. Buttons have no DOM text: aria-label names the action and
  state, SVG paths draw copy/check/failure glyphs, and live feedback
   lives outside rendered words. Thus DeckPage.placeOf inputs (.textContent
   and Range.toString) keep their existing content. Test this in both engines,
   including clicking to edit words AFTER a fence before and after copying.
   Native selection/Copy/Select All must omit every control label. Keep the
   mapped code child and wrapper source boundaries so quotation still includes
   the full fence; controls have no mapped textual descendants.
   Announce results through a polite live region outside the message payload,
   within the active dialog when present. Async completion is tied to the
   pressed element/version; detached controls cannot update a replacement.
3. Feed messages keep their native button card. Each complete fence owns an
   external Copy button beside the feed list. CSS anchors position the glyph
   at its fence. When a browser resolves a fixed anchor against a different
   scroll origin, use the measured fence corner and follow scrolling, clipping
   and resizes. The message toolbar inserts external buttons in source order
   alongside existing links. Keyboard entry from the following card also
   reaches a trailing fence. Clipboard refusal feedback sits within the fence
   and offers the Reader as a recovery route for either pointer type.

4. Reader pointer lighting/focusing and DeckPage keyboard selection/editing
   must ignore copy controls, including modified clicks/Enter and Space.
   Normal Tab/Shift-Tab stays available, including Safari Option-Tab. No broad
   event suppression on the fence payload. Add a narrowly scoped shared
   fence-press guard: while a copy control is held, queue destructive paints
   of its host (latest per host). Release queued paints in a MessageChannel
   task after pointerup and its native click; flush on pointercancel or blur
   without copying. Also protect Space-down through keyup/native click.
   formatWords and drawPassages defer destructive replacement; DeckPage.paint
   defers replacement of its rows. Cover feed expansion, message revision
   repaint, notebook live repaint and Reader redraw. The control keeps the
   payload that was visible when pressed; clipboard writes still happen
   directly in click, never in the repaint queue. Ignore disconnected hosts,
   and do not update replacement controls from stale clipboard completion.
5. CSS uses existing theme tokens, focus-visible and capability media queries.
   Code scrolls within its own bounds; control stays at the visible right edge,
   does not create page overflow, stays clear of message toolbars, and works
   in light/dark and at narrow phone widths.

## Evidence

- Node tests: both fence markers, variable delimiter length, language/no
  language, empty/unclosed/quoted fences, CRLF/Unicode/whitespace, literal HTML,
  repeated blocks, partial fences versus closed fences before an excerpt ends,
  box tables and inline code excluded, source offsets/quote boundaries unchanged,
  no buttons without explicit opt-in. Clipboard resolve/reject/missing API,
  rapid retry, detached controls and stale completions.
- Native Chrome for Testing and Playwright WebKit against an isolated instance:
  each requested surface; pointer hover/focus and Tab in both directions;
  real click, Enter and Space; touch-context first tap (no preparatory tap),
  320/390px phone sizes; horizontal scrolling; text drag/select/copy/quote;
  a truncated feed loaded on hover/touch; card editing and Text mode exclusions;
  denied clipboard and repeated copy; navigation/repaint while pending.
  Hold a native pointer down over Copy and deliver each of feed expansion,
  message revision, notebook revision and Reader redraw before releasing;
  assert the original visible payload copies exactly once and no enclosing
  action fires. Also hold Space through a repaint, and cancel a touch press
  by scrolling to prove it neither copies nor leaves paints held.
- Separate stubbed API contract checks from actual clipboard proof. Include
  real browser writes and native paste into an isolated test field for exact
  round trips where the platform permits, without granting Chromium clipboard
  permissions that could hide lost activation. Record inability honestly.
- Run existing Markdown/source mapping unit checks and affected Reader, feed,
  notebook, stack and navigation checks. Capture screenshots, browser versions,
  failures and owned browser cleanup. One browser workload at a time.
- Publish an isolated preview for Tony to use on iPhone over HTTPS. Desktop
  WebKit with touch is not iOS Safari; actual phone paste/selection/keyboard
  behavior remains a named device check until exercised. No claim of phone
  verification based on emulation alone.
- Review the actual implementation, address findings, and push only this
  reviewed branch. Production deployment is a separate explicit action.

## Browser references

- https://webkit.org/blog/10855/async-clipboard-api/ (secure context and user
  gesture requirements, completion and overlapping writes).
- https://web.dev/articles/async-clipboard (writeText, failures, and WebKit's
  activation difference).

## Red-team rounds

Round 1: NOT PASS. Resolved three findings in this revision: only a terminated
closing line counts in partial input; non-text control labels protect Notebook
cursor mapping as well as Reader source mapping; explicit shared press
deferral protects destructive paints through the native click. Round 2: PASS, no blocking findings. Implementation authorized by Tony.

## Implementation review and preview feedback

- The first implementation review found a Tab-order regression, own-card glyph
  contrast, nested-quote minimum width, and press-guard listeners removed by
  in-place navigation. The revised implementation preserves native inline
  control order, uses the theme's paired tooltip colors, clamps fence width,
  and uses persistent shell listeners with queued paints discarded on navigation.
- Tony tried the first preview: Copy worked in the composer and feed. He
  requested a glyph rather than a word button, and showed a Notebook card
  written as an opening fence immediately followed by a Discord URL, then a
  closing fence on the next line. The parser now treats an opener whose info
  begins http:// or https:// as same-line payload, keeping its entire remainder
  and any following payload lines. Other language/info syntax is unchanged.
  The reviewer approved this narrow parsing extension and the SVG glyph design.
- The button has an accessible name and tooltip, no textual DOM descendants,
  and copy/check/failure glyphs. Clipboard state remains separately testable;
  controls never become part of native Copy or Notebook cursor mapping.

## Newline placement in fences

Tony's second preview showed three related cases: a one-line triple-backtick
pair had no Copy, a closing fence attached to the payload remained visible,
and `hixie URL` on the opening line disappeared when the closer was on the
next line. The parser now accepts a matching terminal closing run on the
opening line or after payload on a later line. All four arrangements of the
line breaks immediately after/before the fences display and copy the payload.
Trailing payload spaces remain; only a separate closing line loses its
separating newline. Shorter marker runs inside longer fences remain literal.
Single/double inline backticks and a compact pair followed by prose retain
their inline behavior.

Normal multiline info (including `py title`) remains metadata when a payload
line follows. An opening remainder containing an HTTP(S) URL is payload, also
when more lines follow. When a nonempty opening remainder is followed
immediately by a standalone closer, the remainder is payload: `python` in
that shape is displayed, not an invisible empty language block. An explicit
blank payload line keeps an intentionally empty language block. This bounded
ambiguity is intentional so one-word fenced text does not disappear.

The red team rejected treating every multiword opening remainder as payload
because it would break existing language/info syntax. The bounded rule above
passed review before implementation. Node tests cover all four arrangements
for arbitrary text and URLs, quotes, CRLF, whitespace, language metadata,
empty blocks, source positions and partial excerpts. Browser checks exercise
the reported arrangements in every requested surface, on desktop and touch.

The final screenshot check caught a second parser in Notebook card/stack
splitting: it did not recognize compact closures and could absorb the next
card. Both parsers now use the pure helpers in fences.mjs. Notebook detection
normalizes CRLF without changing source slices, and tests assert separate
cards, protected stack links, and exact roundtrips. The red team approved
this shared-parser plan before implementation.
