import { Api } from './api.mjs';
import { openJournal } from './journal.mjs';
import { EditorRegistry } from './app-session.mjs';
import { Reader } from './reader.mjs';
import { PRIOR_PUBLICATION_NOTICE } from './session.mjs';
import { readableUploads, uploadWork, recoveryReadOnly, refusedCopyAtDraft, refusedAtDraft } from './upload-state.mjs';
import { Freshness, initialViews, readFailure, checkedView, bindingOf } from './freshness.mjs';
import { TopicViews } from './topic-views.mjs';

const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const button = (label, action) => { const element = node('button', label); element.type = 'button'; element.onclick = () => run(action); return element; };
const status = message => { $('app-status').textContent = message; $('app-status').hidden = !message; };
const run = action => { try { return Promise.resolve(action()).catch(error => { status(error.message); return null; }); } catch (error) { status(error.message); return Promise.resolve(null); } };
let api, bootstrap, journal, registry, reader, topic, opening = 0, freshness, views, updateState;
let localEffectVersion = 0;
let availabilitySerial = 0;
const listLoads = new Map();
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
function imageSummary(editor, refs = editor.draft.attachments) {
  const names = refs.map(r => r.name ?? editor.uploadState?.entries.find(e => e.ready_descriptor?.media_id === r.id)?.file?.name ?? r.id);
  return names.length ? `${names.length} attachment${names.length === 1 ? '' : 's'}: ${names.join(', ')}` : 'No attachments';
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
  if (editor.context.kind === 'reply') {
    $('review-content').append(node('p', imageSummary(editor), 'muted'));
    const uploads = session.uploads;
    if (editor.imageStorageError) $('review-content').append(button('Retry saving image change', async () => { await uploads.transition(() => {}); if (current()) await showVersions(editor, opener); }));
    const retained = editor.uploadState?.entries.filter(e => !e.selected || e.owner.kind === 'submission') ?? [];
    if (retained.length) $('review-content').append(node('h3', 'Removed images and earlier replies'));
    for (const entry of retained) {
      const section = node('section');
      section.append(node('p', `${entry.file?.name ?? entry.ready_descriptor?.name ?? 'Attachment'} · ${uploads.status(entry.selection_id)}`));
      if (entry.owner.kind === 'submission') section.append(node('p', 'Included in the earlier reply. Discarding the local file does not remove it from that reply.', 'muted'));
      if (entry.attempts.length) section.append(button('Check confirmation', async () => { await uploads.check(entry.selection_id); if (current()) await showVersions(editor, opener); }));
      if (entry.bytes_ref && !uploads.running.has(entry.selection_id)) {
        section.append(node('p', 'An upload may still finish. Discard only the retained file on this device; its upload history and earlier reply stay.', 'muted'));
        section.append(button('Discard retained file', async () => { await uploads.discard(entry.selection_id); if (current()) await showVersions(editor, opener); }));
      }
      $('review-content').append(section);
    }
  }
  let remote = recovery?.remote ?? editor.conflict?.remote;
  if (!recovery && editor.conflict && remote === undefined) {
    try {
      const state = validate(await api.view('editor_state', { source_ref: editor.sourceRef, topic_id: editor.context.topicId }));
      registry.validateState(state, editor.sourceRef, editor.context.topicId);
      remote = editor.context.kind === 'note' ? state.note : state.draft;
    } catch (error) { if (current()) reviewStatus(error.message); }
  }
  if (!current()) return;
  if (recovery || editor.conflict) $('review-content').append(version('Saved private version', remote === undefined ? 'Saved version unavailable. Retry to read it; your writing is kept.' : remote?.body ?? null,
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
  } else if (editor.conflict) reviewStatus(remote === undefined ? 'The saved version could not be read. Retry; sending remains blocked and your writing is kept.' : 'Both versions are kept. Copy what you need; this comparison does not overwrite either version.');
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
      if (candidate.snapshot && (candidate.snapshot.format === 1 || readableUploads(candidate.snapshot))) {
        if (candidate.snapshot.format === 2) section.append(node('p', 'This version includes saved image selections. Recover it to check or remove them before sending.', 'muted'));
        const adopt = button('Recover this version', async () => {
          adopt.disabled = true;
          try { await registry.adoptCandidate(editor, candidate, presentation); if (current()) { closeReview(); reader.field.focus({ preventScroll: true }); } }
          catch (error) { if (current()) reviewStatus(error.message); }
          finally { if (adopt.isConnected) adopt.disabled = false; }
        });
        adopt.disabled = editor.localVersion > 0 || session.attempts.length > 0 || uploadWork(editor);
        section.append(adopt);
        if (refusedCopyAtDraft(candidate, editor.recoveryServerDraft)) {
          for (const item of candidate.snapshot.submissions.filter(item => refusedAtDraft(item, editor.recoveryServerDraft))) {
            section.append(node('p', 'Earlier reply was not prepared. Keeping current writing leaves this earlier reply saved here.', 'muted'), node('pre', item.snapshot.body));
          }
          section.append(button('Keep current writing', async () => {
            await registry.keepCurrentWriting(editor, candidate);
            if (current()) { reviewStatus('Current writing kept. The earlier reply remains saved and will not be sent.'); changed(editor); }
          }));
        }
        if (candidate.snapshot.format === 2 && candidate.snapshot.uploadState.entries.some(e => e.selected && e.owner.kind === 'cycle')) {
          section.append(button('Remove saved image selections', async () => { await registry.removeCandidateImages(editor, candidate); if (current()) await showVersions(editor, opener); }));
        }
        for (const e of candidate.snapshot.uploadState?.entries ?? []) if (!e.selected || e.owner.kind === 'submission') {
          const label = node('p', e.file?.name ?? e.ready_descriptor?.name ?? 'Earlier image'); section.append(label);
          const a = e.attempts[e.choice];
          if (a) section.append(button('Check image confirmation', async () => {
            const r = await api.view('operation', { operation_id: a.publish_operation_id });
            if (r?.instance_id !== editor.context.instanceId || r.operation_id !== a.publish_operation_id ||
                r.recorded === true && r.kind !== 'media.publish') throw Error('Image confirmation identity does not match.');
            if (current()) label.textContent = `${e.file?.name ?? 'Earlier image'} · ${r.recorded === true ? r.status : 'Confirmation unknown'}`;
          }));
          if (e.bytes_ref) section.append(button('Discard retained file', async () => {
            await journal.changeCandidateImages(editor.key, candidate, { kind: 'discard', selectionId: e.selection_id });
            if (current()) await showVersions(editor, opener);
          }));
        }
      } else if (candidate.availability !== 'open-in-another-tab') {
        section.append(node('p', 'This saved copy cannot be interpreted. It will remain on this device.', 'muted'));
        section.append(button('Continue without this copy', async () => { await registry.waiveUnreadable(editor, candidate); reviewStatus('This copy is kept. The choice applies only to this writing cycle and this exact saved version.'); }));
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
  $('review-content').append(version('Earlier reply', item.snapshot.body, `To ${item.topicId} · Addressed to ${(item.snapshot.addressees ?? []).join(', ') || 'the topic'} · ${imageSummary(editor, item.snapshot.attachments)}`), version('Your current writing', editor.draft.body, imageSummary(editor)));
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
        if (local.has(item.id)) { card.append(node('pre', item.snapshot.body));
          if (item.snapshot.attachments.length) card.append(node('p', 'Included in this reply · ' + imageSummary(editor, item.snapshot.attachments), 'muted')); }
        else card.append(button('Read submitted writing', async () => {
          const detail = await registry.inspectPending(editor, item.id);
          if (current() && !card.querySelector('pre')) card.append(node('pre', detail.body));
          draw();
        }));
        card.append(button('Check confirmation', async () => { await registry.checkPending(editor, item.id); draw(); }));
        if (local.has(item.id) && statusKey !== 'confirmed' && (item.detached || item.receipt?.kind === 'submission.prepare')) {
          const again = button('Prepare this reply again', () => showCorrection(editor, item, opener)); card.append(again);
        }
      }
      card.querySelector('h3').textContent = (item.detached ? 'Earlier runtime · ' : '') + (names[statusKey] ?? 'Confirmation unknown');
      const reason = registry.pendingReason(editor, item);
      let explanation = card.querySelector('[data-refusal]');
      if (reason && !explanation) { explanation = node('p', '', 'muted'); explanation.dataset.refusal = ''; card.append(explanation); }
      if (explanation) { explanation.textContent = reason ?? ''; explanation.hidden = !reason; }
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
    reader.field.readOnly = Boolean(reader.editor?.adopting || recoveryReadOnly(reader.editor));
    const known = candidates.get(reader.editor.key);
    $('review-versions').hidden = !reader.editor.uploadState && !reader.editor.recoveryDiscovery && !reader.editor.authorityRecovery && !reader.editor.conflict && !reader.editor.cleanupError && !known?.items.length && !known?.nextCursor;
  }
  invalidateComparison(editor);
  if (editor.context.kind === 'reply' && pendingCount(editor)) {
    let host = [...$('topic-pending').children].find(child => child.dataset.key === editor.key);
    if (!host) { host = node('div'); host.dataset.key = editor.key; $('topic-pending').append(host); }
    pendingButton(host, editor);
  }
  for (const item of editor.submissions) {
    const version = item.status === 'confirmed' && item.receipt?.result?.topic?.version;
    if (version > localEffectVersion) { localEffectVersion = version; freshness?.invalidate('topic', version); freshness?.request(); }
  }
}
function revokeMedia() { for (const url of mediaURLs) URL.revokeObjectURL(url); mediaURLs.clear(); }
async function present(presentation) {
  retainRevisionTargets(presentation);
  revokeMedia(); reader.presentation = presentation;
  reader.show(presentation.source, presentation.editors, { opener: presentation.opener, topics: [topic], presentation, mode: presentation.mode });
  if (presentation.sourceUnavailable) reader.notice('The source is unavailable. Your private writing is kept.');
  for (const editor of Object.values(presentation.editors)) {
    registry.recoveryCandidates(editor, { limit: 10 }).then(page => { candidates.set(editor.key, page); changed(editor); }).catch(error => { if (registry.isCurrent(presentation)) reader.notice(error.message); });
  }
  registry.neighbors(presentation).then(neighbors => {
    if (!neighbors || !registry.isSourceCurrent(presentation)) return;
    registry.current.neighbors = neighbors;
    $('previous-message').disabled = !neighbors.previous; $('next-message').disabled = !neighbors.next;
  }).catch(error => { if (registry.isSourceCurrent(presentation)) reader.notice(error.message); });
  sourceAttachments(presentation);
}
function sourceAttachments(presentation) {
  reader.drawAttachments($('source-attachments'), presentation.source.attachments);
  for (const attachment of presentation.source.attachments ?? []) {
    const host = node('span', undefined, 'attachment-label'); $('source-attachments').append(host);
    const available = () => registry.isSourceCurrent(presentation) && host.isConnected &&
      !registry.current.sourceUnavailable && !registry.current.availabilityUnconfirmed;
    const show = button(`Open ${attachment.name ?? 'attachment'}`, async () => {
      if (!available()) return;
      show.disabled = true;
      try {
        const media = await api.media(bootstrap.instance_id, attachment, presentation.source.source_ref);
        if (!available()) return;
        const url = URL.createObjectURL(media.blob);
        mediaURLs.add(url); host.replaceChildren();
        if (media.inline) { const image = node('img'); image.alt = attachment.name; image.src = url; host.append(image); }
        const download = node('a', `Download ${attachment.name}`); download.href = url; download.download = attachment.name; host.append(download);
      } catch (error) { if (available()) reader.notice(error.message); }
      finally { if (show.isConnected) show.disabled = false; }
    }); host.append(show);
  }
}
async function openSource(ref, opener) {
  const request = ++opening;
  views.retain(views.currentItem, ref.kind === 'memory' ? ref.id : null);
  status('');
  try { await registry.open(ref, { topicId: topic.id, opener }); }
  catch (error) { if (request === opening) status(error.message); }
  finally { if (request === opening) { views.retain(views.currentItem, null); reader.paintOffer(); } }
}
function keepListAnchor(paint) {
  const anchor = [...document.querySelectorAll('#messages .message-card, #memory-items .memory-card')].find(card => card.getBoundingClientRect().bottom > 0);
  const top = anchor?.getBoundingClientRect().top;
  paint();
  if (anchor?.isConnected && Number.isFinite(top)) window.scrollBy(0, anchor.getBoundingClientRect().top - top);
}
function paintViews(kind) {
  if (kind === 'offer') { reader?.paintOffer(); return; }
  if (kind === 'topic') {
    topic = views.topic; $('topic-title').textContent = topic.title;
    $('topic-description').textContent = 'Open a message to read, quote, reply, or keep a private note.';
    $('topics').firstElementChild.textContent = topic.title;
    $('participants').replaceChildren(...views.participants.map(p => node('span', p.actor_id, 'chip')));
    for (const id of ['messages', 'notebook', 'participants']) $(id).hidden = false;
    return;
  }
  keepListAnchor(() => {
  for (const item of kind === 'messages' ? [...views.messages.values()].sort((a, b) => b.seq - a.seq) : []) {
    let card = [...$('messages').children].find(child => child.dataset.id === item.id);
    if (!card) {
      const ref = { kind: 'message', id: item.id };
      card = button('', () => openSource(ref, card)); card.className = 'message-card'; card.dataset.id = item.id; card.dataset.seq = item.seq;
      card.append(node('span', item.author_id, 'message-author'), node('span', item.body, 'message-preview'));
      const following = [...$('messages').children].find(child => Number(child.dataset.seq) < item.seq);
      $('messages').insertBefore(card, following ?? null);
    }
  }
  for (const item of kind === 'memory' ? [...views.memory.values()].sort((a, b) => a.seq - b.seq) : []) {
    let card = [...$('memory-items').children].find(child => child.dataset.id === item.id);
    if (!card) {
      card = button('', () => openSource(item.source_ref, card)); card.className = 'memory-card';
      card.dataset.id = item.id; card.append(node('strong'), node('span')); $('memory-items').append(card);
    }
    const identity = sourceIdentity(item.source_ref);
    if (card.dataset.source !== identity) {
      card.dataset.source = identity; card.querySelector('strong').textContent = item.title || 'Notebook item'; card.querySelector('span').textContent = item.body;
    }
    card.onclick = () => run(() => openSource(item.source_ref, card));
  }
  });
  $('more-messages').hidden = views.olderCursor === null;
  $('more-memory').hidden = views.memoryCursor === null;
}
function listPage(kind, more = false) {
  if (listLoads.has(kind)) return listLoads.get(kind);
  const cursor = kind === 'messages' ? views.olderCursor : views.memoryCursor;
  if (more && cursor === null) return Promise.resolve();
  const foreground = registry.cleanup.foreground();
  const args = kind === 'messages' ? { topic_id: topic.id, audience: 'all', direction: 'before', limit: 30 }
    : { owner_scope: views.scope, limit: 20 };
  if (more) args.cursor = cursor;
  const run = foreground.read(options => api.view(kind === 'messages' ? 'topic_messages' : 'memory_items', args, options)).then(page => {
    if (kind === 'messages') views.messagesPage(page, { initial: !more, cursor });
    else views.memoryPage(page, { initial: !more, cursor });
  }).finally(() => { foreground.release(); listLoads.delete(kind); });
  listLoads.set(kind, run); return run;
}
function retainRevisionTargets(presentation = registry?.current) {
  const source = presentation?.source;
  views.retain(source?.source_ref.kind === 'memory' ? source.source_ref.id : null, views.openingItem);
  if (source?.source_ref.kind === 'memory') views.revisions.observe(source.source_ref.id, source.current_revision);
}
function revisionOffer(presentation) {
  if (!views || !registry?.isCurrent(presentation) || presentation.sourceUnavailable || presentation.availabilityUnconfirmed) return null;
  retainRevisionTargets(presentation);
  const ref = presentation.source.source_ref, revision = views.revisions.offer(ref, presentation.source.current_revision);
  if (revision === null) return null;
  const editor = presentation.editors.reply, key = editor.key;
  return { revision, open: () => {
    if (registry.isCurrent(presentation) && presentation.editors.reply === editor && editor.key === key &&
        !presentation.sourceUnavailable && !presentation.availabilityUnconfirmed) return openSource({ ...ref, revision }, presentation.opener);
  } };
}
function updateStatus(state) {
  updateState = state;
  const quiet = state.kind === 'current' || state.kind === 'defer';
  $('updates-status').hidden = quiet;
  $('updates-message').textContent = state.kind === 'retry' ? 'Updates delayed. Your writing is kept. '
    : state.kind === 'authority' ? 'The runtime changed. Review your saved writing before reconnecting. '
    : state.kind === 'forbidden' ? 'This topic is unavailable. Your private writing is kept. '
    : state.message + ' ';
  $('updates-retry').textContent = state.kind === 'reconnect' ? 'Reload to reconnect' : state.kind === 'authority' ? 'Review saved writing' : 'Retry updates';
  $('updates-retry').hidden = state.kind === 'manual';
}
async function checkAvailability(read, current, topicDenied = true) {
  if (topicDenied) {
    for (const id of ['messages', 'notebook', 'participants']) $(id).hidden = true;
    $('more-messages').hidden = true; $('topic-title').textContent = 'Topic unavailable'; $('topic-description').textContent = '';
    $('topics').replaceChildren(node('p', 'Topic unavailable'));
    for (const session of registry.sessions.values()) {
      if (session.editor.context.kind === 'reply' && session.editor.context.topicId === topic.id) {
        session.editor.unavailable = true; registry.cancelSave(session.editor); changed(session.editor);
      }
    }
  }
  let p = registry.current;
  if (!p) return;
  const sourcePresentation = p, serial = ++availabilitySerial;
  const wasUnavailable = p.sourceUnavailable;
  p.availabilityChecking = true; p.accessMessage = '';
  if (topicDenied) p.topicUpdatesPaused = true;
  p.availabilityUnconfirmed = true; p.destinationAvailable = false;
  p.editors.reply.unavailable = true; registry.cancelSave(p.editors.reply);
  p.editors.note.unavailable = true; registry.cancelSave(p.editors.note); reader.paintStatus();
  const sameSource = () => serial === availabilitySerial && registry.isSourceCurrent(sourcePresentation);
  const owns = () => current() && sameSource();
  try {
  let source;
  try { source = await read('source', p.source.source_ref); }
  catch (error) {
    if (readFailure(error).kind !== 'forbidden') throw error;
    if (!owns()) return;
    p = registry.current;
    p.sourceUnavailable = true; p.availabilityUnconfirmed = false;
    p.source.body = ''; p.source.attachments = []; p.editors.note.unavailable = true;
    revokeMedia(); reader.hideUnavailableSource(); return;
  }
  if (!owns()) return;
  p = registry.current;
  if (source?.source_ref?.kind !== p.source.source_ref.kind || source.source_ref.id !== p.source.source_ref.id ||
      source.source_ref.revision !== p.source.source_ref.revision) throw Error('The available source identity changed.');
  const state = await read('editor_state', { source_ref: p.source.source_ref, topic_id: topic.id });
  if (!owns()) return;
  p = registry.current;
  registry.validateState(state, p.source.source_ref, topic.id);
  p.availabilityUnconfirmed = false;
  if (!state.source_available) {
    p.sourceUnavailable = true; p.source.body = ''; p.source.attachments = []; revokeMedia(); reader.hideUnavailableSource();
  } else if (wasUnavailable) {
    Object.assign(p.source, source); p.sourceUnavailable = false;
    reader.drawSource(source.body); sourceAttachments(p);
    const provenance = source.source_ref.kind === 'memory' ? `Notebook · revision ${source.source_ref.revision}` : 'Message';
    $('reader-origin').textContent = [source.author, provenance].filter(Boolean).join(' · ');
  }
  p.destinationAvailable = state.destination_available;
  p.editors.reply.unavailable = !state.source_available || !state.destination_available;
  p.editors.note.unavailable = !state.source_available;
  reader.paintStatus();
  } finally {
    if (sameSource()) { registry.current.availabilityChecking = false; reader.paintStatus(); }
  }
}
async function retrySource() {
  const p = registry.current;
  if (!p || p.availabilityChecking || p.editors.reply.authorityRecovery) return;
  const foreground = registry.cleanup.foreground(), current = () => registry.isSourceCurrent(p);
  try {
    await checkAvailability(async (name, args) => checkedView(await foreground.read(options => api.view(name, args, options)), bootstrap.instance_id), current, false);
  } catch (error) {
    if (current()) {
      const failure = readFailure(error);
      if (failure.kind === 'authority') { await registry.parkAuthority(bindingOf(bootstrap), failure.code); updateStatus(failure); }
      registry.current.accessMessage = 'Could not confirm source access. Your private writing is kept. ' + failure.message;
    }
  } finally {
    foreground.release();
    if (current()) {
      reader.paintStatus();
      const failed = registry.current.sourceUnavailable || registry.current.availabilityUnconfirmed;
      (failed ? $('retry-source') : $('source-body')).focus({ preventScroll: true });
    }
  }
}
function enableFreshness(checkpoint) {
  if (!checkpoint) { updateStatus({ kind: 'manual', message: 'Automatic updates need the updated server. Use Refresh.' }); return; }
  freshness = new Freshness({ api, bootstrap, topicId: topic.id, checkpoint,
    read: operation => registry.cleanup.read(operation), binding: () => ({ ...bootstrap, authority: registry.runtime.current }),
    keys: item => views.keys(item), refreshKeys: () => views.refreshKeys(), status: updateStatus,
    authorityLost: (binding, failure) => registry.parkAuthority(binding, failure.code), denied: checkAvailability,
    rebuild: async (_read, current) => { if (current()) for (const item of views.refreshKeys()) freshness.invalidate(item.key, item.version, true); },
    refresh: async (key, version, read, current) => {
      if (key === 'availability') { await checkAvailability(read, current, false); return true; }
      if (key !== 'neighbors') return views.refresh(key, version, read, current);
      const p = registry.current;
      if (!p || p.source.source_ref.kind !== 'message') return true;
      p.neighbors = null;
      const result = await registry.neighbors(p, { read });
      if (!current() || !registry.isSourceCurrent(p) || !result) return true;
      registry.current.neighbors = result;
      $('previous-message').disabled = !result.previous; $('next-message').disabled = !result.next; return true;
    } });
  registry.cleanup.foregroundListeners.add(() => freshness.interrupt());
  document.addEventListener('visibilitychange', () => freshness.setVisible(document.visibilityState === 'visible'));
  window.addEventListener('online', () => { if (document.visibilityState === 'visible') freshness.request(); });
  freshness.setVisible(document.visibilityState === 'visible');
}
let startup = null;
function start() {
  if (!startup) startup = initialize().finally(() => { startup = null; });
  return startup;
}
async function initialize() {
  const token = document.querySelector('meta[name="aim-next-session"]')?.content;
  if (!token || token === '__AIM_SESSION_TOKEN__') throw Error('This page needs a session from the Theseus server.');
  api = new Api(token); bootstrap = await api.bootstrap();
  if (!bootstrap?.instance_id || !bootstrap.actor || bootstrap.error) throw Error('The instance and reader identity could not be established.');
  $('instance-label').textContent = `${bootstrap.actor} · ${bootstrap.instance_id}`;
  const topicId = new URL(location.href).searchParams.get('topic');
  if (!topicId) throw Error('Open a Theseus topic link to choose the conversation.');
  // The saved feed position precedes topic, messages and Notebook startup reads.
  const checkpoint = await initialViews({ api, bootstrap, topicId, load: async () => {} });
  views = new TopicViews({ instanceId: bootstrap.instance_id, topicId, paint: paintViews, invalidate: (key, version) => freshness?.invalidate(key, version) });
  const result = validate(await api.view('topic', { topic_id: topicId })); topic = result.topic;
  views.topic = topic; views.participants = result.participants;
  if (topic.id !== topicId) throw Error('The topic identity could not be confirmed.');
  $('topic-title').textContent = topic.title; $('topic-description').textContent = 'Open a message to read, quote, reply, or keep a private note.';
  $('topics').replaceChildren(node('p', topic.title));
  try {
    const workspace = validate(await api.view('workspace', { workspace_id: topic.workspace_id })).workspace;
    $('workspace-name').textContent = workspace.title; $('workspaces').replaceChildren(node('p', workspace.title));
  } catch { $('workspace-name').textContent = topic.workspace_id; }
  $('participants').replaceChildren(...result.participants.map(participant => node('span', participant.actor_id, 'chip')));
  // Keep startup retry read-only: no editor or clickable source exists until
  // both initial list bodies have arrived after the captured feed baseline.
  const messageAnswer = await api.view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 30 });
  const memoryAnswer = await api.view('memory_items', { owner_scope: views.scope, limit: 20 });
  journal = await openJournal({ instanceId: bootstrap.instance_id, actor: bootstrap.actor });
  reader = new Reader({
    revisionOffer,
    retrySource: () => run(retrySource),
    uploads: editor => registry?.sessionFor(editor).uploads,
    edit: editor => run(() => registry.edited(editor)), status: editor => registry.status(editor),
    mode: mode => {
      const cancelled = Boolean(registry.pendingOpen);
      reader.presentation = registry.setMode(mode); changed(reader.editor); retainRevisionTargets();
      if (cancelled) reader.notice('Stayed on this message; opening the other message was cancelled.');
    },
    saveNote: editor => run(() => registry.saveNote(editor)),
    send: (editor, options) => registry.send(editor, { ...options, presentation: reader.presentation }),
    close: () => registry.close(reader.presentation, { explicit: true }),
    step: async direction => {
      const presentation = registry.current, neighbors = presentation.neighbors ?? await registry.neighbors(presentation);
      if (!registry.isCurrent(presentation)) return;
      const ref = direction < 0 ? neighbors?.previous : neighbors?.next;
      if (ref) await openSource(ref, presentation.opener);
    },
    destination: value => { if (value !== topic.id) reader.notice('Choose the open topic for this reply.'); },
    reconcile: editor => run(() => registry.checkConfirmation(editor)),
    renderPending: (host, editor) => pendingButton(host, editor),
    recover: (editor, item) => run(() => showCorrection(editor, item, document.activeElement)),
    error: error => reader.notice(error.message),
  });
  registry = new EditorRegistry({ api, bootstrap, journal, present: presentation => run(() => present(presentation)), changed,
    closed: presentation => { if (reader.presentation === presentation) { reader.finishClose?.(); revokeMedia(); views.retain(null, null); } } });
  $('review-versions').onclick = () => run(() => showVersions(reader.editor));
  $('refresh').onclick = () => run(async () => {
    if (freshness) return freshness.request({ refresh: true });
    await listPage('messages'); await listPage('memory');
  });
  $('updates-retry').onclick = () => run(async () => {
    if (updateState?.kind === 'reconnect') { location.reload(); return; }
    if (updateState?.kind === 'authority') { if (reader.editor) await showVersions(reader.editor); else location.reload(); return; }
    if (registry.current?.sourceUnavailable || registry.current?.availabilityUnconfirmed || updateState?.kind === 'forbidden') freshness?.invalidate('availability', 0, true);
    await freshness?.request({ refresh: true, retry: true });
  });
  $('more-messages').onclick = () => run(() => listPage('messages', true)); $('more-memory').onclick = () => run(() => listPage('memory', true));
  window.addEventListener('beforeunload', event => { if (registry.hasUnprotectedWriting) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { freshness?.dispose(); registry.dispose(); journal.close(); revokeMedia(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  views.messagesPage(messageAnswer, { initial: true }); views.memoryPage(memoryAnswer, { initial: true });
  document.body.dataset.ready = 'true'; enableFreshness(checkpoint);
}
$('refresh').onclick = () => run(start);
run(start);
