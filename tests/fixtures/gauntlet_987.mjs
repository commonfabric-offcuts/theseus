import { PipelinePage } from './pipeline.mjs';
import records from './records987data.mjs';
const host=document.querySelector('#cards');
const painter=new PipelinePage({host,header:document.createElement('header'),reader:'agent-b',instanceId:'test-instance',workspace:'w1',read:()=>{throw Error('no reads');},send:()=>{throw Error('no writes');}});
for(const [state,record] of Object.entries(records)){
  const box=document.createElement('section');box.dataset.state=state;
  const title=document.createElement('h2');title.textContent=state;box.append(title);
  const piece=record.pieces[0];
  box.append(painter.pieceCard(piece,new Map(record.items.map(i=>[i.number,i])),record.pipeline,Date.now(),true));
  host.append(box);
}
window.records987=records;window.ready987=true;
