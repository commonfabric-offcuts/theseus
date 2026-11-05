// Small DOM oracle for actual view adapters. Native-browser proof remains
// separate: this fixture exercises rendering, not hit testing or focus order.
export function dom() {
  const document={activeElement:null};
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.classList={add(){}};}
    append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(){}
    focus(){document.activeElement=this;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
    querySelector(selector){const key=selector==='[data-more]'?'more':selector==='[data-history-retry]'?'historyRetry':null;return this.children.find(x=>key&&Object.hasOwn(x.dataset,key))??null;}
  }
  document.createElement=tag=>new Element(tag);document.body=document.createElement('body');
  return document;
}
