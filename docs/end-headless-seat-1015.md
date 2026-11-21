# End a headless seat (1015)

Parent: approved1002 d4c0401bc9d9c80a0acc13f61e16eda2967e22e3,
schema64. Owner: core-lane8; medium Build2, piece p-95e8ab37f1ea4d899974485e.

The current human outcome owner chooses **End seat** in Team. This records
`workspace.hosted_seat_end`, target `{workspace_id, seat_request_id}`, empty
args, expected `{authority, seat_revision}`. CLI `seat-end OUTCOME SEAT_REQUEST`
uses the same command and saved operation recovery as Add/Retry. A lost answer
is unconfirmed: check the saved operation or retry its exact envelope, never
make a replacement request. A second End returns the current ending/ended
record without another external effect; stale first requests conflict.

Schema65 adds end intent to the original hosted_seats row, with the requesting
human, time, and version at which End was requested. The original setup state,
plan, thread, inviter, owner, first message and immutable event history remain.
Public seat state is `ending` until retirement and `ended` afterwards. Setup
stage is retained; `end_state` records the lifecycle explicitly. There is no
page-only End state. End cannot be undone with Continue, Retry or a same-name
Add; a new seat needs a different name and its own identity.

Recording End immediately fences future runner claims, setup advancement,
ready-route adoption and pin provisioning. Existing pending deliveries remain
in the record; they are neither acknowledged nor delivered again by this seat.
An already admitted native dispatch counts as the current turn. A running turn
keeps its profile and board access until it finishes normally.
End never sends turn/interrupt, never ends a shared child and never rewrites the
operator route map. The control’s recorded human owner can still explicitly Stop a runaway turn
while Ending. Continue cannot revive the seat. End never transfers that
existing control to another person.

The guarded runner reads a bounded, indexed page of ending seats independently
of setup and ready routes. For a known thread it reconciles the same native
context through the existing resume/last-turn path, never thread/start. An
active, uncertain, attaching or dispatching context remains Ending. Once native
idle is confirmed, the host retains that context until Core confirms retirement
with no open handed turn or claim. It then abandons the context by detaching its
in-memory route/bridge. Native history is retained;
End does not promise to erase or archive it. Failed/unknown native reconciliation
keeps the slot occupied and Ending, allowing a later runner to reconcile again.
A setup that never reached ready has never received a model turn: it can be
abandoned without replaying creation/injection. A late original creation answer
retains its thread ID for audit and cannot make an ended seat ready.

Final retirement is a guarded, versioned Core effect. It refuses a conflicting
pin or invalid bound control rather than deleting another route. Control identity
comes from its exact actor/authority binding, allowing a legitimate human owner
change before pinning while retaining the original seat audit identities. It removes only this recorded
seat's exact pin and control, appends an ended event and releases the instance
cap slot atomically. Ending retains its prior occupied slot until retirement.
Seat records, membership and original audit IDs are retained, including disabled
or departed seats through the exact scoped seat view. No identity is recycled.
The indexed End fence also applies to operator-map claims and future provisioning,
so restart, removal, disablement and stale route files cannot re-adopt the actor.
Other seats and their shared child continue normally. Existing Team membership
limit128 remains; End frees the separate instance cap8, retaining membership
and history rather than recycling the old identity.

Checks cover owner and revision refusals, exact/lost retries, idle and active
retirement, crash/restart, late setup answers, disabled/nonmember seats, history,
pin conflicts and cap reuse. Applied mutation controls must catch claim or
retirement-fence regressions and restore exact bytes. Process/app-server fixtures
are synthetic control evidence; native browser evidence uses isolated scratch
records and actual gestures, and is never described as a model reply.

An ending/ended operator-map entry is skipped without rewriting the map or
stopping peers, including when the retired actor is later disabled. A refused
End-context resume remains locally unconfirmed; it cannot pause the shared
runner. End retries use1,2,4,…30-second backoff and a successful native attach or
turn completion wakes them promptly. Repeated loop wakes and unchanged diagnostic
schedule reads do not create retry transactions. A later form/error or authority
notice permanently replaces the prior End notice; the seat’s own status row
continues following Core.
