from __future__ import annotations

"""Landing authentication for a fresh one-run compose packet (not history)."""
from pathlib import Path
import tempfile
from tools import base_move as b, grouped_admission as g, compose_forward as f

PRODUCER = ('forward_plan.py', 'compose_forward.py','compose_groups.py','compose_inventory.cjs','compose_instrument.cjs',
            'compose_deadline_775.mjs','compose_worker_775.mjs','run_compose_group.py')


def listing(github, endpoint, key):
    first=github.get(endpoint+'?per_page=100')
    total=first.get('total_count')
    b.require(type(total) is int and 0<total<=512, 'fresh API count unavailable/out of bound')
    rows=[]
    for page in range(1,(total+99)//100+1):
        part=first if page==1 else github.get(endpoint+'?per_page=100&page=%d'%page)
        b.require(part.get('total_count')==total and len(part.get(key,[]))==min(100,total-len(rows)), 'fresh incomplete API page')
        rows.extend(part[key])
    b.require(len({r['id'] for r in rows})==total, 'fresh duplicate API identity')
    return rows


def validate(ref, judgment, git, github, repository, head, anchor, source_files):
    packet=b.fields(b.document(ref),'version product package archives review')
    b.require(type(packet['version']) is int and packet['version']==2, 'fresh packet version')
    root=b.ask(git,'rev-parse','--show-toplevel').strip()
    source=f.f779_source(root,head)
    b.require(packet['product']==source and anchor['attempt']==1, 'fresh source/attempt differs')
    auth=g.review(packet['review'],{k:v for k,v in packet.items() if k!='review'},judgment,'fresh-compose-admission')
    package=b.fields(b.document(packet['package']),'producer workflow_head workflow_sha256 instrumented_sha256 review')
    patch_review=g.review(package['review'],{k:v for k,v in package.items() if k!='review'},judgment,'fresh-compose-package')
    b.require(auth['record']!=patch_review['record'], 'fresh reviews not separate')
    b.require(set(package['producer'])==set(PRODUCER),'fresh producer inventory differs')
    for name,digest in package['producer'].items():
        b.sha(digest,64)
        b.require(digest==b.digest((Path(__file__).parent/name).read_bytes()), 'fresh protected producer differs')
        b.require(digest==b.digest(f.f779_git(root,'show',head+':tools/'+name)), 'fresh tested producer differs')
    b.require(package['workflow_head'] in (head,anchor['tested_merge']['second_parent'])
              and package['workflow_sha256']==b.digest(f.f779_git(root,'show',package['workflow_head']+':.github/workflows/checks.yml'))
              and f.f779_git(root,'show',head+':.github/workflows/checks.yml')==f.f779_git(root,'show',package['workflow_head']+':.github/workflows/checks.yml'), 'fresh workflow bytes differ')
    inventory=f.f779_inventory(root,head)
    groups=f.f779_groups(inventory,source)
    original=f.f779_git(root,'show',head+':tests/reader_compose_native.mjs')
    patched=f.f779_patch(original)
    b.require(package['instrumented_sha256']==b.digest(patched), 'fresh reviewed instrument differs')
    archives=packet['archives']
    b.require(sum(a['name']=='release-check' for a in archives)==1, 'fresh missing/duplicate summary archive')
    facts={}
    endpoint='repos/%s/actions/runs/%d/artifacts'%(repository,anchor['run'])
    artifacts=listing(github,endpoint,'artifacts')
    offered={a['id']:a for a in archives}
    b.require(len(offered)==len(archives) and {a['id'] for a in artifacts}==set(offered), 'fresh full original archive inventory differs')
    contents={}
    with tempfile.TemporaryDirectory(prefix='fresh779-originals-') as temp:
        for binding in archives:
            b.require(binding['run']==anchor['run'] and binding['attempt']==anchor['attempt']
                      and binding['run_head']==anchor['tested_merge']['second_parent'] and binding['event']=='pull_request'
                      and binding['workflow_head']==package['workflow_head'], 'fresh archive wrong run/source')
            role='summary' if binding['name']=='release-check' else 'check'
            for read,run,job in g.archive(binding,git,github,repository,facts,role=role):
                b.require(job.get('conclusion') in ('success','failure'), 'fresh producer job not retired')
                b.require(binding['name'] not in contents, 'fresh duplicate archive name')
                members={}
                for name in read.members:
                    if name.endswith('/'):
                        continue
                    # Every supplied evidence byte must match its original. Images/caches not consumed remain opaque.
                    key=binding['name']+'/'+name
                    if key in source_files:
                        raw=read(name)
                        b.require(b.artifact(source_files[key])==raw,'fresh repackaged source evidence differs')
                        members[name]=raw
                        target=Path(temp)/key;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
                contents[binding['name']]=members
        b.require(set(source_files)=={name+'/'+p for name,rows in contents.items() for p in rows},'fresh files absent from original archives')
        summary=b.loads(contents['release-check']['summary.json'])
        provenance=b.loads(contents['release-check']['provenance.json'])
        f.f779_plan(provenance['plan'],summary['required'],groups)
        b.require(set(contents)=={'check-%d'%i for i in range(len(provenance['plan']))}|{'release-check'}, 'fresh extra/missing archive assignment')
        b.require(next(a for a in archives if a['name']=='release-check')['job_name']=="the whole run's summary", 'fresh aggregate job differs')
        for i,job in enumerate(provenance['plan']):
            archive_name='check-%d'%i
            b.require(next(a for a in archives if a['name']==archive_name)['job_name']==job['name'], 'fresh API ordinary/group assignment differs')
            original_receipt=b.loads(contents[archive_name]['run.json'])
            b.require(original_receipt.get('shard',{}).get('name')==job['name'], 'fresh original job name differs')
        receipts=[]
        for i,job in enumerate(provenance['plan']):
            if not job.get('compose_group'):
                continue
            name='check-%d'%i
            b.require(next(a for a in archives if a['name']==name)['job_name']==job['name'], 'fresh API group assignment differs')
            expected={k:str(anchor[k]) for k in ('run','attempt')}
            expected={'id':expected['run'],'attempt':expected['attempt'],'workflow_sha':package['workflow_head'],
                      'workflow_ref':provenance['run']['workflow_ref'],'repository':repository,'job':('check' if i<256 else 'check_more'),'job_name':job['name']}
            receipts.append(f.f779_read_group(Path(temp)/name,next(g for g in groups if g['id']==job['compose_group']['id']),source,inventory,original,patched,package['producer'],expected,root))
        union=f.f779_fold(groups,receipts)
        b.require(next(s for s in summary['steps'] if s['name']=='native-compose')==f.f779_step(union), 'fresh forged aggregate')
    return {'kind':'authenticated-compose-union-779','complete':True,'passed':union['passed'],
            'originals':[],'retained_results':[],'replay_overlap':[],'raw_false':union['raw_false'],
            'original_cleanup':[],'collector':union,'review':packet['review'],'evidence':ref,'mode':'fresh-one-run','admitted':False}
