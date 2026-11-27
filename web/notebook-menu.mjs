import { openMessageMenu } from './message-menu.mjs';

// Notebook descriptors name their place; the shared menu still owns its one
// open instance, outside press, scroll, Escape and focus return. Reparent the
// same buttons, retaining their acts and the shared linear keyboard order.
export function openNotebookMenu(options) {
  const {items,doc=globalThis.document,win=globalThis,anchor,at=null}=options;
  const menu=openMessageMenu({...options,doc,win});if(!menu)return menu;
  const root=menu.root,buttons=[...root.children];root.classList.add('notebook-palette');
  if (anchor.dataset?.pageId && anchor.closest?.('#things, #outcome-references')) root.classList.add('notebook-surface');
  let group=null,groupName=null;
  for(let i=0;i<items.length;i++) {
    const item=items[i],button=buttons[i],place=item.place??'row';
    button.dataset.notebookAction=item.key??item.label;
    if(item.ariaLabel)button.setAttribute('aria-label',item.ariaLabel);
    if(item.description)button.title=item.description;
    if(place==='mark'||place==='swatch') {
      button.title=[item.label,item.keys].filter(Boolean).join(' · ');button.setAttribute('aria-label',item.label);
      button.setAttribute('role','menuitem');button.removeAttribute('aria-checked');
      if(item.checked!==undefined)button.setAttribute('aria-pressed',String(item.checked));
      button.classList.add(place==='swatch'?'notebook-swatch':'notebook-mark');
      if(place==='swatch') {
        button.replaceChildren();const dot=doc.createElement('span');dot.className='notebook-swatch-dot';
        if(item.color)button.classList.add('agent-'+item.color);else button.classList.add('no-colour');button.append(dot);
      } else {const icon=button.querySelector('svg');button.replaceChildren(...(icon?[icon]:[]));}
      if(item.key==='copy')button.classList.add('notebook-copy');
    }
    if(place==='danger')button.classList.add('notebook-danger');
    if(place==='key') {
      button.title=item.label;button.setAttribute('aria-label',item.label);button.replaceChildren(item.keys??item.label);
    }
    const name=['mark','swatch'].includes(place)?'marks':['view','start'].includes(place)?place:place==='key'?'keys':null;
    if(name) {
      if(groupName!==name){group=doc.createElement('div');group.className='notebook-menu-'+name;group.setAttribute('role','group');
        group.setAttribute('aria-label',name==='view'?'View':name==='start'?'Start new':name==='marks'?'Marks':'Keys');root.append(group);
        if(name==='view'||name==='start'){const label=doc.createElement('span');label.textContent=name==='view'?'View':'Start new';label.className='notebook-menu-caption';group.append(label);}}
      if(place==='key'&&item.keyGroup&&item.keyGroup!==items[i-1]?.keyGroup){const label=doc.createElement('span');label.textContent=item.keyGroup;group.append(label);}
      group.append(button);
    } else {root.append(button);group=null;}
    groupName=name;
  }
  root.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const enabled=buttons.filter(b=>!b.disabled),i=enabled.indexOf(doc.activeElement);
    enabled[(i+(event.key==='ArrowRight'?1:-1)+enabled.length)%enabled.length]?.focus({preventScroll:true});
  });
  const requested=options.focusKey==null?-1:items.findIndex(i=>i.key===options.focusKey);
  const ordinary=(i,n)=>!buttons[n].disabled&&!['mark','swatch','danger','key'].includes(i.place);
  // Keep the page's View and Reader Edit focus stops as the new copy row
  // moves to the front. The card's existing first action remains Copy text.
  const preferred=items.findIndex((i,n)=>ordinary(i,n)&&(options.label==='This card'||i.key!=='copy-text'));
  const first=preferred>=0?preferred:items.findIndex(ordinary);
  (buttons[requested>=0&&!buttons[requested].disabled?requested:first>=0?first:buttons.findIndex(b=>!b.disabled)])?.focus({preventScroll:true});
  if(!root.classList.contains('menu-sheet')) {
    const box=anchor.getBoundingClientRect(),width=root.offsetWidth||0,height=root.offsetHeight||0,W=win.innerWidth??Infinity,H=win.innerHeight??Infinity;
    const x=at?at.x:box.right-width,below=at?at.y:box.bottom+4,above=(at?at.y:box.top-4)-height;
    Object.assign(root.style,{left:Math.max(8,Math.min(x,W-width-8))+'px',top:Math.max(8,Math.min(below+height+8<=H?below:above,H-height-8))+'px'});
  }
  return menu;
}

export function notebookReaderMenuItems(source,act,copied) {
  const revision=source.source_ref.revision;
  return [
    {key:'star',place:'mark',label:source.starred?'Unstar':'Star',glyph:source.starred?'starred':'star',checked:Boolean(source.starred),act:()=>act('star')},
    {key:'copy',place:'mark',label:'Copy link',glyph:'link',act:()=>act('copy')},
    ...(copied?[copied]:[]),
    ...(source.reader_may_write?[{key:'edit',label:'Edit page',glyph:'pencil',act:()=>act('edit')}]:[]),
    {key:'revision',label:'Copy link to revision '+revision,glyph:'link',act:()=>act('revision')},
    ...['topic','dossier'].map(kind=>({key:'start-'+kind,place:'start',label:kind==='topic'?'Topic':'Dossier',ariaLabel:kind==='topic'?'Start a topic from this page':'Start a new dossier from this page',glyph:kind==='topic'?'topic':'pencil',act:()=>act('start-'+kind)})),
    ...(source.reader_may_write?[{key:'rename',label:'Rename',glyph:'pencil',act:()=>act('rename')}]:[]),
    ...(source.reader_may_delete?[{key:'delete',place:'danger',label:'Delete page',glyph:'drop',act:()=>act('delete')}]:[]),
  ];
}
