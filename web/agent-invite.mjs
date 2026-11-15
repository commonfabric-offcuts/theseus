// Inviting an agent to an outcome, from its Team panel (item 324,
// docs/agents.md "Inviting an agent"). Whoever organises the outcome (its
// owner or coordinator) presses "+ Invite agent", types the agent's name, taps
// the program it runs in (Claude Code or Codex) and presses Return. Core
// registers the agent and adds it to the team; the server writes its sign-in
// file and answers with the prompt to paste into the agent, which shows here
// with a copy glyph. Core decides who may invite; the page only hides the
// control from someone who may not.
//
// An answer that never came keeps its exact request, so the next Return sends
// that same request again. A sign-in file that could not be written keeps it
// too, and Try again sends it once more: Core answers with its recorded
// receipt, and only the file is written. A refusal is said in plain words with
// the name kept and selected, so a taken name is changed in place.

const copy = structuredClone;
const element = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
const AGAIN = ' Press Return to try once more.';
export const HARNESSES = [['claude-code', 'Claude Code'], ['codex', 'Codex']];
// Puts text on the clipboard; settles true when it is there.
const copyText = async text => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };
const harnessName = id => HARNESSES.find(([key]) => key === id)?.[1] ?? id;
export const COPY_REFUSED_PROMPT = 'Copying was refused here. The prompt is selected: copy it with your keyboard or menu.';

function envelope(bootstrap, workspace, revision, args) {
  const { authority_id, authority_epoch } = bootstrap.authority;
  return { v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'workspace.agent_invite',
    target: { workspace_id: workspace }, expected: { workspace_revision: revision, authority: { authority_id, authority_epoch } }, args };
}

// The request and what became of it. send() resolves to { agent, harness,
// prompt } once the agent is on the team and its sign-in file is written, or
// throws an Error in plain words: again (the answer was lost, or the file was
// not written) means the same request is kept for the next attempt.
export class Invitation {
  constructor({ api, bootstrap }) { Object.assign(this, { api, bootstrap }); this.pending = null; }

  async send(workspace, name, harness) {
    if (!name.trim()) throw Error('Type the agent’s name, then press Return.');
    const kept = this.pending;
    if (!(kept && kept.target.workspace_id === workspace.id && kept.args.name === name && kept.args.harness === harness)) {
      this.pending = envelope(this.bootstrap, workspace.id, workspace.version, { name, harness });
    }
    let receipt = await this.attempt(this.pending);
    // Someone else changed the team at the same moment: once more, as a new request, at the revision Core names.
    const current = receipt?.error?.code === 'REVISION_CONFLICT' ? receipt.error.current_versions?.workspace_revision : undefined;
    if (Number.isInteger(current) && current !== this.pending.expected.workspace_revision) {
      this.pending = envelope(this.bootstrap, workspace.id, current, { name, harness });
      receipt = await this.attempt(this.pending);
    }
    return this.settle(this.pending, receipt);
  }

  // The kept request, sent again exactly (Try again after a sign-in file was not written).
  async again() {
    if (!this.pending) throw Error('Nothing is waiting to be sent again.');
    return this.settle(this.pending, await this.attempt(this.pending));
  }

  async attempt(request) {
    try { return await this.api.command(copy(request)); }
    catch (error) { throw Object.assign(Error(`Not confirmed: ${error.message}.${AGAIN}`, { cause: error }), { again: true }); }
  }

  settle(request, receipt) {
    const exact = receipt?.instance_id === request.instance_id && receipt.operation_id === request.operation_id && receipt.kind === request.kind;
    if (exact && receipt.recorded === true && receipt.status === 'committed') {
      const result = receipt.result;
      if (receipt.sign_in?.written === true && typeof receipt.sign_in.prompt === 'string') {
        this.pending = null;
        return { agent: result.agent, harness: result.harness, prompt: receipt.sign_in.prompt };
      }
      throw Object.assign(Error(receipt.sign_in?.message ?? `${result.agent.name} is on the team, but its sign-in file was not confirmed.`),
        { again: true, retry: true, agent: result.agent });
    }
    const message = receipt?.error?.message ?? 'Theseus did not confirm this.';
    // A refusal Core recorded, or one made before Core was asked: a changed name is a new request.
    if (exact && receipt.status === 'rejected' && (receipt.recorded === true || receipt.error?.retryable === false)) {
      this.pending = null;
      throw Object.assign(Error(message), { code: receipt.error?.code });
    }
    throw Object.assign(Error((/[.!?]$/.test(message) ? message : message + '.') + AGAIN), { again: true });
  }
}

