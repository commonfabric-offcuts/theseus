import { NotebookSheet } from '../../web/notebook-sheet.mjs';
import { miniDocument } from './mini_dom.mjs';

// Actual sheet handlers with a small DOM; not native dialog or layout proof.
export function notebookFixture(t, {feed=true, wide=true, storage=new Map()}={}) {
  const doc=miniDocument(), calls=[], listeners=new Map(), saved=new Map();
  const set=(name,value)=>{saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});};
  const make=doc.createElement;
  doc.createElement=tag=>{const n=make(tag);n.style={};n.ownerDocument=doc;n.contains=other=>n===other||[...n.descendants()].includes(other);
    n.before=other=>n.parent?.insertBefore(other,n);
    n.getBoundingClientRect=()=>({top:0,bottom:80,left:0,right:500,height:80,width:500});
    n.scrollTop=0;n.style.removeProperty=k=>delete n.style[k];
    n.click=()=>n.onclick?.({stopPropagation(){},preventDefault(){}});
    if(tag==='dialog'){
      n.open=false;n.close=()=>{n.open=false;n.removeAttribute('open');calls.push('close');};
      n.showModal=()=>{n.open=true;n.modal=true;n.setAttribute('open','');calls.push('modal');};
      n.show=()=>{n.open=true;n.modal=false;n.setAttribute('open','');calls.push('nonmodal');};
    }
    return n;};
  doc.createElementNS=(_ns,tag)=>doc.createElement(tag);
  doc.body=doc.createElement('body');doc.body.root=true;
  doc.documentElement=doc.createElement('html');
  doc.getElementById=id=>doc.body.querySelector('#'+id)??doc.byId(id);
  doc.querySelector=selector=>selector==='dialog:modal'?[...doc.body.descendants()].find(n=>n.tag==='dialog'&&n.open&&n.modal)??null:doc.body.querySelector(selector);
  doc.addEventListener=(type,fn)=>{doc.listeners??={};doc.listeners[type]=fn;};
  doc.removeEventListener=()=>{};
  const dialog=doc.createElement('dialog');dialog.id='new-message-sheet';doc.body.append(dialog);
  const inline=doc.byId('inline-composer');dialog.append(inline);doc.body.append(doc.byId('reader'));
  const media={matches:wide,addEventListener:(_type,fn)=>{media.changed=fn;},removeEventListener(){}};
  doc.defaultView={getComputedStyle:()=>({marginTop:'0px',marginBottom:'0px'})};
  set('document',doc);set('location',new URL('https://fixture/?topic=t'));
  set('scrollX',0);set('scrollY',100);set('scrollTo',()=>{});
  set('getComputedStyle',()=>({overflowY:'visible',overflowX:'visible'}));
  set('sessionStorage',{getItem:key=>storage.get(key)??null,setItem:(k,v)=>storage.set(k,v),removeItem:key=>storage.delete(key)});
  set('matchMedia',()=>media);
  set('addEventListener',(type,fn,options={})=>{const row={fn,options};if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(row);});
  set('removeEventListener',()=>{});
  const emit=(type,event)=>{for(const {fn,options} of listeners.get(type)??[])if(!options.signal?.aborted)fn(event);};
  const page={host:doc.createElement('section'),text:doc.createElement('textarea'),mode:'cards',item:'p',sheetTitle:doc.createElement('span'),
    views:doc.createElement('div'),draft:doc.createElement('span'),more:doc.createElement('button'),pageNotice:doc.createElement('div'),status:doc.createElement('span'),addImage:doc.createElement('button'),
    load:async()=>true,paint(){},show(){},close(){calls.push('page-close');},writing:{journalPending:false}};
  const feedOptions={topicId:'t',read:async()=>({items:[],next_cursor:null}),open:async(...args)=>calls.push(['feed',...args])};
  const sheet=new NotebookSheet({doc,make:(_id,host)=>{page.host=host;const tools=doc.createElement('div');tools.className='notebook-tools';tools.append(page.views,page.draft,page.more);host.append(tools,page.pageNotice,page.status,page.addImage);return page;},fullHref:()=>'/p',openStack:async(...args)=>{calls.push(['reader',...args]);return true;},goBack(){},feed:feed?feedOptions:null});
  t.after(()=>{sheet.retire();for(const [name,descriptor] of saved)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];});
  return {sheet,page,doc,dialog,calls,media,storage,emit,feedOptions,set};
}
