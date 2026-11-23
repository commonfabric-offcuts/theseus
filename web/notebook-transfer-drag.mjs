// Native HTML drag owns the page identity only. Core and NotebookWriting keep
// the destination, current writing, exact operation and refusal/Undo result.
const owners=new WeakMap(),TYPE='application/x-theseus-notebook-page';
export function notebookTransferDrag({doc,bootstrap,rail,current,perform,refused}) {
  owners.get(doc)?.();
  const listeners=[];let held=null,target=null,preview=null;
  const on=(type,fn)=>{doc.addEventListener(type,fn);listeners.push([type,fn]);};
  const clear=()=>{target?.classList.remove('notebook-drop-target');target=null;preview?.remove();preview=null;};
  const valid=event=>held&&current()&&event.dataTransfer?.types?.includes(TYPE);
  const destination=node=>{
    const row=node?.closest?.('a[data-topic-id],a.ol-name[data-workspace-id]');
    if(!row||!rail()?.contains(row)||row.closest('[inert]'))return null;
    return {row,scope:row.dataset.topicId?{kind:'topic',id:row.dataset.topicId}:{kind:'workspace',id:row.dataset.workspaceId}};
  };
  on('dragstart',event=>{
    if(event.defaultPrevented||!current()||doc.getSelection?.()?.isCollapsed===false||event.target?.closest?.('input,textarea,[contenteditable]'))return;
    const source=event.target?.closest?.('a.ol-page[data-page-id],[data-notebook-page-id],#outcome-references-list .reference[data-id]');
    if(!source||!event.dataTransfer)return;
    const id=source.dataset.notebookPageId??source.dataset.pageId??source.dataset.id;if(!id)return;
    held={id,instance:bootstrap.instance_id,actor:bootstrap.actor};
    event.dataTransfer.setData(TYPE,JSON.stringify(held));event.dataTransfer.effectAllowed='copyMove';
  });
  on('dragover',event=>{
    if(!valid(event))return;const to=destination(event.target);if(!to){clear();return;}
    event.preventDefault();event.dataTransfer.dropEffect=event.altKey?'copy':'move';
    if(target!==to.row){clear();target=to.row;target.classList.add('notebook-drop-target');preview=doc.createElement('p');preview.className='notebook-drop-preview';preview.setAttribute('role','status');rail().append(preview);}
    preview.textContent=(event.altKey?'Copy':'Move')+' page to “'+(to.row.title||to.row.textContent.trim())+'”';
  });
  on('drop',event=>{
    if(!valid(event))return;const to=destination(event.target);if(!to)return;
    event.preventDefault();event.stopPropagation();
    let payload;try{payload=JSON.parse(event.dataTransfer.getData(TYPE));}catch{return;}
    if(payload.id!==held.id||payload.instance!==held.instance||payload.actor!==held.actor)return;
    const id=held.id,kind=event.altKey?'memory.copy':'memory.move';held=null;clear();
    Promise.resolve().then(()=>current()&&perform(id,kind,to.scope)).catch(error=>refused(error.message));
  });
  on('dragend',()=>{held=null;clear();});
  const dispose=()=>{held=null;clear();for(const [type,fn]of listeners)doc.removeEventListener(type,fn);};owners.set(doc,dispose);return dispose;
}
