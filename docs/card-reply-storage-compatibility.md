# Item 721 composition on actual104 — storage compatibility

This source-only composition retains the approved `web/journal.mjs` adapter:
new captures serialize a Blob to ArrayBuffer outside the transaction, store
`data` in the existing scoped `upload-bytes-v1` row, and reconstruct the logical
Blob on read. Existing Blob rows remain readable. There is no schema migration
or second byte store. The original approved behavior is in
[card-reply-preview.md](card-reply-preview.md).

Focused below-browser contracts in `tests/ui_721_composition.test.mjs` use the
actual journal adapter, a transactional IDB/Web Lock model, actual Uploads,
EditorRegistry, and isolated HTTP/Core. They import the exact actual104 journal
from `c1ac9d303d07e305ce421a503681127a9382a9e3` for the reverse direction;
Uploads is asserted byte-identical to that commit. This is not native IDB or
browser proof. Applied source mutants and raw results live with the coordinator's
composition report, not in this declaration.

Forward: an old Blob capture is adopted and read by the new adapter. A new
buffer capture survives adoption with exact image bytes, writing, caret,
source, actor, editor and destination. Scope, metadata, size, selection identity,
writer ownership, duplicate capture, binary metadata refusal and interruption
are checked. Publication retains the same operation and image identities.

Reverting to actual104 is **not a fully compatible storage rollback**. Its
actual `readBytes` rejects the new buffer row after adoption. Successful capture
has already released chooser memory. Both Uploads.bytes and preview fail;
publication cannot prepare that unpublished draft image, and there is no server
image to fetch. Writing and metadata remain. Explicit Remove permits a text-only
send. The buffer itself is retained, so returning to the new reader can recover
it. Old104's byte-release transaction also refuses this buffer: Remove does not
make Discard work under the old reader.

Already-published images remain in Core with their exact bytes and can be sent
and opened from a submitted message after revert. Frozen submission images,
the original send identity, and newer writing survive a lost committed-send
answer and reconciliation. A published image whose local byte pointer still
names a buffer has an unavailable local draft thumbnail under old104 because
preview tries that pointer before server media; this does not erase the published
image. Cleanup/discard of that retained buffer cannot be promised on old104.

Release qualification for root/auditor: reverting to actual104 makes newly
buffer-captured unpublished draft images unavailable to that reader, including
preview and further upload; retained local buffers cannot be discarded there.
Writing, submitted/frozen image references and already-published server images
are retained. Upgrade again or explicitly remove/reselect the draft image.
No redesign or silent Blob-storage substitution is included in this composition.

Native selection, physical touch handles, geometry/focus and engine IDB behavior
on the composed head remain unrun in this source-only phase. Historical approval
and evidence retain their exact source and input scope.
