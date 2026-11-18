import assert from 'node:assert/strict';

// Observe the actual Reader instance after its normal show() has completed.
// This hook never opens a source or invokes an input handler.
export const observeReader = `(async()=>{
  const entry=document.querySelector('script[type="module"][src]').src;
  const {Reader}=await import(new URL('reader.mjs',entry).href);
  if(!Reader.prototype.item715Observed){
    const show=Reader.prototype.show;
    Reader.prototype.show=function(...args){const result=show.apply(this,args);window.item715Reader=this;return result;};
    Reader.prototype.item715Observed=true;
  }
  return true;
})()`;

export const readerSnapshot = `(()=>{
  const r=window.item715Reader, editor=r?.sessions?.reply;
  return {open:Boolean(document.querySelector('#reader')?.open),source:r?.source?.source_ref??null,
    topic:r?.source?.topic_id??null,context:editor?.context??null,writing:document.querySelector('#writing-body')?.value??null,
    words:document.querySelector('#source-body')?.textContent??null,url:location.href,
    navigation:document.querySelector('#topic-navigation-status')?.textContent??''};
})()`;

export function assertReaderDestination(actual, root, topic) {
  assert.equal(actual.open,true,'canonical root is open in the Reader');
  assert.deepEqual(actual.source,{kind:'message',id:root},'Reader opens its canonical root');
  assert.equal(actual.topic,topic,'Reader source belongs to its actual topic');
  assert.deepEqual(actual.context?.sourceRef,{kind:'message',id:root},'reply retains the canonical root');
  assert.equal(actual.context?.topicId,topic,'reply retains its exact destination');
}
