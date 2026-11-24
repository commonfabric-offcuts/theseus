import { foldFixture } from './rail_topic_fold_1161.mjs';
import { RailHotkeys } from '../../web/rail-hotkeys.mjs';

// Actual TopicRail links and their actions; small event/DOM adapters only.
// No claim about layout, trusted keys or native beforeunload comes from this.
export function hotkeyFixture(t,{storage=null}={}) {
  const f=foldFixture({count:3}),doc=f.doc,root=f.outcome.li.parent;
  root.id='rail'; const events=new Map(),make=doc.createElement;
  const adapt=node=>{
    node.style??={};
    // Row stores its direct words separately from children. Native
    // replaceChildren clears those text nodes as well as element children.
    const replace=node.replaceChildren.bind(node);
    node.replaceChildren=(...children)=>{node.words='';replace(...children);};
    Object.defineProperty(node,'parentElement',{get:()=>node.parent,configurable:true});
    const original=node.href;
    Object.defineProperty(node,'href',{get:()=>node.getAttribute('href')??'',set:value=>node.setAttribute('href',value),configurable:true});
    if(original)node.href=original;
    node.click=()=>node.onclick?.({target:node,button:0,detail:0,preventDefault(){},stopPropagation(){}});
    return node;
  };
  doc.createElement=tag=>adapt(make(tag));
  for(const node of [root,...root.descendants()])adapt(node);
  doc.defaultView.location=new URL('https://fixture.invalid/?topic=t0');
  doc.defaultView.innerWidth=1280;doc.defaultView.innerHeight=1000;
  const listen=(at,type,fn)=>{let bag=events.get(at);if(!bag)events.set(at,bag=new Map());if(!bag.has(type))bag.set(type,[]);bag.get(type).push(fn);};
  doc.addEventListener=(type,fn)=>listen(doc,type,fn);doc.defaultView.addEventListener=(type,fn)=>listen(doc.defaultView,type,fn);
  doc.getSelection=()=>({isCollapsed:true});
  doc.body=root;doc.getElementById=id=>id==='rail'?root:null;
  const kept=new Map();storage??={getItem:key=>kept.get(key)??null,setItem:(key,value)=>kept.set(key,value)};
  const opened=[],hotkeys=new RailHotkeys({root,doc,storage,listen,open:(...args)=>{opened.push(args);return false;}});
  const bootstrap={instance_id:'1160-instance',actor:'fixture-reader'};
  const handles={bootstrap,route:{kind:'topic',id:'t0'},readable:()=>true};hotkeys.ready(handles);
  const emit=(at,type,event)=>{for(const fn of events.get(at)?.get(type)??[])fn(event);};
  const key=(extra={})=>{
    const e={code:'Digit1',key:'¡',altKey:true,ctrlKey:false,metaKey:false,shiftKey:false,defaultPrevented:false,
      target:doc.createElement('textarea'),preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
    emit(doc,'keydown',e);return e;
  };
  const link=(href,label)=>{const row=doc.createElement('a');row.href=href;row.textContent=label;root.append(row);return row;};
  t.after(f.close);
  return {...f,doc,root,events,listen,storage,kept,opened,hotkeys,bootstrap,handles,key,link,emit,rows:[...f.host.children]};
}
