from __future__ import annotations

"""Protected controller archive authentication, before any forward classification.

Only called by the reviewed workflow. No credentials are read by this program;
the existing gh client performs read-only API requests in its job environment.
"""
import argparse
import datetime
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import stat
import subprocess
import zipfile


def require(ok, why):
    if not ok:
        raise ValueError('forward archive: '+why)


def api(endpoint, raw=False):
    result=subprocess.run(['gh','api',endpoint],capture_output=True,check=True).stdout
    return result if raw else json.loads(result)


def listing(endpoint,key):
    first=api(endpoint+'?per_page=100'); total=first.get('total_count')
    require(type(total) is int and 0<total<=512,'missing/out-of-bound API inventory')
    rows=[]
    for page in range(1,(total+99)//100+1):
        part=first if page==1 else api(endpoint+'?per_page=100&page=%d'%page)
        require(part.get('total_count')==total and len(part.get(key,[]))==min(100,total-len(rows)),'incomplete API page')
        rows.extend(part[key])
    require(len({r['id'] for r in rows})==total,'duplicate paginated identity')
    return rows


def stamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z','+00:00'))


def authenticate(record,shards,aggregate,originals):
    p=record['producer']; repository=p['head_repository']; rid=int(p['run_id']); attempt=int(p['run_attempt'])
    require(attempt==1,'retries cannot add coverage')
    prefix='repos/%s/actions/runs/%d'%(repository,rid)
    run=api(prefix+'/attempts/%d'%attempt)
    require(run.get('id')==rid and run.get('run_attempt')==attempt and run.get('head_sha')==p['head_sha']
            and run.get('path')=='.github/workflows/checks.yml' and run.get('name')=='Checks'
            and run.get('event')==p['event'] and run.get('status')=='completed'
            and run.get('conclusion') in ('success','failure')
            and run.get('repository',{}).get('full_name')==repository
            and run.get('head_repository',{}).get('full_name')==repository,'API run identity differs')
    jobs=listing(prefix+'/attempts/%d/jobs'%attempt,'jobs')
    require(all(j.get('run_id')==rid and j.get('run_attempt')==attempt and j.get('head_sha')==p['head_sha']
                and j.get('status')=='completed' for j in jobs),'API job source/run/attempt differs')
    artifacts=listing(prefix+'/artifacts','artifacts')
    provenance=json.loads((Path(aggregate)/'provenance.json').read_bytes())
    expected={'check-%d'%i for i in range(len(provenance['plan']))}|{'release-check'}
    require(len(artifacts)==len(expected) and {a['name'] for a in artifacts}==expected,'complete archive inventory differs')
    Path(originals).mkdir(parents=True,exist_ok=False)
    observed=[]
    for a in artifacts:
        name=a['name']; wr=a.get('workflow_run') or {}
        require(a.get('expired') is False and wr.get('id')==rid and wr.get('head_sha')==p['head_sha']
                and wr.get('repository_id')==run['repository']['id']
                and wr.get('head_repository_id')==run['head_repository']['id'],'archive source/run differs')
        raw=api('repos/%s/actions/artifacts/%d/zip'%(repository,a['id']),True)
        require(a.get('digest')=='sha256:'+hashlib.sha256(raw).hexdigest() and a.get('size_in_bytes')==len(raw),'API archive digest differs')
        (Path(originals)/(name+'.zip')).write_bytes(raw)
        out=Path(aggregate) if name=='release-check' else Path(shards)/name
        if name=='release-check':
            job_name="the whole run's summary"; upload="Keep the whole run's summary"
        else:
            index=int(name.split('-')[1]);job_name=provenance['plan'][index]['name'];upload='Keep the evidence'
        matches=[j for j in jobs if j.get('name')==job_name]
        require(len(matches)==1 and matches[0].get('conclusion') in ('success','failure'),'archive job not retired')
        job=matches[0]
        uploads=[s for s in job.get('steps',[]) if s.get('name')==upload and s.get('status')=='completed' and s.get('conclusion')=='success']
        require(len(uploads)==1 and stamp(uploads[0]['started_at'])<=stamp(a['created_at'])<=stamp(job['completed_at']),'attempt/upload differs')
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names=z.namelist();require(len(names)==len(set(names)),'duplicate original ZIP member')
            files=[]
            for n in names:
                q=PurePosixPath(n);require(not q.is_absolute() and '..' not in q.parts,'unsafe ZIP member')
                if n.endswith('/'):
                    continue
                mode=z.getinfo(n).external_attr>>16
                require(not stat.S_ISLNK(mode),'ZIP symlink refused')
                require((out/n).is_file() and (out/n).read_bytes()==z.read(n),'download differs from original archive')
                files.append(n)
            actual=[str(x.relative_to(out)) for x in out.rglob('*') if x.is_file()]
            require(set(actual)==set(files),'extra/missing downloaded bytes')
        observed.append({'id':a['id'],'name':name,'sha256':hashlib.sha256(raw).hexdigest(),'job':job['id']})
    return {'run':rid,'attempt':attempt,'head':p['head_sha'],'archives':observed,'jobs':len(jobs)}


def main():
    parser=argparse.ArgumentParser()
    for name in ('producer','shards','aggregate','originals','out'):
        parser.add_argument('--'+name,required=True)
    a=parser.parse_args()
    result=authenticate(json.loads(Path(a.producer).read_bytes()),a.shards,a.aggregate,a.originals)
    Path(a.out).write_text(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
