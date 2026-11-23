import { openSeatJournal } from './seat-journal.mjs';
import { checkedView } from './freshness.mjs';

const copy = structuredClone;
const sameForm = (a, b) => a?.name === b?.name && a?.role === b?.role && a?.template_id === b?.template_id;
const validTemplate = id => typeof id === 'string' && /^template-[0-9a-f]{64}$/.test(id);
const templateRefusal = seat => ['host_template_ambiguous', 'host_template_unavailable', 'host_not_configured'].includes(seat.reason);
const authorityOf = bootstrap => ({ authority_id: bootstrap.authority.authority_id, authority_epoch: bootstrap.authority.authority_epoch });

// The form's writing and its exact outstanding request are separate. A late
// receipt clears only the request it answers; newer writing stays in place.
export class SeatAddition {
  constructor({ api, bootstrap, workspace, journal, id = () => crypto.randomUUID(), changed = () => {}, added = () => {} }) {
    Object.assign(this, { api, bootstrap: copy(bootstrap), workspace: copy(workspace), journal, id, changed, added });
    this.row = null; this.busy = null; this.writes = Promise.resolve(); this.notice = ''; this.storageError = null;
    this.version = 0; this.savedVersion = 0;
  }
  get notice() { return this._notice ?? ''; }
  set notice(words) { this._notice = words; this.noticeSeatId = null; }
  followSeat(seat, label) {
    this.notice = `${label}: ${seatWords(seat)}`;
    this.noticeSeatId = seat.id;
  }
  async load() {
    this.row = await this.journal.get() ?? { revision: 0, form: { name: '', role: '' }, request: null, lastSeatId: null };
    this.changed(); return this;
  }
  save() {
    const snapshot = copy(this.row), version = this.version;
    const next = this.writes.catch(() => {}).then(async () => {
      const kept = await this.journal.put(snapshot, this.row.revision);
      this.row.revision = kept.revision; this.storageError = null; this.savedVersion = Math.max(this.savedVersion, version);
    }).catch(error => { this.storageError = error.message; throw error; });
    this.writes = next; return next;
  }
  async edit(form) {
    this.row.form = copy(form); this.version++; this.notice = ''; this.noticeSeatId = null; this.changed();
    try { await this.save(); } finally { this.changed(); }
  }
  perform(action) {
    if (this.busy) return this.busy;
    const work = Promise.resolve().then(action).catch(error => { this.notice = error.message; throw error; });
    this.busy = work; this.changed();
    const finish = () => { if (this.busy === work) this.busy = null; this.changed(); };
    work.then(finish, finish); return work;
  }
  validate() {
    if (!this.row.form.name.trim()) throw Error('Give the seat a name.');
    if (!this.row.form.role.trim()) throw Error('Describe the seat’s role.');
    if (new TextEncoder().encode(this.row.form.role).length > 16384 || this.row.form.role.includes('\0')) throw Error('The role needs at most 16 KiB of text, with no null characters.');
    if (this.templates) {
      if (!this.templates.available) throw Error('The host’s templates are not available. Your writing is kept; reopen Headless Codex to check again.');
      const id = this.row.form.template_id;
      if (id && !this.templates.items.some(item => item.id === id)) throw Error('The selected template is no longer available. Choose a current named template.');
      if (this.templates.items.length > 1 && !id) throw Error('Choose a named host template.');
    }
  }
  request(version = this.workspace.version) {
    return { v: 1, instance_id: this.bootstrap.instance_id, operation_id: this.id(), kind: 'workspace.hosted_seat_add',
      target: { workspace_id: this.workspace.id }, expected: { workspace_revision: version, authority: authorityOf(this.bootstrap) }, args: copy(this.row.form) };
  }
  async checkAuthority() {
    const current = await this.api.bootstrap({ readClass: 'foreground' });
    if (current?.instance_id !== this.bootstrap.instance_id || current.actor !== this.bootstrap.actor ||
        current.authority?.authority_id !== this.bootstrap.authority.authority_id ||
        current.authority?.authority_epoch !== this.bootstrap.authority.authority_epoch) {
      this.parked = true;
      this.notice = 'The account or runtime authority changed. This Add and its writing are kept without rebinding.';
      throw Error(this.notice);
    }
  }
  add() {
    return this.perform(async () => {
      if (this.row.request) throw Error('The previous seat request is unconfirmed. Check or retry that request first.');
      await this.checkAuthority();
      this.validate(); this.row.request = this.request(); this.row.requestLabel = this.row.form.name; this.version++;
      return this.dispatch(true);
    });
  }
  retrySeat(seat, label = seat.agent_id) {
    return this.perform(async () => {
      if (this.row.request) throw Error('The previous seat request is unconfirmed. Check or retry that request first.');
      if (!seat.retryable) throw Error('This native setup needs reconciliation before retrying.');
      await this.checkAuthority();
      this.row.request = { v: 1, instance_id: this.bootstrap.instance_id, operation_id: this.id(), kind: 'workspace.hosted_seat_retry',
        target: { workspace_id: this.workspace.id, seat_request_id: seat.id },
        expected: { authority: authorityOf(this.bootstrap), seat_revision: seat.version },
        args: templateRefusal(seat) && this.row.form.template_id ? { template_id: this.row.form.template_id } : {} };
      this.row.requestLabel = label; this.version++; return this.dispatch(false);
    });
  }
  endSeat(seat, label = seat.agent_id) {
    return this.perform(async () => {
      if (this.row.request) throw Error('A seat request is unconfirmed. Check or retry it first.');
      if (['ending', 'ended'].includes(seat.state)) throw Error('This seat is already ending or ended.');
      await this.checkAuthority();
      this.row.request = { v: 1, instance_id: this.bootstrap.instance_id, operation_id: this.id(), kind: 'workspace.hosted_seat_end',
        target: { workspace_id: this.workspace.id, seat_request_id: seat.id },
        expected: { authority: authorityOf(this.bootstrap), seat_revision: seat.version }, args: {} };
      this.row.requestLabel = label; this.version++; return this.dispatch(false);
    });
  }
  async dispatch(revisionRetry = false) {
    await this.save(); // A failed device write prevents the public act.
    await this.checkAuthority();
    const request = copy(this.row.request); let receipt;
    try { receipt = await this.api.command(copy(request)); }
    catch (error) { this.notice = `Seat request is unconfirmed: ${error.message} Check or retry the same request.`; throw Error(this.notice); }
    if (revisionRetry && receipt?.recorded === true && receipt.status === 'rejected' && receipt.error?.code === 'REVISION_CONFLICT' &&
        receipt.instance_id === request.instance_id && receipt.operation_id === request.operation_id && receipt.kind === request.kind &&
        Number.isSafeInteger(receipt.error.current_versions?.workspace_revision)) {
      // This original request was definitively refused. A new one keeps the
      // original form, even when newer typing arrived while the reply was out.
      const next = this.request(receipt.error.current_versions.workspace_revision); next.args = copy(request.args);
      this.row.request = next; this.version++; return this.dispatch(false);
    }
    return this.settle(request, receipt);
  }
  async settle(request, receipt) {
    const exact = receipt?.instance_id === request.instance_id && receipt.operation_id === request.operation_id && receipt.kind === request.kind;
    if (exact && receipt.recorded === true && receipt.status === 'committed') {
      const result = receipt.result;
      const retry = request.kind !== 'workspace.hosted_seat_add';
      const ending = request.kind === 'workspace.hosted_seat_end';
      if (result?.workspace_id !== request.target.workspace_id || typeof result.seat_request_id !== 'string' ||
          result.seat?.id !== result.seat_request_id || result.seat.agent_id !== result.agent?.id ||
          (retry ? result.seat_request_id !== request.target.seat_request_id : result.seat.role !== request.args.role) ||
          request.args.template_id && result.seat.template_id !== request.args.template_id) {
        this.notice = 'Seat request is unconfirmed: its seat identity did not match the request.'; throw Error(this.notice);
      }
      this.row.request = null; this.row.requestLabel = null; this.row.lastSeatId = result.seat_request_id;
      if (!retry && sameForm(this.row.form, request.args)) this.row.form = { name: '', role: '' };
      if (ending) this.followSeat(result.seat, result.agent.name);
      else this.notice = `${result.agent.name} is on the team and preparing.`;
      this.version++;
      await this.save(); this.added(result); return result;
    }
    if (exact && receipt.recorded === true && receipt.status === 'rejected') {
      this.row.request = null; this.row.requestLabel = null; this.notice = receipt.error?.message ?? 'This Add was refused.';
      this.version++;
      await this.save(); throw Error(this.notice);
    }
    this.notice = `Seat request is unconfirmed. ${receipt?.error?.message ?? 'Check or retry the original request.'}`;
    throw Error(this.notice);
  }
  again() {
    return this.perform(async () => {
      const request = this.row.request;
      if (!request) throw Error('There is no previous Add to check.');
      await this.checkAuthority();
      let answer;
      try { answer = await this.api.view('operation', { operation_id: request.operation_id }, { readClass: 'foreground' }); }
      catch (error) { this.notice = `Seat request remains unconfirmed: ${error.message}`; throw Error(this.notice); }
      if (answer?.recorded === true) return this.settle(copy(request), answer);
      if (answer?.instance_id !== request.instance_id || answer.operation_id !== request.operation_id || answer.recorded !== false || answer.status !== 'unknown') {
        this.notice = 'Seat request remains unconfirmed. Its confirmation could not be read safely.'; throw Error(this.notice);
      }
      return this.dispatch(false);
    });
  }
  get unprotectedWriting() { return this.savedVersion < this.version || Boolean(this.storageError); }
}

