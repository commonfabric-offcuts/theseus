from __future__ import annotations
import sys, json, os, sqlite3, subprocess, select, time, signal, argparse
from pathlib import Path
REPO=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(REPO))
from aim_next import Store, initialize
from aim_next.profile import write_profile
from aim_next.codex_host import provision
parser=argparse.ArgumentParser(description='Opt-in real Codex/Theseus lifecycle proof on a NEW isolated database. Uses signed-in model capacity.')
parser.add_argument('--output',required=True)
parser.add_argument('--codex',required=True)
parser.add_argument('--home',required=True)
options=parser.parse_args()
ROOT=Path(options.output).resolve()
ROOT.mkdir(mode=0o700)
for name in ('data','profiles','work','host'): (ROOT/name).mkdir(mode=0o700)
DB=ROOT/'data/data.sqlite3'
INSTANCE='hosted-real-pilot'
AGENT='pilot'
binding=initialize(DB,INSTANCE,[{'id':'lead','kind':'human'},{'id':AGENT,'kind':'agent'}],authority_path=ROOT/'authority.json')['binding']
store=Store(DB,INSTANCE,expected_binding=binding)
for actor in ('lead',AGENT):write_profile(ROOT/('profiles/'+actor+'.json'),DB,INSTANCE,actor,binding=binding)
cli=ROOT/'aim-next'
cli.write_text("#!/usr/bin/python3 -I\nimport os,sys\nos.execv('/usr/bin/python3',['/usr/bin/python3','-I',%r]+sys.argv[1:])\n"%str(REPO/'bin/aim-next'));cli.chmod(0o700)
(ROOT/'work/numbers.txt').write_text('13\n21\n8\n')
config=ROOT/'pilot.route.json'
result=provision(runner_profile=str(ROOT/'profiles/lead.json'),runner_id='real-pilot',actor_profile=str(ROOT/'profiles/pilot.json'),
 codex_executable=options.codex,
 codex_home=options.home,cli=str(cli),cwd=str(ROOT/'work'),
 model='gpt-6.1-sol',config_path=str(config),permission_mode='full',reasoning_effort='medium',
 instructions='You are a pilot worker on an isolated Theseus instance. Lead is the human owner and their messages authorize the requested small file tasks within this assigned work directory. Use the bound Theseus CLI for every conversation reply. Do not delegate. Do not read other agent or desktop files. Read your post back, then acknowledge deliveries separately. Do not end your turn without posting required output in Theseus. When you ask Lead a question, finish and wait for a new delivery; never invent an answer.')
print(json.dumps({'provision':result}),flush=True)
(ROOT/'routes.json').write_text(json.dumps({'v':1,'routes':{AGENT:str(config)}}));(ROOT/'routes.json').chmod(0o600)
serial=0
def act(kind,args,target,expected=None):
 global serial
 serial+=1
 r=store.command('lead',{'v':1,'instance_id':INSTANCE,'operation_id':'pilot-%s'%serial,'kind':kind,'target':target,'args':args,'expected':dict(expected or {},authority={k:binding[k] for k in ('authority_id','authority_epoch')})})
 assert r['status']=='committed',r
 return r['result']
def sql(query,args=()):
 with sqlite3.connect(str(DB)) as db:
  db.row_factory=sqlite3.Row
  return [dict(r) for r in db.execute(query,args)]
class Run:
 def __init__(self):
  self.err=open(ROOT/'runner.stderr','ab');self.log=open(ROOT/'runner.events','a');self.buf=b'';self.events=[]
  self.p=subprocess.Popen(['/usr/bin/python3','-I',str(REPO/'bin/aim-next-runner'),'--profile',str(ROOT/'profiles/lead.json'),'--runner-id','real-pilot','--routes',str(ROOT/'routes.json'),'--host-dir',str(ROOT/'host')],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=self.err)
  self.until('host_resume')
 def until(self,name,seconds=240,**fields):
  deadline=time.monotonic()+seconds
  while time.monotonic()<deadline:
   while b'\n' not in self.buf:
    if not select.select([self.p.stdout],[],[],max(0,deadline-time.monotonic()))[0]:raise TimeoutError(name)
    block=os.read(self.p.stdout.fileno(),65536)
    if not block:raise RuntimeError('Runner exited before '+name)
    self.buf+=block
   line,self.buf=self.buf.split(b'\n',1);self.log.write(line.decode()+'\n');self.log.flush()
   event=json.loads(line);self.events.append(event)
   if event.get('event') in ('host_resume','host_dispatch','host_turn_end','paused','host_server_request'):print(json.dumps(event),flush=True)
   if event.get('event')==name and all(event.get(k)==v for k,v in fields.items()):return event
  raise TimeoutError(name)
 def close(self):
  if self.p.poll() is None:
   self.p.terminate()
   try:self.p.communicate(timeout=20)
   except subprocess.TimeoutExpired:self.p.kill();self.p.communicate(timeout=5)
  self.err.close();self.log.close()
