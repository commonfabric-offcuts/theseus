import { openMessageMenu } from './message-menu.mjs';

// Destination discovery is read-only and paged. A chosen destination is still
// checked by Core at the same transaction as the source revision and quotes.
export async function notebookDestinations(read,scope,cursor=null,list='active') {
  const checked=answer=>{if(answer?.error)throw Error(answer.error.message);return answer;};
  const workspace=scope.kind==='workspace'?scope.id:checked(await read('topic',{topic_id:scope.id})).topic?.workspace_id;
  if(!workspace)throw Error('The page’s outcome could not be read.');
  const outcome=checked(await read('workspace',{workspace_id:workspace}));
  const topics=checked(await read('workspace_topics',{workspace_id:workspace,limit:50,...(list==='done'?{done:true}:list==='archived'?{archived:true}:{}),...(cursor===null?{}:{cursor})}));
  if(outcome.workspace?.id!==workspace||!Array.isArray(topics.items))throw Error('The destination Notebooks could not be confirmed.');
  return {outcome:{scope:{kind:'workspace',id:workspace},label:outcome.workspace.title},
    topics:topics.items.map(t=>({scope:{kind:'topic',id:t.id},label:t.title})),cursor:topics.next_cursor??null};
}

export async function chooseNotebookDestination(page,kind,cursor=null,show=openMessageMenu,list='active') {
  const writer=page.writing,source=writer?.pageState;
  if(!source||writer.closed)return;
  try {
    const model=await notebookDestinations((...args)=>page.read(...args),source.owner_scope,cursor,list);
    if(page.writing!==writer||writer.closed)return;
    const choice=({scope,label})=>({key:scope.kind+':'+scope.id,label,glyph:scope.kind==='topic'?'topic':'dossier',
      disabled:kind==='memory.move'&&scope.kind===source.owner_scope.kind&&scope.id===source.owner_scope.id,
      act:()=>page.writing===writer&&!writer.closed&&page.transferPage(kind,scope)});
    const items=[choice({...model.outcome,label:model.outcome.label+' · Outcome Notebook'}),...model.topics.map(choice)];
    if(model.cursor!==null)items.push({key:'more',label:'More topics…',glyph:'down',act:()=>chooseNotebookDestination(page,kind,model.cursor,show,list)});
    for(const [key,label]of [['active','Open topics…'],['done','Done topics…'],['archived','Archived topics…']])if(key!==list)
      items.push({key,label,glyph:'topic',act:()=>chooseNotebookDestination(page,kind,null,show,key)});
    return show({doc:page.doc,anchor:page.more,items,label:kind==='memory.copy'?'Copy page to…':'Move page to…',sheet:true});
  } catch(error){if(page.writing===writer&&!writer.closed)page.say(error.message,'attention');}
}
