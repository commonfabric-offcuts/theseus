import { hasTitle } from './creation.mjs';
import { routeHref } from './topic-navigation.mjs';

// Getting something in is one line: type a title, Return makes it, Escape
// cancels. Purpose, people and the first message are set afterwards, in
// place. Each create goes through the same Core commands as before; an answer
// that never came keeps its exact request, so the next Return sends that same
// request again, and a refusal shows in plain words with the typed text kept.

const copy = structuredClone;
const element = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
const AGAIN = ' Press Return to try once more.';

function envelope(bootstrap, kind, target, expected, args) {
  const { authority_id, authority_epoch } = bootstrap.authority;
  return { v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind, target,
    expected: { ...expected, authority: { authority_id, authority_epoch } }, args };
}

// What became of one command: its committed result, or an Error in plain words.
// keep(): the request may have been recorded, so the caller keeps it to send again.
async function sent(api, request, keep) {
  let receipt;
  try { receipt = await api.command(copy(request)); }
  catch (error) { keep(); throw Error(`Not confirmed: ${error.message}.${AGAIN}`); }
  const exact = receipt?.instance_id === request.instance_id && receipt.operation_id === request.operation_id && receipt.kind === request.kind;
  if (exact && receipt.recorded === true && receipt.status === 'committed') return receipt.result;
  const message = receipt?.error?.message ?? 'Theseus did not confirm this.';
  if (exact && (receipt.recorded === true || receipt.error?.code === 'INVALID_ARGUMENT')) throw Object.assign(Error(message), { code: receipt.error?.code });
  keep(); throw Error(message + AGAIN);
}

// One outcome from a title: workspace.create with only the title; the owner is
// its team until they add people on its page.
export class OutcomeStart {
  constructor({ api, bootstrap }) { Object.assign(this, { api, bootstrap }); this.pending = null; }
  async create(title) {
    if (!hasTitle(title)) throw Error('Type the outcome’s title, then press Return.');
    if (this.pending?.args.title !== title) this.pending = envelope(this.bootstrap, 'workspace.create', {}, { workspace_revision: 0 },
      { id: 'w-' + crypto.randomUUID().replaceAll('-', ''), title, purpose: '', team: [] });
    const request = this.pending;
    try { await sent(this.api, request, () => {}); }
    catch (error) { if (!error.message.endsWith(AGAIN)) this.pending = null; throw error; }
    this.pending = null;
    return request.args.id;
  }
}

// One topic from a title, through the private opening Core already keeps:
// opening.save with the title (and the message it answers), then
// opening.publish. With nothing written, Core starts the topic with no
// message, or, started from a message, with that message quoted. The opening
// and topic identities stay the same across every Return, so a request whose
// answer was lost is sent again whole.
export class TopicStart {
  constructor({ api, bootstrap, workspace, participants = [], source = null }) {
    Object.assign(this, { api, bootstrap, workspace, participants, source });
    this.renew(); this.started = []; this.seen = [];
  }
  renew() {
    const id = () => crypto.randomUUID().replaceAll('-', '');
    this.opening = 'o-' + id(); this.topic = 't-' + id(); this.revision = 0; this.savedTitle = null; this.save = null; this.publish = null;
  }
  async start(title) {
    if (!hasTitle(title)) throw Error('Type the topic’s title, then press Return.');
    if (this.savedTitle !== title) {
      if (this.save?.args.title !== title) this.save = envelope(this.bootstrap, 'opening.save', { opening_id: this.opening }, { opening_revision: this.revision },
        { workspace_id: this.workspace, topic_id: this.topic, title, participants: [...this.participants], body: '', attachments: [],
          ...(this.source ? { source_message_id: this.source } : {}) });
      const request = this.save;
      let result;
      try { result = await sent(this.api, request, () => {}); }
      catch (error) {
        if (!error.message.endsWith(AGAIN)) this.save = null;
        // Its topic identity is taken (a lost first save landed elsewhere): start afresh.
        if (error.code === 'REVISION_CONFLICT' && this.revision === 0) { this.renew(); throw Error('That did not start. Press Return to start it now.'); }
        if (error.code === 'OPENING_CLOSED') { const topic = await this.published(); if (topic) return topic; }
        throw error;
      }
      this.revision = result.opening_revision; this.savedTitle = title; this.save = null; this.publish = null;
    }
    this.publish ??= envelope(this.bootstrap, 'opening.publish', { opening_id: this.opening }, { opening_revision: this.revision },
      this.source ? { seen: [...this.seen] } : {});
    const request = this.publish;
    try {
      const result = await sent(this.api, request, () => {});
      this.publish = null;
      return result.topic.id;
    } catch (error) {
      if (error.message.endsWith(AGAIN)) throw error;
      this.publish = null;
      if (error.code === 'ALREADY_STARTED') throw await this.alreadyStarted();
      if (error.code === 'OPENING_CLOSED') { const topic = await this.published(); if (topic) return topic; }
      throw error;
    }
  }
  // An earlier Return's publish landed after all: the topic it started.
  async published() {
    const answer = await this.api.view('opening', { opening_id: this.opening }, { readClass: 'foreground' }).catch(() => null);
    return answer?.opening?.state === 'published' ? answer.opening.topic_id : null;
  }
  // Topics already started from the same message: named, so the next Return starts another knowingly.
  async alreadyStarted() {
    const answer = await this.api.view('source_topics', { message_id: this.source, limit: 20 }, { readClass: 'foreground' }).catch(() => null);
    const items = Array.isArray(answer?.items) ? answer.items : [];
    this.started = items; this.seen = items.map(item => item.id);
    const words = items.length === 1 ? 'A topic was already started from this message.' : `${items.length || 'Some'} topics were already started from this message.`;
    return Object.assign(Error(`${words} Continue there, or press Return to start this one anyway.`),
      { links: items.map(item => ({ id: item.id, href: routeHref({ kind: 'topic', id: item.id }), title: (item.title || 'Untitled topic') + (item.title_truncated ? '…' : '') })) });
  }
}

