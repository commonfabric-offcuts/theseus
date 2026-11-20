import { formatNodes } from './message-format.mjs';

// Read the shared renderer's words as text, keeping its block/list/table boundaries.
// No HTML, clipboard markup, controls, children or hidden card lines are copied.
export function plainCardText(title, words, doc) {
  const text=node=>{
    if(node.nodeType===3)return node.textContent;
    const own=name=>node.classList?.contains(name);
    const children=[...(node.childNodes??[])];
    if(own('md-marker'))return node.textContent+' ';
    const join=own('md-list')||own('md-quote')||node.tagName==='TBODY'||node.tagName==='THEAD'||node.tagName==='TABLE'?'\n':node.tagName==='TR'?'\t':'';
    return children.map(text).join(join);
  };
  const body=formatNodes(words,{doc}).map(text).join('\n\n');
  return [title,body].filter(Boolean).join('\n\n');
}
