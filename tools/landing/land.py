from __future__ import annotations
import time
import datetime, hashlib, importlib.util, json, signal, sqlite3, subprocess, sys, select
from pathlib import Path

# land.py FOLDER [--preflight]: the landing of one approved head, from the landing folder FOLDER (SPEC.json,
# MERGE-BODY.txt), with this seat's settings from config.py. --preflight stops before any effect.
KIT = Path(__file__).resolve().parent
sys.path.insert(0, str(KIT))
import config, decisions, execution_compare, runner_visible  # noqa: E402
OUT = Path(sys.argv[1]).resolve()
SETTINGS = config.load()
CO = Path(SETTINGS['coordinator']); SHIP = Path(SETTINGS['ship']); LIVE = Path(SETTINGS['live']); LANDDIR = Path(SETTINGS['work'])
REMOTE = SETTINGS['remote']; REPO = SETTINGS['repo']; BRANCH = SETTINGS['release_branch']; WORKSPACE = SETTINGS['workspace']
SPEC = json.loads((OUT/'SPEC.json').read_text())
WT = Path(SPEC['wt']); BASE = SPEC['base']; SOURCE = SPEC['source']; TREE = SPEC['tree']; PR = SPEC['pr']
ITEMS = SPEC['items']; PIECE = SPEC['piece']; TOPIC = SPEC['topic']; RELEASE = SPEC['release']; REVIEW = SPEC['review']
TITLE = SPEC['title']; FILES = SPEC['files']; KIND = SPEC.get('kind', 'ordinary'); JUDGMENT = SPEC.get('judgment')
CLI = config.cli() + ['--json']
PREFLIGHT = '--preflight' in sys.argv

def now(): return datetime.datetime.now().astimezone().isoformat()
def save(name, data): (OUT/name).write_text(json.dumps(data, indent=2)+'\n')
def run(argv):
    r = subprocess.run(argv, capture_output=True, text=True)
    if r.returncode: raise RuntimeError(str((argv, r.returncode, r.stdout[-2000:], r.stderr[-2000:])))
    return r.stdout
def git(*args): return run(['git', '-C', str(WT), *args]).strip()
def item(name):
    raw = run(CLI+['item',WORKSPACE,str(ITEMS[0])]); (OUT/name).write_text(raw)
    return json.JSONDecoder().raw_decode(raw)[0]['item']
def stage(name, argv):
    # Stage moves may need fable's authority; a refusal is recorded, never worked around.
    try: (OUT/name).write_text(run(CLI+argv)); return True
    except RuntimeError as error:
        save(name.replace('.json','-REFUSED.json'), {'at': now(), 'error': str(error)[:4000]}); print('STAGE REFUSED', name, flush=True); return False

def wait_boundary(ship, limit=120.0):
    # A boundary (no seat with a turn open) is taken when it comes within the limit. With six hosted seats dispatching
    # it may never come, and the deploy stops the runner itself (SIGTERM): a turn in flight is lost and redone.
    runs=sorted(ship.INSTANCE.glob('run-runner-*'),key=lambda p:int(p.name.rsplit('-',1)[1]) if p.name.rsplit('-',1)[1].isdigit() else -1)
    assert runs
    started=time.monotonic()
    with (runs[-1]/'stdout.log').open() as watched:
        queue=select.kqueue()
        try:
            queue.control([select.kevent(watched,filter=select.KQ_FILTER_VNODE,flags=select.KQ_EV_ADD|select.KQ_EV_CLEAR,fflags=select.KQ_NOTE_WRITE)],0)
            while True:
                turns,detail=ship.open_turns();assert turns>=0,detail
                print('BOUNDARY',turns,detail,flush=True)
                if turns==0:return
                if PREFLIGHT: print('PREFLIGHT: would wait up to',limit,'s for a boundary', flush=True); return
                if time.monotonic()-started>limit:
                    print('NO BOUNDARY within',limit,'s:',turns,'turns open; the deploy stops the runner mid-turn and those turns are redone',flush=True); return
                queue.control(None,1,10)
        finally:queue.close()

