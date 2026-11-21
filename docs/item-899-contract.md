# Choosing an outcome coordinator

An outcome's + Add popover contains Coordinator above Invite. It shows the
current team name, or Nobody. Opening the row offers the current team names,
using the existing disambiguation, plus Nobody. A choice sends immediately,
without confirmation; another choice can change it back. Nobody sends null.

Every team member may open this row, as Core permits. Adding/removing members
and Invite retain their existing management permissions. Nonmembers are not
coordinator choices; invite them first. The existing regular-member test which
said + Add was absent deliberately changes to present for this capability.
Its initially closed popover, no-remove and purpose-permission assertions stay.

workspace.coordinator_set remains the sole durable owner. The page sends the
viewed workspace revision and current authority through the existing command
adapter, once per pick, with no automatic conflict retry. Busy picks send
nothing extra. An uncertain retry keeps its exact operation; it is never
represented as confirmed success. A refused or failed change says why and
rereads the actual outcome/team. A failed reread is also visible. The page
never optimistically labels the selected candidate as the coordinator.

The current page and choice own their asynchronous result: an older command or
read cannot paint a replacement page or overwrite a newer choice. Existing
workspace/outcome change events refresh open outcome and topic pages through
their existing owners. No new durable cache or authority rule is introduced.

The existing + Add dismissal owner keeps the popover. Coordinator choices are
real buttons reached by the list's handlers; Escape closes the coordinator
list and returns to its row. Closing + Add closes that list too. No pixel
position or native pointer, keyboard, layout or timing claim follows from the
bounded in-memory Node checks. Native starts used 0, allocated 0; 18 remain
unallocated. No Core/store/HTTP/server/browser/hosted/whole-suite runtime.
