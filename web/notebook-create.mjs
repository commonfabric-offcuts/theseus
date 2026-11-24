import { NotebookStart, OneLine } from './quick-create.mjs';

// The same pencil and one-line creation in every Notebook heading: the right
// rail's Notebook section (its summary, which the pencil opens if it is
// folded), the topic's while it lists the topic's pages and the outcome's
// while it lists the outcome's, and the outcome's own page beside its list.
// Return or Escape creates from a nonempty title. An empty Escape and an
// outside press close the line. The new page keeps this pencil as its opener.
export class NotebookCreate {
  constructor({ host, scope, api, bootstrap, open }) {
    const doc = host.ownerDocument, heading = host.localName === 'details' ? host.querySelector(':scope > summary') : host.querySelector('.rail-heading,.section-heading');
    const button = doc.createElement('button');
    button.type = 'button'; button.className = 'notebook-create'; button.title = 'New Notebook page';
    button.setAttribute('aria-label', 'New Notebook page'); button.setAttribute('aria-expanded', 'false');
    const pencil = doc.getElementById('new-message')?.querySelector('svg')?.cloneNode(true);
    if (pencil) button.append(pencil); else button.textContent = 'New page';
    heading.append(button);
    const starter = new NotebookStart({ api, bootstrap, scope });
    const line = new OneLine({ id: `new-notebook-${scope.kind}-${scope.id}`, label: 'New Notebook page title', placeholder: 'Page title', className: 'rail-line',
      submit: async title => {
        line.input.readOnly = true;
        try {
          const id = await starter.create(title);
          line.input.value = ''; line.root.remove(); button.setAttribute('aria-expanded', 'false');
          await open({ kind: 'cards', id, write: 'new' }, button);
        } finally { line.input.readOnly = false; }
      } });
    const close = focus => {
      if (line.busy) return;
      line.root.remove(); button.setAttribute('aria-expanded', 'false');
      if (focus) button.focus();
    };
    line.cancel = () => close(true);
    button.onclick = () => {
      if (line.root.isConnected) return close(true);
      if (heading.localName === 'summary') heading.parentElement.open = true;
      heading.after(line.root); button.setAttribute('aria-expanded', 'true'); line.focus();
    };
    doc.addEventListener('pointerdown', event => {
      if (line.root.isConnected && !line.root.contains(event.target) && !button.contains(event.target)) close(false);
    });
    Object.assign(this, { button, line, close, available: true });
  }
  setAvailable(on) { this.available = on; this.button.hidden = !on; if (!on) this.close(false); }
  // A heading that outlives the page (the right rail's) loses its pencil and line when the page goes.
  remove() { this.setAvailable(false); this.line.root.remove(); this.button.remove(); }
}