// The control on the page. workspace() is the outcome as the page last read
// it ({ id, version }); invited() runs after Core added an agent, so the team
// shows it.
export class AgentInvite {
  constructor({ host, invitation, workspace, invited = () => {}, copier = copyText }) {
    Object.assign(this, { host, invitation, workspace, invited, copier });
    this.manage = false; this.busy = false; this.harness = HARNESSES[0][0];
    this.opener = element('button', { type: 'button', id: 'invite-agent', className: 'choice-chip add-chip', textContent: '+ Invite agent',
      title: 'Invite an agent to this outcome' });
    this.opener.setAttribute('aria-expanded', 'false');
    this.opener.onclick = () => this.toggle();
    this.input = element('input', { id: 'invite-agent-name', type: 'text', autocomplete: 'off', placeholder: 'Agent’s name', spellcheck: false });
    this.input.setAttribute('aria-label', 'Name of the agent to invite');
    this.input.setAttribute('enterkeyhint', 'go');
    this.input.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) this.go(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.toggle(false); }
    });
    this.input.addEventListener('input', () => { if (!this.busy) this.show(''); });
    this.chips = element('div', { className: 'state-chips invite-harness' });
    this.chips.setAttribute('role', 'group'); this.chips.setAttribute('aria-label', 'The agent runs in');
    for (const [id, name] of HARNESSES) {
      const chip = element('button', { type: 'button', className: 'choice-chip', textContent: name, title: `The agent runs in ${name}` });
      chip.dataset.harness = id;
      // The focus goes back to the name, so Return invites.
      chip.onclick = () => { if (this.busy) return; this.harness = id; this.paintChips(); this.input.focus(); };
      this.chips.append(chip);
    }
    this.state = element('p', { className: 'one-line-state invite-state', hidden: true });
    this.state.setAttribute('role', 'status');
    this.line = element('div', { className: 'invite-line', hidden: true }, this.input, this.chips, this.state);
    this.said = element('p', { className: 'invite-said' });
    this.said.setAttribute('role', 'status');
    this.copyButton = glyphButton('invite-copy', 'Copy the prompt', COPY_PATH);
    this.copyButton.onclick = () => this.copy();
    this.closeButton = element('button', { type: 'button', className: 'invite-close', textContent: '×', title: 'Close the prompt' });
    this.closeButton.setAttribute('aria-label', 'Close the prompt');
    this.closeButton.onclick = () => this.closePrompt();
    this.text = element('pre', { id: 'invite-prompt-text', className: 'invite-prompt-text', tabIndex: 0 });
    this.text.setAttribute('aria-label', 'The prompt to paste into the agent');
    this.copied = element('p', { className: 'invite-copied', hidden: true });
    this.copied.setAttribute('role', 'status');
    this.prompt = element('div', { className: 'invite-prompt', hidden: true },
      element('div', { className: 'invite-head' }, this.said, this.copyButton, this.closeButton), this.text, this.copied);
    host.replaceChildren(this.opener, this.line, this.prompt);
    this.paintChips();
  }

  // manage: whether the reader organises the outcome, so may invite. A prompt
  // already showing stays until it is closed.
  paint(manage) {
    this.manage = manage;
    this.opener.hidden = !manage;
    if (!manage && !this.busy && !this.state.textContent) this.toggle(false, false);
    this.host.hidden = !manage && this.line.hidden && this.prompt.hidden;
  }

  paintChips() {
    for (const chip of this.chips.children) chip.setAttribute('aria-pressed', chip.dataset.harness === this.harness ? 'true' : 'false');
  }

  toggle(open = this.line.hidden, focus = true) {
    if (open && !this.manage) return;
    this.line.hidden = !open; this.opener.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { this.input.focus(); return; }
    if (!this.busy) this.show('');
    if (focus && !this.opener.hidden) this.opener.focus();
    this.host.hidden = !this.manage && this.prompt.hidden;
  }

  show(text, { quiet = false, retry = false } = {}) {
    this.state.replaceChildren(text);
    if (retry) {
      const again = element('button', { type: 'button', className: 'text-action invite-retry', textContent: 'Try again' });
      again.onclick = () => this.go(true);
      this.state.append(' ', again);
    }
    this.state.hidden = !text; this.state.classList.toggle('quiet', quiet);
  }

  async go(again = false) {
    if (this.busy) return;
    this.busy = true; this.input.readOnly = true; this.input.setAttribute('aria-busy', 'true');
    this.chips.setAttribute('aria-disabled', 'true');
    this.show('Inviting…', { quiet: true });
    let done = null, failed = null;
    try { done = again ? await this.invitation.again() : await this.invitation.send(this.workspace(), this.input.value, this.harness); }
    catch (error) { failed = error; }
    this.busy = false; this.input.readOnly = false; this.input.removeAttribute('aria-busy'); this.chips.removeAttribute('aria-disabled');
    if (done) {
      this.input.value = ''; this.show('');
      this.toggle(false, false);
      this.showPrompt(done);
      this.invited(done.agent);
      return;
    }
    // A sign-in file not written: the agent is on the team already, and Try again writes the file.
    if (failed.retry) { this.show(failed.message, { retry: true }); this.invited(failed.agent); this.state.querySelector('button')?.focus(); return; }
    this.show(failed.message);
    this.input.focus();
    // A refusal keeps the name, selected, to be changed in place.
    if (!failed.again) this.input.select();
  }

  showPrompt({ agent, harness, prompt }) {
    this.said.textContent = `${agent.name} is on the team. Paste this into ${harnessName(harness)}:`;
    this.text.textContent = prompt;
    this.copied.hidden = true; this.copied.textContent = '';
    this.prompt.hidden = false; this.host.hidden = false;
    this.copyButton.focus();
  }

  closePrompt() {
    this.prompt.hidden = true; this.text.textContent = '';
    this.host.hidden = !this.manage && this.line.hidden;
    if (!this.opener.hidden) this.opener.focus();
  }

  async copy() {
    const ok = await this.copier(this.text.textContent);
    this.copied.hidden = false;
    this.copied.classList.toggle('quiet', ok);
    this.copied.textContent = ok ? 'Copied' : COPY_REFUSED_PROMPT;
    if (ok) return;
    // Refused: the words are selected for the person to copy themselves.
    const range = document.createRange(); range.selectNodeContents(this.text);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
}

const COPY_PATH = 'M8 8h12v12H8z M16 8V4H4v12h4';
function glyphButton(className, label, path) {
  const button = element('button', { type: 'button', className, title: label });
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
  return button;
}
