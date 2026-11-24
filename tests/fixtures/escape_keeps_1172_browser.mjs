import { OneLine, TopicStart, firstSentence } from '/web/quick-create.mjs';
import { titleLine, pipelineHref } from '/web/pipeline.mjs';
import { firstLine } from '/web/pipeline-words.mjs';
import { ThingsRail } from '/web/things-rail.mjs';

// Native DOM/keyboard; API, destination and access are named memory ports.
// The server supplies the actual app functions from app.mjs at request time.
const $ = id => document.getElementById(id), commands=[], destinations=[];
const bootstrap={instance_id:'1172-browser',actor:'fixture',authority:{authority_id:'fixture',authority_epoch:'one'}};
const state=window.fixture1172={commands,destinations,refused:false};
const api={command:async request=>{
  commands.push(structuredClone(request));
  if(state.refused)throw Error('1172 refused');
  const result=request.kind==='opening.save'?{opening_revision:1}:request.kind==='opening.publish'?{topic:{id:'made'}}:{number:1172};
  return {instance_id:request.instance_id,operation_id:request.operation_id,kind:request.kind,recorded:true,status:'committed',result};
}};
const registry={current:{source:{source_ref:{kind:'message',id:'source1172'},author:'fixture',body:'Before'},sourceUnavailable:false},runtime:{current:bootstrap.authority}};
window.ports1172={$,OneLine,TopicStart,firstSentence,titleLine,pipelineHref,firstLine,bootstrap,api,registry,topic:{workspace_id:'w'},
  mayStartFrom:()=>true,run:action=>Promise.resolve().then(action),node:(tag,text,className='')=>Object.assign(document.createElement(tag),{textContent:text,className}),
  openDestination:async target=>{destinations.push(target);$('reader-menu').focus();}};
const forms=await import('/app-forms1172.mjs');
$('start-from-message').onclick=forms.openStartLine;
$('pipeline-open').onclick=forms.openPipelineAdd;
state.openReader=()=>{$('test-reader').showModal();};

const rail=new ThingsRail({host:$('things1172'),backdrop:$('backdrop1172')});
rail.handles={workspaceId:'w',bootstrap};rail.drawnOnce=true;rail.host.hidden=false;
rail.links.mayWrite=true;rail.links.write=async(_handles,row)=>{commands.push({kind:'workspace.link_set',args:row});return row;};
const part=rail.sections.get('previews');part.details.hidden=false;part.details.open=true;
state.openLink=()=>{rail.open();rail.links.edit({seq:1,url:'https://1172.invalid/link',title:'Before',revision:1,removed:false},rail.links.pencil);};
state.rail=rail;
document.body.dataset.fixture1172='ready';
