// Shared generated browser expressions. Unit checks compile every expression and
// execute the state/layout readers against a synthetic document before a pool run.
export const expression790 = {
  ready: `document.body.dataset.ready === 'true' && Boolean(document.querySelector('#outcome-team:not([hidden])'))`,
  opened: `Boolean(document.querySelector('#onboarding-sheet')?.open)`,
  state: `document.querySelector('#onboarding-state').textContent`,
  text: `document.querySelector('#onboarding-text').value`,
  ownerMenu: `Boolean(document.querySelector('#outcome-menu') && !document.querySelector('#outcome-menu').hidden)`,
  layout: `(()=>{const d=document.querySelector('#onboarding-sheet'),b=d.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:innerWidth,height:innerHeight,overflow:d.scrollWidth-d.clientWidth}})()`,
  scratch: `(()=>{document.querySelector('#onboarding-paste-proof')?.remove();const t=document.createElement('textarea');t.id='onboarding-paste-proof';t.setAttribute('aria-label','Isolated clipboard paste proof');document.querySelector('#onboarding-sheet').append(t);return true})()`,
  pasted: `document.querySelector('#onboarding-paste-proof').value`,
  deny: `(()=>{window.clipboard790={write:navigator.clipboard.write,writeText:navigator.clipboard.writeText};Object.defineProperty(navigator.clipboard,'write',{configurable:true,value:async()=>{throw Error('Isolated clipboard refusal')}});Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw Error('Isolated clipboard refusal')}});return true})()`,
  restore: `(()=>{Object.defineProperty(navigator.clipboard,'write',{configurable:true,value:window.clipboard790.write});Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:window.clipboard790.writeText});delete window.clipboard790;return true})()`,
};
export const centre790 = selector => `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`;
export const hit790 = (selector,x,y) => `document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${Number(x)},${Number(y)}))`;
