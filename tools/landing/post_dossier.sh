#!/bin/bash
# post_dossier.sh RELEASE ITEM: posts <posts>/dossier-ITEM.txt as the dossier of RELEASE once the release record shows
# ITEM shipped in it, and records the message in <posts>/release-RELEASE.id only when the post succeeded; a second call
# for a posted release changes nothing.
set -u
. "$(dirname "$0")/kit.sh"
N="$1"; ITEM="$2"; D=$(cfg posts) || exit 2; F="$D/dossier-$ITEM.txt"
read -r -a AN <<< "$(cfg cli)"
[ -f "$F" ] || { echo "no dossier file $F for release $N (item $ITEM)"; exit 1; }
[ -s "$D/release-$N.id" ] && { echo "already posted $N: $(cat "$D/release-$N.id")"; exit 0; }
REC=$("${AN[@]}" releases --limit 20 2>&1 | /usr/bin/grep -E "^release $N ")
echo "$REC" | /usr/bin/grep -qE "shipped ([0-9]+, )*$ITEM(,|\$)" || { echo "record for $N not showing $ITEM yet: [$REC]"; exit 1; }
sed "s/Release NNN is live/Release $N is live/" "$F" > "$D/release-$N.post.txt"
/usr/bin/grep -qE "_TO_FILL|LENS_RESULT|TBD" "$D/release-$N.post.txt" && { echo "REFUSED: $F still holds a placeholder:"; /usr/bin/grep -nE "_TO_FILL|LENS_RESULT|TBD" "$D/release-$N.post.txt"; exit 1; }
REASON=$(head -1 "$D/release-$N.post.txt" | sed -E 's/^@[a-z0-9-]+ //; s/^\*\*(.*)\*\*$/\1/; s/\.$//')
OUT=$("${AN[@]}" post "$(cfg releases_topic)" --tells "$(cfg dossier_tells)" --divergence-reason "$REASON" - < "$D/release-$N.post.txt" 2>&1 | head -1)
echo "$OUT"
case "$OUT" in posted\ m-*) echo "$OUT" > "$D/release-$N.id";; *) exit 1;; esac
