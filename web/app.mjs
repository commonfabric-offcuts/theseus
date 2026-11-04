import { Api } from './api.mjs';
import { openJournal } from './journal.mjs';
import { EditorRegistry } from './app-session.mjs';
import { Reader } from './reader.mjs';
import { PRIOR_PUBLICATION_NOTICE } from './session.mjs';

const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const button = (label, action) => { const element = node('button', label); element.type = 'button'; element.onclick = () => run(action); return element; };
const status = message => { $('app-status').textContent = message; $('app-status').hidden = !message; };
const run = action => { try { return Promise.resolve(action()).catch(error => { status(error.message); return null; }); } catch (error) { status(error.message); return Promise.resolve(null); } };
let api, bootstrap, journal, registry, reader, topic, messageCursor = null, memoryCursor = null, opening = 0;
const candidates = new Map(), mediaURLs = new Set();
const review = $('version-review');
let comparison = null, reviewSerial = 0, reviewOpener = null;
const sourceIdentity = ref => JSON.stringify(ref);
const validate = answer => {
  if (answer?.error) throw Error(answer.error.message);
  if (answer?.instance_id !== bootstrap.instance_id) throw Error('This view belongs to a different instance.');
  return answer;
};
const reviewStatus = message => { $('review-status').textContent = message; $('review-status').hidden = !message; };
function closeReview() {
  ++reviewSerial; comparison = null; review.close();
  if (reviewOpener?.isConnected) reviewOpener.focus({ preventScroll: true });
}
$('review-close').onclick = closeReview; $('review-keep').onclick = closeReview;
review.addEventListener('cancel', event => { event.preventDefault(); closeReview(); });
function beginReview(title, opener) {
  comparison = null; const serial = ++reviewSerial;
  reviewOpener = opener ?? document.activeElement;
  $('review-title').textContent = title; $('review-content').replaceChildren(); reviewStatus('');
  $('review-save').hidden = true; $('review-save').disabled = true;
  $('review-retry').hidden = true; $('review-retry').disabled = false;
  if (!review.open) review.showModal(); $('review-title').focus(); return serial;
}
function version(label, writing, detail = '') {
  const section = node('section'); section.append(node('h3', label));
  if (detail) section.append(node('p', detail, 'muted'));
  section.append(node('pre', writing ?? 'No saved version here')); return section;
}
function invalidateComparison(editor) {
  if (!comparison || comparison.editor !== editor) return;
  if (comparison.localVersion !== editor.localVersion || comparison.authority !== JSON.stringify(editor.authorityRecovery)) {
    $('review-save').disabled = true;
    reviewStatus('The writing or saved version changed. Review again before choosing.');
    $('review-retry').hidden = false;
    $('review-retry').onclick = () => run(() => showVersions(editor, reviewOpener));
  }
}
async function showVersions(editor, opener = $('review-versions')) {
  const serial = beginReview('Review versions', opener), session = registry.sessionFor(editor), presentation = registry.current;
  const current = () => serial === reviewSerial && review.open;
  const localVersion = editor.localVersion, recovery = structuredClone(editor.authorityRecovery);
  const destination = editor.context.kind === 'note' ? 'Private note · only you' : `Reply to ${editor.context.topicId}`;
  $('review-content').append(version('Your current writing', editor.draft.body, destination));
  let remote = recovery?.remote ?? editor.conflict?.remote;
  if (!recovery && editor.conflict && remote === undefined) {
    try {
      const state = validate(await api.view('editor_state', { source_ref: editor.sourceRef, topic_id: editor.context.topicId }));
      registry.validateState(state, editor.sourceRef, editor.context.topicId);
      remote = editor.context.kind === 'note' ? state.note : state.draft;
    } catch (error) { if (current()) reviewStatus(error.message); }
  }
  if (!current()) return;
  if (recovery || editor.conflict) $('review-content').append(version('Saved private version', remote?.body ?? null,
    remote ? `Revision ${remote.revision} · ${destination}` : destination));
  if (recovery) {
    reviewStatus(recovery.message);
    $('review-retry').hidden = false;
    $('review-retry').onclick = () => run(async () => { await session.retryAuthority(); if (current()) await showVersions(editor, opener); });
    $('review-save').hidden = false;
    $('review-save').disabled = recovery.phase !== 'ready' || localVersion !== editor.localVersion;
    $('review-save').onclick = () => run(async () => {
      $('review-save').disabled = true;
      try {
        const result = await session.resumePrivate(recovery, localVersion);
        if (current() && result?.status === 'committed') closeReview();
      } catch (error) { if (current()) { reviewStatus(error.message); $('review-retry').hidden = false; } }
    });
  } else if (editor.conflict) reviewStatus('Both versions are kept. Copy what you need; this comparison does not overwrite either version.');
  comparison = { editor, localVersion, authority: JSON.stringify(editor.authorityRecovery) };
  const list = node('div'); $('review-content').append(list);
  const appendCandidates = async cursor => {
    const page = await registry.recoveryCandidates(editor, { cursor, limit: 10 });
    if (!current()) return;
    candidates.set(editor.key, page); changed(editor);
    for (const candidate of page.items) {
      const section = version(candidate.availability === 'open-in-another-tab' ? 'Open in another tab' : 'Writing kept on this device',
        candidate.snapshot?.draft.body ?? 'Close the other tab, then Retry to review its writing.',
        candidate.snapshot ? `Writer ${candidate.writerId} · ${destination}` : 'Ownership is still held by another document.');
      if (candidate.snapshot) {
        const adopt = button('Recover this version', async () => {
          adopt.disabled = true;
          try { await registry.adoptCandidate(editor, candidate, presentation); if (current()) { closeReview(); reader.field.focus({ preventScroll: true }); } }
          catch (error) { if (current()) reviewStatus(error.message); }
          finally { if (adopt.isConnected) adopt.disabled = false; }
        });
        adopt.disabled = editor.localVersion > 0 || session.attempts.length > 0;
        section.append(adopt);
      }
      list.append(section);
    }
    if (page.nextCursor) {
      const more = button('More versions', async () => { more.disabled = true; await appendCandidates(page.nextCursor); more.remove(); }); list.append(more);
    }
  };
  try { await appendCandidates(null); } catch (error) { if (current()) reviewStatus(error.message); }
  if (!current()) return;
  if (!recovery) {
    $('review-retry').hidden = false; $('review-retry').onclick = () => run(() => showVersions(editor, opener));
  }
  const history = button('Earlier recovery history', async () => {
    const append = async cursor => {
      const page = await journal.history(editor.key, { limit: 10, cursor });
      if (!current()) return;
      for (const row of page.items) list.append(version('Earlier version · already recovered', row.snapshot.draft.body, `Writer ${row.writerId}`));
      if (page.nextCursor) list.append(button('More history', () => append(page.nextCursor)));
    };
    history.disabled = true; await append(null);
  }); list.append(history);
}

