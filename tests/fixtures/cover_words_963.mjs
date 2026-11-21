import { arrangeStacks } from '/reply-stacks.mjs';
import { formatWords, drawPassages } from '/message-format.mjs';
import { Reader } from '/reader.mjs';

const context={viewer:'scratch-reader',nameOf:x=>x};
const list=document.querySelector('#messages');
let cover={stands:'Plain standing words',waiting:[],payload:null,owner:'scratch-reader',root_id:'root',
  by:'writer',at_ms:1795230000000,revision:1};
const messages=new Map([
 ['root',{id:'root',seq:1,topic_id:'scratch963',body:'A synthetic root',author_id:'scratch-reader',author_kind:'human',acts:{cover},unread:false}],
 ['reply',{id:'reply',seq:2,topic_id:'scratch963',reply_to:'root',body:'A synthetic reply',author_id:'scratch-agent',author_kind:'agent',acts:{},unread:false}]
]);
for(const item of messages.values()){
  const card=document.createElement('button');card.className='message-card';card.dataset.id=item.id;card.dataset.seq=String(item.seq);
  const who=document.createElement('span');who.className='message-author';who.textContent=item.author_id;
  const words=document.createElement('span');words.className='message-preview';formatWords(words,item.body);
  card.append(who,words);list.append(card);
}
const reader=Object.assign(Object.create(Reader.prototype),{
  $:id=>document.getElementById(id),callbacks:{actor:()=>context.viewer,actorName:x=>x,
    dossierCover:()=>({rootId:'root',topicId:'scratch963',cover})}
});
window.paint963=stands=>{
  cover={...cover,stands,revision:cover.revision+1,at_ms:cover.at_ms+1000};messages.get('root').acts.cover=cover;
  arrangeStacks(list,messages,{doc:document,...context,unread:()=>false});
  reader.paintCover({source_ref:{kind:'message',id:'root'}});
  formatWords(document.querySelector('[data-id=root] .message-preview'),stands);
  drawPassages(document.querySelector('#reference'),stands,document);
  return {revision:cover.revision,at_ms:cover.at_ms,stands:cover.stands};
};
window.paint963(cover.stands);window.ready963=true;