phase='preflight'
try:
    assert not (OUT/'MERGED.json').exists(), 'Read the existing attempt before proceeding'
    assert git('rev-parse','HEAD') == SOURCE and git('rev-parse','HEAD^{tree}') == TREE
    assert not git('status','--porcelain')
    # The review was written of one head; the landing merges exactly that head, or live merged into it.
    _refusal = decisions.carry_refusal(SPEC, git('rev-parse', SOURCE+'^@').split())
    assert _refusal is None, _refusal
    # The node comparison reads execution_changes only after the whole suite; a malformed entry refuses here instead.
    _refusal = execution_compare.entries_problem(SPEC.get('execution_changes') or [])
    assert _refusal is None, _refusal
    # Live may have moved past the source's base by a merge that changed no tree (a judged head landed as the
    # same tree): the merge of SOURCE onto BASE is then exactly SOURCE's tree. Anything else needs a carry first.
    _mb=git('merge-base',BASE,SOURCE)
    assert _mb==BASE or git('rev-parse',_mb+'^{tree}')==git('rev-parse',BASE+'^{tree}'), ('live moved with a different tree; carry first', _mb)
    assert run(['git','-C',str(LIVE),'rev-parse','HEAD']).strip() == BASE, 'live is not at BASE'
    assert not run(['git','-C',str(LIVE),'status','--porcelain','--untracked-files=no']).strip()
    assert git('ls-remote',REMOTE,'refs/heads/'+BRANCH).split()[0] == BASE
    latest = json.loads(run(CLI+['releases','--limit','1']))['items'][0]
    assert latest['release']==RELEASE-1 and latest['commit']==BASE, latest
    pr=json.loads(run(['gh','pr','view',str(PR),'--repo',REPO,'--json','number,state,headRefOid,baseRefName,mergeable']))
    save('PR-BEFORE.json',pr)
    assert pr['state']=='OPEN' and pr['headRefOid']==SOURCE and pr['baseRefName']==BRANCH, pr
    guard=json.loads((CO/SPEC['guard']).read_text())
    assert hashlib.sha256(Path(guard['tool']).read_bytes()).hexdigest()==guard['tool_sha256']
    for relative,digest in guard['verified_file_sha256'].items():
        assert hashlib.sha256((Path(guard['checkout'])/relative).read_bytes()).hexdigest()==digest
    sys.path.insert(0,guard['checkout'])
    from tools import deploy as deployment, releases, train
    admission_options = decisions.admission_options(KIND, deployment.admit, JUDGMENT)
    # LANDED ON READS (Tony, Nov 23 6:42), item 1182: the installed guard predates live's file classification, under which
    # live's PLANNING_PATHS (aim_next/judgment.py at BASE) are planning inputs, not deploy-tool files, and Core freezes a
    # piece that changes only them as ordinary. The installed guard's guarded list is read through live's rule for this
    # process only: those paths leave it, every other guarded path stays. Receipt: LAND-ON-READS.json. 1182 removes this.
    import ast as _ast
    _live_planning=()
    for _node in _ast.parse(git('show',BASE+':aim_next/judgment.py')).body:
        if isinstance(_node,_ast.Assign) and any(getattr(t,'id',None)=='PLANNING_PATHS' for t in _node.targets):
            _live_planning=tuple(_ast.literal_eval(_node.value))
    _installed_guarded=train.guarded; _planning_receipt=[]
    def _guarded_on_live_rule(paths):
        kept_=list(_installed_guarded(paths)); dropped_=[p for p in kept_ if p in _live_planning]
        if dropped_ and not _planning_receipt:
            _planning_receipt.append(dropped_)
            with open(OUT/'LAND-ON-READS.json','a') as receipt:
                receipt.write(json.dumps({'at':now(),'base':BASE,'source':SOURCE,'installed_guarded':kept_,
                    'live_planning_paths':list(_live_planning),'ordinary_under_live':dropped_,
                    'rule':'Tony Nov 23 6:42: land on reads, fix the tool after','tool_item':1182})+'\n')
            print('LANDED ON READS: live classifies', dropped_, 'as planning inputs', flush=True)
        return [p for p in kept_ if p not in _live_planning]
    train.guarded=_guarded_on_live_rule
    # LANDED ON READS (Tony, Nov 23 6:42): Core's combine records no candidate commit for a one-item judged release, and
    # the installed admission refuses every judged release without one; that is the tool's own failure (item 1141). The
    # candidate this release was combined for is the carry the accepted judgment names, so it is supplied here, for this
    # release piece only, and only while Core's field is empty and the release's sources are exactly the judgment's
    # cohort. The guard's files are unchanged and verified above. Receipt: LAND-ON-READS.json. 1141 removes this.
    # An ordinary landing has no judgment, so nothing is supplied on reads for it.
    if JUDGMENT is not None:
        from tools import gauntlet_admission
        _cohort_ref=JUDGMENT['core_cohort']
        assert hashlib.sha256(Path(_cohort_ref['path']).read_bytes()).hexdigest()==_cohort_ref['sha256'], 'core cohort record changed'
        _cohort_pairs=sorted((row['piece_id'],row['head']) for row in json.loads(Path(_cohort_ref['path']).read_text())['pieces'])
        assert JUDGMENT['carry']['head']==SOURCE and JUDGMENT['carry']['tree']==TREE, 'judgment carry is not this landing'
        _approved_from_core=gauntlet_admission.approved
        def _approved_on_reads(config_, run_):
            pieces_, waiting_, version_ = _approved_from_core(config_, run_)
            for value in pieces_:
                if value.get('id')==PIECE and value.get('release')==RELEASE and value.get('train_candidate') is None:
                    sources_=value.get('train_sources')
                    assert isinstance(sources_,list) and sorted((s['id'],s['freeze']['head_commit']) for s in sources_)==_cohort_pairs, \
                        ('release sources differ from the accepted judgment', sources_, _cohort_pairs)
                    value['train_candidate']=SOURCE
                    with open(OUT/'LAND-ON-READS.json','a') as receipt:
                        receipt.write(json.dumps({'at':now(),'release_piece':PIECE,'release':RELEASE,'supplied_train_candidate':SOURCE,
                            'core_train_candidate':None,'sources':_cohort_pairs,'judgment_digest':train.deterministic_admission.evidence_digest(JUDGMENT),
                            'rule':'Tony Nov 23 6:42: land on reads, fix the tool after','tool_item':1141})+'\n')
                    print('LANDED ON READS: candidate', SOURCE[:8], 'supplied for', PIECE, flush=True)
            return pieces_, waiting_, version_
        gauntlet_admission.approved=_approved_on_reads
    trailer=run(['git','interpret-trailers','--parse',str(OUT/'MERGE-BODY.txt')]).strip()
    assert trailer.startswith('Pipeline:') and releases.trailer_items(trailer.split(':',1)[1].strip())==ITEMS,trailer
    changed=git('diff','--name-only',BASE,SOURCE).splitlines()
    # The landed train classifies by the guarded list alone (aim_next/judgment.py); no input-declaration exemption.
    kept=train.guarded(changed); additions=[]
    assert len(changed)==FILES, len(changed)
    if KIND == 'ordinary': assert not kept, kept
    else:
        assert KIND == 'judged-first', ('judged-first needs its deterministic evidence', kept)
        train.deterministic_admission.shape(JUDGMENT)
    spec=importlib.util.spec_from_file_location('ship_warp',SHIP)
    ship=importlib.util.module_from_spec(spec);spec.loader.exec_module(ship)
    current=item('ITEM-PRELAND.json');assert (current.get('piece') or {}).get('id')==PIECE, current.get('piece')
    # The combine names the piece's own build topic; a SPEC naming any other topic is refused here, not after the deploy.
    assert ((current.get('piece') or {}).get('topic') or {}).get('id')==TOPIC, ('SPEC topic is not the piece\'s build topic', TOPIC, ((current.get('piece') or {}).get('topic') or {}).get('id'))
    # A release piece fable has already combined is reused as it stands: its number, members, source commit and stage are
    # checked here, before any effect, and no ENTER-WAIT or second combine is attempted on it.
    release_piece_record=current.get('piece') or {}
    REUSE_COMBINE=release_piece_record.get('kind')=='release'
    if REUSE_COMBINE:
        assert str(release_piece_record.get('release_number'))==str(RELEASE), ('release piece number', release_piece_record.get('release_number'), RELEASE)
        assert release_piece_record.get('commit') in (None, SOURCE), ('release piece commit', release_piece_record.get('commit'), SOURCE)
        assert sorted(int(i) for i in (release_piece_record.get('items') or []))==sorted(ITEMS), ('release piece items', release_piece_record.get('items'), ITEMS)
        # A release piece already moved to Checks by a deploy that did not land is reused there, not entered again.
        assert current['stage']['stage_id'] in ('combine','checks'), ('release piece stage', current['stage']['stage_id'])
    print('PREFLIGHT OK: stage', current['stage'] and current['stage']['stage_id'], 'changed', len(changed), 'guard', guard['head'][:8], flush=True)
    # Export and verify source before the outer wait; legacy/runtime/schema changes still wait.
    config=deployment.load_config(str(CO/'deploy-trains.json'))
    run(['git','-C',str(LIVE),'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',
         'fetch','--no-tags',str(WT),SOURCE])
    host_policy=deployment.runner_policy(config,SOURCE)
    # 987: the admission read before any boundary, merge or allocation; refuses a judged candidate while an ordinary approved head is unshipped.
    # The pre-merge admission reads the candidate's own commits for their Pipeline trailers; the carry's commits carry
    # none and the merge commit carries them, so the candidate admitted here is the exact merge this landing makes:
    # the carry's tree on live and the carry, with the merge subject and body, built locally and never pushed.
    (OUT/'PRE-MERGE-MESSAGE.txt').write_text(TITLE+'\n\n'+(OUT/'MERGE-BODY.txt').read_text())
    pre=git('commit-tree',TREE,'-p',BASE,'-p',SOURCE,'-F',str(OUT/'PRE-MERGE-MESSAGE.txt')).strip()
    save('PRE-MERGE.json',{'candidate':pre,'tree':TREE,'parents':[BASE,SOURCE],'message':str(OUT/'PRE-MERGE-MESSAGE.txt')})
    run(['git','-C',str(LIVE),'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','fetch','--no-tags',str(WT),pre])
    deployment.admit(config, pre, **admission_options)
    save('RUNNER-POLICY-PREMERGE.json',host_policy)
    print('RUNNER POLICY',host_policy['kind'],host_policy['reason'],flush=True)
    if PREFLIGHT:
        turns,detail=ship.open_turns(); print('open hosted turns now:', turns, detail, flush=True); sys.exit(0)
    # A landing has one boundary wait, spent before the deploy where the runner is stopped; here the open turns are only read.
    if host_policy['kind']=='restart': print('open hosted turns before the backup:', *ship.open_turns(), flush=True)
    if PIECE and not REUSE_COMBINE and current['stage']['stage_id']=='build':
        assert stage('ENTER-REVIEW.json', ['enter-stage',PIECE,'review','--round','1','--left','passed','--note',REVIEW]), 'enter review refused'
    if PIECE and not REUSE_COMBINE and item('ITEM-STAGE-CURRENT.json')['stage']['stage_id']!='wait':
        assert stage('ENTER-WAIT.json', ['enter-stage',PIECE,'wait','--left','approved','--note',REVIEW]), 'enter wait refused'
    if PIECE and REUSE_COMBINE:
        assert item('ITEM-STAGE-CURRENT.json')['stage']['stage_id'] in ('combine','checks'), 'the release piece left Combine and Checks'
    if not (OUT/'BACKUP-VERIFIED.json').exists():
        # The backup copies the live database page by page and gives up when a writer keeps it busy (DATABASE_BUSY,
        # retryable); with six seats writing, three tries a few seconds apart are what a quiet moment costs.
        for attempt_no in range(3):
            try: print(run(['/usr/bin/python3','-I',str(KIT/'backup_live.py'),str(OUT)]),flush=True); break
            except RuntimeError as error:
                if 'DATABASE_BUSY' not in str(error) or attempt_no==2: raise
                print('backup: database busy; trying again', flush=True); time.sleep(5)
    assert json.loads((OUT/'BACKUP-VERIFIED.json').read_text())['verified']
    # The schema step and the new code's first reads, on a disposable copy of the backup just taken, before anything
    # is merged or stopped: a refusal here leaves the service, GitHub and the release record as they were.
    phase='rehearsal'
    rehearsal=subprocess.run(['/usr/bin/python3','-I',str(KIT/'realdata_proof.py'),
                              json.loads((OUT/'BACKUP-VERIFIED.json').read_text())['bundle_path'],str(OUT/'realdata'/('rehearse-landing-%d'%int(time.time()))),
                              '--rehearse',str(WT)],capture_output=True,text=True)
    save('REHEARSAL.json',{'at':now(),'exit':rehearsal.returncode,'stdout':rehearsal.stdout[-2000:],'stderr':rehearsal.stderr[-2000:]})
    print('REHEARSAL exit',rehearsal.returncode,rehearsal.stdout.strip()[-300:],flush=True)
    assert rehearsal.returncode==0, 'the upgrade rehearsal on the fresh backup failed; nothing was merged or stopped'
    # The runner must be one the deploy can see before anything is merged: a refusal here changes nothing.
    print('RUNNER VISIBLE', runner_visible.ensure(LANDDIR), flush=True)
    # The piece's stage is read again right before the merge. A stage move after the preflight's read (a successor freeze
    # passes the piece through Review) would otherwise leave a merged PR whose combine is refused, with nothing deployed.
    if PIECE:
        _stage=item('ITEM-STAGE-PREMERGE.json')['stage']['stage_id']
        assert _stage in (('combine','checks') if REUSE_COMBINE else ('wait',)), ('the piece left Wait before the merge; nothing was merged', _stage)
    phase='merge'
    print(run(['gh','pr','merge',str(PR),'--repo',REPO,'--merge','--match-head-commit',SOURCE,
               '--subject',TITLE,'--body-file',str(OUT/'MERGE-BODY.txt')]),flush=True)
    pr=json.loads(run(['gh','pr','view',str(PR),'--repo',REPO,'--json','number,state,headRefOid,baseRefName,mergeCommit']))
    save('MERGED.json',pr);assert pr['state']=='MERGED' and pr['headRefOid']==SOURCE
    # Every push and release keeps its producer; it reports independently of admission.
    merge=pr['mergeCommit']['oid'];git('-c','core.hooksPath=/dev/null','fetch','--no-tags',REMOTE,merge)
    run(['git','-C',str(LIVE),'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','fetch','--no-tags',REMOTE,merge])
    assert git('show','-s','--format=%P',merge).split()==[BASE,SOURCE]
    assert git('rev-parse',merge+'^{tree}')==TREE
    items,commits=releases.shipped(run(releases.log_argv(WT,BASE,merge)));assert items==ITEMS,items
    save('TRAIN.json',{'pr':PR,'merge_commit':merge,'merged_tree':TREE,'kind':KIND,
         'items':[{'item':n,'approved_head':SOURCE,'review':REVIEW} for n in ITEMS],'hosted_run':None,'judgment':JUDGMENT})
    phase='combine'
    stage('STAGE-NOTE.json', ['stage-note',PIECE,REVIEW]) if PIECE else save('STAGE-NOTE.json',{'skipped':'no piece'})
    if PIECE and REUSE_COMBINE:
        save('COMBINE.json',{'reused':PIECE,'release':RELEASE,'merge':merge})
        current=item('COMBINE-READBACK.json')
        assert current['piece']['id']==PIECE and current['stage']['stage_id'] in ('combine','checks'), ('release piece changed', current['piece'].get('id'), current['stage'])
        release_piece=PIECE
    elif PIECE:
        assert stage('COMBINE.json', ['combine',WORKSPACE,'--release',str(RELEASE),'--pieces',PIECE,'--topic',TOPIC,'--commit',merge]), 'combine refused'
        current=item('COMBINE-READBACK.json')
        release_piece=current['piece']['id']
    else:
        save('COMBINE.json',{'skipped':'no piece'})
    if PIECE and current['stage']['stage_id']!='checks':
        assert stage('CHECKS-STAGE.json', ['enter-stage',release_piece,'checks','--left','approved','--note',REVIEW]), 'enter checks refused'
    # The keepalive is held from this check until the deploy ends, so no runner it resumes can appear in between; a
    # runner the deploy cannot see stops the landing here, with the server still up (377's first deploy).
    with runner_visible.hold(LANDDIR):
        print('RUNNER VISIBLE', runner_visible.ensure(LANDDIR), flush=True)
        host_policy=deployment.runner_policy(config,merge)
        save('RUNNER-POLICY-PREDEPLOY.json',host_policy)
        if host_policy['kind']=='restart': wait_boundary(ship)
        phase='deploy';save('DEPLOY-START.json',{'at':now(),'release':RELEASE,'merge':merge,'source':SOURCE,'base':BASE,'tree':TREE})
        for sig in ship.STOPS: signal.signal(sig,signal.SIG_IGN)
        deployment.deploy(config,merge,OUT/'deploy',None,False,number=RELEASE,train=OUT/'TRAIN.json',github=train.GhCli())
        save('DEPLOY-END.json',{'at':now(),'exit':0,'release':RELEASE,'merge':merge});print('DEPLOY EXIT0',merge,flush=True)
except BaseException as error:
    if not (PREFLIGHT and isinstance(error, SystemExit)):
        save('STOP.json',{'at':now(),'phase':phase,'error':str(error)[:4000]});print('STOP',phase,str(error)[:1500],flush=True)
    raise
