# A Reader answer closes after success

Go ahead and Don't on the Reader's message, and those offered for linked
Waiting on you entries in its dossier cover, close that same Reader only after
the existing action owner reports a committed receipt. A null/pending result,
refusal or failure keeps it open with the existing notice. A later answer must
not close a different Reader or presentation.

This reverses item 860's writing-stays-open default for these Reader action
buttons only. Feed-card decisions and cover answers keep their current action.
Reader thumbs already close after a committed positive thumb; withdrawal keeps
it open. Cover links and waiting labels remain navigation, not answer actions.

Closing delegates to Reader.close and the page's existing callback to
EditorRegistry.close/keepLocal. Exact unsent writing, destination, caret and
attachments are kept before the Reader closes. A local-save or image-choice
refusal leaves the Reader open; no second session, save or close owner is added.

The contract is checked through real app, Reactions, Reader and registry owners
with in-memory adapters, first red on release170. Native focus and browser
behavior are not proved by these checks.
