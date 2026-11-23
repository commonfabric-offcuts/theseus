// Real Cards/Notebook memory ports shared by retained reviewer replays.
import assert from 'node:assert/strict';
import { cardText } from '../../web/deck.mjs';
import { DeckPage } from '../../web/deck-page.mjs';
export * from './card_text_867.mjs';
export { DeckPage } from '../../web/deck-page.mjs';
export { NotebookWriting } from '../../web/notebook-writing.mjs';
export { textCard } from '../../web/deck.mjs';
function clipboard(t){const saved=[],old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>saved.push(text)}}});
 const location=globalThis.location;globalThis.location=new URL('https://fixture.invalid/');
 t.after(()=>{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;globalThis.location=location;});return saved;
}

function painted867(t,p){
 p.header.description??=p.doc.createElement('p');
 const old=globalThis.document;globalThis.document=p.doc;t.after(()=>{p.listening.abort();globalThis.document=old;});
 Object.assign(p,{talks:new Map(),room:null,keyed:false,opening:p.doc.createElement('div'),keyLines:[],editButton:p.doc.createElement('button'),mark(){},fit(){}});
 p.paint=()=>DeckPage.prototype.paint.call(p);return p;
}
function edit867(p,at,written){
 const c=p.deck.cards[at],shown=p.written(c),field=p.doc.createElement('textarea');field.value=written??cardText({title:c.title,words:shown.words});
 p.editing={text:cardText(c),shown:cardText({title:c.title,words:shown.words}),near:at,depth:c.depth,fresh:false,field,details:shown.details,stacks:[],images:[],kept:''};p.doc.body.append(field);
}
function press867(p,at){
 const button=p.list.children[at].querySelector('.deck-menu');assert.ok(button,'painted overflow');button.listeners.click({target:button,stopPropagation(){}});
 const menu=p.doc.body.querySelector('[role="menu"]');assert.ok(menu,'real shared menu');return menu;
}
function choice867(menu,key){const button=menu.querySelectorAll('button').find(n=>n.dataset.notebookAction===key||n.textContent===key);assert.ok(button);return button.onclick({preventDefault(){},stopPropagation(){}});}

export { clipboard, painted867, edit867, press867, choice867 };