async function showCorrection(editor, item, opener) {
  const serial = beginReview('Review this reply before preparing again', opener), localVersion = editor.localVersion;
  const current = () => serial === reviewSerial && review.open;
  $('review-content').append(version('Earlier reply', item.snapshot.body, `To ${item.topicId}`), version('Your current writing', editor.draft.body));
  const state = validate(await api.view('editor_state', { source_ref: item.sourceRef, topic_id: item.topicId }));
  if (!current()) return;
  registry.validateState(state, item.sourceRef, item.topicId);
  $('review-content').append(version('Saved private version', state.draft?.body ?? null));
  const label = node('label'), acknowledgement = node('input'); acknowledgement.type = 'checkbox';
  label.append(acknowledgement, document.createTextNode(' ' + PRIOR_PUBLICATION_NOTICE)); $('review-content').append(label);
  const prepare = button('Prepare this reply again', async () => {
    prepare.disabled = true;
    try {
      await registry.sessionFor(editor).correctPreparation(item, state.draft, localVersion,
        { stay: true, presentation: registry.current, acknowledgePossiblePriorPublication: acknowledgement.checked });
      if (current()) closeReview();
    } catch (error) { if (current()) reviewStatus(error.message); }
  });
  prepare.disabled = true; acknowledgement.onchange = () => { prepare.disabled = !acknowledgement.checked || localVersion !== editor.localVersion; };
  $('review-content').append(prepare);
}

