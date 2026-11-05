import { validActorId } from './creation.mjs';

const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const publicRow=row=>{if(!row)return null;const {key,scope,...value}=row;return value;};
const preview=text=>{let result='';for(const ch of text??''){if(new TextEncoder().encode(result+ch).length>256)return result+'…';result+=ch;}return result;};
export function intentSummary(row) {
  return {id:row.id,kind:row.kind,workspace:row.workspace,phase:row.phase,title:preview(row.form.title)||'Untitled outcome'};
}
// Earlier browsers kept local pointers to prepared topic openings here. Core now
// owns openings; such rows are left untouched and are never listed or written.
const retiredOpening=row=>row?.kind==='opening';

// A separate v1 database leaves every open v2 editor/image recovery connection
// untouched.
export async function openIntentJournal({instanceId,actor}) {
  if(!validActorId(instanceId)||!validActorId(actor))throw Error('Intent storage needs a confirmed instance and actor.');
  if(!navigator.locks?.request)throw Error('Private creation ownership is unavailable in this browser.');
  const scope=JSON.stringify([instanceId,actor]),held=new Map(),claims=new Map(),queues=new Map();let closed=false;
  const rowKey=id=>JSON.stringify([scope,id]);
  const release=()=>{closed=true;for(const end of held.values())end();held.clear();};
  const database=await new Promise((resolve,reject)=>{
    let failed=false;const request=indexedDB.open('aim-next-intents',1);
    request.onupgradeneeded=()=>{
      const store=request.result.createObjectStore('intents',{keyPath:'key'});
      store.createIndex('scope',['scope','id']);store.createIndex('workspace',['scope','workspace','id']);
    };
    request.onsuccess=()=>{if(failed)request.result.close();else resolve(request.result);};
    request.onerror=()=>{failed=true;reject(request.error);};
    request.onblocked=()=>{failed=true;reject(Error('Private creation storage is blocked by another tab.'));};
  });
  database.onversionchange=()=>{database.close();release();};
  const valid=row=>row?.format===1&&row.scope===scope&&row.key===rowKey(row.id)&&validActorId(row.id)&&
    row.instanceId===instanceId&&row.actor===actor&&validActorId(row.authority?.authority_id)&&validActorId(row.authority?.authority_epoch)&&
    (row.workspace===null||validActorId(row.workspace))&&['draft','uncertain','rejected','confirmed'].includes(row.phase)&&
    row.kind==='create'&&row.form&&typeof row.form.title==='string'&&typeof row.form.purpose==='string'&&Array.isArray(row.form.team);
  const transact=(mode,action)=>new Promise((resolve,reject)=>{
    if(closed){reject(Error('Private creation storage is closed.'));return;}
    const tx=database.transaction('intents',mode,mode==='readwrite'?{durability:'strict'}:undefined);let result,failure;
    tx.oncomplete=()=>resolve(result??null);tx.onerror=tx.onabort=()=>reject(failure??tx.error??Error('Private creation storage failed.'));
    const fail=error=>{failure=error;try{tx.abort();}catch{reject(error);}};
    try{if(mode==='readwrite'&&tx.durability!=='strict')throw Error('Strict private creation durability is unavailable.');action(tx.objectStore('intents'),value=>result=value,fail);}catch(error){fail(error);}
  });
  const get=id=>{
    if(!validActorId(id))throw Error('Invalid private intent identity.');
    return transact('readonly',(store,finish,fail)=>{
      store.get(rowKey(id)).onsuccess=event=>{const row=event.target.result;if(row&&!valid(row))fail(Error('This saved intent cannot be read safely. It has been kept.'));else finish(publicRow(row));};
    });
  };
  return {
    get,
    claim(id){
      if(!validActorId(id))return Promise.reject(Error('Invalid private intent identity.'));
      if(closed)return Promise.reject(Error('Private creation storage is closed.'));
      if(held.has(id))return Promise.resolve(true);if(claims.has(id))return claims.get(id);
      const pending=new Promise((resolve,reject)=>{
        navigator.locks.request('aim-next-intent:'+rowKey(id),{mode:'exclusive',ifAvailable:true},granted=>{
          if(!granted||closed){resolve(false);return;}
          const lifetime=new Promise(end=>held.set(id,end));resolve(true);return lifetime;
        }).catch(reject);
      });claims.set(id,pending);pending.then(()=>claims.delete(id),()=>claims.delete(id));return pending;
    },
    put(value){
      const row={...structuredClone(value),scope,key:rowKey(value.id)};
      if(!valid(row))return Promise.reject(Error('The private intent does not match this actor and instance.'));
      const next=(queues.get(row.id)??Promise.resolve()).catch(()=>{}).then(()=>transact('readwrite',(store,finish,fail)=>{
        if(!held.has(row.id))throw Error('Open in another tab — this intent is read-only.');
        store.get(row.key).onsuccess=event=>{
          try{
            const old=event.target.result;
            if(old&&(!valid(old)||old.kind!==row.kind||old.authority.authority_id!==row.authority.authority_id||old.authority.authority_epoch!==row.authority.authority_epoch))throw Error('The private intent identity changed. It has not been replaced.');
            if(!held.has(row.id))throw Error('Private intent ownership was lost.');
            store.put(row);finish(publicRow(row));
          }catch(error){fail(error);}
        };
      }));
      queues.set(row.id,next);const done=()=>{if(queues.get(row.id)===next)queues.delete(row.id);};next.then(done,done);return next;
    },
    page({workspace=null,cursor=null,limit=20}={}){
      if(!Number.isInteger(limit)||limit<1||limit>20||workspace!==null&&!validActorId(workspace)||cursor!==null&&!validActorId(cursor))throw Error('Invalid private intent page.');
      return transact('readonly',(store,finish,fail)=>{
        const prefix=workspace===null?[scope]:[scope,workspace],items=[];let examined=0,last=null;
        const range=IDBKeyRange.bound([...prefix,cursor??''],[...prefix,[]],cursor!==null);
        store.index(workspace===null?'scope':'workspace').openCursor(range).onsuccess=event=>{
          try{
            const entry=event.target.result;
            if(!entry){finish({items,nextCursor:null,examined});return;}
            if(examined===limit){finish({items,nextCursor:last,examined});return;}
            const row=entry.value,retired=row?.scope===scope&&retiredOpening(row);
            if(!retired&&!valid(row))throw Error('A saved intent cannot be read safely. It has been kept.');
            const include=!retired&&row.phase!=='confirmed',summary=include?intentSummary(row):null;
            if(include&&bytes([...items,summary])>16384){finish({items,nextCursor:last,examined});return;}
            examined++;last=row.id;if(include)items.push(summary);entry.continue();
          }catch(error){fail(error);}
        };
      });
    },
    close(){database.close();release();},
  };
}
