import test from 'node:test';
import assert from 'node:assert/strict';
import { A, B, card, details, cardText, parseDeck, deckBody, cardDetails, menuPage, text867, NotebookPage, NotebookWriting, DeckPage, textCard, painted867, edit867, press867, choice867, clipboard } from './fixtures/card_menu_867.mjs';

// ===== refute probes: appended to a copy of tests/ui_card_menu_867.test.mjs; drives the real DeckPage through the painted ⋯ =====
function freshR4(p,after,near,written){
 const field=p.doc.createElement('textarea');field.value=written;
 p.editing={text:'',after,depth:0,near,fresh:true,field,stacks:[],images:[],details:[],kept:''};p.doc.body.append(field);
}
function pressMaybe(p,at){
 const row=p.list.children[at],button=row.querySelector('.deck-menu');if(!button)return {row,button:null,menu:null};
 button.listeners.click({target:button,stopPropagation(){}});
 return {row,button,menu:p.doc.body.querySelector('[role="menu"]')};
}
const titles=p=>p.deck.cards.map(c=>c.title);
test('PROBE A4 a fresh card (Return after One) being written: ⋯ on each other card deletes that card',t=>{
 for(const [press,expect] of [[0,['New','Two','Three']],[2,['One','New','Three']],[3,['One','New','Two']]]){
  const p=painted867(t,menuPage(card('One','one',null)+card('Two','two',null)+card('Three','three',null)));
  freshR4(p,cardText(p.deck.cards[0]),0,'New');p.paint();
  assert.ok(p.list.children[1].classList.contains('deck-writing'));assert.equal(p.list.children[1].dataset.index,'1');assert.equal(p.list.children[2].dataset.index,'1');
  assert.equal(p.list.children[1].querySelector('.deck-menu'),null,'a fresh holder has no ⋯');
  choice867(press867(p,press),'Delete');assert.deepEqual(titles(p),expect,'pressed row '+press);
 }
});
test('PROBE A4b a fresh card above One (Option-Return on the first card): ⋯ on One deletes One',t=>{
 const p=painted867(t,menuPage(card('One','one',null)+card('Two','two',null)));
 freshR4(p,null,-1,'New');p.paint();assert.ok(p.list.children[0].classList.contains('deck-writing'));
 choice867(press867(p,1),'Delete');assert.deepEqual(titles(p),['New','Two']);
});
test('PROBE A4d twins: Option-Return above the second Todo (with a child), ⋯ on that Todo',t=>{
 const p=painted867(t,menuPage(card('Todo','',null)+card('Todo','',null)+'### Only under the second\n\nkid\n\n'));
 p.picked=1;freshR4(p,cardText(p.deck.cards[0]),0,'New idea');p.paint();
 choice867(press867(p,2),'Delete');assert.deepEqual(titles(p),['Todo','New idea']);
});
test('PROBE A6 identical twins with children: a cleared or extended twin box and the other twin\'s ⋯',t=>{
 const raw=card('Same','same',details(A))+'### kid a\n\nka\n\n'+card('Same','same',details(B))+'### kid b\n\nkb\n\n';
 let p=painted867(t,menuPage(raw));edit867(p,0,'');p.paint();choice867(press867(p,2),'Delete');assert.deepEqual(titles(p),[]);
 p=painted867(t,menuPage(raw));edit867(p,0,'');p.paint();choice867(press867(p,3),'Delete');assert.deepEqual(titles(p),['Same']);assert.equal(cardDetails(p.deck.cards[0].words).id,B);
 p=painted867(t,menuPage(raw));edit867(p,2,'');p.paint();choice867(press867(p,0),'Delete');assert.deepEqual(titles(p),[]);
 p=painted867(t,menuPage(raw));edit867(p,2,'');p.paint();choice867(press867(p,1),'Delete');assert.deepEqual(titles(p),['Same']);assert.equal(cardDetails(p.deck.cards[0].words).id,A);
 p=painted867(t,menuPage(raw));edit867(p,2,'');p.paint();const {menu}=pressMaybe(p,3);assert.equal(menu,null,'kid b goes with its cleared parent: no menu');assert.deepEqual(titles(p),['Same','kid a']);
 p=painted867(t,menuPage(raw));edit867(p,0,'Same\nsame\n\n### extra\nmore');p.paint();choice867(press867(p,2),'Delete');assert.deepEqual(titles(p),['Same','extra','kid a']);assert.equal(cardDetails(p.deck.cards[0].words).id,A);
});
test('PROBE A7 the holder\'s own ⋯ when its writing adds a heading deletes the written card only',t=>{
 const p=painted867(t,menuPage(card('Budget','words',details(A))+card('Other','o',details(B))));
 edit867(p,0,'Budget\nwords\n\n## Added\nmore');p.paint();choice867(press867(p,0),'Delete');assert.deepEqual(titles(p),['Added','Other']);
});
test('PROBE A9 the holder\'s own ⋯ with the box cleared opens no menu and removes the card',t=>{
 const p=painted867(t,menuPage(card('Budget','words',details(A))+card('Other','o',details(B))));
 edit867(p,0,'');p.paint();const {menu}=pressMaybe(p,0);assert.equal(menu,null);assert.deepEqual(titles(p),['Other']);
});
// Own probe: a card ABOVE a non-fresh editor whose writing adds a heading (the claim's suggested case).
test('PROBE X1 ⋯ on the card above an editor that adds a heading deletes that card, not its neighbour',t=>{
 const p=painted867(t,menuPage(card('Top','t',null)+card('Budget','words',details(A))+card('Below','b',null)));
 edit867(p,1,'Budget\nwords\n\n## Added\nmore');p.paint();assert.equal(p.list.children[0].dataset.index,'0');
 choice867(press867(p,0),'Delete');assert.deepEqual(titles(p),['Budget','Added','Below']);
});
// Own probe: a child's ⋯ while its parent's box is cleared removes the group and opens no menu; the card after the group is untouched.
test('PROBE X2 a child ⋯ under a cleared parent box opens no menu and leaves the next card alone',t=>{
 const p=painted867(t,menuPage(card('Parent','p',details(A))+'### kid\n\nk\n\n'+card('Next','n',details(B))));
 edit867(p,0,'');p.paint();assert.equal(p.list.children[1].dataset.index,'1');
 const {menu}=pressMaybe(p,1);assert.equal(menu,null,'no menu for a row the cleared box removes');assert.deepEqual(titles(p),['Next']);
});
