import { NotebookWriting, notebookStore, notebookDeleted } from './notebook-writing.mjs';
// Document ownership outlives in-place page runs; the journal outlives documents.
const documents=new WeakMap(),nativeAdd=globalThis.EventTarget?.prototype?.addEventListener;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const editing=event=>event.target?.closest?.('input,textarea,[contenteditable]');
export async function notebookDeleteUI({doc,shell,api,bootstrap,open,current}) {
  const key=JSON.stringify([bootstrap.instance_id,bootstrap.actor,bootstrap.authority]);
  let ui=documents.get(doc);
  if(!ui||ui.key!==key) {
    ui?.dispose();
    ui={key,rows:new Map(),pages:new Map(),flights:new Map(),writers:new Map(),undoWanted:new Set(),retained:new Set(),departures:new Map(),listeners:[],error:null};documents.set(doc,ui);
    const on=(target,type,fn)=>{
      if(!target?.addEventListener)return;
      // This document owner survives the shell's page-run listener retirement.
      // Use the pre-wrap native method in browsers; adapters own their listeners.
      if(nativeAdd)nativeAdd.call(target,type,fn);else target.addEventListener(type,fn);
      ui.listeners.push([target,type,fn]);
    };
    ui.dispose=()=>{if(ui.timer!==undefined)clearTimeout(ui.timer);for(const [t,k,f]of ui.listeners)t.removeEventListener?.(k,f);};
    ui.observe=w=>{if(w.journalPending||w.journalError)return;if(w.deleteUndo)ui.rows.set(w.item,{binding:w.binding,undo:structuredClone(w.deleteUndo),error:w.actionError});else ui.rows.delete(w.item);ui.render();};
    ui.available=row=>!row.undo.undoRequested&&['pending','committed'].includes(row.undo.phase)&&
      (row.undo.phase!=='committed'||Date.now()<row.undo.expires)&&same(row.undo.authority,{authority_id:ui.owner.bootstrap.authority.authority_id,authority_epoch:ui.owner.bootstrap.authority.authority_epoch});
    ui.render=()=>{
      if(documents.get(doc)!==ui)return;
      let host=doc.getElementById('notebook-delete-notice');
      const rows=[...ui.rows.values()].filter(r=>(r.undo.phase!=='committed'||r.undo.undoRequested||Date.now()<r.undo.expires)).sort((a,b)=>b.undo.at-a.undo.at);
      if(ui.timer!==undefined){clearTimeout(ui.timer);ui.timer=undefined;}
      const next=rows.filter(r=>r.undo.phase==='committed'&&!r.undo.undoRequested).map(r=>r.undo.expires-Date.now());
      if(next.length)ui.timer=setTimeout(ui.render,Math.max(1,Math.min(...next)));
      if(!rows.length&&!ui.error&&!ui.cursor){host?.remove();return;}
      if(!host){host=doc.createElement('section');host.id='notebook-delete-notice';host.className='notice';host.setAttribute('aria-label','Notebook changes');host.setAttribute('role','status');const header=doc.querySelector('.topic-header');if(header)header.after(host);else doc.getElementById('main')?.prepend(host);}
      const nodes=[],button=(label,act)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>Promise.resolve().then(act).catch(e=>{ui.error=e.message;ui.render();});return b;};
      if(ui.error){const p=doc.createElement('p');p.textContent=ui.error;nodes.push(p);}
      for(const row of rows){const {undo:u,binding:{item_id:id}}=row,line=doc.createElement('p');line.dataset.notebookDelete=id;
        line.append(u.phase==='undone'?`Restored “${u.title}”. `:u.phase==='rejected'?`Could not delete “${u.title}”. `:u.phase==='restore_rejected'?`Could not restore “${u.title}”. `:
          u.undoRequested?`Restoring “${u.title}”; confirmation is not known yet. `:u.phase==='committed'?`Deleted “${u.title}”. `:
          `Delete for “${u.title}” is kept; confirmation is not known yet. `);
        if(row.error)line.append(row.error+' ');
        if(ui.available(row))line.append(button('Undo',()=>ui.drive(id,true)));
        if(!['committed','rejected','restore_rejected','undone'].includes(u.phase)||u.phase==='committed'&&u.undoRequested)line.append(' ',button('Retry',()=>ui.drive(id,false)));
        if(['rejected','restore_rejected','undone'].includes(u.phase))line.append(' ',button('Open page',()=>ui.owner.open(id,u.mode,u.scope)));
        nodes.push(line);
      }
      if(ui.cursor)nodes.push(button('Older Notebook changes',async()=>{await ui.loadMore();ui.render();}));
      host.replaceChildren(...nodes);
    };
    ui.drive=(id,undo)=>{
      const existing=ui.flights.get(id);if(existing){if(undo){ui.undoWanted.add(id);const writer=ui.writers.get(id);if(writer?.deleteUndo){ui.undoWanted.delete(id);return writer.undoDelete().then(()=>existing);}}return existing;}
      const run=(async()=>{
        let page=ui.pages.get(id),w=page?.writing,store,owned=false;
        if(!w||w.closed){store=await notebookStore({instance_id:ui.owner.bootstrap.instance_id,actor_id:ui.owner.bootstrap.actor,item_id:id});
          w=new NotebookWriting({item:id,bootstrap:ui.owner.bootstrap,api:{view:(...args)=>ui.owner.api.view(...args),command:envelope=>{if(documents.get(doc)!==ui||!ui.owner.current())throw Error('This page has moved. Retry on the current page.');return ui.owner.api.command(envelope);}},store,changed:writer=>ui.observe(writer)});owned=true;}
        try {
          ui.writers.set(id,w);
          if(owned)await w.open(async()=>{if(ui.undoWanted.delete(id))await w.undoDelete();});
          if(undo)await w.undoDelete();
          else {if(!owned&&w.actionPending)await w.retryAction();if(w.deleteUndo?.undoRequested)await w.finishDeleteUndo();}
          if(w.deleteUndo?.phase==='committed'&&!w.deleteUndo.undoRequested&&Date.now()>=w.deleteUndo.expires)await w.forgetDeleteUndo();
          ui.observe(w);
          if(w.deleteUndo?.phase==='undone')return structuredClone(w.deleteUndo);
        }finally{if(ui.writers.get(id)===w)ui.writers.delete(id);if(owned||page?.detached){await w.serial.catch(()=>{});w.close();(store??page.store).close();if(ui.pages.get(id)===page)ui.pages.delete(id);}}
      })();
      ui.flights.set(id,run);
      return run.finally(()=>{if(ui.flights.get(id)===run)ui.flights.delete(id);}).then(target=>target?ui.owner.open(id,target.mode,target.scope):undefined);
    };
    on(doc,'keydown',event=>{
      if(event.defaultPrevented||event.isComposing||editing(event)||event.key.toLowerCase()!=='z'||!(event.metaKey||event.ctrlKey)||event.shiftKey||event.altKey)return;
      const row=[...ui.rows.values()].filter(ui.available).sort((a,b)=>b.undo.at-a.undo.at)[0];
      if(row){event.preventDefault();event.stopImmediatePropagation();ui.drive(row.binding.item_id,true).catch(e=>{ui.error=e.message;ui.render();});}
    });
    on(doc,'beforeinput',event=>{
      if(event.defaultPrevented||event.inputType!=='historyUndo'||editing(event))return;
      const row=[...ui.rows.values()].filter(ui.available).sort((a,b)=>b.undo.at-a.undo.at)[0];
      if(row){event.preventDefault();ui.drive(row.binding.item_id,true).catch(e=>{ui.error=e.message;ui.render();});}
    });
    on(doc.defaultView,'pagehide',event=>{if(event.isTrusted)for(const page of ui.pages.values()){page.writing?.close();page.writing?.serial.finally(()=>page.store?.close());}});
    ui.loadMore=async()=>{const result=await notebookDeleted(bootstrap,globalThis,ui.cursor);ui.cursor=result.cursor;for(const row of result.rows)if(!ui.rows.has(row.binding.item_id))ui.rows.set(row.binding.item_id,row);};
    ui.loading=ui.loadMore().catch(e=>{ui.error='Saved Notebook changes could not be read: '+e.message;});
  }
  ui.owner={api,bootstrap,open,current};await ui.loading;ui.render();
  return {
    async beforeOpen(id){await ui.departures.get(id);await ui.flights.get(id);},
    async register(page){ui.pages.set(page.item,page);if(page.writing.deleteUndo?.phase==='undone')await page.writing.forgetDeleteUndo();ui.observe(page.writing);},
    changed(w){if(w.deleteUndo)ui.observe(w);},
    retains(w){return ui.retained.has(w);},
    release(page){if(!ui.retained.has(page.writing)&&ui.pages.get(page.item)===page)ui.pages.delete(page.item);},
    remove(page,close){
      const run=(async()=>{const w=page.writing;if(!w||page.unavailable)return;
      ui.retained.add(w);
      let departed=false;w.actionKept=async()=>{if(!departed){departed=true;await close();}};
      try {
        await w.action('memory.delete',{deleted:true},{title:w.value.title,scope:w.pageState.owner_scope,mode:page.mode});
        if(w.deleteUndo?.undoRequested)await w.finishDeleteUndo();ui.observe(w);
      }finally{
        w.actionKept=null;ui.retained.delete(w);
        if(departed&&!ui.flights.has(page.item)){await w.serial.catch(()=>{});w.close();page.store.close();if(ui.pages.get(page.item)===page)ui.pages.delete(page.item);}
      }})();ui.departures.set(page.item,run);return run.finally(()=>{if(ui.departures.get(page.item)===run)ui.departures.delete(page.item);});
    },
    start(){ui.render();if(ui.resumed)return;ui.resumed=true;for(const row of ui.rows.values())if(row.undo.phase==='committed'&&!row.undo.undoRequested&&Date.now()>=row.undo.expires||row.undo.phase==='pending'||row.undo.undoRequested&&['committed','undone'].includes(row.undo.phase))ui.drive(row.binding.item_id,false).catch(e=>{ui.error=e.message;ui.render();});},
  };
}
