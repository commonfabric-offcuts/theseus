// Where a native press fell, for the harnesses' point() (reader_persistence_native.mjs, webkit_native.mjs). A
// pointer action is aimed by a hit-test, then pressed; a redraw landing between the two (an answer drawing the
// page again) can move the target from under the point, and the press then falls on whatever moved there.
// watch(selector) runs in the page with the hit-test that found the target there, and notes where the press's
// pointerdown lands. read runs while the button is down: '' when the press fell inside the element the selector
// finds then, and the element it fell on otherwise. A press whose pointerdown never reaches the window (one in a
// frame) reads '' too.
export const FELL = {
  watch: selector => `window.pressFell='';removeEventListener('pointerdown',window.pressWatch,true);
    window.pressWatch=event=>{const e=event.target;window.pressFell=document.querySelector(${JSON.stringify(selector)})?.contains(e)?''
      :e instanceof Element?e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\\s+/).join('.'):''):String(e)};
    addEventListener('pointerdown',window.pressWatch,true);`,
  read: `(()=>{removeEventListener('pointerdown',window.pressWatch,true);return window.pressFell??''})()`,
};
