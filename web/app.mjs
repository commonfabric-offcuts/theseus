import { Api } from './api.mjs';
import { openJournal } from './journal.mjs';
import { EditorRegistry } from './app-session.mjs';
import { Reader } from './reader.mjs';
import { InlineComposer } from './inline-composer.mjs';
import { PRIOR_PUBLICATION_NOTICE } from './session.mjs';
import { readableUploads, uploadWork, recoveryReadOnly, refusedCopyAtDraft, refusedAtDraft } from './upload-state.mjs';
import { Freshness, initialViews, readFailure, checkedView, bindingOf } from './freshness.mjs';
import { TopicViews } from './topic-views.mjs';
import { TopicPages, TopicNavigation, TopicRail, parseRoute, routeHref } from './topic-navigation.mjs';
import { OutcomeRail } from './outcomes.mjs';
import { OutcomeReferences } from './outcome-references.mjs';
import { openIntentJournal } from './intent-journal.mjs';
import { OpeningDraft } from './opening.mjs';
import { OpeningView, UnfinishedOpenings } from './opening-view.mjs';
import { openOpeningStore } from './opening-store.mjs';
import { OutcomeCreation } from './creation.mjs';
import { CreateOutcomeView, showUnfinished } from './creation-view.mjs';
import { ReadThrough } from './read-through.mjs';
import { Live, liveOffered, reloader } from './live.mjs';
import { Attention, paintSent } from './attention.mjs';
import { TopicStatePanel, paintWaiting, readableTime } from './topic-state.mjs';
import { PeoplePanel, fillNames, readDirectory, readMembers } from './people.mjs';
import { Marks, paintMarkButton, paintAuthor, marksWords } from './marks.mjs';

