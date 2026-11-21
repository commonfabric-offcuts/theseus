# Retained receipt parser fixtures

These bytes make the 734 parser and refusal tests portable. They are historical
test evidence, not a new native execution, a source approval, or release clearance.

`manifest.json` binds every uncompressed object by SHA256 and length. Large text
objects are gzip encoded without changing the retained bytes; the manifest also
binds their compressed bytes. The two genuine 651 and corrected 652 Pool ZIPs are
kept byte for byte, including the 652 red. The API snapshots, raw reports, stdout,
snapshot records and expected inventories are retained separately. Publication
clock variants and family positive controls remain explicitly synthetic in tests.

The 649/656 replay fixtures contain exact selected members from the named original
ZIP digests. They are parser inputs, not repackaged authenticated ZIPs. Original
Notebook/reading/rail reports remain red and their failures are still asserted.

The Git pack contains original commit ancestry and the complete selected source
trees. Tests unpack it into a temporary bare repository and retain the exact
commit, tree, source and mode assertions. No local repository object, private
folder, environment variable, network fetch or historical branch is required.

`tests/own_receipt_fixtures.py` verifies the bytes and relocates only artifact
reference paths into temporary test files, recomputing references to the relocated
documents. The original documents and their hashes remain in this fixture. Raw
artifacts and API facts are not rewritten by relocation.
