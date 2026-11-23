// Instrument readiness only. Each press is supplied by the native driver;
// no elapsed-time or fake-DOM result is a browser acceptance claim.
export async function readerFromSource({inlineShown,pressSource,waitFirst,waitReader}) {
  const inline=await inlineShown();
  await pressSource();
  if(!inline) {
    const first=await waitFirst();
    if(first==='inline')await pressSource();
    else if(first!=='reader')throw Error('Source gesture did not reach an inline composer or Reader');
  }
  await waitReader();
}

// This callback is serialized by Playwright. Keep it self-contained and pass
// the function itself: waitForFunction(string) would require CSP unsafe-eval.
export function readReaderState({cardSelector,prefix,waitFor}) {
  const dialog=document.querySelector('#reader'),source=document.querySelector('#source-body'),menu=document.querySelector('#reader-menu');
  const inline=document.querySelector(cardSelector+' > .card-reply-composer');
  const state=dialog?.open
    ?source?.textContent.includes(prefix)&&source.getClientRects().length&&menu&&!menu.hidden&&!menu.disabled?'reader':'opening'
    :inline&&!inline.hidden?'inline':null;
  if(waitFor==='first')return state==='inline'||state==='reader'?state:false;
  if(waitFor==='reader')return state==='reader';
  return state;
}

export async function readerFromPage({page,cardSelector,prefix,pressSource}) {
  const args={cardSelector,prefix};
  await readerFromSource({
    inlineShown:async()=>await page.evaluate(readReaderState,args)==='inline',pressSource,
    waitFirst:async()=>{const state=await page.waitForFunction(readReaderState,{...args,waitFor:'first'});return state.jsonValue();},
    waitReader:()=>page.waitForFunction(readReaderState,{...args,waitFor:'reader'}),
  });
}