run=None
facts={'thread_id':result['thread_id'],'provisioned':True}
try:
 run=Run()
 act('workspace.create',{'id':'w1','title':'Hosted pilot','purpose':'Verify native hosted work','team':[AGENT],'coordinator':AGENT},{})
 act('opening.save',{'workspace_id':'w1','topic_id':'t1','title':'Sum and ask','participants':[AGENT],'body':'Read numbers.txt with your shell, calculate its sum and write sum.txt as the integer followed by a newline. Post the total here and ask me which label to put in label.txt. Do not create label.txt until I answer. Then acknowledge the delivery you handled and finish this turn.','attachments':[]},{'opening_id':'o1'},{'opening_revision':0})
 act('opening.publish',{}, {'opening_id':'o1'},{'opening_revision':1})
 end=run.until('host_turn_end');assert end['status']=='completed',end
 messages=sql('SELECT id,body,intent,addressees FROM messages WHERE author_id=? ORDER BY seq',(AGENT,))
 assert (ROOT/'work/sum.txt').read_text()=='42\n'
 assert not (ROOT/'work/label.txt').exists()
 asks=[m for m in messages if m['intent']=='ask'];assert asks,messages
 assert not sql("SELECT id FROM deliveries WHERE recipient_id=? AND state='pending'",(AGENT,))
 facts['first']={'messages':messages,'sum':42,'waiting_for_human':True,'pending':0}
 (ROOT/'facts.json').write_text(json.dumps(facts,indent=2)+'\n')
 run.close();run=Run()
 act('message.post',{'body':'Use IRIS as the label. Write it in label.txt, then tell me the earlier total and the label.','addressees':[AGENT],'intent':'tell','reply_to':asks[-1]['id']},{'topic_id':'t1'})
 end=run.until('host_turn_end');assert end['status']=='completed',end
 assert (ROOT/'work/label.txt').read_text().strip()=='IRIS'
 assert not sql("SELECT id FROM deliveries WHERE recipient_id=? AND state='pending'",(AGENT,))
 facts['second']={'messages':sql('SELECT id,body,intent FROM messages WHERE author_id=? ORDER BY seq',(AGENT,)),'label':'IRIS','pending':0}
 # A third job stays active long enough to deliver a follow-up and Stop it.
 act('message.post',{'body':'Create working.txt with ACTIVE, then run a shell command that waits (at most 90 seconds) for continue.txt to exist. This wait is part of this isolated lifecycle check. After the file exists, write FINISHED in finished.txt and report completion here. Until then leave this delivery unacknowledged.','addressees':[AGENT],'intent':'tell'},{'topic_id':'t1'})
 run.until('host_dispatch',outcome='handed',mode='start')
 deadline=time.monotonic()+100
 while not (ROOT/'work/working.txt').exists():
  if time.monotonic()>deadline:raise TimeoutError('native shell never started the hold')
  time.sleep(.2)
 act('message.post',{'body':'Follow-up for that active job: when released, also write LILY in followup.txt. Keep the existing wait and do not acknowledge until released.','addressees':[AGENT],'intent':'tell'},{'topic_id':'t1'})
 run.until('host_dispatch',outcome='handed',mode='steer')
 state=next(a['execution'] for a in store.view('lead','health',{})['agents'] if a['actor_id']==AGENT)
 assert state['state']=='working',state
 act('agent.execution',{'desired':'stopped'},{'actor_id':AGENT},{'execution_revision':state['execution_revision']})
 run.until('host_turn_end',status='interrupted')
 pending=sql("SELECT id FROM deliveries WHERE recipient_id=? AND state='pending'",(AGENT,))
 assert len(pending)==2,pending
 assert not (ROOT/'work/finished.txt').exists()
 assert not (ROOT/'work/followup.txt').exists()
 facts['stopped']={'pending':len(pending),'active_followup_steered':True}
 run.close();run=Run()
 state=next(a['execution'] for a in store.view('lead','health',{})['agents'] if a['actor_id']==AGENT)
 assert state['state']=='stopped',state
 assert store.runner_schedule([AGENT])['next_due_ms'] is None
 (ROOT/'work/continue.txt').write_text('release\n')
 act('agent.execution',{'desired':'running'},{'actor_id':AGENT},{'execution_revision':state['execution_revision']})
 end=run.until('host_turn_end');assert end['status']=='completed',end
 assert (ROOT/'work/finished.txt').read_text().strip()=='FINISHED'
 assert (ROOT/'work/followup.txt').read_text().strip()=='LILY'
 assert not sql("SELECT id FROM deliveries WHERE recipient_id=? AND state='pending'",(AGENT,))
 facts['continued']={'same_context':True,'followup':'LILY','pending':0}
 facts['turns']=sql('SELECT thread_id,turn_id,mode,seen_ms,final_status,cli_calls FROM hosted_turns')
 assert all(t['thread_id']==result['thread_id'] for t in facts['turns'])
 facts['passed']=True
finally:
 if run:run.close()
 (ROOT/'facts.json').write_text(json.dumps(facts,indent=2)+'\n')
print(json.dumps(facts),flush=True)
