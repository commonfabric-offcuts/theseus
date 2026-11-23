import {glyph} from './glyphs.mjs';

const keyOf=item=>item.key??item.label;
const pressed=new Set(['Unstar','Mark read','Bring back']);
const keyItems=new Set(['fold','fold-stack','open-stack','level','move-up','move-down','join-up','join-down','undo','reset','moves']);
const rowOrder=['Ask for update','cover-refresh','Edit','Start a topic from this','Start a new dossier','Add to pipeline','Move to topic…','Withdraw question','Show full message','split'];
const families=[['fold',['fold','fold-stack','open-stack','level']],['move',['move-up','move-down']],['join',['join-up','join-down']],['',['undo','reset','moves']]];
const short={reset:'reset place',moves:'move or join…'};

// Classification changes presentation only; exact offered items/acts stay owned
// by their source. In particular two start buttons never share an action.
export function messagePaletteParts(items) {
  const marks=new Map(),keys=[],rows=[],danger=[];let link=null;
  for(const item of items) {
    const key=keyOf(item);
    if(key==='rename'||item.label==='Rename'||/^Break out paragraphs/.test(item.label))continue;
    if(key==='Copy Link')link=item;
    else if(key==='Mark read'||key==='Mark unread'){if(!marks.has('read'))marks.set('read',item);}
    else if(key==='star'||key==='aside')marks.set(key,item);
    else if(keyItems.has(key))keys.push(item);
    else if(['Unsend','Retract','Delete'].includes(item.label))danger.push(item);
    else rows.push(item);
  }
  const rank=item=>{const n=rowOrder.indexOf(keyOf(item));return n<0?rowOrder.length:n;};
  rows.sort((a,b)=>rank(a)-rank(b));
  const topic=rows.find(item=>keyOf(item)==='Start a topic from this'),dossier=rows.find(item=>keyOf(item)==='Start a new dossier');
  return {marks:['star','read','aside'].flatMap(key=>marks.has(key)?[marks.get(key)]:[]),link,keys,danger,
    rows:topic&&dossier?rows.flatMap(item=>item===topic?[[topic,dossier]]:item===dossier?[]:[item]):rows};
}

export function renderMessagePalette({doc,root,items,makeButton,glyphFor}) {
  const parts=messagePaletteParts(items),element=(tag,cls)=>Object.assign(doc.createElement(tag),{className:cls});
  const buttonFor=item=>{
    const button=makeButton(item,items.indexOf(item));button.dataset.menuKey=keyOf(item);
    button.dataset.menuLabel=item.label;button.dataset.menuKeys=item.keys??'';
    button.setAttribute('aria-label',item.label);button.title=item.label;return button;
  };
  const separator=()=>{const node=element('div','palette-sep');node.setAttribute('role','separator');return node;};
  const marksRow=element('div','palette-marks'),markButtons=parts.marks.map(item=>{
    const button=buttonFor(item),on=pressed.has(item.label),name=item.label+(item.keys?' '+item.keys:'');
    button.classList.add('palette-icon');button.setAttribute('role','menuitemcheckbox');
    button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-checked',String(on));
    button.setAttribute('aria-label',name);button.title=name;button.replaceChildren(glyphFor(item));return button;
  });
  marksRow.append(...markButtons);const linkButtons=[];
  if(parts.link){
    const button=buttonFor(parts.link);button.classList.add('palette-icon','palette-link');
    button.setAttribute('aria-label','Copy link');button.title='Copy link';button.replaceChildren(glyphFor(parts.link));
    marksRow.append(button);linkButtons.push(button);
  }
  const rowButtons=[],rows=element('div','palette-rows');
  for(const entry of parts.rows) {
    if(Array.isArray(entry)) {
      const pair=element('div','palette-pair'),words=element('span','palette-pair-words'),choices=element('span','palette-seg');
      pair.setAttribute('role','group');pair.setAttribute('aria-label','Start new');words.textContent='Start new';words.append(glyph('topic',doc));
      for(const item of entry){const button=buttonFor(item);button.replaceChildren(keyOf(item)==='Start a new dossier'?'Dossier':'Topic');choices.append(button);rowButtons.push(button);}
      pair.append(words,choices);rows.append(pair);
    } else {const button=buttonFor(entry);rows.append(button);rowButtons.push(button);}
  }
  const dangerButtons=parts.danger.map(item=>{const button=buttonFor(item);button.classList.add('palette-danger');return button;});
  const foot=element('div','palette-keys'),keyButtons=[];
  for(const [word,family]of families) {
    const group=parts.keys.filter(item=>family.includes(keyOf(item)));if(!group.length)continue;
    const span=element('span','palette-key-group');
    if(word){const name=element('span','palette-key-word');name.textContent=word;span.append(name);}
    for(const item of group) {
      const key=keyOf(item),cap=item.keys||(key==='fold'?'x':null),button=buttonFor(item);
      const label=element(cap?'kbd':'span','palette-key-cap');
      label.textContent=cap??(key==='level'?(item.label.startsWith('Show all')?'all':'latest'):short[key]??item.label);
      button.replaceChildren(label);span.append(button);keyButtons.push(button);
    }
    foot.append(span);
  }
  root.classList.add('menu-palette');
  if(markButtons.length||linkButtons.length)root.append(marksRow);
  if(rowButtons.length){if(root.children.length)root.append(separator());root.append(rows);}
  if(dangerButtons.length){if(root.children.length)root.append(separator());root.append(...dangerButtons);}
  if(keyButtons.length){if(root.children.length)root.append(separator());root.append(foot);}
  const buttons=[...markButtons,...linkButtons,...rowButtons,...dangerButtons,...keyButtons];
  return {buttons,first:[...rowButtons,...dangerButtons,...keyButtons].find(button=>!button.disabled)};
}
