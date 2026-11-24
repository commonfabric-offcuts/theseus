#!/bin/bash
# carry_ordinary.sh ITEM APPROVED_HEAD LIVE BRANCH [PR]
# Carries an approved ordinary head onto the live commit: merges LIVE into the head in the landing folder's worktree
# (SPEC wt), refuses on a conflict, pushes the carry to BRANCH (the PR's head branch), and fills SPEC.json (source,
# tree, base, carry, files; pr when given). Then it runs the landing's preflight, so a file the landing may not change
# refuses in seconds. The piece's own tests are the caller's to run on the carry before landing.
# Exit 0: carried and the preflight passed. 2: refused before the carry. 3: a conflict, or the SPEC or merge body
# refused. 4: the push was refused. 5: carried, but the preflight refused (its whole output is <folder>/carry-preflight.out).
set +e
. "$(dirname "$0")/kit.sh"
ITEM="$1"; HEAD="$2"; LIVE="$3"; BR="$4"; PR="${5:-}"
F="$(cfg work)/$ITEM-land"; REMOTE=$(cfg remote); RB=$(cfg release_branch); CLONE=$(cfg clone); SEAT=$(cfg seat)
[ -f "$F/SPEC.json" ] || { echo "STOP: no $F/SPEC.json; make the folder with new_folder.sh"; exit 2; }
# Every field land.py reads that this script does not fill, checked here so a missing one stops the carry, not a landing.
/usr/bin/python3 -I - "$F/SPEC.json" "$HEAD" <<'PY' || exit 2
import json, sys
s = json.load(open(sys.argv[1]))
missing = [k for k in ('wt', 'piece', 'topic', 'release', 'items', 'title', 'kind', 'approved_head', 'review_head', 'guard', 'review') if not s.get(k)]
if missing:
    sys.exit('STOP: SPEC.json lacks ' + ', '.join(missing))
if s['approved_head'] != sys.argv[2] or s['review_head'] != sys.argv[2]:
    sys.exit('STOP: this carry is of %s, but SPEC.json approves %s and its review was written of %s'
             % (sys.argv[2][:8], s['approved_head'][:8], s['review_head'][:8]))
PY
W=$(spec "$F" wt)
cd "$CLONE" && git fetch -q "$REMOTE" "$RB" "$HEAD" 2>/dev/null
[ "$(git rev-parse FETCH_HEAD 2>/dev/null)" = "$HEAD" ] || git fetch -q "$REMOTE" "$HEAD"
git fetch -q "$REMOTE" "$RB"; [ "$(git rev-parse FETCH_HEAD)" = "$LIVE" ] || { echo "STOP: $RB is $(git rev-parse FETCH_HEAD | cut -c1-8), not $LIVE"; exit 2; }
[ -d "$W" ] || git worktree add -q --detach "$W" "$HEAD"
cd "$W" && git checkout -q --detach "$HEAD" && git reset -q --hard "$HEAD" || { echo "STOP: cannot check out $HEAD in $W"; exit 2; }
git -c user.name="$SEAT" -c user.email="$SEAT@theseus.local" merge -q --no-edit -m "Carry $ITEM onto live" "$LIVE" > "$F/carry-merge.out" 2>&1; MERGE=$?
C=$(git status --short | /usr/bin/grep -E "^(UU|AA|DU|UD)" | awk '{print $2}')
[ "$MERGE" = 0 ] || [ -n "$C" ] || { echo "STOP: merging live into $HEAD failed with no conflict (git exit $MERGE); see $F/carry-merge.out"; exit 3; }
if [ -n "$C" ]; then
  if [ -n "${RESOLVER:-}" ]; then
    for f in $C; do /usr/bin/python3 -I "$RESOLVER" "$f" || { echo "UNRESOLVED $f"; git merge --abort; exit 3; }; git add "$f"; done
    git -c user.name="$SEAT" -c user.email="$SEAT@theseus.local" commit -q -m "Carry $ITEM onto live" || { echo "STOP: commit after resolution failed"; git merge --abort; exit 3; }
    echo "resolved: $(echo $C | tr '\n' ' ') with $RESOLVER"
  else
    echo "CONFLICT: $(echo $C | tr '\n' ' '); resolve with RESOLVER=<script> or by hand, then rerun"; git merge --abort; exit 3
  fi
fi
NEW=$(git rev-parse HEAD); echo "carry $NEW parents $(git log -1 --format=%p)"; git diff --stat "$LIVE" HEAD | tail -1
git push -q "$REMOTE" "${NEW}:refs/heads/$BR" > "$F/carry-push.out" 2>&1; PUSH=$?
[ "$PUSH" = 0 ] || { /usr/bin/grep -vE "^remote:|^$" "$F/carry-push.out" | head -3; echo "STOP: the push of $NEW to $BR was refused (git exit $PUSH); SPEC.json is unchanged"; exit 4; }
# land.py refuses unless SPEC files equals the number of paths the carry changes against live.
/usr/bin/python3 -I - "$F/SPEC.json" "$NEW" "$(git rev-parse HEAD^{tree})" "$LIVE" "$PR" "$(git diff --name-only "$LIVE" HEAD | wc -l | tr -d ' ')" <<'PY'
import json, os, re, subprocess, sys
p, src, tree, base, pr, files = sys.argv[1:7]; d = json.load(open(p))
d.update({'source': src, 'tree': tree, 'base': base, 'carry': src, 'files': int(files)})
if pr: d['pr'] = int(pr)
open(p, 'w').write(json.dumps(d, indent=1) + '\n')
print('SPEC:', 'source', src[:8], 'base', base[:8], 'release', d['release'], 'pr', d['pr'], 'piece', d['piece'])
body = os.path.join(os.path.dirname(p), 'MERGE-BODY.txt')
want = 'Pipeline: ' + ' '.join(str(i) for i in d['items'])
if not os.path.exists(body):
    open(body, 'w').write(re.sub(r'^(@[a-z0-9-]+ )+', '', (d.get('review') or d['title']).strip()) + '\n\n' + want + '\n')
    print('MERGE-BODY.txt written from the review')
else:
    # land.py refuses a merge body whose last paragraph is not the Pipeline trailer for exactly these items.
    parsed = subprocess.run(['git', 'interpret-trailers', '--parse', body], capture_output=True, text=True, check=True).stdout.strip()
    if parsed.startswith('Pipeline:') and parsed != want:
        print('STOP: MERGE-BODY.txt ends with', repr(parsed), 'but this landing is', want, '- correct the body before landing'); sys.exit(3)
    elif parsed != want:
        open(body, 'w').write(open(body).read().rstrip('\n') + '\n\n' + want + '\n'); print('MERGE-BODY.txt: trailer set to', want)
PY
[ $? -eq 0 ] || { echo "NOT CARRIED: $ITEM's SPEC or merge body refused above; the carry $NEW is pushed to $BR"; exit 3; }
echo "CARRIED $ITEM $(date '+%-I:%M %p'): $NEW on $BR"
/usr/bin/python3 -I "$K/land.py" "$F" --preflight > "$F/carry-preflight.out" 2>&1; PRE=$?
/usr/bin/grep -E "^(PREFLIGHT OK|STOP|AssertionError|RUNNER POLICY)" "$F/carry-preflight.out" | head -3
[ "$PRE" = 0 ] && /usr/bin/grep -q "^PREFLIGHT OK" "$F/carry-preflight.out" || { echo "STOP: carried, but the preflight refused (exit $PRE); see $F/carry-preflight.out"; exit 5; }
