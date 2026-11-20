# A Notebook held in another tab (849)

NotebookPage already shows the notebookStore failure through its existing
writingChanged/say status owner when Cards or Text opens. Keep that path.
A denied tab lock says: “This Notebook page is being written in another tab.
Close the page in the other tab, then reload this one, or keep reading here.”

While device writing is unavailable, card changes, Edit, New card and Undo
repeat that same attention notice through the existing status line before
returning. Their key and button handlers keep the existing mutation guards.
Reading, selection, folding and switching views remain available. Closing the
owner releases its lock; the existing reader stays read-only until reloaded.

The check uses actual NotebookPage, NotebookWriting and notebookStore with
bounded DOM, lock and storage adapters. It covers the opening notice in both
views, refused card keys and buttons, no writes or changed content, reading
navigation, and a fresh editable opening after the owner closes. Applied
mutants must fail assertions and exact restores must pass. This is handler
evidence, not native keyboard, focus, click or cross-tab arbitration proof.
No Core or schema change.
