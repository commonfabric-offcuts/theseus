import { openMessageMenu } from './message-menu.mjs';
import { readTopicList, TopicPages, listArgs, PAGE } from './topic-navigation.mjs';
import { arrangeItems, book, scopeOf } from './outline-order.mjs';

// Destination discovery is read-only and paged. A chosen destination is still
// checked by Core at the same transaction as the source revision and quotes.
export async function notebookDestinations(read,scope,cursor=null,list='active',state=null) {
  const checked=answer=>{if(answer?.error)throw Error(answer.error.message);return answer;};
  const workspace=scope.kind==='workspace'?scope.id:checked(await read('topic',{topic_id:scope.id})).topic?.workspace_id;
  if(!workspace)throw Error('The page’s outcome could not be read.');
  const outcome=checked(await read('workspace',{workspace_id:workspace}));
  const topics=await readTopicList(async(...args)=>checked(await read(...args)),
    {workspace_id:workspace,...listArgs(list,true),limit:PAGE,...(cursor===null?{}:{cursor})});
  if(outcome.workspace?.id!==workspace)throw Error('The destination Notebooks could not be confirmed.');
  const pages=state?.pages??new TopicPages(topics.instance_id,workspace,null,list,true);
  if(pages.workspaceId!==workspace||pages.list!==list)throw Error('The destination Notebooks changed. Choose again.');
  // A direct paged read can start at a cursor; picker More keeps the actual
  // owner, so its loaded extent and conversation survive subsequent pages.
  if(cursor!==null&&!pages.started){pages.started=true;pages.next=cursor;}
  if(!pages.accept(topics,cursor))throw Error('The destination topics changed. Choose again.');
  if(state)state.pages=pages;
  book.learn(scopeOf(workspace),pages.order);
  return {outcome:{scope:{kind:'workspace',id:workspace},label:outcome.workspace.title},
    topics:arrangeItems(pages.items,book.ids(scopeOf(workspace))).map(t=>({scope:{kind:'topic',id:t.id},label:t.title})),cursor:pages.next};
}

export async function chooseNotebookDestination(page,kind,cursor=null,show=openMessageMenu,list='active',state=null) {
  const writer=page.writing,source=writer?.pageState;
  if(!source||writer.closed)return;
  try {
    const selection=state??{};
    const model=await notebookDestinations((...args)=>page.read(...args),source.owner_scope,cursor,list,selection);
    if(page.writing!==writer||writer.closed)return;
    const choice=({scope,label})=>({key:scope.kind+':'+scope.id,label,glyph:scope.kind==='topic'?'topic':'dossier',
      disabled:kind==='memory.move'&&scope.kind===source.owner_scope.kind&&scope.id===source.owner_scope.id,
      act:()=>page.writing===writer&&!writer.closed&&page.transferPage(kind,scope)});
    const items=[choice({...model.outcome,label:model.outcome.label+' · Outcome Notebook'}),...model.topics.map(choice)];
    if(model.cursor!==null)items.push({key:'more',label:'More topics…',glyph:'down',act:()=>chooseNotebookDestination(page,kind,model.cursor,show,list,selection)});
    for(const [key,label]of [['active','Open topics…'],['done','Done topics…'],['archived','Archived topics…']])if(key!==list)
      items.push({key,label,glyph:'topic',act:()=>chooseNotebookDestination(page,kind,null,show,key)});
    return show({doc:page.doc,anchor:page.more,items,label:kind==='memory.copy'?'Copy page to…':'Move page to…',sheet:true});
  } catch(error){if(page.writing===writer&&!writer.closed)page.say(error.message,'attention');}
}
