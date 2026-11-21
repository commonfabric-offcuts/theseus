# Rail notices and their close box (1036)

The page's notice group uses rail typography and a small boxed × in each
notice's upper right corner. The button's accessible name/title is Close notice.
Named type default follows existing rail labels: .77rem for Compact on a fine
pointer above760px, .85rem for Roomy and phone/coarse layouts. Add/Retry/Reload
buttons inherit that size. The close glyph is small; its native button keeps a
44px touch target on phone/coarse input and a compact laptop target. Both
Bookends and Paper use their existing notice colours. No Core/audience change.

A closed notice stays closed for this page. Identity is the existing status
node for a static channel, or the sent-operation node for a mention notice.
Repeated paints, transient network changes, pending/failed Add and Retry
responses cannot reopen that identity. A later new page gets fresh notice
nodes and its own close state; no storage or global dismissal by words.
Closing hides only the notice; it never cancels the underlying work or changes
writing, delivery, recovery or Retry/Add operations. Mention dismissal retains
its existing dismissed-entry guard. Keyboard closing returns focus to the main
reading region when the closed button held focus; pointer closure does not
steal unrelated focus. Other notices and non-group inline/Reader lines keep
their own behavior.

## Every writer into the group at base311

- index.html creates app-status, wakes-status, updates-status and
  topic-navigation-status as direct children of page-notices.
- boot.js also writes app-status before any module can run, when the module
  graph fails. Its standalone inline fallback must retain Reload, offer the
  same labelled close, and remember that close across repeated graph errors.
- app-status is app.mjs status()/failed(), passed to page actions, including
  Question withdrawn. It uses lines.mjs showLine(). Its unreached-connection
  cases also repaint from api.heard callbacks inside lines.mjs.
- wakes-status is WakeLights.painted in app.mjs, from wakeLights.notice().
- updates-status is app.mjs updateStatus(): current/defer hides; retry,
  authority, forbidden, reconnect or manual renders words and the existing
  Retry updates/Review saved writing/Reconnect control as appropriate.
- topic-navigation-status is app.mjs openDestination(), stayedWhy() and
  updatedNotice(); lines.mjs writes it, including the existing Reload action.
- MentionNotices appends one dynamic notice per confirmed send operation,
  renders paged names, check-again/error, Add/pending/refused/added states,
  and currently its trailing Dismiss. All of those actions stay intact while
  the corner close replaces Dismiss.
- outcome-scope.mjs placeBrand() moves the SAME host between rail and main;
  moving it is not a new page and does not reset dismissals.901 retirement
  replaces page nodes; old callbacks must stay confined to their old nodes.

Use one shared notice finishing function, scoped to direct children of the
page-notices host. lines.mjs invokes it for every paint, including its contact
callbacks; explicit direct writers and MentionNotices invoke it after their
paint. The pre-module boot fallback cannot import a failed graph and therefore keeps
its own small page-local close guard. No MutationObserver, polling, timeout or
independent content model.
The helper preserves all existing controls and owns only the close button and
page-local hidden state. Inventory/wiring checks and native action cases must
hold all four static channels plus dynamic notices, not only mention rendering.

Retain actual pre-edit red, source-matched focused and importer checks,
applied close-state/render restoration where meaningful, and native Chrome
and installed-WebKit checks in isolated stores/origins/profiles with every
Browser.close/PID/profile/fixture EOFexit0/absence/port cleanup verified.
Phone widths and accessibility attributes do not claim physical Safari,
real screen-reader or performance acceptance. Fable owns classification and
canonical records; Warp owns one independent read and carry/landing.

Final full-file inventory correction: boot.js was outside the initial .mjs
search. Its missing close is separately retained as boot-red.txt (existing
five boot checks pass; the new sixth fails before the fallback edit). Its
small independent guard is necessary when no module can run. Native boot
proof blocks the actual app entry, verifies the inline boot's source hash,
then closes its real fallback and re-fires the same failed module event.
