#!/bin/bash
# post_dossier.sh RELEASE ITEM: posts <posts>/dossier-ITEM.txt as the dossier of RELEASE once the release record shows
# ITEM shipped in it. The post carries the operation id <seat>-dossier-RELEASE-ITEM. A run that dies after Core recorded
# the post, but before this script saw the answer, is finished by running it again: the same request goes under the
# same id and Core answers with the message it recorded, so a recovery never posts twice (a changed dossier is a
# different request, which the CLI refuses under that id). The message is then read back from the board, and
# <posts>/release-RELEASE.id is written only from that read.
set -u
. "$(dirname "$0")/kit.sh"
N="$1"; ITEM="$2"; D=$(cfg posts) || exit 2; F="$D/dossier-$ITEM.txt"; TOPIC=$(cfg releases_topic); SEAT=$(cfg seat)
read -r -a AN <<< "$(cfg cli)"
[ -f "$F" ] || { echo "no dossier file $F for release $N (item $ITEM)"; exit 1; }
REC=$("${AN[@]}" releases --limit 20 2>&1 | /usr/bin/grep -E "^release $N ")
echo "$REC" | /usr/bin/grep -qE "shipped ([0-9]+, )*$ITEM(,|\$)" || { echo "record for $N not showing $ITEM yet: [$REC]"; exit 1; }
sed "s/Release NNN is live/Release $N is live/" "$F" > "$D/release-$N.post.txt"
/usr/bin/grep -qE "_TO_FILL|LENS_RESULT|TBD" "$D/release-$N.post.txt" && { echo "REFUSED: $F still holds a placeholder:"; /usr/bin/grep -nE "_TO_FILL|LENS_RESULT|TBD" "$D/release-$N.post.txt"; exit 1; }
REASON=$(head -1 "$D/release-$N.post.txt" | sed -E 's/^@[a-z0-9-]+ //; s/^\*\*(.*)\*\*$/\1/; s/\.$//')
OUT=$("${AN[@]}" post "$TOPIC" --tells "$(cfg dossier_tells)" --divergence-reason "$REASON" --operation "$SEAT-dossier-$N-$ITEM" - < "$D/release-$N.post.txt" 2>&1)
MID=$(echo "$OUT" | /usr/bin/grep -oE "^posted m-[0-9a-f]+" | head -1 | sed 's/^posted //')
[ -n "$MID" ] || { echo "$OUT" | tail -2; echo "STOP: the post answered with no message; run this again, which sends the same operation"; exit 1; }
"${AN[@]}" --json read "$TOPIC" --limit 50 > "$D/release-$N.readback.jsonl" 2>&1 || { echo "STOP: posted $MID, but the read-back failed; run this again"; exit 1; }
/usr/bin/python3 -I - "$K" "$D/release-$N.readback.jsonl" "$MID" "$SEAT" "$D/release-$N.post.txt" <<'PY' || exit 1
import json, sys
sys.path.insert(0, sys.argv[1])
import decisions
rows = [json.loads(line) for line in open(sys.argv[2]) if line.strip()]
message = decisions.message_from_read(rows, sys.argv[3])
first = open(sys.argv[5]).read().split('\n')[0]
if not message or message['author_id'] != sys.argv[4] or message['body'].split('\n')[0] != first:
    sys.exit('STOP: %s is not on the board as %s\'s dossier' % (sys.argv[3], sys.argv[4]))
PY
echo "posted $MID in $TOPIC, read back" | tee "$D/release-$N.id"
