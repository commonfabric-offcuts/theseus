#!/bin/bash
# post_dossier.sh RELEASE ITEM: posts <posts>/dossier-ITEM.txt as the dossier of RELEASE once the release record shows
# ITEM shipped in it, then reads the posted message back from the board.
# The request is saved before it is sent, as <posts>/release-RELEASE.post.txt, and goes under the operation id
# <seat>-dossier-RELEASE-ITEM. A run that dies after Core recorded the post, but before this script saw the answer, is
# finished by running it again: the saved request goes again, unchanged, under the same id, and Core answers with the
# message it recorded, so a recovery never posts twice (the CLI refuses a different request under that id).
# The message is then found by its id in the releases topic, read from the seq another release's read-back recorded
# (read_message.py; this release's own record would start after the message itself), and must be the seat's, in that topic, readable, with the whole saved text as its body.
# <posts>/release-RELEASE.id ("posted MESSAGE seq SEQ in TOPIC, read back") is written only from that read.
set -u
. "$(dirname "$0")/kit.sh"
N="$1"; ITEM="$2"; D=$(cfg posts) || exit 2; F="$D/dossier-$ITEM.txt"; TOPIC=$(cfg releases_topic); SEAT=$(cfg seat)
read -r -a AN <<< "$(cfg cli)"
SAVED="$D/release-$N.post.txt"
REC=$("${AN[@]}" releases --limit 20 2>&1 | /usr/bin/grep -E "^release $N ")
echo "$REC" | /usr/bin/grep -qE "shipped ([0-9]+, )*$ITEM(,|\$)" || { echo "record for $N not showing $ITEM yet: [$REC]"; exit 1; }
if [ -f "$SAVED" ]; then
  echo "sending the saved request $SAVED again, unchanged"
else
  [ -f "$F" ] || { echo "no dossier file $F for release $N (item $ITEM)"; exit 1; }
  sed "s/Release NNN is live/Release $N is live/" "$F" > "$SAVED.new"
  /usr/bin/grep -qE "_TO_FILL|LENS_RESULT|TBD" "$SAVED.new" && { echo "REFUSED: $F still holds a placeholder:"; /usr/bin/grep -nE "_TO_FILL|LENS_RESULT|TBD" "$SAVED.new"; rm -f "$SAVED.new"; exit 1; }
  mv "$SAVED.new" "$SAVED"
fi
REASON=$(head -1 "$SAVED" | sed -E 's/^@[a-z0-9-]+ //; s/^\*\*(.*)\*\*$/\1/; s/\.$//')
OUT=$("${AN[@]}" post "$TOPIC" --tells "$(cfg dossier_tells)" --divergence-reason "$REASON" --operation "$SEAT-dossier-$N-$ITEM" - < "$SAVED" 2>&1)
MID=$(echo "$OUT" | /usr/bin/grep -oE "^posted m-[0-9a-f]+" | head -1 | sed 's/^posted //')
[ -n "$MID" ] || { echo "$OUT" | tail -2; echo "STOP: the post answered with no message; run this again, which sends the saved request under the same operation"; exit 1; }
AFTER=$(for f in "$D"/release-*.id; do [ "$f" = "$D/release-$N.id" ] || cat "$f"; done 2>/dev/null | /usr/bin/grep -oE " seq [0-9]+ in $TOPIC," | awk '{print $2}' | sort -n | tail -1)
/usr/bin/python3 -I "$K/read_message.py" "$TOPIC" "$MID" "${AFTER:-0}" > "$D/release-$N.readback.json" 2>&1 || { cat "$D/release-$N.readback.json"; echo "STOP: posted $MID, but it did not read back; run this again"; exit 1; }
SEQ=$(/usr/bin/python3 -I - "$D/release-$N.readback.json" "$MID" "$TOPIC" "$SEAT" "$SAVED" <<'PY'
import json, sys
message = json.load(open(sys.argv[1]))
mid, topic, seat, saved = sys.argv[2:6]
text = open(saved, encoding='utf-8').read()
wrong = [what for what, same in (('id', message['id'] == mid), ('topic', message['topic_id'] == topic), ('author', message['author_id'] == seat),
                                 ('readable body', not message['withheld']), ('body', message['body'].rstrip('\n') == text.rstrip('\n'))) if not same]
if wrong:
    sys.exit('STOP: %s reads back with a different %s than the saved request' % (mid, ', '.join(wrong)))
print(message['seq'])
PY
) || { echo "$SEQ"; exit 1; }
echo "posted $MID seq $SEQ in $TOPIC, read back" | tee "$D/release-$N.id"