const stages = { profile: 'seat setup', thread: 'Codex connection', starting: 'seat creation', persist: 'saved context',
  persisting: 'saved context', pin: 'execution controls', route: 'work route', delivery: 'first task' };
const reasons = {
  auth_missing: 'The existing host is not signed in.', host_not_configured: 'No existing host template is configured.',
  host_template_ambiguous: 'Choose a named template in Headless Codex, then Retry setup.',
  host_template_unavailable: 'The selected template is no longer available. Choose a current template in Headless Codex, then Retry setup.',
  host_template_requires_full: 'This host template cannot add a seat while it is running.',
  thread_start_uncertain: 'Native seat creation is unconfirmed. Its original request is kept; another thread will not be created automatically.',
  thread_persistence_uncertain: 'Saving the native context is unconfirmed. Its known thread is kept.',
  thread_settings_not_applied: 'Codex did not apply the requested runtime settings.',
  access_changed: 'The current owner or seat membership changed.',
  conversation_missing: 'This outcome needs a Conversation before setup can be retried.',
  first_delivery_failed: 'The first task could not be recorded. Its seat request is kept.',
  profile_conflict: 'An existing seat file does not match.', path_conflict: 'An existing file or directory cannot be replaced safely.',
  pin_conflict: 'An existing native context or its owner does not match.', route_conflict: 'An existing work route does not match.',
};
export function seatWords(seat) {
  if (seat.state === 'ending') return 'Ending after the current turn…';
  if (seat.state === 'ended') return 'Ended · history kept.';
  if (seat.state === 'ready') return 'Ready · first task in Conversation.';
  if (seat.state === 'refused') return `Stopped at ${stages[seat.stage] ?? 'preparation'}: ${reasons[seat.reason] ?? `The host refused this step (${seat.reason}).`}`;
  return 'Preparing…';
}

