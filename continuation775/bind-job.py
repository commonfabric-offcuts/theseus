from pathlib import Path
import os,sys,json,subprocess as s,hashlib,datetime,platform
root=Path(os.environ['GITHUB_WORKSPACE']);product=root/'product';wrapper=root/'wrapper';packet=wrapper/'continuation775';out=Path(os.environ['RUNNER_TEMP'])/'check';phase=sys.argv[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(p,*args):return s.check_output(['git','-C',str(p),*args],text=True).strip()
group_path=packet/os.environ['GROUP_FILE'];group=json.load(open(group_path));source=os.environ['SOURCE_HEAD'];assert source=='bed0a0d46970fa48e200d68008a2f85de4ebcca9';assert git(product,'rev-parse','HEAD')==source;assert git(product,'rev-parse','HEAD^{tree}')=='68d67de20982995f950564579c5b4bf0e3e31f47';assert group['source']['head']==source;assert group['source']['tree']==git(product,'rev-parse','HEAD^{tree}')
packet_manifest=json.load(open(packet/'PACKET-SHA256.json'))
for rel,h in packet_manifest.items():assert sha(packet/rel)==h,rel
record={'version':1,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phase':phase,'run':{'id':os.environ['GITHUB_RUN_ID'],'attempt':os.environ['GITHUB_RUN_ATTEMPT'],'event':os.environ['GITHUB_EVENT_NAME'],'repository':os.environ['GITHUB_REPOSITORY'],'workflow_sha':os.environ.get('GITHUB_WORKFLOW_SHA'),'workflow_ref':os.environ.get('GITHUB_WORKFLOW_REF'),'api_head':os.environ['GITHUB_SHA'],'job':os.environ['GITHUB_JOB']},'product':{'head':git(product,'rev-parse','HEAD'),'tree':git(product,'rev-parse','HEAD^{tree}'),'parents':git(product,'show','-s','--format=%P','HEAD').split(),'status':git(product,'status','--porcelain')},'wrapper':{'head':git(wrapper,'rev-parse','HEAD'),'tree':git(wrapper,'rev-parse','HEAD^{tree}'),'tooling_head':'16fe73aa65c3ec053499549eb354a5f83c4415f0'},'group':{'id':group['id'],'file':os.environ['GROUP_FILE'],'sha256':sha(group_path),'cases_sha256':group['cases_sha256']},'packet_manifest_sha256':sha(packet/'PACKET-SHA256.json'),'original_binding_sha256':sha(packet/'BINDING.json'),'base_at_run':None,'base_at_run_reason':'workflow_dispatch; product parents are recorded separately, not relabelled as original PR','authority':[9553,9559],'runtime':{'python':sys.version,'platform':platform.platform(),'runner_os':os.environ.get('RUNNER_OS'),'runner_arch':os.environ.get('RUNNER_ARCH'),'image_os':os.environ.get('ImageOS'),'image_version':os.environ.get('ImageVersion'),'chrome_requested':os.environ.get('CHROME_VERSION'),'playwright_requested':os.environ.get('PLAYWRIGHT_VERSION')},'admitted':False}
if phase=='before':
 assert not record['product']['status'];assert not out.exists();(Path(os.environ['RUNNER_TEMP'])/'dispatch-source.json').write_text(json.dumps(record,indent=2))
else:
 out.mkdir(exist_ok=True);before=Path(os.environ['RUNNER_TEMP'])/'dispatch-source.json'
 if before.exists():(out/'dispatch-source.json').write_bytes(before.read_bytes())
 record['result_hashes']={str(p.relative_to(out)):sha(p) for p in out.rglob('*') if p.is_file() and 'pyc' not in p.parts}
 record['source_after_clean']=not record['product']['status'];(out/'run.json').write_text(json.dumps(record,indent=2))
