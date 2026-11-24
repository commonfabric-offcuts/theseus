# A phone dossier keeps the person's scroll with a reply open (1173)

Tony20573 reports that scrolling toward the bottom of a dossier with an inline
reply open repeatedly jumps up and down; closing the reply with its x is his
escape. Warp20575/20576 assign this page-only repair to page-lane5 immediately
after 1151. Fable20596 filed 1173 and requested this source contract for Build
binding. No Core, database, schema or stored-draft format change belongs here.

Current preparation is on release 378, f861feae4aac30a4a41a56b0cfc86df7333e8923,
in a fresh worktree and branch after Warp20609 and the bound release read
confirmed it live. The earlier unexecuted 377 preparation is preserved in its
own worktree. HOLD20595 ended with that release; it supplies no test, fixture,
inventory-helper or browser allowance for this item. The 1151 source's two
roots are spent and are not this item's allowance. This item's actual
test/helper roots remain zero.

Read the existing owners before choosing a change: CardReplies.open/hide owns
the inline surface and its x; InlineComposer and the editor registry own its
draft; compose-bar.mjs owns the persistent visual-viewport reader and writing
reveal; reply-stacks.mjs records/restores moved card scroll boxes. One source
candidate is the reduced-keyboard viewport reader: an offset-only viewport
scroll can schedule revealWriting, whose scrollBy can move the page again.
That is an unverified candidate, not a reproduction or root-cause finding.

The bounded unit/DOM reproduction will exercise those real owners with an
inline reply inside a dossier at phone width. The initial geometry model is
390 by 844, with the existing 991 port's reduced viewport; it is an explicit
model, not physical-phone geometry or timing evidence. Record each person's
scroll position and each application write to the page's scroll owner, and
find the earliest write that does not belong to that scroll. Model a finite
sequence of downward scrolls and viewport signals, including continuation
after a queued adjustment, and require it to settle without oscillation.

Acceptance keeps the reply open with its exact draft while ordinary page
scrolling writes no corrective page scrollTop/scrollBy. Opening still reaches
the reply; x still closes through the existing draft-preserving owner.
Textarea-internal scroll and independent scrolling composers retain their own
owners. Existing keyboard resize, writing growth and genuine visual-pan
behavior covered by 838/991/993 are controls, not assertions to weaken merely
to make the new case pass. The first red must establish the disputed event
ordering before a product fix is applied.

Before any execution, return the exact proposed source/test bodies, finite
registration inventory and independent coverage review, cumulative roots,
runtime/caller/input pins and bounded preparation/red/green plan. Follow the
installed CASE-INVENTORY.md contract: pin and separately authorize its inert
helper invocation, retain a ready report before red and complete file/name
multiplicity reconciliation with green. Missing/extra identities, refusal,
incomplete output or an unexpected result stop to Warp without rerun/reset.

Fable grants runtime and binds the canonical Build piece. Warp reads the actual
diff/test evidence before one source commit/push; Fable freezes and Warp owns
the separately checked actual-current-base carry and landing. There is no
browser cell for this pair. Tony's phone checks the landed behavior; DOM ports
cannot establish native touch, keyboard, momentum, layout or timing behavior.
