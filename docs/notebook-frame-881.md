# Notebook frame (881)

The whole Notebook dialog uses the dossier cover's existing inset shadow and
sheet radius tokens: `--stack-cover-inset` and `--stack-r-sheet`. The common
open-dialog rule serves the docked and full-screen layouts. Geometry, content,
writing, controls and docking behavior retain their existing owners.

The inset has explicit light/dark definitions in `stack-look.css`; the radius
is shared between schemes. No shadow or radius value is copied into the frame.
Full screen uses the same frame as the named default from Tony12021/Warp12022.

The focused881 Node source contract fails on actual158 before this change.
It applies the relevant source declarations by media, specificity and source
order to the real NotebookSheet fixture's docked/modal class transitions,
including the phone dialog radius override. This bounded cascade check is not
browser rendering, native gesture, screenshot or physical-device evidence.
