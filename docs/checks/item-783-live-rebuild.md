# 783 on current live

Tony's Ship now instruction (11224, Warp11225) replaces the earlier preview and
native-call gates. Rebuild on the current release, add no quick-check failures,
have Warp read the frozen source, and ship one piece for Tony to try live. This
port starts from the preserved product at 930eef781b0a28ba785ec3f718e31ee0903bc7dd
and is rebased on release 123, bc3011956c10802c8488e5ff8d87884ffab13fae.

The cover is under the dossier tab, above its first message, open or closed.
Its background is the folder's own color in both themes, with a subtle inset
shadow. Keep current 799/803 singleton folders and their one cover sheet; do
not restore the older singleton-pills behavior. Keep cover refresh, Reader
placement, inline replies and the arrival hold. There is no record/schema
change. Adjacent message faces overlap as before when the cover precedes them.

Quick evidence is in the auditor evidence directory, prefixed `783-`:

- Existing dossier cover, inline wiring, stack position/order and renderer checks
  compare actual live with the candidate. On release 122 these are 271/271 and
  279/279 with the eight retained 783 oracle/comparator checks added.
  Final release-123 comparison also includes the arrival-hold checks: live
  301/301, candidate 309/309. The Core preflight passes again on that base.
- The strengthened real-renderer checks cover ordinary folders, lone replies,
  More/root arrival, text edits and cover rewrites. Both fail on the actual
  release-122 renderer and pass after restoring the candidate.
- Six complete-Build source controls (original, flat, wrong order, wrong
  background, outer shadow, restored) execute actual renderer code below a
  browser. Each applies its mutation and checks restoration; each Python phase
  and its restored control has an isolated cache. Geometry is a deliberate
  model, not a measured layout.
- The retained Core preflight passes 17 isolated scenarios, 545 controls, and
  checks actual feed/Reader text, newlines, updates/restoration and singleton
  placement. It opens no HTTP server or browser.

The historical SPECs, native sources and comparison Builds are retained as
evidence. They are not current browser acceptance. The old native singleton
oracle predates 799/803 and needs reconciliation before any future browser run.
No preview, browser, full suite or CI ran for this rebuild.

## Earlier failures remain literal

Fable11240 supplies the later packet at
`fable-tools/checks/783-native10053/REPORT.md` (SHA256
`920b890194722f3f46cd43a4f6762af9ffe84bb5423604a08a8c4094af5237fb`).
The original run was Chromium 1/9: eight cases failed whole-record equality
after the same case required two cover writes. The shown differences include
revision 1 to 3 and the act watermark advancing twice. This proves that exact
whole-record equality conflicts with those writes; the truncated assertion
values cannot exclude other undisplayed differences. The ninth complete-Build
comparison passed. Agent-root iterations and WebKit were unrun. Historical
0/9 on both engines and 8/9 on both engines also remain unchanged. There have
been five native starts in total; none is resumed here. No independent
no-product-fault ruling or browser clearance is claimed.