// The line itself: an input sized to a sentence and a quiet status after it.
// submit(text) resolves when made (the caller moves on) or throws an Error
// whose words are shown, with any links it carries; the text stays as typed.
export class OneLine {
  constructor({ id, label, placeholder = '', value = '', submit, cancel, open = () => {}, className = '' }) {
    Object.assign(this, { submit, cancel, open });
    this.input = element('input', { id, type: 'text', autocomplete: 'off', enterKeyHint: 'go', placeholder, value, spellcheck: true });
    this.input.setAttribute('aria-label', label);
    this.state = element('p', { className: 'one-line-state', hidden: true });
    this.state.setAttribute('role', 'status');
    this.root = element('div', { className: ['one-line', className].filter(Boolean).join(' ') }, this.input, this.state);
    this.input.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) this.go(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel?.(); }
    });
    this.input.addEventListener('input', () => { if (!this.busy) this.show(''); });
  }
  show(text, links = [], quiet = false) {
    this.state.replaceChildren(text);
    for (const link of links) {
      const a = element('a', { href: link.href ?? '#', textContent: link.title });
      a.onclick = event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); this.open(link); };
      this.state.append(' ', a);
    }
    this.state.hidden = !text; this.state.classList.toggle('quiet', quiet);
  }
  async go() {
    if (this.busy) return;
    this.busy = true; this.input.setAttribute('aria-busy', 'true'); this.show('Starting…', [], true);
    try { await this.submit(this.input.value); this.show('Saved', [], true); }
    catch (error) { this.show(error.message, error.links ?? []); this.input.focus(); }
    finally { this.busy = false; this.input.removeAttribute('aria-busy'); }
  }
  focus(select = false) { this.input.focus(); if (select) this.input.select(); }
}

// A rail button that opens its one line beneath its heading. A second press, or
// Escape, closes it and gives the focus back to the button.
export function lineFromButton({ button, after, line }) {
  const close = () => { line.root.remove(); button.setAttribute('aria-expanded', 'false'); button.focus(); };
  line.cancel = close;
  button.setAttribute('aria-expanded', 'false');
  button.onclick = () => {
    if (line.root.isConnected) { close(); return; }
    after.after(line.root); button.setAttribute('aria-expanded', 'true'); line.focus();
  };
  return close;
}

// The first sentence of a message, as a topic title: quote marks and spacing
// gone, cut at a word near 120 characters.
export function firstSentence(body) {
  const words = String(body ?? '').split('\n').map(line => line.replace(/^\s*>\s?/, '')).join(' ').replace(/\s+/g, ' ').trim();
  const sentence = words.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? words;
  if (sentence.length <= 120) return sentence;
  const cut = sentence.slice(0, 119), space = cut.lastIndexOf(' ');
  return (space > 60 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '') + '…';
}
