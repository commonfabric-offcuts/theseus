# Ask when someone is named

Item 848 changes the page default in `whisper-choice.mjs` `defaultChoice`.
With named recipients and no explicit choice, writing shows and sends Ask.
This includes a leading @name and the recipient offered for a reply, in the
Reader and the inline composer, and writing moved into the conversation.
With nobody named it is Send. A reply to a whisper with its one agent named
stays Whisper. Explicit Tell, Ask and Whisper choices keep their meaning.
Adding a second name to a held whisper still makes it Tell and says so;
removing that name restores Whisper. Removing every name clears the choice.

The who chip, audience sentence and button all read the shared choice. Both
composers make it explicit before freezing the send. No Core, CLI, schema,
record or backfill change: existing human Ask handling owns the wait. An
undecided saved/recovered draft uses the new default when next shown; a saved
explicit choice and the historic private-draft interpretation stay intact.

Checks use the real choice painter and the Reader/InlineComposer send methods
with Editor.beginPrepare, holding the outgoing intent, privacy, exact body
and recipients. Existing controls retain chosen Tell/Whisper, no recipient,
whisper replies, multiple recipients, human recipients, read-only chips,
choice keys, conversation transfer and the private saved-quote path. The
inline fixture's first draft used the wrong member shape; its corrected red
run fails an assertion on `tell` versus `ask`, as the Reader check does.

These are focused Node checks with a small DOM, not native browser gestures
or server wait acceptance. No local browser, preview or full suite was run.
