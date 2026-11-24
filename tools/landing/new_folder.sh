#!/bin/bash
# new_folder.sh ITEM: makes this seat's landing folder for ITEM (<work>/ITEM-land) and records the kit it is made with
# (INPUTS.json, which check_inputs.py holds every landing step to). SPEC.json starts with what the seat's config fills
# (items, wt, guard, kind); the item's own fields (piece, topic, release, title, review, review_head, approved_head,
# pr) are null until written, and carry_ordinary.sh refuses until they are. Refuses when the folder exists.
set -u
. "$(dirname "$0")/kit.sh"
ITEM="$1"; WORK=$(cfg work) || exit 2; F="$WORK/$ITEM-land"
[ -e "$F" ] && { echo "STOP: $F exists"; exit 2; }
mkdir -p "$F" || exit 2
/usr/bin/python3 -I "$K/check_inputs.py" --record "$F" || exit 2
/usr/bin/python3 -I - "$F/SPEC.json" "$ITEM" "$(cfg worktrees)/$(cfg seat)-land-$ITEM" "$(cfg guard)" <<'PY' || exit 2
import json, sys
path, item, wt, guard = sys.argv[1:5]
spec = {'items': [int(item)], 'wt': wt, 'guard': guard, 'kind': 'ordinary'}
spec.update({k: None for k in ('piece', 'topic', 'release', 'title', 'review', 'review_head', 'approved_head', 'pr')})
open(path, 'w').write(json.dumps(spec, indent=1) + '\n')
PY
echo "made $F: fill SPEC.json's null fields and write MERGE-BODY.txt (or let carry_ordinary.sh write it from the review)"