const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const button = (label, action) => { const element = node('button', label); element.type = 'button'; element.onclick = () => run(action); return element; };
const status = message => { $('app-status').textContent = message; $('app-status').hidden = !message; };
const run = action => { try { return Promise.resolve(action()).catch(error => { status(error.message); return null; }); } catch (error) { status(error.message); return Promise.resolve(null); } };
let api, bootstrap, journal, registry, reader, inline, topic, opening = 0, freshness, views, updateState, live = null, attention = null, topicState = null, waitingHost = null;
let localEffectVersion = 0;
let availabilitySerial = 0;
let inlineAvailabilitySerial = 0;
let topicUnavailable = false, listAccessEpoch = 0;
let topicRail, topicNavigation, outcomeRail, outcomeReferences, inlineDiscovery = null, sentHost = null, participantsPanel = null, outcomeMembers = null;
let intentJournal, intentOpening, outcomeCreation, readThrough, cardObserver, middleObserver, marks = null, commitReload = null;
const halfShown = new Set(), atMiddle = new Set();
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
const presentationFor = editor => [registry?.current, registry?.inline].find(p => p && Object.values(p.editors).includes(editor));
const writingSurface = p => p?.surface === 'inline' ? inline : reader;
const needsReview = editor => {
  const known = candidates.get(editor.key);
  return Boolean(editor.uploadState || editor.recoveryDiscovery || editor.authorityRecovery || editor.conflict || editor.cleanupError || known?.items.length || known?.nextCursor);
};
function closeReview() {
  ++reviewSerial; comparison = null; review.close();
  if (reviewOpener?.isConnected) reviewOpener.focus({ preventScroll: true });
}
$('review-close').onclick = closeReview; $('review-keep').onclick = closeReview;
review.addEventListener('cancel', event => { event.preventDefault(); closeReview(); });
// The version review covers the page while open; what it hides is read once it closes.
review.addEventListener('close', () => noteRead());
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
    $('review-retry').onclick = () => run(() => showVersions(editor, reviewOpener, comparison.presentation));
  }
}
async function showVersions(editor, opener = $('review-versions'), presentation = presentationFor(editor)) {
  if (!registry.isCurrent(presentation, editor)) throw Error('Open this writing before reviewing its versions.');
  const serial = beginReview('Review versions', opener), session = registry.sessionFor(editor);
  const current = () => serial === reviewSerial && review.open && registry.isCurrent(presentation);
  const action = run => () => { if (current() && registry.isCurrent(presentation, editor)) return run(); };
  const make = (label, run) => button(label, action(run));
  const localVersion = editor.localVersion, recovery = structuredClone(editor.authorityRecovery);
  const destination = editor.context.kind === 'note' ? 'Private note · only you' : `Reply to ${editor.context.topicId}`;
  $('review-content').append(version('Your current writing', editor.draft.body, destination));
  if (editor.context.kind === 'reply') {
    $('review-content').append(node('p', imageSummary(editor), 'muted'));
    const uploads = session.uploads;
    if (editor.imageStorageError) $('review-content').append(make('Retry saving image change', async () => { await uploads.transition(() => {}); if (current()) await showVersions(editor, opener, presentation); }));
    const retained = editor.uploadState?.entries.filter(e => !e.selected || e.owner.kind === 'submission') ?? [];
    if (retained.length) $('review-content').append(node('h3', 'Removed images and earlier replies'));
    for (const entry of retained) {
      const section = node('section');
      section.append(node('p', `${entry.file?.name ?? entry.ready_descriptor?.name ?? 'Attachment'} · ${uploads.status(entry.selection_id)}`));
      if (entry.owner.kind === 'submission') section.append(node('p', 'Included in the earlier reply. Discarding the local file does not remove it from that reply.', 'muted'));
      if (entry.attempts.length) section.append(make('Check confirmation', async () => { await uploads.check(entry.selection_id); if (current()) await showVersions(editor, opener, presentation); }));
      if (entry.bytes_ref && !uploads.running.has(entry.selection_id)) {
        section.append(node('p', 'An upload may still finish. Discard only the retained file on this device; its upload history and earlier reply stay.', 'muted'));
        section.append(make('Discard retained file', async () => { await uploads.discard(entry.selection_id); if (current()) await showVersions(editor, opener, presentation); }));
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
    $('review-retry').onclick = () => run(action(async () => { await session.retryAuthority(); if (current()) await showVersions(editor, opener, presentation); }));
    $('review-save').hidden = false;
    $('review-save').disabled = recovery.phase !== 'ready' || localVersion !== editor.localVersion;
    $('review-save').onclick = () => run(action(async () => {
      $('review-save').disabled = true;
      try {
        const result = await session.resumePrivate(recovery, localVersion);
        if (current() && result?.status === 'committed') closeReview();
      } catch (error) { if (current()) { reviewStatus(error.message); $('review-retry').hidden = false; } }
    }));
  } else if (editor.conflict) reviewStatus(remote === undefined ? 'The saved version could not be read. Retry; sending remains blocked and your writing is kept.' : 'Both versions are kept. Copy what you need; this comparison does not overwrite either version.');
  comparison = { editor, presentation, localVersion, authority: JSON.stringify(editor.authorityRecovery) };
  const list = node('div'); $('review-content').append(list);
  // A page the registry applied is drawn even when settling its image copies
  // then fails; the failure is reported after it, and `more` (the button that
  // asked for it) is spent once the page is applied.
  const appendCandidates = async (cursor, more) => {
    let page = null, failure = null;
    try { await registry.recoveryCandidates(editor, { cursor, limit: 10 }, (shown, continued) => { page = shown; if (current()) listCandidates(editor, shown, continued); }); }
    catch (error) { if (!page) throw error; failure = error; }
    if (!current()) return;
    more?.remove();
    for (const candidate of page.items) {
      const section = version(candidate.availability === 'open-in-another-tab' ? 'Open in another tab' : 'Writing kept on this device',
        candidate.snapshot?.draft.body ?? 'Close the other tab, then Retry to review its writing.',
        candidate.snapshot ? `Writer ${candidate.writerId} · ${destination}` : 'Ownership is still held by another document.');
      if (candidate.snapshot && (candidate.snapshot.format === 1 || readableUploads(candidate.snapshot))) {
        if (candidate.snapshot.format === 2) section.append(node('p', 'This version includes saved image selections. Recover it to check or remove them before sending.', 'muted'));
        const adopt = make('Recover this version', async () => {
          adopt.disabled = true;
          try { await registry.adoptCandidate(editor, candidate, presentation); if (current()) { closeReview(); writingSurface(presentation).field.focus({ preventScroll: true }); } }
          catch (error) { if (current()) reviewStatus(error.message); }
          finally { if (adopt.isConnected) adopt.disabled = false; }
        });
        adopt.disabled = editor.localVersion > 0 || session.attempts.length > 0 || uploadWork(editor);
        section.append(adopt);
        if (refusedCopyAtDraft(candidate, editor.recoveryServerDraft)) {
          for (const item of candidate.snapshot.submissions.filter(item => refusedAtDraft(item, editor.recoveryServerDraft))) {
            section.append(node('p', 'Earlier reply was not prepared. Keeping current writing leaves this earlier reply saved here.', 'muted'), node('pre', item.snapshot.body));
          }
          section.append(make('Keep current writing', async () => {
            await registry.keepCurrentWriting(editor, candidate);
            if (current()) { reviewStatus('Current writing kept. The earlier reply remains saved and will not be sent.'); changed(editor); }
          }));
        }
        if (candidate.snapshot.format === 2 && candidate.snapshot.uploadState.entries.some(e => e.selected && e.owner.kind === 'cycle')) {
          section.append(make('Remove saved image selections', async () => { await registry.changeCandidateImages(editor, candidate, { kind: 'remove' }); if (current()) await showVersions(editor, opener, presentation); }));
        }
        for (const e of candidate.snapshot.uploadState?.entries ?? []) if (!e.selected || e.owner.kind === 'submission') {
          const label = node('p', e.file?.name ?? e.ready_descriptor?.name ?? 'Earlier image'); section.append(label);
          const a = e.attempts[e.choice];
          if (a) section.append(make('Check image confirmation', async () => {
            const r = await api.view('operation', { operation_id: a.publish_operation_id });
            if (r?.instance_id !== editor.context.instanceId || r.operation_id !== a.publish_operation_id ||
                r.recorded === true && r.kind !== 'media.publish') throw Error('Image confirmation identity does not match.');
            if (current()) label.textContent = `${e.file?.name ?? 'Earlier image'} · ${r.recorded === true ? r.status : 'Confirmation unknown'}`;
          }));
          if (e.bytes_ref) section.append(make('Discard retained file', async () => {
            await registry.changeCandidateImages(editor, candidate, { kind: 'discard', selectionId: e.selection_id });
            if (current()) await showVersions(editor, opener, presentation);
          }));
        }
      } else if (candidate.availability !== 'open-in-another-tab') {
        section.append(node('p', 'This saved copy cannot be interpreted. It will remain on this device.', 'muted'));
        section.append(make('Continue without this copy', async () => { await registry.waiveUnreadable(editor, candidate); reviewStatus('This copy is kept. The choice applies only to this writing cycle and this exact saved version.'); }));
      }
      list.append(section);
    }
    if (page.nextCursor) {
      const next = make('More versions', async () => {
        next.disabled = true;
        try { await appendCandidates(page.nextCursor, next); }
        catch (error) { if (current()) { reviewStatus(error.message); $('review-retry').hidden = false; } }
        finally { if (next.isConnected) next.disabled = false; }
      });
      list.append(next);
    }
    if (failure) throw failure;
  };
  try { await appendCandidates(null); } catch (error) { if (current()) reviewStatus(error.message); }
  if (!current()) return;
  if (!recovery) {
    $('review-retry').hidden = false; $('review-retry').onclick = () => run(() => showVersions(editor, opener, presentation));
  }
  const history = make('Earlier recovery history', async () => {
    const append = async cursor => {
      const page = await journal.history(editor.key, { limit: 10, cursor });
      if (!current()) return;
      for (const row of page.items) list.append(version('Earlier version · already recovered', row.snapshot.draft.body, `Writer ${row.writerId}`));
      if (page.nextCursor) list.append(make('More history', () => append(page.nextCursor)));
    };
    history.disabled = true; await append(null);
  }); list.append(history);
}

async function showCorrection(editor, item, opener, presentation = presentationFor(editor)) {
  if (!registry.isCurrent(presentation, editor)) {
    if (editor.context.sourceRef.kind === 'topic') throw Error('Return to the new message composer before preparing again.');
    if (review.open) closeReview();
    await openSource(editor.context.sourceRef, opener); presentation = registry.current;
    if (!registry.isCurrent(presentation, editor)) throw Error('This writing changed. Review it again.');
  }
  const serial = beginReview('Review this reply before preparing again', opener), localVersion = editor.localVersion;
  const current = () => serial === reviewSerial && review.open && registry.isCurrent(presentation, editor);
  $('review-content').append(version('Earlier reply', item.snapshot.body, `To ${item.topicId} · Addressed to ${(item.snapshot.addressees ?? []).join(', ') || 'the topic'} · ${imageSummary(editor, item.snapshot.attachments)}`), version('Your current writing', editor.draft.body, imageSummary(editor)));
  const state = validate(await api.view('editor_state', { source_ref: item.sourceRef, topic_id: item.topicId }));
  if (!current()) return;
  registry.validateState(state, item.sourceRef, item.topicId);
  $('review-content').append(version('Saved private version', state.draft?.body ?? null));
  const label = node('label'), acknowledgement = node('input'); acknowledgement.type = 'checkbox';
  label.append(acknowledgement, document.createTextNode(' ' + PRIOR_PUBLICATION_NOTICE)); $('review-content').append(label);
  const prepare = button('Prepare this reply again', async () => {
    if (!current()) return;
    prepare.disabled = true;
    try {
      await registry.sessionFor(editor).correctPreparation(item, state.draft, localVersion,
        { stay: true, presentation, acknowledgePossiblePriorPublication: acknowledgement.checked });
      if (current()) closeReview();
    } catch (error) { if (current()) reviewStatus(error.message); }
  });
  prepare.disabled = true; acknowledgement.onchange = () => { prepare.disabled = !acknowledgement.checked || localVersion !== editor.localVersion; };
  $('review-content').append(prepare);
}

function pendingCount(editor) {
  return new Set([...editor.submissions.map(item => item.id), ...registry.pending(editor).items.map(item => item.id)]).size;
}
function pendingButton(host, editor, presentation = presentationFor(editor)) {
  const count = pendingCount(editor), label = `Review ${count} ${count === 1 ? 'reply' : 'replies'}`;
  let control = host.firstElementChild;
  if (!count) { host.replaceChildren(); return; }
  if (!control) { control = button(label, () => showPending(editor, control, presentation)); host.append(control); }
  control.textContent = label; control.onclick = () => run(() => showPending(editor, control, presentation));
}
async function showPending(editor, opener, presentation = presentationFor(editor)) {
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
          const again = button('Prepare this reply again', () => showCorrection(editor, item, opener, presentation)); card.append(again);
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
    $('review-versions').hidden = !needsReview(reader.editor);
  }
  if (inline?.editor === editor) inline.paintStatus();
  invalidateComparison(editor);
  if (editor.context.kind === 'reply' && editor.context.sourceRef.kind !== 'topic' && pendingCount(editor)) {
    let host = [...$('topic-pending').children].find(child => child.dataset.key === editor.key);
    if (!host) { host = node('div'); host.dataset.key = editor.key; $('topic-pending').append(host); }
    pendingButton(host, editor);
  }
  for (const item of editor.submissions) {
    const version = item.status === 'confirmed' && item.receipt?.result?.topic?.version;
    if (version > localEffectVersion) { localEffectVersion = version; freshness?.invalidate('topic', version); freshness?.request(); }
  }
}
// What the person sees is read: while the page is visible and has focus, and
// no modal other than the Reader covers it, the message the Reader shows, or
// else the message cards on screen. Each run of loaded messages is contiguous,
// so the range from the lowest to the highest card on screen in one run holds
// only messages on screen; a range never spans a gap between runs. Only
// another actor's message can settle a delivery, so the person's own are never
// reported.
function noteRead() {
  if (!readThrough || !topic || topicUnavailable || $('messages').hidden || authorityReviewPending() || review.open) return;
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const source = registry.current?.source;
  if (source) {
    if (!registry.current.sourceUnavailable && source.source_ref.kind === 'message' && source.topic_id === topic.id &&
        source.author !== bootstrap.actor) readThrough.seen(topic.id, source.seq, source.seq);
    return;
  }
  const ranges = new Map();
  for (const item of views.messages.values()) {
    if (!(halfShown.has(item.seq) || atMiddle.has(item.seq)) || item.author_id === bootstrap.actor) continue;
    const run = views.runOf(item.id), range = ranges.get(run);
    ranges.set(run, range ? [Math.min(range[0], item.seq), Math.max(range[1], item.seq)] : [item.seq, item.seq]);
  }
  for (const [from, through] of ranges.values()) readThrough.seen(topic.id, from, through);
}
// A card counts as on screen when at least half of it, or of the viewport,
// shows it. The second holds exactly when the card crosses the viewport's
// middle line (a card that crosses it is wholly shown or covers half the
// viewport), which a zero-height root observes for a card of any height.
const cardsSeen = (shown, test) => entries => {
  for (const entry of entries) {
    const seq = Number(entry.target.dataset.seq);
    if (test(entry)) shown.add(seq); else shown.delete(seq);
  }
  noteRead();
};
function revokeMedia() { for (const url of mediaURLs) URL.revokeObjectURL(url); mediaURLs.clear(); }
async function present(presentation) {
  if (presentation.surface === 'inline') inline.show(presentation);
  else {
    retainRevisionTargets(presentation);
    revokeMedia(); reader.presentation = presentation;
    reader.show(presentation.source, presentation.editors, { opener: presentation.opener, topics: [topic], presentation, mode: presentation.mode });
    if (presentation.sourceUnavailable) reader.notice('The source is unavailable. Your private writing is kept.');
    const shown = presentation.source.source_ref;
    if (presentation.mark && !presentation.sourceUnavailable && shown.kind === 'message') {
      marks.learn(shown.id, presentation.mark.mark_revision, { topicId: presentation.source.topic_id, seq: presentation.source.seq });
    }
    paintReaderMark();
    noteRead();
  }
  const discovery = Promise.all(Object.values(presentation.editors).map(editor => discover(presentation, editor)));
  if (presentation.surface === 'inline') { inlineDiscovery = discovery; return; }
  registry.neighbors(presentation).then(neighbors => {
    if (!neighbors || !registry.isSourceCurrent(presentation)) return;
    registry.current.neighbors = neighbors;
    $('previous-message').disabled = !neighbors.previous; $('next-message').disabled = !neighbors.next;
  }).catch(error => { if (registry.isSourceCurrent(presentation)) reader.notice(error.message); });
  sourceAttachments(presentation);
}
// A checked page of saved copies: the first page replaces what was listed,
// and a page that continues it is added, as the editor's image copies are.
function listCandidates(editor, page, continued) {
  const known = continued ? candidates.get(editor.key) : null;
  candidates.set(editor.key, known ? { items: [...known.items, ...page.items], nextCursor: page.nextCursor } : page);
  changed(editor);
}
function discover(presentation, editor) {
  return registry.recoveryCandidates(editor, { limit: 10 }, (page, continued) => listCandidates(editor, page, continued))
    .catch(error => { if (registry.isCurrent(presentation, editor)) writingSurface(presentation).notice(error.message); });
}
// Rows a foreground read deferred were checked again: what the page lists for
// exactly those rows is replaced, a copy that moved is added, and every other
// listed copy stays.
// It runs inside the cleanup task that rechecked them, so no discovery or
// image change lands between the recheck and this patch.
function rechecked(session, ids, page) {
  const editor = session.editor, validated = registry.applyRecheck(editor, ids, page);
  if (!validated) return;
  const known = candidates.get(editor.key), kept = new Map(page.items.map(row => [row.id, row]));
  if (known) {
    const items = known.items.flatMap(row => kept.has(row.id) ? [kept.get(row.id)] : ids.includes(row.id) ? [] : [row]);
    const listed = new Set(items.map(row => row.id));
    candidates.set(editor.key, { ...known, items: [...items, ...page.items.filter(row => !listed.has(row.id))] });
  }
  changed(editor);
  validated.catch(error => {
    const presentation = presentationFor(editor);
    if (registry.isCurrent(presentation, editor)) writingSurface(presentation).notice(error.message);
  });
}
// One attachment of a source: a button that fetches it, then shows an image
// in place and offers the file to save. current() says the place it was
// offered from still shows that source; a refusal goes to notice, and an open
// that succeeds sends notice('') to say an earlier refusal no longer holds.
// Focus pressed onto Open moves to Download, or back to Open on a refusal,
// unless the person has put it somewhere else meanwhile.
function attachmentControl(attachment, sourceRef, current, notice) {
  const host = node('span', undefined, 'attachment-label');
  const available = () => host.isConnected && current();
  const unplaced = () => !document.activeElement || document.activeElement === document.body;
  const show = button(`Open ${attachment.name ?? 'attachment'}`, async () => {
    if (!available()) return;
    const held = document.activeElement === show;
    show.disabled = true;
    try {
      const media = await api.media(bootstrap.instance_id, attachment, sourceRef);
      if (!available()) return;
      const url = URL.createObjectURL(media.blob);
      mediaURLs.add(url); host.replaceChildren();
      if (media.inline) { const image = node('img'); image.alt = attachment.name; image.src = url; host.append(image); }
      const download = node('a', `Download ${attachment.name}`); download.href = url; download.download = attachment.name; host.append(download);
      notice('');
      if (held && unplaced()) download.focus();
    } catch (error) { if (available()) notice(error.message); }
    finally { if (show.isConnected) { show.disabled = false; if (held && unplaced()) show.focus(); } }
  }); host.append(show);
  return host;
}
function sourceAttachments(presentation) {
  reader.drawAttachments($('source-attachments'), presentation.source.attachments);
  const current = () => registry.isSourceCurrent(presentation) && !registry.current.sourceUnavailable && !registry.current.availabilityUnconfirmed;
  // A refusal names its attachment. An open clears the notice only if this
  // attachment wrote it last and it still says that, so it never wipes another
  // attachment's refusal or anything said since.
  let last = null;
  for (const attachment of presentation.source.attachments ?? []) {
    const mine = {};
    $('source-attachments').append(attachmentControl(attachment, presentation.source.source_ref, current, message => {
      if (message) { mine.said = `${attachment.name ?? 'attachment'}: ${message}`; last = mine; reader.notice(mine.said); }
      else if (last === mine && $('reader-notice').textContent === mine.said) { reader.notice(''); last = null; }
    }));
  }
}
// act: what the person's act of reading captured (Marks.capture), for a card
// or Read it; every other open passes none and clears nothing.
async function openSource(ref, opener, act = null) {
  const request = ++opening;
  const from = registry.interactive;
  views.retain(views.currentItem, ref.kind === 'memory' ? ref.id : null);
  status('');
  try { await marks.open(registry, ref, { topicId: topic.id, opener }, act); }
  catch (error) {
    if (request === opening) {
      if (from?.surface !== 'inline' && registry.isCurrent(from)) reader.notice(error.message);
      else status(error.message);
    }
  }
  finally { if (request === opening) { views.retain(views.currentItem, null); reader.paintOffer(); } }
}
// A repaint leaves in place what the person is at: the inline writing, a
// field on the page they are typing in, or else the first card in view. A
// button keeps no place: More would hold itself still and scroll past what
// it loaded.
function keepListAnchor(paint) {
  const at = document.activeElement;
  const writing = inline?.root.contains(at) && registry.isCurrent(registry.inline);
  const anchor = writing ? inline.field : $('main').contains(at) && at.matches('input, textarea, select') && inView(at) ? at
    : [...document.querySelectorAll('#messages .message-card, #memory-items .memory-card')].find(inView);
  const top = anchor?.getBoundingClientRect().top;
  paint();
  if (anchor?.isConnected) window.scrollBy(0, anchor.getBoundingClientRect().top - top);
}
function inView(node) { const box = node.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; }
function paintViews(kind) {
  if (kind === 'offer') { reader?.paintOffer(); return; }
  if (kind === 'topic') {
    if (authorityReviewPending()) return;
    topicUnavailable = false;
    topic = views.topic; $('topic-title').textContent = topic.title;
    topicState?.paint(topic, views.participants);
    if (registry.inline) { registry.inline.topic = structuredClone(topic); inline.$('destination').textContent = `To ${topic.title}`; }
    $('topic-description').textContent = 'Open a message to read, quote, reply, or keep a private note.';
    topicRail?.updateCurrent(topic);
    paintParticipants(topic, views.participants);
    for (const id of ['messages', 'notebook', 'participants']) $(id).hidden = false;
    paintMarks(); noteRead(); return;
  }
  keepListAnchor(() => {
  for (const item of kind === 'messages' ? [...views.messages.values()].sort((a, b) => b.seq - a.seq) : []) {
    let card = [...$('messages').children].find(child => child.dataset.id === item.id);
    if (!card) {
      const ref = { kind: 'message', id: item.id };
      // The revision a click or keypress may clear is the one the card shows.
      card = button('', () => openSource(ref, card, marks.capture(item.id))); card.className = item.author_id === bootstrap.actor ? 'message-card own-message' : 'message-card'; card.dataset.id = item.id; card.dataset.seq = item.seq;
      const author = node('span', undefined, 'message-author');
      paintCardAuthor(author, item);
      card.append(author, node('span', item.body, 'message-preview'));
      if (item.preview) card.append(node('span', 'Excerpt · Open to read the rest', 'message-preview-cue'));
      const following = [...$('messages').children].find(child => Number(child.dataset.seq) < item.seq);
      $('messages').insertBefore(card, following ?? null);
      cardObserver?.observe(card); middleObserver?.observe(card);
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
  if (kind === 'messages') noteRead();
}
// Messages sent before times were kept have none.
function paintCardAuthor(author, item) {
  paintAuthor(author, item.author_id, Number.isInteger(item.sent_ms) ? readableTime(item.sent_ms) : null, marks?.state(item.id)?.marked === true);
}
// What the page knows of the person's marks: the topic's line, each loaded
// card's pill and the Reader's button.
function paintMarks() {
  if (!marks || !topic) return;
  const count = marks.marked(topic.id).length;
  $('topic-marks-words').textContent = marksWords(count);
  $('topic-marks').hidden = !count || topicUnavailable;
  keepListAnchor(() => {
    for (const card of $('messages').children) {
      const item = views.messages.get(card.dataset.id);
      if (item) paintCardAuthor(card.querySelector('.message-author'), item);
    }
  });
  paintReaderMark();
}
function paintReaderMark() {
  const p = registry?.current, ref = p?.source?.source_ref;
  const state = p && !p.sourceUnavailable && p.mark && ref.kind === 'message' ? marks.state(ref.id) : null;
  paintMarkButton($('mark-unread'), state && { ...state, busy: marks.busy(ref.id) });
}
// Every page of the person's marks in this topic.
function loadMarks() {
  if (!marks || topicUnavailable) return Promise.resolve(true);
  if (authorityReviewPending()) return Promise.resolve(false);
  return marks.load(topic.id, async args => checkedView(await registry.cleanup.list(options => api.view('marks', args, options)), bootstrap.instance_id));
}
async function toggleMark() {
  const p = registry.current, ref = p?.source?.source_ref;
  if (!p || p.sourceUnavailable || !p.mark || ref.kind !== 'message' || marks.busy(ref.id)) return;
  const state = marks.state(ref.id);
  if (!state) return;
  let receipt;
  try { receipt = await marks.send(ref.id, !state.marked, state.mark_revision); }
  catch {
    if (registry.isSourceCurrent(p)) reader.notice('Connection interrupted; whether the mark was saved is unknown. Press again to send the same request.');
    return;
  }
  if (!registry.isSourceCurrent(p)) return;
  if (receipt?.error?.code === 'REVISION_CONFLICT') {
    reader.notice(`This message's mark changed in another tab or device: it is ${marks.state(ref.id)?.marked ? 'marked unread' : 'not marked unread'} now. Nothing was changed.`);
  } else if (receipt?.status !== 'committed') reader.notice(receipt?.error?.message ?? 'The mark was not confirmed. Press again to send the same request.');
}
function authorityReviewPending() {
  return updateState?.kind === 'authority' ||
    [...registry.sessions.values()].some(session => session.editor.authorityRecovery) ||
    registry.runtime.current.authority_id !== bootstrap.authority.authority_id ||
    registry.runtime.current.authority_epoch !== bootstrap.authority.authority_epoch;
}
function listPage(kind, more = false) {
  if (authorityReviewPending()) {
    status('The runtime changed. Review your saved writing before reloading this page.');
    return Promise.resolve();
  }
  if (listLoads.has(kind)) return listLoads.get(kind);
  const accessEpoch = listAccessEpoch, mayPaint = !topicUnavailable;
  const cursor = kind === 'messages' ? views.olderCursor : views.memoryCursor;
  if (more && cursor === null) return Promise.resolve();
  const foreground = registry.cleanup.foreground();
  const args = kind === 'messages' ? { topic_id: topic.id, audience: 'all', direction: 'before', limit: 30 }
    : { owner_scope: views.scope, limit: 20 };
  if (more) args.cursor = cursor;
  const run = foreground.read(options => api.view(kind === 'messages' ? 'topic_messages' : 'memory_items', args, options)).then(page => {
    checkedView(page, bootstrap.instance_id);
    if (!mayPaint || accessEpoch !== listAccessEpoch || authorityReviewPending()) return;
    if (kind === 'messages') views.messagesPage(page, { initial: !more, cursor });
    else views.memoryPage(page, { initial: !more, cursor });
  }).finally(() => { foreground.release(); listLoads.delete(kind); });
  listLoads.set(kind, run); return run;
}
async function refreshLists() {
  if (authorityReviewPending()) {
    status('The runtime changed. Review your saved writing before reloading this page.'); return;
  }
  await outcomeRail?.load(); await topicRail?.load(); await outcomeReferences?.load(); await loadMarks();
  if (freshness?.enabled && !freshness.stopped) return freshness.request({ refresh: true });
  if (topicUnavailable) status('Topic unavailable. Use Retry updates.');
  await listPage('messages'); await listPage('memory');
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
  if (state.kind === 'authority') ++listAccessEpoch;
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
    topicUnavailable = true; ++listAccessEpoch;
    for (const id of ['messages', 'notebook', 'participants']) $(id).hidden = true;
    $('more-messages').hidden = true; $('topic-title').textContent = 'Topic unavailable'; $('topic-description').textContent = '';
    paintMarks();
    for (const session of registry.sessions.values()) {
      if (session.editor.context.kind === 'reply' && session.editor.context.topicId === topic.id) {
        session.editor.unavailable = true; registry.cancelSave(session.editor); changed(session.editor);
      }
    }
  }
  const results = await Promise.allSettled([
    checkInlineAvailability(read, current), checkSourceAvailability(read, current, topicDenied),
  ]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}
async function checkInlineAvailability(read, current) {
  const p = registry.inline;
  if (!p) return;
  const editor = p.editors.reply, serial = ++inlineAvailabilitySerial;
  const sameInline = () => serial === inlineAvailabilitySerial && !registry.disposed && registry.inline === p && registry.sessions.get(editor.key)?.editor === editor;
  const owns = () => sameInline() && current();
  p.availabilityChecking = true; p.availabilityUnconfirmed = true;
  editor.unavailable = true; registry.cancelSave(editor); inline.paintStatus();
  try {
    const results = await Promise.allSettled([
      read('topic', { topic_id: p.topic.id }),
      read('editor_state', { source_ref: editor.context.sourceRef, topic_id: p.topic.id }),
    ]);
    if (!owns()) return;
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const [answer, state] = results.map(result => result.value);
    if (answer.topic?.id !== p.topic.id) throw Error('The topic identity could not be confirmed.');
    registry.validateState(state, editor.context.sourceRef, p.topic.id);
    p.availabilityUnconfirmed = false; p.destinationAvailable = state.source_available && state.destination_available;
    editor.unavailable = !p.destinationAvailable;
    if (!editor.unavailable && editor.dirty && !editor.authorityRecovery && !editor.conflict) registry.schedule(editor);
  } catch (error) {
    if (owns() && readFailure(error).kind === 'forbidden') p.availabilityUnconfirmed = false;
    throw error;
  } finally {
    if (sameInline()) {
      p.availabilityChecking = false;
      // Cancellation cannot confirm access. It can release this check's UI
      // and leave one recheck in the existing, epoch-fenced freshness queue.
      if (!current()) freshness?.invalidate('availability', 0, true);
      inline.paintStatus();
    }
  }
}
async function initializeInlineComposer() {
  try { await registry.initializeInline(topic); }
  catch (error) { inline.fail(error.message); return; }
  // Recovery discovery reads in the background lane, which any foreground read
  // defers. The optional rail reads that follow wait for it, so a saved copy
  // that Core already acknowledges is retired rather than left for review.
  await inlineDiscovery;
}
async function retryInline() {
  const p = registry.inline;
  if (!p) return initializeInlineComposer();
  if (p.availabilityChecking || p.editors.reply.authorityRecovery) return;
  const editor = p.editors.reply, foreground = registry.cleanup.foreground();
  const current = () => !registry.disposed && registry.inline === p && registry.sessions.get(editor.key)?.editor === editor;
  try {
    await checkInlineAvailability(async (name, args) => checkedView(await foreground.read(options => api.view(name, args, options)), bootstrap.instance_id), current);
    if (current()) inline.notice('');
  } catch (error) {
    if (current()) {
      const failure = readFailure(error);
      if (failure.kind === 'authority') { await registry.parkAuthority(bindingOf(bootstrap), failure.code); updateStatus(failure); }
      inline.notice('Could not confirm topic access. Your writing is kept. ' + failure.message);
    }
  } finally { foreground.release(); }
}
async function checkSourceAvailability(read, current, topicDenied) {
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
    reader.paintOrigin(source);
  }
  p.destinationAvailable = state.destination_available;
  p.editors.reply.unavailable = !state.source_available || !state.destination_available;
  p.editors.note.unavailable = !state.source_available;
  reader.paintStatus();
  } finally {
    if (sameSource()) { registry.current.availabilityChecking = false; reader.paintStatus(); paintReaderMark(); }
  }
}
async function retrySource() {
  const p = registry.current;
  if (!p || p.availabilityChecking || p.editors.reply.authorityRecovery) return;
  const foreground = registry.cleanup.foreground(), current = () => registry.isSourceCurrent(p);
  try {
    await checkSourceAvailability(async (name, args) => checkedView(await foreground.read(options => api.view(name, args, options)), bootstrap.instance_id), current, false);
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
    keys: item => views.keys(item), refreshKeys: () => views.refreshKeys(), status: updateStatus, live,
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
  // Each new commit asks for a pass; while the stream is down the timer resumes.
  live?.listen(event => {
    if (event.kind === 'commit' || event.state === 'live') freshness.request();
    else if (event.state === 'down' || event.state === 'unavailable') freshness.schedule(freshness.delay ?? 500);
  });
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
  if (liveOffered(bootstrap) && !live) {
    live = new Live({ token });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') live.wake(); });
    window.addEventListener('online', () => live.wake());
    live.start();
  }
  if (!attention) {
    attention = new Attention({ api: { view: (...args) => api.view(...args) }, instanceId: bootstrap.instance_id, after: bootstrap.attention?.after,
      doc: document, open: openSent });
    attention.listen(answer => { if (sentHost) paintSent(sentHost, answer, { open: openSent, acknowledge: markSent, read: readSent, attachment: sentAttachment }); });
    const ask = $('notify'), offer = () => { ask.hidden = !attention.canAsk; };
    ask.onclick = () => run(async () => { await attention.ask(); offer(); });
    offer();
    live?.listen(event => { if (event.kind === 'commit' || event.state === 'live') attention.refresh(); });
    attention.listen(answer => { if (waitingHost) paintWaiting(waitingHost, answer, (id, title) => openDestination({ kind: 'topic', id }, title)); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') attention.refresh(); });
    attention.refresh();
  }
  $('instance-label').textContent = `${bootstrap.actor} · ${bootstrap.instance_id}`;
  refreshDirectory();
  document.addEventListener('focusin', event => {
    const list = event.target?.getAttribute?.('list');
    if (list === 'directory-names') refreshDirectory();
    if (list === 'addressable-names') refreshMembers();
  });
  const route = parseRoute(new URL(location.href));
  if (route.kind !== 'topic') {
    await initializeOutcomePage(route);
    if(['root','workspace'].includes(route.kind))run(()=>initializeUnfinished(route));
    return;
  }
  const topicId = route.id;
  // The saved feed position precedes topic, messages and Notebook startup reads.
  const checkpoint = await initialViews({ api, bootstrap, topicId, load: async () => {} });
  views = new TopicViews({ instanceId: bootstrap.instance_id, topicId, paint: paintViews, invalidate: (key, version) => freshness?.invalidate(key, version) });
  const result = validate(await api.view('topic', { topic_id: topicId })); topic = result.topic;
  views.topic = topic; views.participants = result.participants;
  if (topic.id !== topicId) throw Error('The topic identity could not be confirmed.');
  $('topic-title').textContent = topic.title; $('topic-description').textContent = 'Open a message to read, quote, reply, or keep a private note.';
  try {
    const workspace = validate(await api.view('workspace', { workspace_id: topic.workspace_id })).workspace;
    $('workspace-name').textContent = workspace.title;enableNewTopic(workspace.id);
  } catch { $('workspace-name').textContent = topic.workspace_id; }
  participantsPanel = new PeoplePanel({ host: $('participants'), label: 'Add a participant to this topic', names: 'directory-names',
    add: id => setParticipation(id, true), remove: id => setParticipation(id, false) });
  // Who can be sent a message here: the topic's participants and the outcome's
  // members. A reader outside the outcome cannot list its members.
  outcomeMembers = await readMembers(api, bootstrap.instance_id, topic.workspace_id).catch(() => null);
  paintParticipants(topic, result.participants);
  topicState = new TopicStatePanel({ host: $('topic-state'), reader: bootstrap.actor, refresh: () => freshness?.request(),
    send: (current, args) => {
      const { authority_id, authority_epoch } = bootstrap.authority;
      return api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'topic.update',
        target: { topic_id: current.id }, expected: { topic_revision: current.version, authority: { authority_id, authority_epoch } }, args });
    } });
  topicState.paint(topic, result.participants);
  // Keep startup retry read-only: no editor or clickable source exists until
  // both initial list bodies have arrived after the captured feed baseline.
  const messageAnswer = checkedView(await api.view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 30 }), bootstrap.instance_id);
  const memoryAnswer = checkedView(await api.view('memory_items', { owner_scope: views.scope, limit: 20 }), bootstrap.instance_id);
  journal = await openJournal({ instanceId: bootstrap.instance_id, actor: bootstrap.actor });
  inline = new InlineComposer({
    admits: (p, editor) => registry?.isCurrent(p, editor),
    reach: recipientReach,
    uploads: editor => registry.sessionFor(editor).uploads,
    edit: (editor, p) => run(() => { if (registry.isCurrent(p, editor)) return registry.edited(editor); }),
    status: editor => registry.status(editor), needsReview,
    send: (editor, p) => registry.send(editor, { presentation: p, stay: true }),
    review: (editor, p, opener) => run(() => showVersions(editor, opener, p)),
    renderPending: (host, editor, p) => pendingButton(host, editor, p),
    retry: () => run(retryInline),
  });
  reader = new Reader({
    admits: (p, editor) => registry?.isCurrent(p, editor),
    reach: recipientReach,
    revisionOffer,
    retrySource: () => run(retrySource),
    uploads: editor => registry?.sessionFor(editor).uploads,
    edit: editor => run(() => { if (registry.isCurrent(reader.presentation, editor)) return registry.edited(editor); }), status: editor => registry.status(editor),
    mode: mode => {
      const cancelled = Boolean(registry.pendingOpen);
      reader.presentation = registry.setMode(mode); changed(reader.editor); retainRevisionTargets();
      if (cancelled) reader.notice('Stayed on this message; opening the other message was cancelled.');
    },
    saveNote: editor => run(() => registry.saveNote(editor)),
    send: (editor, options) => registry.send(editor, { ...options, presentation: reader.presentation }),
    close: () => registry.close(reader.presentation, { explicit: true }).catch(error => { reader.notice(error.message); return false; }),
    step: async direction => {
      const presentation = registry.current, neighbors = presentation.neighbors ?? await registry.neighbors(presentation);
      if (!registry.isCurrent(presentation)) return;
      const ref = direction < 0 ? neighbors?.previous : neighbors?.next;
      if (ref) await openSource(ref, presentation.opener);
    },
    destination: value => { if (value !== topic.id) reader.notice('Choose the open topic for this reply.'); },
    reconcile: editor => run(() => registry.checkConfirmation(editor)),
    renderPending: (host, editor) => pendingButton(host, editor, reader.presentation),
    recover: (editor, item) => run(() => showCorrection(editor, item, document.activeElement, reader.presentation)),
    error: error => reader.notice(error.message),
  });
  registry = new EditorRegistry({ api, bootstrap, journal, present: presentation => run(() => present(presentation)), changed,
    activity: () => { inline.paintStatus(); reader.paintStatus(); },
    closed: presentation => { if (reader.presentation === presentation) { reader.finishClose?.(); revokeMedia(); views.retain(null, null); } noteRead(); } });
  registry.cleanup.resumeListeners.add(rechecked);
  // After any recorded answer to a mark, this page shows what Core now holds,
  // with or without the live stream.
  marks = new Marks({ api, instanceId: bootstrap.instance_id, authority: () => registry.runtime.current, cancelOpen: () => registry.cancelOpen(),
    recorded: () => { attention?.refresh(); if (commitReload) run(commitReload); } });
  marks.listen(paintMarks);
  $('mark-unread').onclick = () => run(toggleMark);
  $('read-mark').onclick = () => run(() => {
    const next = marks.marked(topic.id)[0];
    if (next) return openSource({ kind: 'message', id: next.messageId }, $('read-mark'), marks.capture(next.messageId));
  });
  // Escape before the Reader shows cancels the open under way.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !reader.dialog.open && !review.open && registry.cancelOpen()) event.preventDefault();
  });
  readThrough = new ReadThrough({ send: (topicId, from, seq) => {
    const { authority_id, authority_epoch } = bootstrap.authority;
    return api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'topic.read_through',
      target: { topic_id: topicId }, expected: { authority: { authority_id, authority_epoch } }, args: { from_seq: from, seq } });
  } });
  cardObserver = new IntersectionObserver(cardsSeen(halfShown, entry => entry.isIntersecting && entry.intersectionRatio >= 0.5), { threshold: [0, 0.5] });
  middleObserver = new IntersectionObserver(cardsSeen(atMiddle, entry => entry.isIntersecting), { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
  document.addEventListener('visibilitychange', noteRead);
  window.addEventListener('focus', noteRead);
  topicNavigation = new TopicNavigation({ registry, current:route,
    navigateTarget: target => { marks.leave(); location.assign(routeHref(target)); } });
  await initializeInlineComposer();
  initializeOutcomeNavigation(topic.workspace_id); outcomeRail.load();
  topicRail = new TopicRail({ reader: bootstrap.actor, pageMax: pageMax(), pages: new TopicPages(bootstrap.instance_id, topic.workspace_id, topic),
    host: $('topics'), more: $('more-topics'), retry: $('retry-topics'), message: $('topics-status'),
    denied: error => readFailure(error).kind === 'forbidden',
    read: async args => {
      if (authorityReviewPending()) throw Error('The runtime changed. Review saved writing before reloading.');
      const answer = checkedView(await registry.cleanup.list(options => api.view('workspace_topics', args, options)), bootstrap.instance_id);
      if (registry.disposed || authorityReviewPending()) throw Error('The runtime changed. Reload after reviewing saved writing.');
      return answer;
    },
    open: id => openDestination({kind:'topic',id},topicRail.pages.items.find(item => item.id === id)?.title ?? id),
  });
  topicRail.load();
  outcomeReferences = new OutcomeReferences({ scope: topic.workspace_id, host: $('outcome-references'), count: $('outcome-references-count'),
    list: $('outcome-references-list'), more: $('more-references'), message: $('outcome-references-status'), pageMax: pageMax(),
    denied: error => readFailure(error).kind === 'forbidden',
    read: async args => {
      if (authorityReviewPending()) throw Error('The runtime changed. Review saved writing before reloading.');
      const answer = checkedView(await registry.cleanup.list(options => api.view('memory_items', { owner_scope: { kind: 'workspace', id: topic.workspace_id }, ...args }, options)), bootstrap.instance_id);
      if (registry.disposed || authorityReviewPending()) throw Error('The runtime changed. Reload after reviewing saved writing.');
      return answer;
    },
    open: (ref, row) => run(() => openSource(ref, row)),
    seen: items => { for (const item of items) views.revisions.observe(item.id, item.revision); reader.paintOffer(); },
  });
  outcomeReferences.load();
  // The open topic's marks are the person's own, read by the person's scope
  // and paged; the open Reader's button follows them.
  commitReload = followCommits(async () => {
    const outcomes = await outcomeRail?.load(), topics = await topicRail?.load(), references = await outcomeReferences?.load(), marked = await loadMarks();
    return outcomes !== false && topics !== false && references !== false && marked !== false;
  });
  $('review-versions').onclick = () => run(() => showVersions(reader.editor, $('review-versions'), reader.presentation));
  $('refresh').onclick = () => run(refreshLists);
  $('updates-retry').onclick = () => run(async () => {
    if (updateState?.kind === 'reconnect') { location.reload(); return; }
    if (updateState?.kind === 'authority') { const p = registry.interactive; if (p) await showVersions(p.editors[p.mode], $('updates-retry'), p); return; }
    if (registry.current?.sourceUnavailable || registry.current?.availabilityUnconfirmed || registry.inline?.editors.reply.unavailable || updateState?.kind === 'forbidden') freshness?.invalidate('availability', 0, true);
    await freshness?.request({ refresh: true, retry: true });
  });
  $('more-messages').onclick = () => run(() => listPage('messages', true)); $('more-memory').onclick = () => run(() => listPage('memory', true));
  window.addEventListener('beforeunload', event => { marks.leave(); if (registry.hasUnprotectedWriting) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { freshness?.dispose(); registry.dispose(); journal.close(); revokeMedia(); });
  views.messagesPage(messageAnswer, { initial: true }); views.memoryPage(memoryAnswer, { initial: true });
  run(loadMarks);
  document.body.dataset.ready = 'true'; enableFreshness(checkpoint);
}
// A message sent by name opens its topic, or, where the reader has lost the
// topic, the outcomes page that lists it to be marked read.
// A message sent by name in a topic the reader has lost: Core lets them read
// exactly that message, so its whole text and attachments come from its source.
async function readSent(item) {
  return checkedView(await api.view('source', item.source_ref, { readClass: 'foreground' }), bootstrap.instance_id);
}
const sentAttachment = (attachment, sourceRef, notice) => attachmentControl(attachment, sourceRef, () => true, notice);
function openSent(item) {
  return item.topic_readable ? openDestination({ kind: 'topic', id: item.topic.id }, item.topic.title) : openDestination({ kind: 'root' }, 'Outcomes');
}
async function acknowledgeSent(item) {
  const { authority_id, authority_epoch } = bootstrap.authority;
  try {
    const receipt = await api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'delivery.ack',
      target: { delivery_id: item.id }, expected: { authority: { authority_id, authority_epoch } }, args: {} });
    if (receipt?.status !== 'committed') status(receipt?.error?.message ?? 'Marking it read was not confirmed.');
  } finally {
    // Whether or not the answer arrived, the list shows what Core now holds.
    await attention.refresh();
  }
}
// A failed attempt says so where the page reports, like every other button.
const markSent = item => run(() => acknowledgeSent(item));
// The topic's participants, which its outcome's owner and its creator may
// change, and the names the composer offers.
function paintParticipants(current, participants) {
  participantsPanel?.paint(participants, [current.owner_id, current.creator_id].includes(bootstrap.actor));
  // The team's entries come first: they carry names, which participants do not.
  // A disabled person cannot be sent to, so they are not offered.
  fillNames($('addressable-names'), [...outcomeMembers ?? [], ...participants].filter(person => person.enabled !== false)
    .map(person => ({ id: person.actor_id, name: person.name, kind: person.kind })));
  // Who may be addressed changed: the composers' recipient chips say so again.
  if (reader?.sessions) reader.paintRecipients();
  if (inline?.editor) inline.paintRecipients();
}
// Whether a message to name would reach them: they must be able to see the
// topic. Unknown when the outcome's team could not be read.
function recipientReach(name) {
  if (!topic || !views?.participants) return null;
  const manage = [topic.owner_id, topic.creator_id].includes(bootstrap.actor);
  const add = manage ? () => setParticipation(name, true) : null;
  const known = [...views.participants, ...outcomeMembers ?? []].find(person => person.actor_id === name);
  if (known?.enabled === false) return { reachable: false, disabled: true };
  if ([topic.owner_id, topic.creator_id].includes(name) || views.participants.some(person => person.actor_id === name)) return { reachable: true };
  if (outcomeMembers === null) return null;
  return { reachable: outcomeMembers.some(person => person.actor_id === name), add, scope: topic.id };
}
async function setParticipation(id, present) {
  const receipt = await setPresence('participation.set', { topic_id: topic.id }, 'topic_revision', topic.version, { actor_id: id, present });
  freshness?.request();
  return receipt;
}
// participation.set and workspace.member_set check the topic's or outcome's
// revision, which any message there advances. Each states its result outright
// (present or not), so a conflict is answered by sending the same change once
// more at the revision the refusal reports; a second conflict is shown.
async function setPresence(kind, target, field, revision, args) {
  const { authority_id, authority_epoch } = bootstrap.authority;
  const send = at => api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind, target,
    expected: { [field]: at, authority: { authority_id, authority_epoch } }, args });
  let receipt = await send(revision);
  const current = receipt?.error?.code === 'REVISION_CONFLICT' ? receipt.error.current_versions?.[field] : undefined;
  if (Number.isInteger(current) && current !== revision) receipt = await send(current);
  if (receipt?.error?.code !== 'REVISION_CONFLICT') return receipt;
  return { ...receipt, error: { ...receipt.error, message: 'Someone else changed this at the same moment. Try again.' } };
}
// The team behind the composer's names, read again whenever someone starts
// naming a recipient, so a change to the team since the page opened shows. A
// read that fails (busy, offline) keeps the team the page had; only a refusal
// to list it says the reader can no longer know who is in it.
let membersRead = null;
function refreshMembers() {
  if (!topic) return null;
  membersRead ??= readMembers(api, bootstrap.instance_id, topic.workspace_id)
    .catch(error => error.details?.error?.code === 'FORBIDDEN' ? null : outcomeMembers)
    .then(members => { outcomeMembers = members; if (views?.participants) paintParticipants(topic, views.participants); })
    .finally(() => { membersRead = null; });
  return membersRead;
}
// The directory feeds every field that adds someone to a team or topic; it is
// read at start and again whenever such a field is focused.
let directoryRead = null;
function refreshDirectory() {
  directoryRead ??= readDirectory(api, bootstrap.instance_id).then(({ items }) => fillNames($('directory-names'), items))
    .catch(() => {}).finally(() => { directoryRead = null; });
  return directoryRead;
}
// A visible page reloads its lists after each commit and when shown again; a
// hidden one waits, as its reads do. load() settles false, or fails, when a
// list could not be read, and only then does the stream's return read again:
// anything saved while the stream was down changes its first number, which
// arrives as a commit, so a feed that keeps reconnecting rereads nothing.
// Returns the page's one reload, which its first read and Refresh go through
// as well; the page calls this before its first read, so a commit while that
// read is out is read after it.
function followCommits(load) {
  let owed = false;
  const reload = reloader(async () => { owed = true; owed = await load() === false; });
  if (live) {
    live.listen(event => { if ((event.kind === 'commit' || event.state === 'live' && owed) && document.visibilityState === 'visible') run(reload); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(reload); });
  }
  return reload;
}
// Rows a reload may ask for at once, from the server's own limits.
const pageMax = () => Number.isSafeInteger(bootstrap.limits?.page_max) ? bootstrap.limits.page_max : undefined;
async function openDestination(target, title) {
  // A page whose start failed has no navigation; leave it for the destination.
  if (!topicNavigation) { location.assign(routeHref(target)); return; }
  const notice=$('topic-navigation-status');notice.hidden=true;
  const pending=topicNavigation.openTarget(target,title),serial=topicNavigation.serial;
  try { return await pending; }
  catch(error) {
    if(serial!==topicNavigation.serial)return;
    notice.textContent=error.message;notice.hidden=false;notice.scrollIntoView({block:'nearest'});
  }
}
function initializeOutcomeNavigation(current=null) {
  const home=event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();return openDestination({kind:'root'},'Outcomes');
  };
  $('outcomes-home').onclick=home;document.querySelector('.wordmark').onclick=home;
  $('new-outcome').disabled=false;
  $('new-outcome').onclick=()=>openDestination({kind:'create',intent:crypto.randomUUID()},'New outcome');
  const read=async args=>{
    if(registry&&authorityReviewPending())throw Error('The runtime changed. Review saved writing before reloading.');
    const answer=checkedView(await (registry ? registry.cleanup.list(options=>api.view('workspaces',args,options)) : api.view('workspaces',args,{readClass:'foreground'})),bootstrap.instance_id);
    if(registry&&(registry.disposed||authorityReviewPending()))throw Error('The runtime changed. Review saved writing before reloading.');
    return answer;
  };
  outcomeRail=new OutcomeRail({instanceId:bootstrap.instance_id,current,host:$('workspaces'),more:$('more-workspaces'),
    retry:$('retry-workspaces'),message:$('outcomes-status'),empty:$('outcomes-empty'),read,open:openDestination,
    denied:error=>readFailure(error).kind==='forbidden',pageMax:pageMax()});
}
async function initializeOutcomePage(route) {
  // There is no topic, implicit composer or source in a selection-only view.
  if(route.kind==='create')return initializeCreationPage(route);
  if(route.kind==='opening')return initializeOpeningPage(route);
  if(!['root','workspace'].includes(route.kind))throw Error('This opening link is not available yet. Open Outcomes to choose a place.');
  status('');
  for(const id of ['notebook','participants','messages','topic-pending','inline-composer'])$(id).hidden=true;
  $('outcome-page').hidden=false;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>location.assign(routeHref(target))});
  sentHost=$('sent-to-you');
  if(attention?.last)paintSent(sentHost,attention.last,{open:openSent,acknowledge:markSent,read:readSent,attachment:sentAttachment});
  // What waits on the reader heads every outcome page.
  waitingHost=$('waiting-on-you');
  if(attention?.last)paintWaiting(waitingHost,attention.last,(id,title)=>openDestination({kind:'topic',id},title));
  if(route.kind==='root') {
    $('topic-title').textContent='Outcomes';$('topic-description').textContent='Choose an outcome to see its topics.';
    $('outcomes-heading').textContent='Your outcomes';
    $('outcome-page').append($('outcome-navigation'));document.querySelector('.rail').hidden=true;
    initializeOutcomeNavigation();
    const reload=followCommits(()=>outcomeRail.load());
    $('refresh').onclick=()=>run(reload);
    await reload();
  } else {
    $('outcome-page').append($('topic-navigation'));
    initializeOutcomeNavigation(route.id);
    let refreshSerial=0;
    const refresh=async()=>{
      const serial=++refreshSerial;
      status('');
      let answer;
      try { answer=checkedView(await api.view('workspace',{workspace_id:route.id},{readClass:'foreground'}),bootstrap.instance_id); }
      catch(error) {
        if(serial!==refreshSerial)return;
        if(readFailure(error).kind==='forbidden') {
          $('topic-title').textContent='Outcome unavailable';$('topic-description').textContent='';$('outcome-team').hidden=true;
          $('topic-navigation').hidden=true;$('new-topic').disabled=true;
        }
        throw error;
      }
      if(serial!==refreshSerial)return;
      const workspace=answer.workspace;
      if(workspace?.id!==route.id||typeof workspace.title!=='string')throw Error('The outcome identity could not be confirmed.');
      $('topic-navigation').hidden=false;
      $('topic-title').textContent=workspace.title;$('topic-description').textContent=workspace.purpose||'Choose a topic, or start a new one.';
      $('workspace-name').textContent=workspace.id;enableNewTopic(workspace.id);
      await paintTeam(workspace,()=>reload());
      if(!topicRail)topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.id,null),host:$('topics'),more:$('more-topics'),
        retry:$('retry-topics'),message:$('topics-status'),denied:error=>readFailure(error).kind==='forbidden',
        read:async args=>checkedView(await api.view('workspace_topics',args,{readClass:'foreground'}),bootstrap.instance_id),
        open:id=>openDestination({kind:'topic',id},topicRail.pages.items.find(item=>item.id===id)?.title??id),
        updated:()=>{$('outcome-empty').hidden=!topicRail.pages.started||topicRail.pages.items.length>0||!$('topics-status').hidden;}});
      return topicRail.load();
    };
    // A commit may change the team or the outcome's revision as well as its
    // topics, and the outcome rail beside them carries counts too.
    const reload=followCommits(async()=>(await Promise.all([outcomeRail.load(),refresh()])).every(read=>read!==false));
    $('refresh').onclick=()=>run(reload);await reload();
  }
  document.body.dataset.ready='true';
}
// An outcome's team, which its owner may change.
let teamPanel=null;
async function paintTeam(workspace,refresh) {
  const send=(id,present)=>setPresence('workspace.member_set',{workspace_id:workspace.id},'workspace_revision',workspace.version,{actor_id:id,present})
    .then(receipt=>{run(refresh);return receipt;});
  if(!teamPanel){
    const section=$('outcome-team');$('outcome-page').append(section);
    teamPanel=new PeoplePanel({host:$('team-people'),label:'Add someone to this outcome\'s team',names:'directory-names',fixed:()=>[teamPanel.owner]});
  }
  Object.assign(teamPanel,{owner:workspace.owner_id,add:id=>send(id,true),remove:id=>send(id,false)});
  let members;
  try { members=await readMembers(api,bootstrap.instance_id,workspace.id); }
  catch(error) { teamPanel.error=`The team could not be read: ${error.message}`;members=teamPanel.people; }
  teamPanel.paint(members,workspace.owner_id===bootstrap.actor);teamPanel.error='';
  $('outcome-team').hidden=false;
}
function enableNewTopic(workspace) {
  $('new-topic').disabled=false;
  $('new-topic').onclick=()=>openDestination({kind:'opening',workspace,opening:crypto.randomUUID(),topic:crypto.randomUUID()},'New topic');
}
async function initializeOpeningPage(route) {
  for(const id of ['notebook','participants','messages','topic-pending','inline-composer','topic-navigation'])$(id).hidden=true;
  $('outcome-page').hidden=false;$('topic-title').textContent='New topic';$('topic-description').textContent='Write privately, then Send to create the topic.';
  const answer=checkedView(await api.view('workspace',{workspace_id:route.workspace},{readClass:'foreground'}),bootstrap.instance_id);
  if(answer.workspace?.id!==route.workspace)throw Error('The chosen outcome could not be confirmed.');
  $('workspace-name').textContent=answer.workspace.title;
  const store=await openOpeningStore({instanceId:bootstrap.instance_id,actor:bootstrap.actor});
  // Core owns the opening; a committed publication opens its topic.
  const draft=new OpeningDraft({api,bootstrap,store,workspace:route.workspace,opening:route.opening,topic:route.topic,
    published:receipt=>location.assign(routeHref({kind:'topic',id:receipt.result.topic.id}))});
  topicNavigation=new TopicNavigation({current:route,beforeLeave:(target,title)=>draft.leave(target,title),navigateTarget:target=>location.assign(routeHref(target))});
  const view=new OpeningView({host:$('outcome-page'),draft,workspace:answer.workspace,open:openDestination});
  $('refresh').onclick=()=>view.run(()=>draft.refresh());
  window.addEventListener('beforeunload',event=>{if(draft.unprotected){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{draft.cancelSave();store.close();});
  await view.run(()=>draft.load());
  if(draft.editable)view.title.focus();
  view.run(()=>view.loadMembers());
  // The outcome list stays beside the writing, and follows commits as on every page.
  initializeOutcomeNavigation(route.workspace);await followCommits(()=>outcomeRail.load())();document.body.dataset.ready='true';
}
async function ensureIntentJournal() {
  if(intentJournal)return intentJournal;
  if(!intentOpening)intentOpening=openIntentJournal({instanceId:bootstrap.instance_id,actor:bootstrap.actor}).then(value=>{
    intentJournal=value;window.addEventListener('pagehide',()=>value.close());return value;
  }).finally(()=>intentOpening=null);
  return intentOpening;
}
async function initializeUnfinished(route) {
  const host=$('unfinished-work');host.hidden=false;
  if(route.kind==='workspace'){
    const list=new UnfinishedOpenings({host,instanceId:bootstrap.instance_id,workspace:route.id,open:openDestination,
      read:args=>api.view('openings',args,{readClass:'foreground'})});
    return list.load();
  }
  try{await showUnfinished({host,journal:await ensureIntentJournal(),open:openDestination});}
  catch(error){host.textContent='Unfinished work on this browser is unavailable. '+error.message;}
}
async function initializeCreationPage(route) {
  for(const id of ['notebook','participants','messages','topic-pending','inline-composer','topic-navigation'])$(id).hidden=true;
  $('outcome-page').hidden=false;$('topic-title').textContent='New outcome';$('topic-description').textContent='Create a place for related topics.';
  const intents=await ensureIntentJournal();
  outcomeCreation=new OutcomeCreation({api,bootstrap,journal:intents,intentId:route.intent});await outcomeCreation.load();
  topicNavigation=new TopicNavigation({current:route,beforeLeave:(target,title)=>outcomeCreation.leave(target,title),navigateTarget:target=>location.assign(routeHref(target))});
  const confirmed=async row=>{
    const answer=checkedView(await api.view('workspace',{workspace_id:row.workspace},{readClass:'foreground'}),bootstrap.instance_id);
    if(answer.workspace?.id!==row.workspace||answer.workspace.owner_id!==bootstrap.actor)throw Error('The created outcome detail could not be confirmed. Keep its original receipt.');
    $('workspace-name').textContent=answer.workspace.title;
  };
  const form=new CreateOutcomeView({host:$('outcome-page'),creation:outcomeCreation,open:openDestination,confirmed,refresh:$('refresh')});
  if(outcomeCreation.row.phase==='confirmed')await form.run(()=>confirmed(outcomeCreation.row));
  $('refresh').onclick=()=>form.run(()=>outcomeCreation.refresh());
  window.addEventListener('beforeunload',event=>{if(outcomeCreation.writable&&(outcomeCreation.pending||outcomeCreation.dirty||outcomeCreation.storageError)){event.preventDefault();event.returnValue='';}});
  initializeOutcomeNavigation();await followCommits(()=>outcomeRail.load())();document.body.dataset.ready='true';
}
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
$('refresh').onclick = () => run(start);
run(start);