function pendingCount(editor) {
  return new Set([...editor.submissions.map(item => item.id), ...registry.pending(editor).items.map(item => item.id)]).size;
}
function pendingButton(host, editor) {
  const count = pendingCount(editor), label = `Review ${count} ${count === 1 ? 'reply' : 'replies'}`;
  let control = host.firstElementChild;
  if (!count) { host.replaceChildren(); return; }
  if (!control) { control = button(label, () => showPending(editor, control)); host.append(control); }
  control.textContent = label; control.onclick = () => run(() => showPending(editor, control));
}
async function showPending(editor, opener) {
  const serial = beginReview('Your replies', opener), current = () => serial === reviewSerial && review.open;
  const host = $('review-content');
  const names = { preparing: 'Preparing — writing kept', prepared: 'Confirmation unknown', confirmed: 'Sent to Theseus', refused: 'Not sent — writing kept', unknown: 'Confirmation unknown', committed: 'Sent to Theseus', rejected: 'Not sent — writing kept' };
  const draw = () => {
    if (!current()) return;
    const local = new Map(editor.submissions.map(item => [item.id, item]));
    const entries = [...local.values(), ...registry.pending(editor).items.filter(item => !local.has(item.id))];
    for (const item of entries) {
      const statusKey = item.status ?? item.send_status;
      let card = [...host.children].find(child => child.dataset.id === item.id);
      if (!card) {
        card = node('section', undefined, 'pending-card'); card.dataset.id = item.id;
        card.append(node('h3'), node('p', `To ${item.topicId ?? item.topic_id}`, 'muted')); host.append(card);
        if (local.has(item.id)) card.append(node('pre', item.snapshot.body));
        else card.append(button('Read submitted writing', async () => {
          const detail = await registry.inspectPending(editor, item.id);
          if (current() && !card.querySelector('pre')) card.append(node('pre', detail.body));
        }));
        card.append(button('Check confirmation', async () => { await registry.checkPending(editor, item.id); draw(); }));
        if (local.has(item.id) && statusKey !== 'confirmed' && (item.detached || item.receipt?.kind === 'submission.prepare')) {
          const again = button('Prepare this reply again', () => showCorrection(editor, item, opener)); card.append(again);
        }
      }
      card.querySelector('h3').textContent = (item.detached ? 'Earlier runtime · ' : '') + (names[statusKey] ?? 'Confirmation unknown');
    }
    host.querySelector('[data-more]')?.remove();
    if (registry.pending(editor).next_cursor !== null) {
      const more = button('More pending replies', async () => { more.disabled = true; await registry.morePending(editor); draw(); });
      more.dataset.more = ''; host.append(more);
    }
  }; draw();
}

