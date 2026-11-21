# Docked Cards have their own ground

In both themes, the Cards viewer docked beside the feed has a black ground
and near-black default card faces, with white words and legible muted/action
colors. The sheet header, Text view and full-page Cards keep their theme.
No dimensions, layout rules, writing or menu owners change.

Warp13246 preserves explicit Set color faces. Those cards retain the theme's
ink and action colors so their chosen light/dark face stays legible; only an
uncolored face takes the near-black default. Checks cover every palette color.

A docked Notebook page marked Draft gives its cards the existing whisper border
style (`dashed` in the shipped CSS); clearing Draft returns the solid border.
The existing `notebook-drafted` class owns that presentation, with no new state.

Computed-style checks run the real NotebookSheet, NotebookPage and writer in
isolated headless Chrome for Testing. Views/commands are memory fixture ports;
the actual browser supplies DOM, CSS and isolated device storage. They measure
black/near-black colors, text contrast (at least 4.5:1), control/outline contrast,
draft on/off and unchanged theme surfaces/layout against the base stylesheet.
They do not claim a live-server or real-account test.
