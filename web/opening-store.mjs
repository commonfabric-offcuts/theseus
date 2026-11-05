import { validActorId } from './creation.mjs';

// One row per opening on this device: writing Core has not acknowledged, the exact
// save whose answer was lost, and the exact publish envelope until Core answers.
// It never decides a save or a send. Rows written before `save` existed omit it.
const fields=['format','instanceId','actor','opening','workspace','topic','base','writing','publish','save'];
export function validDeviceRow(row,{instanceId,actor,opening}) {
  return Boolean(row&&row.format===1&&row.instanceId===instanceId&&row.actor===actor&&row.opening===opening&&
    validActorId(row.workspace)&&validActorId(row.topic)&&Number.isInteger(row.base)&&row.base>=0&&
    (row.writing===null||typeof row.writing==='object')&&(row.publish===null||typeof row.publish?.envelope==='object')&&
    (row.save===undefined||row.save===null||typeof row.save?.envelope==='object')&&
    Object.keys(row).every(key=>fields.includes(key)));
}

export async function openOpeningStore({instanceId,actor,indexedDB=globalThis.indexedDB}) {
  if(!validActorId(instanceId)||!validActorId(actor))throw Error('Opening storage needs a confirmed instance and actor.');
  const key=id=>JSON.stringify([instanceId,actor,id]);
  const database=await new Promise((resolve,reject)=>{
    let failed=false;const request=indexedDB.open('aim-next-openings',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('openings');
    request.onsuccess=()=>{if(failed)request.result.close();else resolve(request.result);};
    request.onerror=()=>{failed=true;reject(request.error);};
    request.onblocked=()=>{failed=true;reject(Error('Opening storage on this device is blocked by another tab.'));};
  });
  let closed=false;
  database.onversionchange=()=>{closed=true;database.close();};
  const transact=(mode,action)=>new Promise((resolve,reject)=>{
    if(closed){reject(Error('Opening storage on this device is closed.'));return;}
    const tx=database.transaction('openings',mode,mode==='readwrite'?{durability:'strict'}:undefined);let result=null;
    tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error??Error('Opening storage on this device failed.'));
    try{
      if(mode==='readwrite'&&tx.durability!=='strict')throw Error('Strict storage durability is unavailable on this device.');
      action(tx.objectStore('openings'),value=>{result=value;});
    }catch(error){reject(error);try{tx.abort();}catch{}}
  });
  return {
    get:opening=>transact('readonly',(store,finish)=>{
      store.get(key(opening)).onsuccess=event=>finish(event.target.result??null);
    }).then(row=>{
      if(row!==null&&!validDeviceRow(row,{instanceId,actor,opening}))throw Error('Writing kept on this device for this opening cannot be read safely. It has been kept.');
      return row;
    }),
    put:row=>{
      if(!validDeviceRow(row,{instanceId,actor,opening:row?.opening}))return Promise.reject(Error('This opening row does not belong to this instance and actor.'));
      return transact('readwrite',store=>{store.put(structuredClone(row),key(row.opening));});
    },
    remove:opening=>transact('readwrite',store=>{store.delete(key(opening));}),
    close(){closed=true;database.close();},
  };
}
