// The existing device preference, presented at the current rail foot. No Core
// writing or source transformation is owned here; changed requests its redraw.
const rule='break-out-paragraphs';
export class ParagraphSwitch {
  constructor({doc,preferences,changed=()=>{},current=()=>true,
    MutationObserver=doc.defaultView?.MutationObserver??globalThis.MutationObserver}) {
    Object.assign(this,{doc,preferences,changed,current,closed:false,element:null,listening:new AbortController()});
    this.mount();
    this.observer=MutationObserver?new MutationObserver(()=>this.mount()):null;
    const target=doc.documentElement??doc.body;
    if(target)this.observer?.observe(target,{childList:true,subtree:true});
  }
  mount() {
    if(this.closed||!this.current())return;
    const foot=this.doc.querySelector('.rail-foot');if(!foot)return;
    for(const copy of this.doc.querySelectorAll('.look-switch[data-switch="paragraphs"]'))if(copy!==this.element)copy.remove();
    if(!this.element) {
      const group=this.element=this.doc.createElement('span');
      group.className='look-switch';group.dataset.switch='paragraphs';group.setAttribute('role','group');group.setAttribute('aria-label','Paragraphs');
      for(const [on,label,title]of [[false,'Joined','Messages read as written'],[true,'Broken out','Long paragraphs are broken out into shorter ones']]) {
        const button=this.doc.createElement('button');button.type='button';button.textContent=label;button.title=title;button.dataset.value=on?'on':'off';
        button.addEventListener('click',()=>{
          if(this.closed||!this.current()||this.preferences.enabled.includes(rule)===on)return;
          this.preferences.toggle(rule);this.paint();this.changed();
        },{signal:this.listening.signal});group.append(button);
      }
    }
    this.paint();if(this.element.parentElement!==foot)foot.append(this.element);
  }
  paint() {
    const value=this.preferences.enabled.includes(rule)?'on':'off';
    this.element?.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.value===value)));
  }
  dispose() {
    if(this.closed)return;
    this.closed=true;this.listening.abort();this.observer?.disconnect();this.element?.remove();
  }
}