function changed(editor) {
  if (reader?.sessions && Object.values(reader.sessions).includes(editor)) {
    reader.paintStatus(); reader.paintPending();
    reader.field.readOnly = Boolean(reader.editor?.adopting);
    const known = candidates.get(reader.editor.key);
    $('review-versions').hidden = !reader.editor.authorityRecovery && !reader.editor.conflict && !reader.editor.cleanupError && !known?.items.length && !known?.nextCursor;
  }
  invalidateComparison(editor);
  if (editor.context.kind === 'reply' && pendingCount(editor)) {
    let host = [...$('topic-pending').children].find(child => child.dataset.key === editor.key);
    if (!host) { host = node('div'); host.dataset.key = editor.key; $('topic-pending').append(host); }
    pendingButton(host, editor);
  }
}
function revokeMedia() { for (const url of mediaURLs) URL.revokeObjectURL(url); mediaURLs.clear(); }
async function present(presentation) {
  revokeMedia(); reader.presentation = presentation;
  reader.show(presentation.source, presentation.editors, { opener: presentation.opener, topics: [topic], presentation, mode: presentation.mode });
  if (presentation.sourceUnavailable) reader.notice('The source is unavailable. Your private writing is kept.');
  for (const editor of Object.values(presentation.editors)) {
    registry.recoveryCandidates(editor, { limit: 10 }).then(page => { candidates.set(editor.key, page); changed(editor); }).catch(error => { if (registry.isCurrent(presentation)) reader.notice(error.message); });
  }
  registry.neighbors(presentation).then(neighbors => {
    if (!registry.isSourceCurrent(presentation)) return;
    registry.current.neighbors = neighbors;
    $('previous-message').disabled = !neighbors.previous; $('next-message').disabled = !neighbors.next;
  }).catch(error => { if (registry.isSourceCurrent(presentation)) reader.notice(error.message); });
  for (const attachment of presentation.source.attachments ?? []) {
    const host = node('span', undefined, 'attachment-label'); $('source-attachments').append(host);
    const show = button(`Open ${attachment.name ?? 'attachment'}`, async () => {
      show.disabled = true;
      try {
        const media = await api.media(bootstrap.instance_id, attachment, presentation.source.source_ref);
        const url = URL.createObjectURL(media.blob);
        if (!registry.isSourceCurrent(presentation)) { URL.revokeObjectURL(url); return; }
        mediaURLs.add(url); host.replaceChildren();
        if (media.inline) { const image = node('img'); image.alt = attachment.name; image.src = url; host.append(image); }
        const download = node('a', `Download ${attachment.name}`); download.href = url; download.download = attachment.name; host.append(download);
      } catch (error) { if (registry.isSourceCurrent(presentation)) reader.notice(error.message); }
      finally { if (show.isConnected) show.disabled = false; }
    }); host.append(show);
  }
}
async function openSource(ref, opener) {
  const request = ++opening;
  status('');
  try { await registry.open(ref, { topicId: topic.id, opener }); }
  catch (error) { if (request === opening) status(error.message); }
}
async function messagePage(more = false) {
  const page = validate(await api.view('topic_messages', { topic_id: topic.id, direction: 'before', limit: 30,
    ...(more && messageCursor !== null ? { cursor: messageCursor } : {}) }));
  for (const item of [...page.items].reverse()) {
    if (item.topic_id !== topic.id) throw Error('The message preview belongs to another topic.');
    let card = [...$('messages').children].find(child => child.dataset.id === item.id);
    if (!card) {
      const ref = { kind: 'message', id: item.id };
      card = button('', () => openSource(ref, card)); card.className = 'message-card'; card.dataset.id = item.id; card.dataset.seq = item.seq;
      card.append(node('span', item.author_id, 'message-author'), node('span', item.body, 'message-preview'));
      const following = [...$('messages').children].find(child => Number(child.dataset.seq) < item.seq);
      $('messages').insertBefore(card, following ?? null);
    }
  }
  messageCursor = page.next_cursor; $('more-messages').hidden = messageCursor === null;
}
async function memoryPage(more = false) {
  const page = validate(await api.view('memory_items', { owner_scope: { kind: 'topic', id: topic.id }, limit: 20,
    ...(more && memoryCursor !== null ? { cursor: memoryCursor } : {}) }));
  for (const item of page.items) {
    let card = [...$('memory-items').children].find(child => child.dataset.id === item.id);
    if (!card) {
      card = button('', () => openSource(item.source_ref, card)); card.className = 'memory-card';
      card.dataset.id = item.id; card.append(node('strong'), node('span')); $('memory-items').append(card);
    }
    card.dataset.source = sourceIdentity(item.source_ref); card.querySelector('strong').textContent = item.title || 'Notebook item'; card.querySelector('span').textContent = item.body;
    card.onclick = () => run(() => openSource(item.source_ref, card));
  }
  memoryCursor = page.next_cursor; $('more-memory').hidden = memoryCursor === null;
}
async function start() {
  const token = document.querySelector('meta[name="aim-next-session"]')?.content;
  if (!token || token === '__AIM_SESSION_TOKEN__') throw Error('This page needs a session from the Theseus server.');
  api = new Api(token); bootstrap = await api.bootstrap();
  if (!bootstrap?.instance_id || !bootstrap.actor || bootstrap.error) throw Error('The instance and reader identity could not be established.');
  $('instance-label').textContent = `${bootstrap.actor} · ${bootstrap.instance_id}`;
  const topicId = new URL(location.href).searchParams.get('topic');
  if (!topicId) throw Error('Open a Theseus topic link to choose the conversation.');
  const result = validate(await api.view('topic', { topic_id: topicId })); topic = result.topic;
  if (topic.id !== topicId) throw Error('The topic identity could not be confirmed.');
  $('topic-title').textContent = topic.title; $('topic-description').textContent = 'Open a message to read, quote, reply, or keep a private note.';
  $('topics').append(node('p', topic.title));
  try {
    const workspace = validate(await api.view('workspace', { workspace_id: topic.workspace_id })).workspace;
    $('workspace-name').textContent = workspace.title; $('workspaces').append(node('p', workspace.title));
  } catch { $('workspace-name').textContent = topic.workspace_id; }
  for (const participant of result.participants) $('participants').append(node('span', participant.actor_id, 'chip'));
  journal = await openJournal({ instanceId: bootstrap.instance_id, actor: bootstrap.actor });
  reader = new Reader({
    edit: editor => run(() => registry.edited(editor)), status: editor => registry.status(editor),
    mode: mode => {
      const cancelled = Boolean(registry.pendingOpen);
      reader.presentation = registry.setMode(mode); changed(reader.editor);
      if (cancelled) reader.notice('Stayed on this message; opening the other message was cancelled.');
    },
    saveNote: editor => run(() => registry.saveNote(editor)),
    send: (editor, options) => registry.send(editor, { ...options, presentation: reader.presentation }),
    close: () => registry.close(reader.presentation, { explicit: true }),
    step: async direction => {
      const presentation = registry.current, neighbors = presentation.neighbors ?? await registry.neighbors(presentation);
      if (!registry.isCurrent(presentation)) return;
      const ref = direction < 0 ? neighbors.previous : neighbors.next;
      if (ref) await openSource(ref, presentation.opener);
    },
    destination: value => { if (value !== topic.id) reader.notice('Choose the open topic for this reply.'); },
    reconcile: editor => run(() => registry.checkConfirmation(editor)),
    renderPending: (host, editor) => pendingButton(host, editor),
    recover: (editor, item) => run(() => showCorrection(editor, item, document.activeElement)),
    error: error => reader.notice(error.message),
  });
  registry = new EditorRegistry({ api, bootstrap, journal, present: presentation => run(() => present(presentation)), changed,
    closed: presentation => { if (reader.presentation === presentation) { reader.finishClose?.(); revokeMedia(); } } });
  $('review-versions').onclick = () => run(() => showVersions(reader.editor));
  $('refresh').onclick = () => run(async () => { await messagePage(); await memoryPage(); });
  $('more-messages').onclick = () => run(() => messagePage(true)); $('more-memory').onclick = () => run(() => memoryPage(true));
  window.addEventListener('beforeunload', event => { if (registry.hasUnprotectedWriting) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { registry.dispose(); journal.close(); revokeMedia(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  await messagePage(); await memoryPage(); document.body.dataset.ready = 'true';
}
run(start);
