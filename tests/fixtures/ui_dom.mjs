// Small DOM oracle for actual view adapters. Native-browser proof remains
// separate: this fixture exercises rendering, not hit testing or focus order.
export function dom() {
  const document={activeElement:null};
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.classList={add(){}};}
    // Anything appended that is not a node is a text node of its string, as in a page:
    // a null appended reads "null" there, and so it does here.
    append(...items){for(let item of items){if(!(item instanceof Element))item=document.createTextNode(String(item));item.parent=this;this.children.push(item);}}
    // What the page's textContent gives: its own words, or its children's.
    get text(){return this.children.length?this.children.map(child=>child.text).join(''):this.textContent;}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(){}
    focus(){document.activeElement=this;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
    insertBefore(child,before){child.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,child);child.parent=this;}
    removeAttribute(name){delete this[name];}
    querySelector(selector){const key=selector==='[data-more]'?'more':selector==='[data-history-retry]'?'historyRetry':null;return this.children.find(x=>key&&Object.hasOwn(x.dataset,key))??null;}
  }
  document.createElement=tag=>new Element(tag);
  document.createElementNS=(ns,tag)=>new Element(tag);
  document.createTextNode=data=>Object.assign(new Element('#text'),{textContent:data});
  document.body=document.createElement('body');
  return document;
}
