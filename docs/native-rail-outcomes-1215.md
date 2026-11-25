# Native rail outcomes (1215)

Tests only, through the existing `rail_more_topics_982_native.mjs` and
`notebook_delete_1051_native.mjs` entry points. Existing cases remain in place.
The shared fixture helper runs its independent contexts before older cases,
so an older prerequisite failure cannot hide these new outcomes.

The archive cases use native pointer hover and browser wheel input over an
exact dossier head. Vertical scrolling preserves the pointer reveal and both
dossiers' Core state. A horizontal wheel gesture archives only the intended
dossier, with a committed `stack.aside` receipt, and clears the reveal latch.
Both Bookends/Paper and light/dark run at a fine-pointer desktop size. This is
browser input, not a physical trackpad or finger-touchend claim.

The Delete cases start with an unopened topic Notebook page and closed sheet.
Both the left outline's starred page and the right Notebook rail entry run in
Bookends/Paper. Native right-click or Shift-F10 opens the menu; one native click
on Delete must reach the real page owner. Observe the exact `memory.delete`
operation, committed Core deletion, matching IndexedDB `deletions` undo record
and closed sheet. Native Command-Z must commit one inverse operation, reopen
the exact page and restore its title/body/owner scope. The persisted undo record,
not a retired notice's words, is the deletion oracle. Star is a real menu action
used only to prepare the left entry; it must leave the sheet unopened.
The fresh device uses the current Cards default. No text edit, finger gesture
or physical hardware behavior is inferred from these desktop cases.

| Interaction | Named outcome evidence |
| --- | --- |
| Pointer hover at the fade | Revealed latch before wheel input |
| Vertical scroll over dossier head | Reveal and both Core dossiers preserved |
| Horizontal wheel over exact dossier head | Trusted target, committed archive, independent Core truth, reveal cleared |
| Right-click on Notebook row | Right entry menu; left entry's preparatory Star |
| Focus and Shift-F10 | Left entry menu while sheet remains unopened |
| One Delete click | One exact operation, committed journal and closed sheet |
| Immediate Command-Z at returned focus | One inverse and exact restored writing; no intervening focus change |

The finalizer also retains the post-input journal and actual focus on failure.
Versioned `/b/.../MODULE` responses retain their full URL and original bytes;
each successful case requires its relevant owner files, so an empty capture
cannot pass. A failing path retains its captures for independent hash checking.

Each case saves reached assertions, original served owner bytes/hashes, native
event observations, operation/record IDs and independent Core reads. No test
calls a product event handler, action callback, delete owner or undo method.
Read-only DOM/IndexedDB inspection is explicitly observational. The containing
harness owns Browser.close, fixture exit and PID/profile/port cleanup. Failed
cases and older barriers stay in the raw results. Isolated temporary product
mutations establish that the new outcome assertions detect the omitted act;
they are restored and never shipped.

Own proof is the two complete unfiltered native files and the helper's static
syntax check. Importing/source-reading consumers are discovered before handoff;
run directly named complete consumers under the current rule. Product bytes
are unchanged. Compare on actual live source with identical test overlays and
retain any inherited failures separately from these new reached assertions.
In particular, completion of the process is not a claim that older cases behind
a More/Done setup barrier or a stale menu-label assertion ran their later bodies.
