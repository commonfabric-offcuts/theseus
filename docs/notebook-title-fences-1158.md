# Notebook card title fences (1158)

On release 376, a Notebook card in Display mode renders authored compact
backtick/tilde fences and inline backtick code through the existing formatter.
Fence payload is literal text, including HTML and URLs. There is no fence-copy
button in a title. The separate 1157 Copy card text/Add child controls and the
body's existing fence-copy controls retain their owners.

Other title characters stay literal: emphasis marks, links, heading marks,
escapes outside code and unmatched delimiters keep their previous appearance.
An empty title keeps Untitled. The existing parent chevron stays outside the
formatted words and keeps its handler. The Cards-only DeckPage keeps literal
titles; the Notebook override owns this change.

Display painting does not change saved title/body, issue commands, create an ID,
or change edit-mode text. Reading projection redraws the same title with its
confirmed revision and joins its source coordinates to the existing whole-card
projection. Interior code characters and whole-title selections retain their
raw source, including delimiters; repeated binding must not add offsets again.
The formatter's default literalWords behavior is unchanged; only Notebook title
calls opt in to fences. This adds no Core fact, schema change or HTML execution.

The unit plan has one exact old-code missing-fence assertion, then eight new
named cases plus the ten unchanged 1157 cases. All tests use isolated memory
ports, real Notebook/Deck painting, the shared formatter and NotebookWriting.
The DOM port proves tree/source mapping and handler ownership, not native
selection, layout, clipboard or timing. Warp20456 waives the browser cell.
Source on 376, an exact plan and Fable's separate grant precede any test root.
