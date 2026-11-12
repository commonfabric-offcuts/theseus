# One Notebook page, Text and Cards (302)

Text and Cards are two views of the same Notebook body, in one writing place.
Changing the view writes no revision and does not convert or normalize the
words. Existing Cards links still open Cards. The page's writing controls
offer both views; a new page starts ready to write.

Both views save while writing, including an unfinished card. Each confirmed
save is a normal `memory.revise` revision, immediately readable by agents.
The saving sign distinguishes a device copy, an in-flight save, a confirmed
revision, and writing that needs attention. The existing writing keys,
including Option-arrow line moves, remain available. Images and `#img` use
the page's topic (or its outcome's Conversation) and become page attachments.
There is no Cards view of a message draft.

Before sending, the browser retains the complete request and current writing
in a scoped device journal. A retry uses that exact request, including title,
attachments, references, expected revision, authority and operation identity.
A late confirmation advances the saved revision but cannot replace words
typed since. Reloading resumes an uncertain request before starting another.
One tab at a time owns this page's device journal; another tab may read it.
Separate devices use Core's existing revision comparison.

If another writer changes the page first, neither version is discarded or
silently overwritten. The editor keeps the local writing and offers the
latest saved page beside it. After reviewing, the person can save their
version against that exact latest revision or use the saved version. A
permission refusal also keeps the unsaved writing. Storage failure prevents
claiming a device copy or discarding the in-memory writing.

No Core command, schema, actor or Notebook ownership rule changes. Revisions
remain immutable; the device journal only retains unconfirmed work.
