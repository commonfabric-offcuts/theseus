# Move selected card writing into a new card (1075)

Pre-edit contract for Page5's assignment17878, canonical Build1
`p-c2f6c3b088fd4a048649c654` confirmed by Fable17881. This separate own
worktree/branch starts at actual live353
`488381d2de0becb68d2adab48f02bf9862b516ea`, tree
`31f23fc8f9e8773fae4dc4c33524716264836e9e`, schema66. The intake manifest
binds all1757 original tracked files; the accompanying archive retains the13
initially read owner, contract and protection-test bodies. It is not a claim
that every runtime input has already been traced.1059fd342774 and train354
remain unchanged.

In a Notebook card editor, Command-Return with a nonempty selection moves
that exact UTF-16 textarea range into a new card below the source. The source
keeps the concatenation of its unselected prefix and suffix; the new editor
holds the selected text and owns the caret. A reversed selection moves the
same range. Without a selection, today's finish-and-open-empty-card behavior
stays with its existing owner. Shift-Command-Return, Option-Return, ordinary
Return, composition keys and inputs outside that card retain their meanings.

The structural change is one model act through the existing NotebookWriting
revision/receipt stream and one inverse act, not an edit followed by a
separately saved add. Immediate Undo must restore both cards/order and the
source text as one step, including while the new editor has no local typing
to undo. Subsequent typing keeps1073's ordinary local text history. Existing
read-only, device ownership, unavailable writing, conflict and uncertain-save
replay fences apply. No new durable card identity, preference, Core command
or schema is presumed.

Original owners read before construction: DeckPage.key/writeNext/start,
finish/act and serialization; NotebookPage.key/open/finish/save/previewBody;
NotebookWriting's content/receipt stream; NotebookEditHistory's editor
lifetime; card metadata/text projection and existing866/1073/1074 checks.
Current writeNext ignores the selection, finishes the source unchanged and
opens an empty editor after its child group. The existing `split` model act
is specifically the inverse of a merge, not selected-text extraction.

Warp17885/17889 ruled both product edges, and Fable17886 recorded these as
the shipping defaults. They supersede the proposals in publication17883:

- The new editor opens with the exact selected string. Saving follows ordinary
  card serialization, as if that text had been typed into the new card:
  headings and surrounding/trailing whitespace normalize. This is not
  lossless saved/reopened text. A whitespace-only selection takes the existing
  no-selection path; that act creates no saved whitespace-only card.
- "Directly below" is the next sibling at the source's depth, after its
  intact child group. Children keep their parent. A whole-text selection does
  not remove the source: its current title remains with its children. Ordinary
  manual empty-edit removal remains separate.

The structural model act replaces one exact source/children region and keeps
the inverse region in the bounded, in-memory Undo stack. Undo refuses a changed
region instead of consuming new writing, while unrelated cards outside it are
preserved. The act binds the source's card position and the page's existing
title/depth/identity shape. Concurrent structural changes refuse the inverse
instead of searching for a surviving duplicate; unrelated body edits outside
the region remain compatible. These are ephemeral Undo facts, not new durable
identities. The new card uses the existing fresh editor/preview until Done;
normalizing that editor into the deck must not add a second Undo step. Immediate
Command-Z at that new editor's empty local history reaches the split inverse;
new typing first uses1073's own local text history.

Evidence plan: retain actual353 named selection/no-selection semantic cases,
corrected results, entire relevant old owners applied, exact restoration,
source maps and direct exits. Model/handler adapters are semantic evidence,
not native keys, focus or timing. Required Chrome/WebKit cases use real page
selection, key input, new-card text/order/caret, exact saved receipt path,
one-step Undo and the no-selection control. Preserve every failure and name
any inherited controls and limits. No native/browser/HTTP launch is admitted
while Page6/1101 owns INUSE17868; later launch needs actual clean FREE,
coordinator admission, fresh checks and Page5's own INUSE. No product edit or
native run is claimed by this pre-edit contract.