const element = (doc, tag, props = {}, ...children) => { const node = Object.assign(doc.createElement(tag), props); node.append(...children); return node; };

// A direct choice in the existing Team +Add. The same nodes survive Core
// progress and role typing; closing or refreshing never replaces this form.
export class HeadlessSeatControl {
  constructor({ panel, api, bootstrap, workspace, current = () => true, added = () => {}, closeOthers = () => {} }) {
    Object.assign(this, { panel, api, bootstrap, workspace: copy(workspace), current, added, closeOthers });
    const doc = panel.host.ownerDocument ?? document;
    const make = (tag, props, ...children) => element(doc, tag, props, ...children);
    this.host = make('div', { className: 'headless-seats', hidden: true });
    this.notice = make('p', { className: 'notice', hidden: true }); this.notice.setAttribute('role', 'status');
    this.list = make('ul', { className: 'seat-statuses' }); this.list.setAttribute('aria-label', 'Headless seats');
    this.host.append(this.notice, this.list); panel.host.append(this.host);
    this.opener = make('button', { type: 'button', id: 'add-headless-seat', className: 'choice-chip', textContent: 'Headless Codex' });
    this.opener.setAttribute('aria-expanded', 'false');
    this.name = make('input', { id: 'headless-seat-name', type: 'text', autocomplete: 'off', spellcheck: false });
    this.name.setAttribute('aria-label', 'Headless seat name');
    this.role = make('textarea', { id: 'headless-seat-role', rows: 4, spellcheck: true });
    this.role.setAttribute('aria-label', 'Headless seat role');
    this.templateChoices = make('div', { className: 'seat-actions' });
    this.templateChoices.setAttribute('role', 'group'); this.templateChoices.setAttribute('aria-label', 'Existing host template');
    this.templateArea = make('section', { hidden: true }, make('p', { textContent: 'Template' }), this.templateChoices);
    this.submit = make('button', { type: 'submit', id: 'headless-seat-submit', className: 'choice-chip', textContent: 'Add seat' });
    this.retry = make('button', { type: 'button', id: 'headless-seat-retry', className: 'text-action', hidden: true });
    this.form = make('form', { className: 'seat-form', hidden: true },
      make('p', { className: 'seat-access', textContent: 'This seat runs with full access on this Mac, including sub-agents, as the hosted lanes do.' }),
      make('label', {}, 'Name', this.name), make('label', {}, 'Role', this.role), this.templateArea,
      make('div', { className: 'seat-actions' }, this.submit, this.retry));
    this.form.setAttribute('aria-label', 'Add a headless Codex seat');
    this.form.onsubmit = event => { event.preventDefault(); this.act(async () => { await this.loadTemplates(); return this.owner.add(); }); };
    this.retry.onclick = () => this.act(() => this.owner.again());
    const edited = () => {
      if (!this.owner) return;
      this.owner.edit({ ...this.owner.row.form, name: this.name.value, role: this.role.value }).catch(error => this.say(error.message));
    };
    this.name.addEventListener('input', edited); this.role.addEventListener('input', edited);
    this.form.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.toggle(false); }
    });
    panel.row.append(this.form);
    panel.extraChoices ??= []; panel.extraChoices.push(this.opener);
    this.opener.onclick = () => this.toggle();
    const previous = this.previousClosed = panel.closed;
    this.closed = () => { previous?.(); this.toggle(false, false); };
    panel.closed = this.closed;
    this.loading = this.load();
  }
  async load() {
    try {
      this.journal = await openSeatJournal(this.bootstrap, this.workspace.id);
      if (this.disposed) { this.journal.close(); return; }
      this.owner = new SeatAddition({ api: this.api, bootstrap: this.bootstrap, workspace: this.workspace,
        journal: this.journal, changed: () => this.paintForm(), added: value => { if (this.current()) this.added(value); } });
      await this.owner.load();
      if (!this.form.hidden) await this.loadTemplates();
    } catch (error) { this.owner = null; this.localError = error.message; this.say(error.message); }
    finally { this.loadFinished = true; this.paintForm(); }
  }
  async act(action) {
    if (!this.current() || !this.manage || !this.owner || this.owner.parked) return;
    try { await action(); }
    catch (error) { this.owner.notice = error.message; }
    this.paintForm();
  }
  say(words) {
    if (this.disposed || !this.current()) return;
    if (this.notice.textContent !== words) this.notice.textContent = words;
    this.notice.hidden = !words; this.host.hidden = !words && !this.list.children.length;
  }
  async loadTemplates() {
    const workspace = this.workspace.id;
    try {
      const answer = checkedView(await this.api.view('hosted_seat_templates', { workspace_id: workspace },
        { readClass: 'foreground' }), this.bootstrap.instance_id);
      if (typeof answer.available !== 'boolean' || !Array.isArray(answer.items) || answer.items.length > 128 ||
          answer.items.some(item => !validTemplate(item.id) || ['name', 'model', 'reasoning_effort'].some(key => typeof item[key] !== 'string')))
        throw Error('Host templates could not be confirmed.');
      if (this.disposed || !this.current() || this.workspace.id !== workspace || !this.owner) return;
      this.owner.templates = copy(answer); this.templateReadError = '';
    } catch (error) {
      if (this.disposed || !this.current() || this.workspace.id !== workspace || !this.owner) return;
      this.owner.templates = { available: false, items: [] }; this.templateReadError = error.message;
    }
    this.paintForm();
  }
  paintTemplates(blocked) {
    const items = this.owner?.templates?.items ?? [], selected = this.owner?.row?.form.template_id;
    this.templateArea.hidden = items.length <= 1 && !selected;
    const signature = JSON.stringify(items.map(item => [item.id, item.name, item.model, item.reasoning_effort]));
    if (signature !== this.templateSignature) {
      this.templateSignature = signature;
      this.templateChoices.replaceChildren(...items.map(item => {
        const button = element(this.host.ownerDocument, 'button', { type: 'button', className: 'choice-chip',
          textContent: `${item.name} · ${item.model} · ${item.reasoning_effort}` });
        button.dataset.seatTemplate = item.id;
        button.onclick = () => this.owner.edit({ ...this.owner.row.form, template_id: item.id }).catch(error => this.say(error.message));
        return button;
      }));
    }
    for (const button of this.templateChoices.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.seatTemplate === selected)); button.disabled = blocked;
    }
  }
  paintForm() {
    if (this.disposed || !this.current()) return;
    const owner = this.owner, row = owner?.row;
    if (row) {
      if (this.name.value !== row.form.name) this.name.value = row.form.name;
      if (this.role.value !== row.form.role) this.role.value = row.form.role;
    }
    const blocked = !this.manage || owner?.parked || !this.loadFinished;
    this.name.readOnly = this.role.readOnly = Boolean(blocked);
    this.submit.disabled = blocked || !owner || Boolean(owner.busy) || Boolean(row?.request) ||
      !owner.templates?.available || owner.templates.items.length > 1 && !row?.form.template_id;
    this.paintTemplates(Boolean(blocked || owner?.busy || row?.request));
    this.retry.hidden = !row?.request;
    this.retry.disabled = blocked || Boolean(owner?.busy);
    if (row?.request) this.retry.textContent = `Check / retry for ${row.requestLabel ?? row.request.args.name ?? 'the previous seat'}`;
    for (const button of this.list.querySelectorAll('[data-seat-retry], [data-seat-end]')) button.disabled = Boolean(blocked || !owner || owner.busy || row?.request);
    this.form.setAttribute('aria-busy', owner?.busy ? 'true' : 'false');
    this.say(owner?.storageError || owner?.notice || this.localError || this.templateReadError ||
      (!this.form.hidden && owner?.templates && !owner.templates.available ? 'The host’s templates are not available yet. Your writing is kept.' : '') ||
      (row?.request ? 'A seat request is unconfirmed. Open Headless Codex to check its saved request.' : ''));
  }
  toggle(open = this.form.hidden, focus = true) {
    if (open && !this.manage) return;
    if (open) this.closeOthers();
    this.form.hidden = !open; this.opener.setAttribute('aria-expanded', String(open));
    if (open) { this.name.focus(); this.loadTemplates(); } else if (focus && !this.opener.hidden) this.opener.focus();
  }
  async refresh(workspace, members, manage) {
    this.workspace = copy(workspace); this.manage = manage; this.opener.hidden = !manage;
    if (this.owner) this.owner.workspace = copy(workspace);
    if (!manage) this.toggle(false, false);
    this.paintForm();
    const names = new Map(members.map(member => [member.actor_id, member.name || member.actor_id]));
    try {
      let cursor = null; const seats = [];
      do {
        const page = checkedView(await this.api.view('hosted_seats', { workspace_id: workspace.id, limit: 100,
          ...(cursor ? { cursor } : {}) }, { readClass: 'background' }), this.bootstrap.instance_id);
        seats.push(...page.items); cursor = page.next_cursor;
      } while (cursor);
      if (this.disposed || !this.current()) return false;
      if (this.owner?.noticeSeatId && !this.owner.row.request) {
        const latest = seats.find(seat => seat.id === this.owner.noticeSeatId);
        if (latest) {
          this.owner.followSeat(latest, names.get(latest.agent_id) ?? latest.agent_id);
          this.paintForm();
        }
      }
      const signature = JSON.stringify([manage, seats.map(seat => [seat.id, seat.version, names.get(seat.agent_id)])]);
      if (signature !== this.signature) {
        this.signature = signature;
        const doc = this.host.ownerDocument;
        this.list.replaceChildren(...seats.map(seat => {
          const label = names.get(seat.agent_id) ?? seat.agent_id;
          const item = element(doc, 'li', {}, element(doc, 'span', { textContent: `${label}: ${seatWords(seat)}` }));
          if (manage && seat.retryable) {
            const retry = element(doc, 'button', { type: 'button', className: 'text-action', textContent: 'Retry setup' });
            retry.dataset.seatRetry = seat.id; retry.setAttribute('aria-label', `Retry setup for ${label}`);
            retry.onclick = () => this.act(async () => {
              if (templateRefusal(seat)) {
                await this.loadTemplates();
                if (!this.owner.row.form.template_id) {
                  this.toggle(true); this.owner.notice = `Choose a named template for ${label}, then Retry setup.`; return;
                }
              }
              return this.owner.retrySeat(seat, label);
            }); item.append(retry);
          }
          if (manage && !['ending', 'ended'].includes(seat.state)) {
            const end = element(doc, 'button', { type: 'button', className: 'text-action', textContent: 'End seat' });
            end.dataset.seatEnd = seat.id; end.setAttribute('aria-label', `End seat ${label}`);
            end.onclick = () => this.act(() => this.owner.endSeat(seat, label)); item.append(end);
          }
          return item;
        }));
        this.paintForm();
      }
      this.host.hidden = this.notice.hidden && !seats.length;
      return true;
    } catch (error) { this.say(`Seat progress could not be read: ${error.message}`); return false; }
  }
  get unprotectedWriting() {
    return !this.disposed && (this.owner?.unprotectedWriting || !this.owner && Boolean(this.name.value || this.role.value));
  }
  dispose() {
    this.disposed = true;
    Promise.resolve(this.owner?.writes).catch(() => {}).then(() => this.journal?.close());
    this.form.remove(); this.opener.remove(); this.host.remove();
    this.panel.extraChoices = this.panel.extraChoices.filter(choice => choice !== this.opener);
    if (this.panel.closed === this.closed) this.panel.closed = this.previousClosed;
  }
}
