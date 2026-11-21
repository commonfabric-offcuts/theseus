import { NotebookRailMenu } from './notebook-rail-menu.mjs';
import { RailMenuCommands } from './rail-menu-commands.mjs';
import { openMessageMenu } from './message-menu.mjs';

// The thumbnail borrows the page's existing descriptors and writer route.
// Opening a menu reads current metadata only; writing starts at an explicit act.
export class NotebookThumbnailMenu {
  constructor({bootstrap,api,read,open,loaded,mode,current,notice,changed,show=openMessageMenu}) {
    Object.assign(this,{bootstrap,api,read,current,notice,show});this.serial=0;
    this.handles={bootstrap,api};this.commands=new RailMenuCommands();
    this.pages=new NotebookRailMenu({open,loaded,mode,current:()=>current(),notice,changed,
      layout:()=>({canDock:()=>false,dossiers:false})});
  }
  async open(item,row,at=null) {
    const serial=++this.serial,id=item.id;
    const current=()=>this.serial===serial&&this.current()&&row.isConnected!==false&&row.dataset.id===id;
    this.menu?.close(false);this.waiting?.abort();this.menu=null;
    const waiting=this.waiting=new AbortController(),doc=row.ownerDocument;
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'||event.key==='Tab'){++this.serial;waiting.abort();}}, {capture:true,signal:waiting.signal});
    doc.addEventListener('pointerdown',event=>{
      if(!row.contains(event.target)&&!this.menu?.root?.contains(event.target)){++this.serial;waiting.abort();}
    }, {capture:true,signal:waiting.signal});
    try {
      const source=await this.read('memory_current',{item_id:id});
      if(!current()){waiting.abort();return;}
      if(source.instance_id!==this.bootstrap.instance_id||source.source_ref?.kind!=='memory'||source.source_ref.id!==id||
        !Number.isSafeInteger(source.source_ref.revision)||source.source_ref.revision<1||
        source.owner_scope?.kind!==item.owner_scope.kind||source.owner_scope.id!==item.owner_scope.id)
        throw Error('The Notebook page could not be confirmed.');
      const items=this.pages.items(source,(key,label)=>{
        if(!current())return;
        return Promise.resolve(this.pages.act(source,key,label,row,this.commands,this.handles)).catch(error=>{if(current())this.notice(error);});
      });
      if(current()) {
        this.menu=this.show({anchor:row,at,items,label:'This page',sheet:true,doc});
        if(this.menu){const close=this.menu.close;this.menu.close=restore=>{waiting.abort();close(restore);};}
        else waiting.abort();
      }
    }catch(error){if(current())this.notice(error);waiting.abort();}
  }
}
