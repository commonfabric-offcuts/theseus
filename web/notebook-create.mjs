import { NotebookStart, OneLine } from './quick-create.mjs';

// The same pencil and one-line creation in either Notebook heading. Nothing
// is sent until Return; Escape and an outside press close the title line.
export class NotebookCreate {
  constructor({ host, scope, api, bootstrap, open }) {
    const doc = host.ownerDocument, heading = host.querySelector('.rail-heading,.section-heading');
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
          await open({ kind: 'cards', id, write: 'new' });
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
      heading.after(line.root); button.setAttribute('aria-expanded', 'true'); line.focus();
    };
    doc.addEventListener('pointerdown', event => {
      if (line.root.isConnected && !line.root.contains(event.target) && !button.contains(event.target)) close(false);
    });
    Object.assign(this, { button, line, close, available: true });
  }
  setAvailable(on) { this.available = on; this.button.hidden = !on; if (!on) this.close(false); }
}
