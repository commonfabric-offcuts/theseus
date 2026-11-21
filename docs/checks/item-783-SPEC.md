# Item 783 verification SPEC

Owner: fresh Codex builder 783-tests9806. Approved product source:
ceb3c02b8c664ae109acb740ced20e679e8c1982 (warp/preview-001), ordered
parent 47be586c (cover first), following 85147119 (pre-change).
Tony's 9803/9804 and Warp's 9806 authorize tests of this existing preview.
The supplied pipeline 783-read9810.json and RULINGS-preview-tests9810.json,
AGENTS.md, VISION.md and experience-guidelines.md were read before editing.
No product edits, new preview gate, title parsing, live records or credentials.

## Behavior and scope

A named dossier's cover is its first child, visually below its name tab and
above its first message, in both open and folded/latest-and-unread states.
Its background equals its folder's computed background, with the approved
subtle inset shadow in both themes. No outer raised shadow is accepted.
Ordinary human-participating dossiers must exercise their actual toggle
states rather than leave an agent-only dossier in its quiet head state.
The literal stands, waits, default and payload words are preserved; the
payload citation reaches its message in feed and Reader. A singleton keeps
pills under its author, and the Reader cover stays above its message.
Chronology, message sequence, folder order, author colors, stars and private
admission are unchanged. Fixtures use synthetic actors and isolated records.

## Cases and gestures

Only literal prefix `^reading item 783` is owned. Eight matrix cases cover
1280/390/375/320 CSS px, light/dark, native pointer on laptop and native touch
on phones. Each seeds the same meaningful dossier shape with a human reply,
both human and agent roots, read and unread replies, cover with punctuation/literal words,
a singleton and a private message outside the viewer's admission. Cases
read Core back, name the dossier through Core, and press the visible fold
control through actual states. Laptop additionally toggles with Return, traverses Tab to a cover
citation and activates Return; phone taps the citation. Reader summary is
pressed, literal contents and position checked, and screenshots retained for
folded/open/Reader states. Native keyboard traversal never calls focus().
One additional case compares whole coherent pre-change and flat-cover Builds,
then applies wrong-order, wrong-background and outer-shadow source mutants
as separate coherent Builds; candidate bytes/CSP must restore in finally.
Every new page closes before a build swap. No DOM style changes stand in for
source mutants. Exact source receipts include all files of each Build.

## Measurement and adversarial controls

The same exported page-expression generators and assertion helpers are used
in local controls and native cases. Every generated expression is compiled
and executed below browser against a deliberate page model before freeze.
Geometry tolerance is 1 CSS px for tab/cover/message order and containment,
1 CSS px for horizontal overflow, and >0.5 CSS px for visible boxes.
Negative controls cross each tolerance by at least 1 px; wrong DOM order,
missing content, wrong folder color, absent inset and raised shadow fail.
Local focused Node checks run with concurrency 1. Source controls apply
actual file mutations, assert a changed SHA, observe the specific check fail,
restore exact bytes, and run the restored control. Python uses CPython 3.9;
any Python mutation/control gets its own effective PYTHONPYCACHEPREFIX.
Whole original/flat web fixtures come from git archives, with archive and
per-public-file SHA256 manifests. They are complete Builds, not mixed files.

## Execution and evidence

Zero previous native starts; two allocated calls total, serial on one clean
frozen commit: native-reading then native-webkit-reading. Dry enumeration
must return only nine owned names per engine before either start. Use the
configured native-case broker only, one run each, no retry, no other Pool
request, local server/browser or full suite. Read the first final raw receipt
before spending the second. If a genuine own product defect is demonstrated,
stop and return it for coordinator disposition before another native call.
Sixteen calls remain unallocated. Preserve every raw failure and history.
Capture all tracked source hashes and the new helpers in both native source
captures, engine versions, fixture exit, page cleanup and Browser.close proof.
No signals are authorized by this verification work.

## Composition obligation: actual99 cover LF

This frozen preview derives from schema/base98. Later integration with actual99
must explicitly verify the updated cover LF behavior: literal line breaks in
stands, waits/defaults and payload survive Core, feed cover, Reader cover,
fold transitions and updates at all four widths in both themes and engines.
Passing this isolated base98 preview does not prove that composition. No
actual99 result is claimed here; carry this named obligation to integration.

## Delivery

Return whole SPEC and REPORT, frozen head/tree/ordered parents, full binary
diff from approved source, all-source and evidence SHA256 manifests, raw
receipts/counts/unrun cases and native cleanup. Independent review is next;
this builder does not self-approve, land, push, publish, install or deploy.
