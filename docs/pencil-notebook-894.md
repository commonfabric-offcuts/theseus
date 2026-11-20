# Notebook pages from the pencil sheet (894)

The topic pencil opens Message | Note card | Note page as one radio group. Message is chosen on each opening. Switching keeps the same writing and caret; arrow keys select and focus the next choice. Message sending is unchanged.

Note card creates a new page in this topic, using the first line as its title and the remaining lines as its words, serialized through the existing card writer. Note page uses the first line as the page title and preserves the remaining body. A blank title becomes Notebook page. Neither creation addresses or notifies anyone. Both create a new page, never append to an existing one. Message recipients, intent and image controls are hidden and unavailable in either Notebook mode; retained message attachments and recipients stay with the message draft.

NotebookStart in quick-create.mjs remains the sole memory.create envelope and confirmation owner used by the rail pencil and this sheet. It accepts an initial body and retains title, body, scope and operation identity together through uncertain answers. A changed writing cannot silently replace an uncertain request. The composer keeps a confirmed result until it is opened, so a late confirmation cannot create a second page on retry. While creating, writing and submission are disabled. Refusal retains the writing and shows its reason.

A confirmation clears only the exact submitted writing through the existing editor and save callback. A later version, cycle, presentation or sheet opening is never cleared or dismissed. A late result offers Open started page. Opening goes through openNotebook with an explicit view and beside request: dock beside the current feed when possible, otherwise use the full Notebook route. Cards starts with the first card picked; Text opens the body. Existing rail and ordinary Notebook openings retain their behavior.

Owners: InlineComposer owns the segmented controls and current presentation, WritingInput/editor/registry own writing and recovery, NotebookStart owns creation identity and result validation, deckBody owns card serialization, openNotebook/NotebookSheet/NotebookPage own navigation, layout and selection. No new command, store, notification path or retry scheduler is introduced.

Focused tests use actual owners with in-memory command and DOM adapters. They cover mode switching, requests and radio keys, refusal and exact retry, late results/newer writing, dock/full-page opening and the unchanged message path. These are not native phone, geometry or screen-reader evidence.
