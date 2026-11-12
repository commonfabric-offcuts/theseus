import { Api, notAnswering, unreached, answeredSince, heard, follow } from './api.mjs';
import { openJournal } from './journal.mjs';
import { EditorRegistry } from './app-session.mjs';
import { Reader } from './reader.mjs';
import { InlineComposer } from './inline-composer.mjs';
import { PRIOR_PUBLICATION_NOTICE } from './session.mjs';
import { readableUploads, uploadWork, recoveryReadOnly, refusedCopyAtDraft, refusedAtDraft } from './upload-state.mjs';
import { typingField } from './writing-input.mjs';
import { Freshness, initialViews, actorBaseline, readFailure, checkedView, bindingOf } from './freshness.mjs';
import { TopicViews } from './topic-views.mjs';
import { TopicPages, TopicNavigation, TopicRail, parseRoute, routeHref, paintChanged, changedSince } from './topic-navigation.mjs';
import { OutcomeRail } from './outcomes.mjs';
import { LightPeek, paintAlsoWaiting, paintStanding, paintStandingFailed } from './outcome-light.mjs';
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
import { TopicStatePanel, paintWaiting, managesTopic, organises } from './topic-state.mjs';
import { paintTopicHeader } from './topic-header.mjs';
import { TopicSettings } from './topic-settings.mjs';
import { repaintTimes, watchDays } from './times.mjs';
import { PeoplePanel, fillNames, readDirectory, readMembers } from './people.mjs';
import { OneLine, OutcomeStart, TopicStart, lineFromButton, firstSentence } from './quick-create.mjs';
import { PurposeLine } from './outcome-purpose.mjs';
import { Marks, paintMarkButton, paintAuthor, marksWords } from './marks.mjs';
import { replyLine } from './replies.mjs';
import { placeNewLine } from './unanswered.mjs';
import { betweenOthers, foldCard, cardIn, paintFold, opened } from './fold.mjs';
import { cardClass, paintCardColor, agentColor, paneClass } from './author-colors.mjs';
import { paintWhisperAuthor } from './whisper-choice.mjs';
import { AgentColors } from './colors.mjs';
import { openColorPicker } from './color-picker.mjs';
import { PageReads } from './page-reads.mjs';
import { PageHere } from './page-here.mjs';
import { TITLE as CONVERSATION_TITLE, subtitle as conversationSubtitle, placeholder as conversationPlaceholder, CONVERSATION_NOTE, paintOnlyNew, paintEmpty, paintItemTags, paintAbout, paintAsksYou, paintConversationRow, conversationDestination, paintAnswerers, switchWriting, PLACE as CONVERSATION_PLACE } from './outcome-conversation.mjs';
import { WakeLights } from './wake-lights.mjs';
import { OutcomeScope, placeBrand } from './outcome-scope.mjs';
import { linkWords, openLinksWith, nameTopicsWith, shareLinksFrom, messageLink, pageLink } from './links.mjs';
import { closeOnOutsideClick } from './dismiss.mjs';
import { PipelinePage, PipelineRow, paintPipelineLine, pipelineHref, titleLine } from './pipeline.mjs';
import { firstLine } from './pipeline-words.mjs';
import { HealthPage } from './health.mjs';
import { DeckPage } from './deck-page.mjs';
import { HealthLight } from './health-light.mjs';
import { phoneCheck } from './phone-check.mjs';
import { MeasurementsPage, OutcomeTargets, paintTopicTarget } from './targets.mjs';
import { MessageMenu, openMessageMenu, sayOn, copyText, COPY_REFUSED } from './message-menu.mjs';
import { Reactions, learnReactions, paintReaderThumb } from './reactions.mjs';
import { CardScroll } from './card-scroll.mjs';
import { InteractionGuide, asksForGuide } from './interaction-guide.mjs';
// How a topic reads (docs/topic-reading.md): read cards, quiet agent talk, replies and stacks, formatted words.
import { agentTalk, readNow, learnReply, paintReading, seenRanges, wakeOnPress } from './card-reading.mjs';
import { entries, entryOf, lineSeq, reveal, headClick, stackState } from './reply-stacks.mjs';
import { StackFeed } from './stack-feed.mjs';
import { PressHold } from './press-hold.mjs';
import { readingOrder } from './stack-order.mjs';
import { formatWords } from './message-format.mjs';
import { shell } from './rails.mjs';
import { SessionRenewal } from './session-renewal.mjs';
import { showLine, lineText } from './lines.mjs';

// Each page is one run of this module (in-place-navigation.mjs). A run that a
// move in place has ended finds its own elements still, so work it had under
// way lands there and never on the page that followed it.
let retired = null;
const $ = id => retired?.get(id) ?? document.getElementById(id);
const thisRun = shell.begin({ open: (target, title) => openDestination(target, title), retire: ids => { retired = ids; } });
const node = (tag, text, className) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const button = (label, action) => { const element = node('button', label); element.type = 'button'; element.onclick = () => run(action); return element; };
// The page's status line (lines.mjs): a failure goes to it as the error itself.
const status = what => showLine($('app-status'), what);
const failed = error => { status(error); return null; };
const run = action => { try { return Promise.resolve(action()).catch(failed); } catch (error) { return Promise.resolve(failed(error)); } };
let healthLight = null;
let api, bootstrap, journal, registry, reader, inline, topic, opening = 0, freshness, views, updateState, live = null, attention = null, topicState = null, waitingHost = null;
let localEffectVersion = 0;
// The open page's outcome conversation: its view (the rail row reads it), and on the conversation page
// itself the latest read of its items, which takes added later change (outcome-conversation.mjs).
let here = null;
let availabilitySerial = 0;
let inlineAvailabilitySerial = 0;
let topicUnavailable = false, listAccessEpoch = 0;
let settings = null, topicRail, topicNavigation, outcomeRail, outcomeReferences, outcomeScope = null, inlineDiscovery = null, sentHost = null, participantsPanel = null, outcomeMembers = null, colors = null;
let intentJournal, intentOpening, outcomeCreation, readThrough, cardObserver, middleObserver, marks = null, commitReload = null, pageReads = null;
let pipelineRow = null, pipelineAddFor = null;
// An outcome page's Notebook page shown in place (page-here.mjs), and that outcome.
let pageHere = null, pageHereOutcome = null;
// The topic page's light, message bar, thumbs-up and go-ahead answers (message-menu.mjs, reactions.mjs).
let menu = null, reactions = null;
// What the person does to reply stacks: star, rename, move, join, fold (stack-feed.mjs).
let stackFeed = null;
// A press held down on the page: the repaints that would move the list under it wait for it to end (press-hold.mjs).
const pressHold = new PressHold(document);
const guide = new InteractionGuide(document);
const halfShown = new Set(), atMiddle = new Set();
// Whether what is drawn above the topic page's messages after they paint has
// had its first fill, so no card the page counts as seen moves (noteRead).
let laidOut = false;
const listLoads = new Map();
const candidates = new Map(), mediaURLs = new Set();
const review = $('version-review');
let comparison = null, reviewSerial = 0, reviewOpener = null;
// Whether each agent's wakes are getting through, said on its name where it is not.
const wakeLights = new WakeLights({ read: async () => checkedView(await api.view('wakes', {}, { readClass: 'background' }), bootstrap.instance_id),
  painted: () => { const words = wakeLights.notice(); $('wakes-status').textContent = words ?? ''; $('wakes-status').hidden = !words; } });
const wakeLight = person => person.kind === 'agent' || person.kind === undefined ? wakeLights.words(person.actor_id) : null;
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
closeOnOutsideClick(review, closeReview, window);
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
  // undefined: not read (say so and offer Retry); null: read, and nothing is
  // saved there. A runtime review records its authority only once it has read
  // both the runtime and the saved version, whether it is then ready or blocked.
  let remote = recovery ? (recovery.authority ? recovery.remote : undefined) : editor.conflict?.remote;
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

// The Review buttons, drawn from the registry alone (docs/replies-in-doubt.md):
// one for each registered writing with a reply in doubt, in the order the
// writings registered, in doubt()'s words. A message's goes under the topic's
// title; the topic's own goes in the composer while the composer shows, and
// under the title until then; the Reader shows its writing's as well. Whatever
// told the page of a change, all are drawn again from what the registry holds
// now, so no editor an event hands in draws or erases one. Returns what it
// drew, which is what the departure guard names.
function paintReview() {
  const entries = registry?.inDoubt ?? [], composer = !$('inline-composer').hidden;
  const inComposer = entry => composer && entry.editor.context.sourceRef.kind === 'topic';
  const title = $('topic-pending'), hosts = new Map([...title.children].map(host => [host.dataset.key, host]));
  const rows = entries.filter(entry => !inComposer(entry)).map(entry => {
    const host = hosts.get(entry.editor.key) ?? node('div'); host.dataset.key = entry.editor.key; reviewControl(host, entry); return host;
  });
  if (rows.length !== title.children.length || rows.some((host, n) => title.children[n] !== host)) title.replaceChildren(...rows);
  reviewControl($('inline-pending'), entries.find(inComposer));
  const reading = registry?.current?.editors.reply?.key;
  reviewControl($('pending-submissions'), entries.find(entry => entry.editor.key === reading));
  return entries;
}
function reviewControl(host, entry) {
  if (!entry) { host.replaceChildren(); return; }
  let control = host.firstElementChild;
  if (!control) { control = node('button'); control.type = 'button'; host.append(control); }
  // A small chip on the reply's line; what it is about is in its name.
  control.textContent = entry.label; control.onclick = () => run(() => showPending(entry.editor.key, control));
  control.setAttribute('aria-label', `${entry.count} ${entry.count === 1 ? 'reply' : 'replies'} may not have sent. Review`);
}
// The replies in doubt of the writing registered under this key, read again
// from the registry at each draw and each act.
async function showPending(key, opener) {
  const serial = beginReview('Your replies', opener), current = () => serial === reviewSerial && review.open;
  const writing = () => registry.sessions.get(key)?.editor;
  const host = $('review-content');
  const names = { preparing: 'Preparing — writing kept', prepared: 'Confirmation unknown', confirmed: 'Sent to Theseus', refused: 'Not sent — writing kept', unknown: 'Confirmation unknown', committed: 'Sent to Theseus', rejected: 'Not sent — writing kept' };
  // The replies in doubt, and those that were while the list is open, so a
  // reply checked as sent says so in place.
  const shown = new Set();
  const draw = () => {
    const editor = writing();
    if (!current() || !editor) return;
    for (const id of registry.doubt(editor).ids) shown.add(id);
    const local = new Map(editor.submissions.map(item => [item.id, item]));
    const entries = [...local.values(), ...registry.pending(editor).items.filter(item => !local.has(item.id))].filter(item => shown.has(item.id));
    for (const item of entries) {
      const statusKey = item.status ?? item.send_status;
      let card = [...host.children].find(child => child.dataset.id === item.id);
      if (!card) {
        card = node('section', undefined, 'pending-card'); card.dataset.id = item.id;
        card.append(node('h3'), node('p', `To ${item.topicId ?? item.topic_id}`, 'muted')); host.append(card);
        if (local.has(item.id)) { card.append(node('pre', item.snapshot.body));
          if (item.snapshot.attachments.length) card.append(node('p', 'Included in this reply · ' + imageSummary(editor, item.snapshot.attachments), 'muted')); }
        else card.append(button('Read submitted writing', async () => {
          const detail = await registry.inspectPending(writing(), item.id);
          if (current() && !card.querySelector('pre')) card.append(node('pre', detail.body));
          draw();
        }));
        card.append(button('Check confirmation', async () => { await registry.checkPending(writing(), item.id); draw(); }));
        if (local.has(item.id) && statusKey !== 'confirmed' && (item.detached || item.receipt?.kind === 'submission.prepare')) {
          card.append(button('Prepare this reply again', () => {
            const now = writing(), kept = now?.submissions.find(entry => entry.id === item.id);
            if (!kept) throw Error('This writing changed. Review it again.');
            return showCorrection(now, kept, opener);
          }));
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
      const more = button('More pending replies', async () => { more.disabled = true; await registry.morePending(writing()); draw(); });
      more.dataset.more = ''; host.append(more);
    }
  }; draw();
}

// The registry tells the page of every change. The Review buttons are drawn
// again from the registry; the rest is painted only for writing it holds, so a
// notice about writing it no longer holds changes nothing else.
function changed(editor) {
  paintReview();
  if (registry.sessions.get(editor.key)?.editor !== editor) return;
  if (reader?.sessions && Object.values(reader.sessions).includes(editor)) {
    reader.paintStatus();
    $('review-versions').hidden = !needsReview(reader.editor);
  }
  if (inline?.editor === editor) inline.paintStatus();
  invalidateComparison(editor);
  const version = registry.localTopicVersion(editor);
  if (version > localEffectVersion) { localEffectVersion = version; freshness?.invalidate('topic', version); freshness?.request(); }
}
// What the person sees is read: while the page is visible and has focus, and
// no modal other than the Reader covers it, the message the Reader shows (an
// open, which the New line counts as an act: TopicViews.opened), or else the
// message cards on screen (which hold the New line from the moment they are
// seen: TopicViews.sighted). A card is on screen only once everything drawn
// above the messages after they paint has had its first fill (laidOut, set in
// initialize, which names them), and only while it is on screen as the page
// reports, measured then. The ranges reported come from seenRanges, so each
// holds only messages on screen: any loaded message between two seen ones that
// is not itself on screen (a reply folded in its stack, a card a stack moved
// away) ends one range and starts the next, and a range never spans a gap
// between runs. Only another actor's message can settle a delivery, so the
// person's own are never reported.
function noteRead() {
  if (!readThrough || !topic || topicUnavailable || $('messages').hidden || authorityReviewPending() || review.open) return;
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const source = registry.current?.source;
  if (source) {
    if (registry.current.sourceUnavailable || source.source_ref.kind !== 'message' || source.topic_id !== topic.id) return;
    views.opened(source.seq);
    if (source.author !== bootstrap.actor) { readThrough.seen(topic.id, source.seq, source.seq); openedHere(source.source_ref.id); }
    return;
  }
  if (!laidOut) return;
  const shown = new Set();
  for (const entry of entries($('messages'))) {
    const seq = Number(entry.dataset.seq);
    if ((halfShown.has(seq) || atMiddle.has(seq)) && onScreen(entry)) shown.add(seq);
  }
  if (!shown.size) return;
  for (const [from, through] of seenRanges([...views.messages.values()], seq => shown.has(seq), id => views.runOf(id), bootstrap.actor))
    views.sighted(from, through, readThrough.seen(topic.id, from, through));
}
// A card counts as on screen when at least half of it, or of the viewport,
// shows it. The second holds exactly when the card crosses the viewport's
// middle line (a card that crosses it is wholly shown or covers half the
// viewport), which a zero-height root observes for a card of any height.
// The observers say when that changes; onScreen measures it as it is now,
// since a layout that moved since (a fill above the messages) is observed a
// frame late.
function onScreen(node) {
  const box = node.getBoundingClientRect(), shown = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
  return shown > 0 && (shown >= box.height / 2 || box.top <= innerHeight / 2 && box.bottom >= innerHeight / 2);
}
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
    offerAuthor(presentation);
    revokeMedia(); reader.presentation = presentation;
    reader.show(presentation.source, presentation.editors, { opener: presentation.opener, topics: [topic], presentation, mode: presentation.mode });
    if (presentation.sourceUnavailable) reader.notice('The source is unavailable. Your private writing is kept.');
    const shown = presentation.source.source_ref;
    if (presentation.mark && !presentation.sourceUnavailable && shown.kind === 'message') {
      marks.learn(shown.id, presentation.mark.mark_revision, { topicId: presentation.source.topic_id, seq: presentation.source.seq });
    }
    paintReaderMark();
    noteRead();
    pageShown = shown.kind === 'memory' && !presentation.sourceUnavailable ? presentation : null;
    notePageRead();
  }
  const discovery = Promise.all(Object.values(presentation.editors).map(editor => discover(presentation, editor)));
  if (presentation.surface === 'inline') { inlineDiscovery = discovery; return; }
  registry.neighbors(presentation).then(neighbors => {
    if (!neighbors || !registry.isSourceCurrent(presentation)) return;
    registry.current.neighbors = onPage(presentation, neighbors);
    $('previous-message').disabled = !registry.current.neighbors.previous; $('next-message').disabled = !registry.current.neighbors.next;
  }).catch(error => { if (registry.isSourceCurrent(presentation)) reader.notice(error); });
  sourceAttachments(presentation);
}
// The Reader's ↑ and ↓ follow the page as shown (stack-order.mjs,
// readingOrder): ↑ the message above, ↓ the one below, down a stack to its
// newer replies and on to the stack below. Where the page shows nothing that
// way (the end of what it loaded, a message it does not show), Core's
// neighbour in the topic stands in. next is the one above, previous below.
function onPage(presentation, core) {
  const id = presentation?.source?.source_ref?.id, order = readingOrder(stackState($('messages')).stacks);
  const at = presentation?.source?.source_ref?.kind === 'message' ? order.findIndex(item => item.id === id) : -1;
  if (at < 0 || !core) return core;
  const ref = item => item ? { kind: 'message', id: item.id } : null, off = other => other && !order.some(item => item.id === other.id) ? other : null;
  return { next: ref(order[at - 1]) ?? off(core.next), previous: ref(order[at + 1]) ?? off(core.previous) };
}
// A Notebook page shown in the Reader is read once the person can see it, as
// a message is (noteRead): in a visible, focused page. One shown in the
// background, such as a Reader restored on load, is read when the page comes
// forward, if it is still the one shown.
let pageShown = null;
function notePageRead() {
  const presentation = pageShown;
  if (!presentation || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  pageShown = null;
  if (registry.isSourceCurrent(presentation) && !presentation.sourceUnavailable) run(() => readPage(presentation));
}
// A read Core did not record says so in the Reader, and the page keeps its
// light. A page the person read at an older revision shows what changed
// since then.
// One that met no Theseus is read again once the page reaches it.
async function readPage(presentation) {
  const current = () => registry.isSourceCurrent(presentation) && !presentation.sourceUnavailable;
  const again = error => owe(error, 'page read', () => { if (current()) { pageShown = presentation; notePageRead(); } });
  let since;
  try { since = await pageReads.opened(presentation.source); }
  catch (error) { if (current()) { reader.notice(error); again(error); } return; }
  if (since === null || !current()) return;
  const ref = { ...presentation.source.source_ref, revision: since };
  let earlier;
  try { earlier = checkedView(await registry.cleanup.list(options => api.view('source', ref, options)), bootstrap.instance_id); }
  catch (error) { if (current()) { reader.notice([`What changed since revision ${since} could not be read.`, error]); again(error); } return; }
  if (current()) reader.showChanges(since, earlier.body ?? '', presentation.source.body ?? '');
}
// A reply to someone else's message in this topic goes to its author unless
// the person removes them; the offer is made once for each reply editor, and
// not to an author the reply would not reach (switched off, or gone from the
// topic and its outcome's team), whose name would make the send refused.
function offerAuthor(presentation) {
  const source = presentation.source, reply = presentation.editors.reply;
  if (presentation.sourceUnavailable || reply.offered !== undefined || source.source_ref.kind !== 'message' ||
      source.topic_id !== reply.context.topicId || !source.author || source.author === bootstrap.actor ||
      recipientReach(source.author)?.reachable === false) return;
  reply.offerAddressees([source.author]);
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
    .catch(error => { if (registry.isCurrent(presentation, editor)) writingSurface(presentation).notice(error); });
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
    if (registry.isCurrent(presentation, editor)) writingSurface(presentation).notice(error);
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
    } catch (error) { if (available()) notice(error); }
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
    $('source-attachments').append(attachmentControl(attachment, presentation.source.source_ref, current, failure => {
      if (failure) { mine.said = [`${attachment.name ?? 'attachment'}:`, failure]; last = mine; reader.notice(mine.said); }
      else if (last === mine && $('reader-notice').textContent === lineText(mine.said)) { reader.notice(''); last = null; }
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
      if (from?.surface !== 'inline' && registry.isCurrent(from)) reader.notice(error);
      else status(error);
    }
  }
  finally { if (request === opening) { views.retain(views.currentItem, null); reader.paintOffer(); } }
}
// A repaint leaves in place what the person is at: the inline writing, a
// field on the page they are typing in, or else the first card in view. A
// button, checkbox or other control keeps no place: More would hold itself still and scroll past what
// it loaded. At the top of the topic, where its newest card shows from its
// top edge, nothing is held: what arrives comes into view above that card,
// with the New line under it, instead of landing out of sight.
function keepListAnchor(paint) {
  const at = document.activeElement;
  const writing = inline?.root.contains(at) && registry.isCurrent(registry.inline);
  const field = !writing && $('main').contains(at) && typingField(at) && inView(at);
  const anchor = writing ? inline.field : field ? at : listAnchor();
  const top = anchor?.getBoundingClientRect().top;
  const atTop = !writing && !field && anchor && anchor === document.querySelector(MESSAGE_ENTRIES) && top >= 0;
  paint();
  if (anchor?.isConnected && !atTop) window.scrollBy(0, anchor.getBoundingClientRect().top - top);
}
function inView(node) { const box = node.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; }
// The first card in view. With More, or the New line that loads older
// messages, first in view at the top edge, the list itself holds by its top:
// what they load comes in where they were, and the Notebook below moves down,
// rather than holding still while the page jumps past all of it. Loaded
// replies can gather messages above into their stacks; the page still stays
// where it was. A card in a reply stack is a card in view of its own, so a
// reply arriving above it in its stack moves it no more than one above the stack.
const MESSAGE_ENTRIES = '#messages > [data-id], #messages > .reply-stack > [data-id], #messages > .reply-stack > .stack-replies > [data-id]';
function listAnchor() {
  const first = [...document.querySelectorAll(`${MESSAGE_ENTRIES}, #messages > [data-line=older], #more-messages, #memory-items .memory-card`)].find(inView);
  return first && !first.dataset.seq && !first.classList.contains('memory-card') ? $('messages') : first;
}
// The New line, just below the oldest message the reader had not read when the
// topic opened, or further back as more became unread (TopicViews.line); faded
// where it is once nothing holds it (TopicViews.held).
function placeLine() {
  placeNewLine($('messages'), lineSeq($('messages'), views.line?.seq ?? null), document,
    views.olderCursor === null ? null : () => run(loadToUnread), views.line?.sent_ms ?? null, views.held);
  paintMoreMessages();
}
// While the New line says more new messages lie below, it is the one way to
// load older messages; More messages, doing much the same, is hidden. A faded
// line promises nothing, so More comes back.
function paintMoreMessages() {
  $('more-messages').hidden = views.olderCursor === null ||
    [...$('messages').children].some(child => child.dataset?.line === 'older' && !child.classList.contains('new-line-read'));
}
function paintViews(kind) {
  if (kind === 'offer') { reader?.paintOffer(); return; }
  // All but the header and the people, which repaint in place, move the list:
  // under a press held down they wait for it to end, so the click lands where it began.
  if (kind !== 'topic' && pressHold.down) { pressHold.after(kind, () => paintViews(kind)); return; }
  // A thumbs-up reads its message (card-reading.mjs, readNow): its card, and its stack's count of new replies, read so.
  if (kind === 'reactions') { keepListAnchor(() => { paintCardReading(); stackMessages(); menu?.paint(); }); paintReaderThumb$(); return; }
  // A star, a stack's name, a join or a place, here or on another device (stack-feed.mjs).
  if (kind === 'acts') { keepListAnchor(() => { stackMessages(); placeLine(); menu?.paint(); }); return; }
  // The line moves under the reader's eyes: the card they are looking at stays where it is.
  if (kind === 'line') { keepListAnchor(placeLine); return; }
  if (kind === 'topic') {
    if (authorityReviewPending()) return;
    topicUnavailable = false;
    topic = views.topic;
    shell.topicChanged();
    // The panel paints the header with the newest topic it has seen.
    if (topicState) topicState.paint(topic, views.participants); else paintHeader(topic);
    if (registry.inline) { registry.inline.topic = structuredClone(topic); inline.$('destination').textContent = `To ${topic.title}`; }
    if (!here?.page) topicRail?.updateCurrent(topic);
    paintParticipants(topic, views.participants);
    for (const id of ['messages', 'notebook', 'topic-people']) $(id).hidden = false;
    paintMoreMessages();
    if (registry?.current?.topicUpdatesPaused) { registry.current.topicUpdatesPaused = false; reader.paintStatus(); }
    paintMarks(); noteRead(); return;
  }
  keepListAnchor(() => {
  // Newest first, so where each new card goes is at or after where the one before it went.
  let following = $('messages').firstElementChild;
  for (const item of kind === 'messages' ? [...views.messages.values()].sort((a, b) => b.seq - a.seq) : []) {
    let card = messageEntries.get(item.id);
    if (!card) {
      const ref = { kind: 'message', id: item.id };
      // The revision a click or keypress may clear is the one the card shows.
      card = button('', () => openSource(ref, card, marks.capture(item.id))); card.className = cardClass(item, bootstrap.actor, agentShown); card.dataset.id = item.id; card.dataset.seq = item.seq;
      // An agent's name on its card opens its color picker instead of the message.
      const open = card.onclick;
      card.onclick = event => {
        // A stack's head row shows or hides its full message, or renames it (reply-stacks.mjs).
        if (headClick($('messages'), messageEntries.get(item.id), event)) return;
        const name = event?.target?.closest?.('.author-name');
        if (name && item.author_kind === 'agent' && item.author_id !== bootstrap.actor) return run(() => pickColor(item.author_id, name, card));
        return open(event);
      };
      // On its card first, so a whisper's words name the card for a screen reader.
      const author = node('span', undefined, 'message-author');
      card.append(author);
      paintCardAuthor(author, item);
      const answers = replyLine(item);
      // The line a reply quotes is cut, so an address at its end is left as words.
      if (answers) card.append(linkWords(node('span', undefined, 'message-reply-to'), answers, { partial: true }));
      card.append(formatWords(node('span', undefined, 'message-preview'), item.body, { partial: item.preview === true }));
      if (item.preview) card.append(node('span', 'Excerpt · Open to read the rest', 'message-preview-cue'));
      // A message between others is one quiet line that opens its card.
      const entry = betweenOthers(item, bootstrap.actor, bootstrap.actor_kind) ? foldCard(card, item, document) : card;
      paintFold(entry, marks?.state(item.id)?.marked === true);
      while (following && !(Number(following.dataset.seq) < item.seq)) following = following.nextElementSibling;
      $('messages').insertBefore(entry, following);
      messageEntries.set(item.id, entry);
      cardObserver?.observe(entry); middleObserver?.observe(entry);
    }
    // A whispered answer arrived: the whisper it answers no longer waits for one.
    const asked = item.whisper && item.reply_to ? views.messages.get(item.reply_to) : null;
    if (asked?.no_answer && item.author_id === asked.private_to) {
      asked.no_answer = false;
      const entry = messageEntries.get(asked.id);
      if (entry) paintCardAuthor(cardIn(entry).querySelector('.message-author'), asked);
    }
    learnReply(views.messages, item, bootstrap.actor);
  }
  // The stacks are drawn with the new messages in before any of them is dealt with (stack-feed.mjs, arrived).
  if (kind === 'messages') { feedOf().arrived([...views.messages.values()]); paintCardReading(); }
  for (const item of kind === 'memory' ? [...views.memory.values()].sort((a, b) => a.seq - b.seq) : []) {
    let card = memoryCards.get(item.id);
    if (!card) {
      card = button('', () => openSource(item.source_ref, card)); card.className = 'memory-card';
      card.dataset.id = item.id; card.append(node('strong'), node('span')); $('memory-items').append(card);
      memoryCards.set(item.id, card);
    }
    // A page read before and revised since wears its light, as in the sidebar.
    const identity = sourceIdentity(item.source_ref), changed = String(changedSince(item));
    if (card.dataset.source !== identity || card.dataset.changed !== changed) {
      const [title, body] = card.children;
      card.dataset.source = identity; card.dataset.changed = changed;
      title.replaceChildren(item.title || 'Notebook item'); paintChanged(title, item); linkWords(body, item.body, { partial: item.preview === true });
    }
    card.onclick = () => run(() => openSource(item.source_ref, card));
  }
  if (kind === 'messages') { placeLine(); menu?.paint(); }
  if (kind === 'messages' && here?.page) paintConversationPage();
  });
  paintMoreMessages();
  $('more-memory').hidden = views.memoryCursor === null;
  if (kind === 'messages') noteRead();
}
// Each message's entry in the list and each Notebook page's card, by id: a
// paint finds a card without searching every card loaded. Cards stay for the
// page's life.
const messageEntries = new Map(), memoryCards = new Map();
// The color the reader sees an agent in: their choice, or the agent's own.
const agentShown = id => colors?.color(id) ?? agentColor(id);
// Replies gather under the message they answer on every topic page, the
// conversation's included (reply-stacks.mjs). A folded stack keeps in view a
// reply the person has not read and, in the conversation, one whose card asks
// something of them: an item nothing has settled, or an ask waiting on them.
function stackMessages() { feedOf().arrange(); }
// The page's reply stacks and what the person does to them, made with the first messages.
function feedOf() {
  stackFeed ??= new StackFeed({ list: $('messages'), messages: () => views.messages, viewer: bootstrap.actor, instanceId: bootstrap.instance_id,
    authority: () => registry.runtime.current, send: envelope => api.command(envelope),
    keep: item => !cardRead(item) || stillOwed(item), unread: item => !cardRead(item), nameOf: id => (id === bootstrap.actor ? 'You' : id),
    hold: paint => keepListAnchor(paint), press: pressHold, status, reread: () => freshness?.invalidate('acts', 0), reply: (id, card) => run(() => replyMessage(id, card)) });
  return stackFeed;
}
// The conversation's own word on a message: its item and the asks that wait,
// as the conversation's newest read says, else as the page's messages say.
const conversationItem = id => here.items.get(id) ?? views.messages.get(id);
const stillOwed = item => Boolean(here?.page && (conversationItem(item.id)?.item?.state === 'new' ||
  (here.view?.waits ?? []).some(wait => wait.on === bootstrap.actor && wait.ask_message_id === item.id)));
// Messages this visit opened in the Reader: each reads as read at once.
const openedIds = new Set();
function openedHere(id) { if (openedIds.has(id)) return; openedIds.add(id); paintCardReading(); }
const cardRead = item => readNow(item, { viewer: bootstrap.actor, marked: marks?.state(item.id)?.marked === true, opened: openedIds.has(item.id) });
// Each loaded card's read look, agent talk and reply arrow, as they now stand.
function paintCardReading() {
  if (!views) return;
  const { kindOf } = whisperPeople();
  for (const entry of entries($('messages'))) {
    const card = cardIn(entry), item = views.messages.get(card.dataset.id);
    if (!item) continue;
    const quiet = agentTalk(item, bootstrap.actor, bootstrap.actor_kind, kindOf);
    entry.dataset.talk = quiet ? 'agents' : '';
    paintReading(card, item, { read: cardRead(item), quiet, go: goToMessage });
  }
}
// A message the page shows, brought into view: its stack opened first when it
// folds the message away, and its fold opened. Null when it is not loaded.
function landOn(id, { full = false } = {}) {
  const entry = entries($('messages')).find(child => child.dataset.id === id);
  if (!entry) return null;
  reveal(entry, { full });
  const card = opened(entry);
  card.scrollIntoView({ block: 'nearest' });
  return card;
}
// A message a link on the page names (the person's reply, or a tag's), opened
// in the Reader from its card, landed on first; one not loaded opens alone.
function goToMessage(id) {
  const card = landOn(id);
  if (!card) return run(() => openSource({ kind: 'message', id }, document.activeElement));
  // Opened as its card's click opens it; a click on the card itself would only light it on a phone (message-menu.mjs).
  run(() => openSource({ kind: 'message', id }, card, marks.capture(id)));
}
// Every loaded card, the participants and the Reader's page, in the reader's colors as they now stand.
function paintAgentColors() {
  for (const entry of entries($('messages'))) {
    const card = cardIn(entry), item = views?.messages.get(card.dataset.id);
    if (item) paintCardColor(card, item, bootstrap.actor, agentShown);
  }
  if (reader?.source && !registry?.current?.sourceUnavailable) reader.paintTone(reader.source);
  participantsPanel?.paint();
}
// The picker for one agent's color, under its name (anchor); closing it gives
// the focus to back. The choices are read first if the page has not read them.
async function pickColor(agent, anchor, back = anchor) {
  if (!colors.loaded) await colors.load('foreground').catch(error => { throw Error('The agent colors could not be read. Try again.', { cause: error }); });
  return openColorPicker({ anchor, back, agent, palette: colors.palette, chosen: colors.chosen(agent), own: agentColor(agent),
    choose: color => colors.choose(agent, color) });
}
// An agent in the participants: its name, in its color, opens its picker. An
// agent keeps one name button across repaints, so a choice that repaints the
// participants leaves the picker's opener on the page to take the focus back.
const participantNames = new Map();
function participantName(person) {
  if (person.kind !== 'agent' || person.actor_id === bootstrap.actor) return null;
  let name = participantNames.get(person.actor_id);
  if (!name) {
    name = node('button', person.actor_id); name.type = 'button';
    name.setAttribute('aria-haspopup', 'dialog'); name.title = `Change ${person.actor_id}'s color`;
    name.onclick = () => run(() => pickColor(person.actor_id, name));
    participantNames.set(person.actor_id, name);
  }
  name.className = 'pill-name';
  return name;
}
// Each person in the topic is one pill in their colour: the reader's own is
// black, as their messages are; an agent's is its colour as the reader sees it.
function participantPill(person) {
  if (person.actor_id === bootstrap.actor) return 'own-pill';
  return person.kind === 'agent' ? `agent-${agentShown(person.actor_id)}` : '';
}
// The top of the open topic: its title, its note as the subtitle, and the
// gear, except on a conversation, which refuses every change Topic settings makes.
function paintHeader(current) {
  // ✅ Done on a topic Ready for review, for a reader who may say where it stands: the Done chip's tap.
  paintTopicHeader({ title: $('topic-title'), subtitle: $('topic-description'), gear: $('settings-open') }, current, bootstrap.actor,
    { settings: current.kind !== 'conversation', done: topicState?.says ? () => topicState.markDone() : null });
  // A conversation's heading says what it is for and who answers, not where it stands.
  if (current.kind === 'conversation') {
    $('topic-title').textContent = CONVERSATION_TITLE;
    $('topic-description').textContent = conversationSubtitle(here?.view?.coordinator?.actor_id); $('topic-description').hidden = false;
  }
}
// Messages sent before times were kept have none.
function paintCardAuthor(author, item) {
  paintAuthor(author, item.author_id, Number.isSafeInteger(item.sent_ms) ? item.sent_ms : null, marks?.state(item.id)?.marked === true);
  if (item.whisper) paintWhisperAuthor(author, item, bootstrap.actor, document);
  if (here?.page) paintAsksYou(author, item, here.view?.waits, bootstrap.actor);
}
// Who the composers may whisper to, and who everyone in this topic is: the
// topic's participants and the outcome's team, by kind, never the reader.
function whisperPeople() {
  const kinds = new Map();
  for (const person of [...outcomeMembers ?? [], ...views?.participants ?? []]) if (person.kind) kinds.set(person.actor_id, person.kind);
  const everyone = (views?.participants ?? []).map(person => person.actor_id).filter(id => id !== bootstrap.actor).sort();
  // Who a leading @name can name (at-names.mjs), as Core reads them (aim_next/addressing.py):
  // the topic's participants and the outcome's team, switched on, never the reader. Writing
  // moved to the outcome's conversation goes to its team.
  const members = topicId => [...outcomeMembers ?? [], ...topicId === topic?.id ? views?.participants ?? [] : []]
    .filter(person => person.enabled !== false && person.actor_id !== bootstrap.actor)
    .map(person => ({ id: person.actor_id, name: person.name ?? null }));
  return { kindOf: name => kinds.get(name), everyone, members };
}
// What the page knows of the person's marks: the topic's line, each loaded
// card's pill and the Reader's button.
function paintMarks() {
  if (!marks || !topic) return;
  const count = marks.marked(topic.id).length;
  $('topic-marks-words').textContent = marksWords(count);
  $('topic-marks').hidden = !count || topicUnavailable;
  keepListAnchor(() => {
    for (const entry of entries($('messages'))) {
      const card = cardIn(entry), item = views.messages.get(card.dataset.id);
      if (item) { paintCardAuthor(card.querySelector('.message-author'), item); paintFold(entry, marks.state(item.id)?.marked === true); }
    }
    paintCardReading();
  });
  paintReaderMark();
}
// "Start a topic from this": one title line right in the Reader, filled from the
// message's first sentence. Return starts the topic with the message quoted as
// its opening and its author in it; people and more words come afterwards, in
// the topic. Escape, or a second press, closes it. Each message keeps its own
// line, with what was typed in it and its start, until it starts a topic: a
// line closed by Escape, or by the Reader moving to another message, opens
// again as it was left.
let startLine = null;
const startLines = new Map();
function closeStartLine(focus = false) {
  if (!startLine) return;
  startLine.line.root.remove(); startLine = null;
  $('start-from-message').setAttribute('aria-expanded', 'false');
  // The line was opened from the Reader's ⋯, where focus goes back.
  if (focus) $('reader-menu').focus();
}
function openStartLine() {
  if (startLine) { closeStartLine(true); return; }
  const p = registry?.current, source = p?.source, ref = source?.source_ref;
  if (ref?.kind !== 'message' || !topic || p.sourceUnavailable) return;
  let line = startLines.get(ref.id);
  const left = Boolean(line);
  if (!line) {
    const author = typeof source.author === 'string' && source.author !== bootstrap.actor ? source.author : null;
    const starter = new TopicStart({ api, bootstrap, workspace: topic.workspace_id, source: ref.id, participants: author ? [author] : [] });
    line = new OneLine({ id: 'start-topic-title', label: 'Title of the topic to start from this message', value: firstSentence(source.body), className: 'start-topic-line',
      submit: async title => { const id = await starter.start(title); startLines.delete(ref.id); closeStartLine(); await openDestination({ kind: 'topic', id }, title); },
      cancel: () => closeStartLine(true), open: link => openDestination({ kind: 'topic', id: link.id }, link.title) });
    startLines.set(ref.id, line);
  }
  startLine = { line, message: ref.id };
  $('start-from-message').after(line.root); $('start-from-message').setAttribute('aria-expanded', 'true');
  // A fresh line's words are selected, so typing replaces them; a line left
  // earlier keeps where the person was in it.
  line.focus(!left);
}
// A message's Add to pipeline: one line under the message, its first line as the
// title; Return adds it to Candidates with the message as where it came from, and
// Core records the message's author as who raised it. Escape closes the line.
function openPipelineAdd() {
  const p = registry?.current, ref = p?.source?.source_ref, host = $('pipeline-add');
  if (!p || p.sourceUnavailable || ref?.kind !== 'message' || !topic || p.source.whisper) return;
  const author = p.source.author, raised = !author ? '' : author === bootstrap.actor ? ', raised by you' : `, raised by ${author}`;
  const workspace = topic.workspace_id;
  pipelineAddFor = ref.id;
  const line = titleLine({ key: 'message-add', value: firstLine(p.source.body), label: 'Title of the new pipeline item',
    hint: `Return adds it to Candidates${raised} · Escape cancels`,
    cancel: () => closePipelineAdd(true),
    submit: (title, field) => run(async () => {
      field.disabled = true;
      host.querySelector('.pl-error')?.remove();
      try {
        const { authority_id, authority_epoch } = registry.runtime.current;
        const receipt = await api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'pipeline.item_add',
          target: { workspace_id: workspace }, expected: { authority: { authority_id, authority_epoch } },
          args: { title, section: 'candidates', candidate_group: '', sources: [{ message_id: ref.id }] } });
        if (receipt?.status !== 'committed') throw Error(receipt?.error?.message ?? 'Theseus did not confirm this item.');
        if (pipelineAddFor !== ref.id) return;
        const open = node('a', 'Open it'); open.href = pipelineHref(workspace, receipt.result.number);
        const done = node('p', `Added ${receipt.result.number} to Candidates.`, 'muted'); done.setAttribute('role', 'status'); done.append(open);
        host.replaceChildren(done); open.focus();
      } catch (error) {
        field.disabled = false; field.focus();
        const message = node('p', error.message, 'pl-error'); message.setAttribute('role', 'status'); line.append(message);
      }
    }) });
  host.replaceChildren(line); host.hidden = false;
  const field = line.querySelector('input');
  field.focus(); field.setSelectionRange(field.value.length, field.value.length);
}
function closePipelineAdd(refocus) {
  pipelineAddFor = null;
  const host = $('pipeline-add'); host.hidden = true; host.replaceChildren();
  if (refocus) $('reader-menu').focus();
}
function paintReaderMark() {
  const p = registry?.current, ref = p?.source?.source_ref;
  // Any readable message can start a topic of its own in this outcome, except
  // a whisper, which stays between its two people (docs/whispers.md).
  $('start-from-message').hidden = !(p && !p.sourceUnavailable && ref?.kind === 'message' && topic && !p.source.whisper);
  // A title line started from another message goes when the Reader moves on.
  if (startLine && (startLine.message !== ref?.id || $('start-from-message').hidden)) closeStartLine();
  // And, while the outcome's pipeline is on, become an item in it; a whisper
  // never does, since the whole outcome reads the pipeline (Core refuses it too).
  $('add-to-pipeline').hidden = !(p && !p.sourceUnavailable && ref?.kind === 'message' && topic && pipelineRow?.on && !p.source.whisper);
  if (pipelineAddFor !== null && pipelineAddFor !== ref?.id) closePipelineAdd(false);
  const state = p && !p.sourceUnavailable && p.mark && ref.kind === 'message' ? marks.state(ref.id) : null;
  paintMarkButton($('mark-unread'), state && { ...state, busy: marks.busy(ref.id) });
  // The ⋯ shows while it offers something: a message's or a Notebook page's
  // links (openReaderMenu), or the layout where the window has room to choose.
  $('reader-menu').hidden = !(p && !p.sourceUnavailable && ((ref?.kind === 'message' && topic) || (ref?.kind === 'memory' && p.source.owner_scope))) && !reader?.layoutChoice;
  paintReaderThumb$();
}
// The Reader's 👍 beside Send: the loaded card's item when there is one, which
// the page keeps current, else what the message's source said.
function readerItem() {
  const p = registry?.current, source = p?.source, ref = source?.source_ref;
  if (!p || p.sourceUnavailable || ref?.kind !== 'message') return null;
  return views?.messages.get(ref.id) ?? { id: ref.id, author_id: source.author, addressees: source.addressees, reactions: source.reactions, go_ahead: source.go_ahead };
}
function paintReaderThumb$() {
  const item = readerItem();
  paintReaderThumb($('thumb-source'), reactions && item, bootstrap.actor, Boolean(item && reactions?.busy.has(item.id)));
}
// Reply, or Return, on a lit message: the Reader opens on it with the cursor
// in the reply, and nothing quoted until the reader selects a passage.
async function replyMessage(id, card) {
  await openSource({ kind: 'message', id }, card, marks.capture(id));
  if (reader.dialog.open && registry.current?.source?.source_ref?.id === id) reader.reply({ kind: 'message', id });
}
// Every page of the person's marks in this topic.
function loadMarks() {
  if (!marks || topicUnavailable) return Promise.resolve(true);
  if (authorityReviewPending()) return Promise.resolve(false);
  return marks.load(topic.id, async args => checkedView(await registry.cleanup.list(options => api.view('marks', args, options)), bootstrap.instance_id));
}
// The topic's own Notebook pages' read state, as loadMarks: nothing for a
// denied topic, and owed while the runtime changed.
function loadReadState() {
  if (topicUnavailable) return Promise.resolve(true);
  if (authorityReviewPending()) return Promise.resolve(false);
  return views.readState((name, args) => registry.cleanup.list(options => api.view(name, args, options)), pageMax());
}
async function toggleMark() {
  const p = registry.current, ref = p?.source?.source_ref;
  if (!p || p.sourceUnavailable || !p.mark || ref.kind !== 'message' || marks.busy(ref.id)) return;
  const state = marks.state(ref.id);
  if (!state) return;
  let receipt;
  try { receipt = await marks.send(ref.id, !state.marked, state.mark_revision); }
  catch (error) {
    if (registry.isSourceCurrent(p)) reader.notice(Error('Connection interrupted; whether the mark was saved is unknown. Press again to send the same request.', { cause: error }));
    return;
  }
  // An explicit Mark read places the New line afresh, wherever the oldest
  // unread message now is, or, with nothing left unread, lets it fade where it
  // is; a read that fails is owed, as after any commit.
  if (receipt?.status === 'committed' && state.marked) { views.placeAfresh(); if (commitReload) run(commitReload); }
  if (!registry.isSourceCurrent(p)) return;
  if (receipt?.error?.code === 'REVISION_CONFLICT') {
    reader.notice(`This message's mark changed in another tab or device: it is ${marks.state(ref.id)?.marked ? 'marked unread' : 'not marked unread'} now. Nothing was changed.`);
  } else if (receipt?.status !== 'committed') reader.notice(receipt?.error ?? 'The mark was not confirmed. Press again to send the same request.');
}
// A message's ⋯ menu, from the ⋯ on its bar (message-menu.mjs) or a
// right-click (docs/links.md, "A message's menu").
// On a phone it opens as a sheet from the bottom, as a long press does.
function openMessageMore(item, more) {
  openMessageMenu({ anchor: more, items: messageMenuItems(item, more, more), label: 'This message', sheet: true });
}
// say: the ⋯ that says "Link copied", or null where none shows. anchor: what
// the menu opened from, where a phone's "Move or join…" sheet opens too.
// What the message's stack offers comes first, its moves and joins last (stack-feed.mjs).
function messageMenuItems(item, say, anchor = say) {
  const phone = Boolean(window.matchMedia?.('(max-width: 760px)').matches);
  const stack = stackFeed && !topicUnavailable ? stackFeed.menuItems(item, { phone, more: moves => anchor && openMessageMenu({ anchor, items: moves, label: 'Move or join', sheet: true }) }) : { first: [], last: [] };
  const items = [...stack.first, { label: 'Copy Link', act: () => run(() => copyLink(item.topic_id, item.id, say)) }];
  if (marks && item.author_id !== bootstrap.actor && !topicUnavailable) {
    const marked = marks.state(item.id)?.marked === true;
    items.push({ label: marked ? 'Mark read' : 'Mark unread', act: () => run(() => markFromMenu(item.id, !marked)) });
  }
  return [...items, ...stack.last];
}
// A right-click on a message opens the same menu where the pointer is. On a
// link or a selection the browser's own menu stays, to copy what it offers.
function messageContextMenu(event) {
  if (event.target.closest('a') || window.getSelection()?.isCollapsed === false) return;
  // A message on its own or in a reply stack (reply-stacks.mjs).
  const entry = entryOf($('messages'), event.target), item = entry && views?.messages.get(entry.dataset.id);
  if (!item) return;
  event.preventDefault();
  const card = cardIn(entry), shown = !card.hidden, anchor = shown ? card : entry.querySelector('.fold-line') ?? entry;
  const at = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null;
  // "Link copied" shows on the bar's ⋯ while its message is lit, as it is under the pointer.
  openMessageMenu({ anchor, at, items: messageMenuItems(item, menu?.moreFor(entry) ?? null, anchor), label: 'This message', sheet: true });
}
// The link names the message's own topic, which the Reader may show on a page of another.
async function copyLink(topicId, messageId, say) {
  const link = messageLink(topicId, messageId);
  if (!await copyText(link)) { status(`The link could not be copied here. Select it to copy it: ${link}`); return; }
  if (say?.getClientRects().length) sayOn(say, 'Link copied'); else status('Link copied.');
}
// Mark unread or Mark read from a menu, on a card that may never have been
// opened. The marks read lists every marked message, so one the page knows
// nothing of is not marked, at a revision it may not know (0 if never marked):
// a refusal that names the revision is answered once more at it, as
// setPresence does. Mark read places the New line afresh, as in the Reader.
async function markFromMenu(messageId, marked) {
  if (marks.busy(messageId)) return;
  const state = marks.state(messageId);
  let receipt;
  try {
    receipt = await marks.send(messageId, marked, state?.mark_revision ?? 0);
    const now = marks.state(messageId);
    if (receipt?.error?.code === 'REVISION_CONFLICT' && now?.marked === marked) return;
    if (!state && receipt?.error?.code === 'REVISION_CONFLICT' && now) receipt = await marks.send(messageId, marked, now.mark_revision);
  } catch (error) { status(Error('Connection interrupted; whether the mark was saved is unknown. Choose it again to send the same request.', { cause: error })); return; }
  if (receipt?.status === 'committed' && !marked) { views.placeAfresh(); if (commitReload) run(commitReload); }
  if (receipt?.error?.code === 'REVISION_CONFLICT') status(`This message's mark changed in another tab or device: it is ${marks.state(messageId)?.marked ? 'marked unread' : 'not marked unread'} now. Nothing was changed.`);
  else if (receipt?.status !== 'committed') status(receipt?.error ?? 'The mark was not confirmed. Choose it again to send the same request.');
}
// A Notebook page's link (docs/links.md, "A Notebook page's link"): the page as
// it stands, or with revision, that revision.
async function copyPageLink(source, revision, say) {
  const link = pageLink(source.owner_scope, source.source_ref.id, revision);
  if (!await copyText(link)) { status(`The link could not be copied here. Select it to copy it: ${link}`); return; }
  if (say?.getClientRects().length) sayOn(say, 'Link copied'); else status('Link copied.');
}
// The Reader's ⋯ (docs/reader.md): Copy Link, the mark, Quote selection while
// there is something to quote, Start a topic from this, Add to pipeline, and
// Wide or Stacked; for a Notebook page, Copy Link, Copy Link to Revision N and
// Open as cards (docs/decks.md).
// The message's own acts live here, not in a row under it; on a phone the
// menu opens as a sheet from the bottom.
function openReaderMenu() {
  const p = registry.current, ref = p?.source?.source_ref, button = $('reader-menu'), items = [];
  const message = Boolean(p && !p.sourceUnavailable && ref?.kind === 'message' && topic);
  if (message) items.push({ label: 'Copy Link', act: () => run(() => copyLink(p.source.topic_id, ref.id, button)) });
  if (p && !p.sourceUnavailable && ref?.kind === 'memory' && p.source.owner_scope) {
    items.push({ label: 'Copy Link', act: () => run(() => copyPageLink(p.source, null, button)) },
      { label: `Copy Link to Revision ${ref.revision}`, act: () => run(() => copyPageLink(p.source, ref.revision, button)) },
      { label: 'Open as cards', act: () => run(() => openDestination({ kind: 'cards', id: ref.id }, p.source.title || 'Cards')) });
  }
  const state = message && p.mark ? marks.state(ref.id) : null;
  if (state) items.push({ label: state.marked ? 'Mark read' : 'Mark unread', act: () => run(toggleMark) });
  if (reader.quotable) items.push({ label: 'Quote selection', act: () => reader.quote() });
  if (!$('start-from-message').hidden) items.push({ label: 'Start a topic from this', act: () => openStartLine() });
  if (!$('add-to-pipeline').hidden) items.push({ label: 'Add to pipeline', act: () => (pipelineAddFor === null ? openPipelineAdd() : closePipelineAdd(true)) });
  if (reader.layoutChoice) items.push({ label: reader.layoutChoice, act: () => reader.toggleLayout() });
  openMessageMenu({ anchor: button, items, label: ref?.kind === 'memory' ? 'This page' : 'This message', sheet: true });
}
// The source a page's link names: that revision, or the page as it stands,
// which Core is asked for by name (memory_current).
async function pageSource(page) {
  if (page.revision) return { kind: 'memory', id: page.id, revision: Number(page.revision) };
  return checkedView(await api.view('memory_current', { item_id: page.id }, { readClass: 'foreground' }), bootstrap.instance_id).source_ref;
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
// The New line's "More new below": older pages, one after another, until the
// line's message's card is loaded or no older page is left; then that
// message takes the focus, with the line in its place below it. A read that
// moves nothing on (a refusal, or a review pending) ends it.
async function loadToUnread() {
  const loaded = () => entries($('messages')).find(child => Number(child.dataset.seq) === views.line?.seq);
  while (views.line && !loaded() && views.olderCursor !== null) {
    const before = views.olderCursor, shared = listLoads.has('messages');
    await listPage('messages', true);
    if (!shared && views.olderCursor === before) break;
  }
  const entry = loaded();
  if (entry) opened(reveal(entry)).focus();
}
// Where the oldest unread message is, read again after each commit: reading,
// marks and replies move it without changing the topic. During a visit the
// line follows it only to show more unread; placed afresh (the person's
// explicit Mark read) it goes wherever it is. Settles
// true when it was read, false when it was not, as the marks do.
function loadUnread() {
  if (!views || topicUnavailable) return Promise.resolve(true);
  if (authorityReviewPending()) return Promise.resolve(false);
  const accessEpoch = listAccessEpoch;
  return views.readUnread(async (name, args) => checkedView(await registry.cleanup.list(options => api.view(name, args, options)), bootstrap.instance_id),
    () => accessEpoch === listAccessEpoch && !topicUnavailable && !authorityReviewPending()).catch(() => false);
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
    : state.kind === 'reconnect' ? 'Reconnecting to Theseus. Your writing is kept. '
    : state.message + ' ';
  $('updates-retry').textContent = state.kind === 'reconnect' ? 'Reconnect' : state.kind === 'authority' ? 'Review saved writing' : 'Retry updates';
  $('updates-retry').hidden = state.kind === 'manual';
  // Updates that ran again may be retried after a later refusal.
  if (state.kind === 'current') reconnectRetried = null;
  if (state.kind === 'reconnect') run(reconnect);
}
async function checkAvailability(read, current, topicDenied = true) {
  if (topicDenied) {
    topicUnavailable = true; ++listAccessEpoch;
    for (const id of ['messages', 'notebook', 'topic-people']) $(id).hidden = true;
    $('more-messages').hidden = true; $('topic-title').textContent = 'Topic unavailable'; $('topic-description').textContent = '';
    // No settings for a topic the reader cannot see.
    $('settings-open').hidden = true; settings?.close();
    paintMarks();
    // The rails hide what they show of it too.
    shell.topicChanged();
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
  // The failed composer shows: writing registered before the failure has its button there.
  // A composer that met no Theseus is retried once the page reaches it, as Retry composer would.
  catch (error) { inline.fail(error); paintReview(); owe(error, 'composer', retryInline); return; }
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
      inline.notice(['Could not confirm topic access. Your writing is kept.', error]);
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
    p.source.body = ''; p.source.attachments = []; p.source.title = 'Source unavailable'; p.editors.note.unavailable = true;
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
    p.sourceUnavailable = true; p.source.body = ''; p.source.attachments = []; p.source.title = 'Source unavailable'; revokeMedia(); reader.hideUnavailableSource();
  } else if (wasUnavailable) {
    Object.assign(p.source, source); p.sourceUnavailable = false;
    reader.drawSource(source.body); sourceAttachments(p);
    reader.paintTitle(source); reader.paintOrigin(source);
  }
  p.destinationAvailable = state.destination_available;
  p.editors.reply.unavailable = !state.source_available || !state.destination_available;
  p.editors.note.unavailable = !state.source_available;
  reader.paintStatus();
  } finally {
    // The check is over even when an open was under way as it ended, so Retry
    // access is never left waiting on it.
    if (serial === availabilitySerial) {
      sourcePresentation.availabilityChecking = false;
      if (registry.current?.source === sourcePresentation.source) registry.current.availabilityChecking = false;
    }
    if (sameSource()) { reader.paintStatus(); paintReaderMark(); }
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
      // Writing begun while access was checked keeps the focus.
      if ([null, document.body, $('retry-source')].includes(document.activeElement)) (failed ? $('retry-source') : $('source-body')).focus({ preventScroll: true });
    }
  }
}
function enableFreshness(checkpoint, actorCheckpoint = null) {
  if (!checkpoint) { updateStatus({ kind: 'manual', message: 'Automatic updates need the updated server. Reload this page to see newer messages.' }); return; }
  freshness = new Freshness({ api, bootstrap, topicId: topic.id, checkpoint, actorCheckpoint,
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
      registry.current.neighbors = onPage(p, result);
      $('previous-message').disabled = !registry.current.neighbors.previous; $('next-message').disabled = !registry.current.neighbors.next; return true;
    } });
  registry.cleanup.foregroundListeners.add(() => freshness.interrupt());
  // Each new commit asks for a pass; while the stream is down the timer resumes.
  // Back live, Topic settings asks Core about a save whose answer was lost.
  live?.listen(event => {
    if (event.state === 'live') topicState?.reconnected();
    if (event.kind === 'commit' || event.state === 'live') freshness.request();
    else if (event.state === 'down' || event.state === 'unavailable') freshness.schedule(freshness.delay ?? 500);
  });
  document.addEventListener('visibilitychange', () => freshness.setVisible(document.visibilityState === 'visible'));
  window.addEventListener('online', () => { if (document.visibilityState === 'visible') freshness.request(); topicState?.reconnected(); });
  freshness.setVisible(document.visibilityState === 'visible');
}
// What could not be done for want of Theseus is done again once Theseus has
// answered since the attempt that failed began (api.mjs answeredSince): at
// once when it already has, as when the live feed came back while a read was
// out, or at the next answer of any kind. The attempt made again began after
// that answer, so if it fails too it waits for a newer one. Each is named, so
// the latest of one kind is the one done.
const owed = new Map();
const owe = (error, name, again) => { if (unreached(error)) { owed.set(name, { error, again }); settleOwed(); } };
function settleOwed() {
  for (const [name, { error, again }] of owed) if (answeredSince(error)) { owed.delete(name); run(again); }
}
const unheard = heard(settleOwed);
// The page reaches Theseus with the session it holds: a renewal, the session
// it has confirmed, or the live feed up again. Replies it did not take go on.
function reached() { registry?.resumeHeld(); }
// A restarted server (every deploy) refuses this page's session. The page
// reads the server's new one (session-renewal.mjs) when anything it asks is
// refused for its session (api.mjs refused), its live feed or its updates
// among them, and goes on in place: the writing, the lists and the Reader
// stay, the live feed opens again under the new session (a socket opened
// under the old one can still read live, half-open), waiting saves and held
// replies go out, and stopped updates resume once.
let renewal = null, reconnectRetried = null;
async function reconnect() {
  const result = await renewal?.renew();
  if (!result) return false;
  reached();
  if (result === 'renewed') {
    live?.reopen(); attention?.refresh();
    for (const { editor } of registry?.sessions.values() ?? []) {
      if (editor.dirty && !editor.authorityRecovery && !editor.conflict && !editor.unavailable) registry.schedule(editor);
    }
    // Access a check could not confirm while the session was refused is checked again.
    if (registry?.current?.availabilityUnconfirmed || registry?.inline?.availabilityUnconfirmed) { freshness?.invalidate('availability', 0, true); freshness?.request(); }
  }
  if (updateState?.kind === 'reconnect' && reconnectRetried !== api.token) {
    reconnectRetried = api.token; await freshness?.request({ refresh: true, retry: true });
  }
  return true;
}
let startup = null;
function start() {
  if (!startup) startup = initialize().finally(() => { startup = null; });
  return startup;
}
async function initialize() {
  const token = document.querySelector('meta[name="aim-next-session"]')?.content;
  if (!token || token === '__AIM_SESSION_TOKEN__') throw Error('This page needs a session from the Theseus server.');
  api = new Api(token); api.refused = () => run(reconnect);
  bootstrap = await api.bootstrap();
  if (!bootstrap?.instance_id || !bootstrap.actor || bootstrap.error) throw Error('The instance and reader identity could not be established.');
  // Every page, the phone check among them, takes the restarted server's session in place.
  renewal ??= new SessionRenewal({ api, bootstrap, live: () => live, makeApi: fresh => new Api(fresh),
    adopted: fresh => { document.querySelector('meta[name="aim-next-session"]').content = fresh; } });
  // The phone check is a page of its own: no topic, no live updates (docs/device-evidence.md).
  const asked = parseRoute(new URL(location.href));
  if (asked.kind === 'phone-check') { await phoneCheck({ api, bootstrap, topicId: asked.id }); document.body.dataset.ready = 'true'; return; }
  shareLinksFrom(bootstrap.links?.origin);
  if (liveOffered(bootstrap) && !live) {
    live = new Live({ token });
    live.listen(event => { if (event.kind === 'refused') run(reconnect); else if (event.state === 'live') reached(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') live.wake(); });
    window.addEventListener('online', () => live.wake());
    live.start();
  }
  // Whether the page is connected now is its live feed's state (api.mjs contact).
  follow(live);
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
  if (!healthLight) {
    // The Health link lights on every page while Core says something is red.
    // The live feed says what is red with every commit; a commit that comes
    // without it, the page opening and the page coming back into view read
    // it, and it says it could not check while the feed is down
    // (health-light.mjs).
    healthLight = new HealthLight({ link: $('health-link'), feed: () => live?.state ?? null,
      read: async () => checkedView(await api.view('health_light', {}, { readClass: 'background' }), bootstrap.instance_id) });
    live?.listen(event => run(() => healthLight.heard(event)));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(() => healthLight.load()); });
    run(() => healthLight.load());
  }
  $('instance-label').textContent = `${bootstrap.actor} · ${bootstrap.instance_id}`;
  guide.offer($('instance-label'));
  refreshDirectory();
  document.addEventListener('focusin', event => {
    const list = event.target?.getAttribute?.('list');
    if (list === 'directory-names') refreshDirectory();
    if (list === 'addressable-names') refreshMembers();
  });
  let route = parseRoute(new URL(location.href));
  if (!['topic', 'conversation'].includes(route.kind)) {
    await initializeOutcomePage(route);
    if(['root','workspace'].includes(route.kind))run(()=>initializeUnfinished(route));
    return;
  }
  // An outcome's conversation is its one topic of kind conversation (outcome-conversation.mjs).
  let topicId = route.id;
  // A message's link names the message to open once the page is up (docs/links.md).
  const anchored = route.kind === 'topic' ? route.message ?? null : null;
  // So does a Notebook page's link, the page and perhaps its revision.
  const pageAnchor = route.kind === 'topic' && route.page ? { id: route.page, revision: route.revision ?? null } : null;
  if (anchored || pageAnchor) { route = { kind: 'topic', id: topicId }; shell.rename(route, location.hash); }
  if (route.kind === 'conversation') {
    const found = validate(await api.view('conversation', { workspace_id: route.id })).conversation;
    if (!found) throw Error('This outcome has no conversation yet.');
    topicId = found.topic_id;
  }
  // The reader's agent colors, read alongside the topic so the first cards wear them.
  if (!colors) {
    colors = new AgentColors({ api, instanceId: bootstrap.instance_id, authority: () => registry?.runtime.current ?? bootstrap.authority });
    colors.listen(paintAgentColors);
  }
  const colorsRead = colors.load('foreground').catch(() => {});
  // The saved feed position precedes topic, messages and Notebook startup reads.
  const checkpoint = await initialViews({ api, bootstrap, topicId, load: async () => {} });
  const actorCheckpoint = await actorBaseline({ api, bootstrap });
  views = new TopicViews({ instanceId: bootstrap.instance_id, topicId, reader: bootstrap.actor, paint: paintViews, invalidate: (key, version) => freshness?.invalidate(key, version) });
  const result = validate(await api.view('topic', { topic_id: topicId })); topic = result.topic;
  views.topic = topic; views.participants = result.participants;
  if (topic.id !== topicId) throw Error('The topic identity could not be confirmed.');
  here = { workspaceId: topic.workspace_id, title: topic.workspace_id, view: null, page: topic.kind === 'conversation', has: topic.kind === 'conversation', onlyNew: false, items: new Map() };
  if (here.page) {
    // Every link to the conversation's topic opens it as the conversation, keeping any message anchor.
    route = { kind: 'conversation', id: topic.workspace_id };
    if (new URL(location.href).searchParams.has('topic')) shell.rename(route, location.hash);
    document.body.classList.add('conversation-page');
    // The writing box stays below the messages, as in any topic, and says where the writing goes.
    $('inline-writing-body').placeholder = conversationPlaceholder(here.title);
  }
  paintHeader(topic);
  settings ??= new TopicSettings({ dialog: $('topic-settings'), gear: $('settings-open'), heading: $('settings-title'), close: $('settings-close') });
  try {
    const workspace = validate(await api.view('workspace', { workspace_id: topic.workspace_id })).workspace;
    $('workspace-name').textContent = workspace.title;enableNewTopic(workspace.id);here.title = workspace.title;
    here.has ||= hasConversation(workspace);
    if (here.page) $('inline-writing-body').placeholder = conversationPlaceholder(workspace.title);
  } catch { $('workspace-name').textContent = topic.workspace_id; }
  // Those who can be added: the outcome's team, or everyone when the team cannot be read.
  participantsPanel = new PeoplePanel({ host: $('participants'), label: 'Add someone to this topic',
    candidates: () => outcomeMembers ? outcomeMembers.filter(person => person.enabled !== false).map(person => ({ id: person.actor_id, name: person.name, kind: person.kind })) : directoryPeople,
    opened: () => { refreshMembers(); refreshDirectory(); },
    add: id => setParticipation(id, true), remove: id => setParticipation(id, false), named: participantName, light: wakeLight, pill: participantPill,
    read: async () => (await readTopic()).participants });
  await wakeLights.load();
  // Who can be sent a message here: the topic's participants and the outcome's
  // members. A reader outside the outcome cannot list its members.
  outcomeMembers = await readMembers(api, bootstrap.instance_id, topic.workspace_id).catch(() => null);
  paintParticipants(topic, result.participants);
  // The topic as the topic view gives it, read once after a change that was not confirmed.
  const readTopic = async () => validate(await registry.cleanup.list(options => api.view('topic', { topic_id: topicId }, options)));
  topicState = new TopicStatePanel({ host: $('topic-state'), reader: bootstrap.actor, refresh: () => freshness?.request(), painted: paintHeader, read: readTopic,
    // Words not saved are shown, in Topic settings, even when leaving it was what saved them.
    attention: () => { if (!$('topic-settings').open) settings.open(); },
    // Each save names its operation: sent again, it is the same command, and Core answers what it holds for it.
    send: (current, args, fields, operation_id) => {
      const { authority_id, authority_epoch } = bootstrap.authority;
      return api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id, kind: 'topic.update',
        target: { topic_id: current.id }, expected: { topic_fields: fields, authority: { authority_id, authority_epoch } }, args });
    },
    sendNote: (current, note, revision, operation_id) => {
      const { authority_id, authority_epoch } = bootstrap.authority;
      return api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id, kind: 'responsibility.set',
        target: { topic_id: current.id }, expected: { responsibility_revision: revision, authority: { authority_id, authority_epoch } }, args: { note } });
    } });
  topicState.paint(topic, result.participants);
  // The outcome's target, one closed line above the conversation (D10).
  paintTopicTarget($('topic-target'), result.outcome_target ?? null, event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); return openDestination({ kind: 'workspace', id: topic.workspace_id }, result.outcome_target.workspace_title);
  });
  // Keep startup retry read-only: no editor or clickable source exists until
  // both initial list bodies have arrived after the captured feed baseline.
  const messageAnswer = checkedView(await api.view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 30 }), bootstrap.instance_id);
  const memoryAnswer = checkedView(await api.view('memory_items', { owner_scope: views.scope, limit: 20 }), bootstrap.instance_id);
  await colorsRead;
  journal = await openJournal({ instanceId: bootstrap.instance_id, actor: bootstrap.actor });
  // The images #img offers (topic_images, docs/conversation.md), and one image's
  // verified bytes, read through the message that carries it.
  const topicImages = async editor => checkedView(await registry.cleanup.list(options => api.view('topic_images', { topic_id: editor.context.topicId }, options)), bootstrap.instance_id);
  const imageBytes = async item => (await api.media(bootstrap.instance_id, item.attachment, item.source_ref)).blob;
  inline = new InlineComposer({
    images: topicImages, imageBytes,
    admits: (p, editor) => registry?.isCurrent(p, editor),
    reach: recipientReach, addressable: addressPeople,
    uploads: editor => registry.sessionFor(editor).uploads,
    edit: (editor, p) => run(() => { if (registry.isCurrent(p, editor)) return registry.edited(editor); }),
    status: editor => registry.status(editor), sign: editor => registry.saveSign(editor).state, savedAt: editor => registry.savedTime(editor), needsReview,
    send: (editor, p) => registry.send(editor, { presentation: p, stay: true }),
    review: (editor, p, opener) => run(() => showVersions(editor, opener, p)),
    renderPending: () => paintReview(),
    retry: () => run(retryInline),
    people: whisperPeople,
    conversation: () => Boolean(here?.page),
    recipientsPainted: names => { if (here?.page || answering.size) answeredBy(inline, $('inline-composer').querySelector('.audience'), names, Boolean(here?.page)); },
  });
  reader = new Reader({
    images: topicImages, imageBytes,
    admits: (p, editor) => registry?.isCurrent(p, editor),
    writes: (p, editor) => registry?.isWritable(p, editor),
    closing: p => registry?.isClosing(p),
    reach: recipientReach, addressable: addressPeople,
    revisionOffer,
    retrySource: () => run(retrySource),
    uploads: editor => registry?.sessionFor(editor).uploads,
    edit: editor => run(() => { if (registry.isWritable(reader.presentation, editor)) return registry.edited(editor); }), status: editor => registry.status(editor),
    sign: editor => registry.saveSign(editor).state, savedAt: editor => registry.savedTime(editor),
    mode: mode => {
      const cancelled = Boolean(registry.pendingOpen);
      reader.presentation = registry.setMode(mode); changed(reader.editor); retainRevisionTargets();
      if (cancelled) reader.notice('Stayed on this message; opening the other message was cancelled.');
    },
    // A note that could not be saved says so in the Reader, beside its writing.
    saveNote: editor => registry.saveNote(editor).catch(error => { reader.notice(error); return null; }),
    send: (editor, options) => registry.send(editor, { ...options, presentation: reader.presentation }),
    close: () => registry.close(reader.presentation, { explicit: true }).catch(error => { reader.notice(error); return false; }),
    step: async direction => {
      const presentation = registry.current, neighbors = onPage(presentation, presentation.neighbors ?? await registry.neighbors(presentation));
      if (!registry.isCurrent(presentation)) return;
      const ref = direction < 0 ? neighbors?.previous : neighbors?.next;
      if (ref) await openSource(ref, presentation.opener);
    },
    destination: value => run(() => switchDestination(value)),
    destinations: (host, source, topicId) => offerConversation(host, source, topicId),
    place: topicId => conversationPlace(topicId),
    audiencePainted: topicId => paintReaderAudience(topicId),
    recipientsPainted: (names, topicId) => paintReaderAudience(topicId, names),
    reconcile: editor => run(() => registry.checkConfirmation(editor)),
    renderPending: () => paintReview(),
    recover: (editor, item) => run(() => showCorrection(editor, item, document.activeElement, reader.presentation)),
    error: error => reader.notice(error),
    paneClass: source => paneClass(source, bootstrap.actor, agentShown),
    people: whisperPeople, actor: () => bootstrap.actor,
  });
  // The Reader's ⋯ offers Wide or Stacked only where the window can choose, so
  // a window that crosses a phone's width shows or hides it again.
  reader.narrow.addEventListener('change', paintReaderMark);
  registry = new EditorRegistry({ api, bootstrap, journal, present: presentation => run(() => present(presentation)), changed,
    activity: () => { inline.paintStatus(); reader.paintStatus(); },
    closed: presentation => { if (reader.presentation === presentation) { reader.finishClose?.(); revokeMedia(); views.retain(null, null); } noteRead(); } });
  registry.cleanup.resumeListeners.add(rechecked);
  // After any recorded answer to a mark, this page shows what Core now holds,
  // with or without the live stream.
  marks = new Marks({ api, instanceId: bootstrap.instance_id, authority: () => registry.runtime.current, cancelOpen: () => registry.cancelOpen(),
    recorded: () => { attention?.refresh(); if (commitReload) run(commitReload); } });
  marks.listen(paintMarks);
  reactions = new Reactions({ api, instanceId: bootstrap.instance_id, authority: () => registry.runtime.current,
    learned: answer => {
      const source = registry.current?.source;
      if (source?.source_ref?.id === answer.message_id) Object.assign(source, { reactions: answer.reactions, go_ahead: answer.go_ahead });
      if (learnReactions(views.messages, answer)) paintViews('reactions'); else paintReaderThumb$();
    },
    // A 👍 or an answer that cleared the person's mark on its message: the card, its pill and the marks line read so at once.
    cleared: result => marks.learn(result.message_id, result.mark_revision, { topicId: result.topic_id, seq: result.seq }),
    recorded: () => { attention?.refresh(); if (commitReload) run(commitReload); } });
  const cardScroll = new CardScroll({ read: async id => checkedView(await api.view('source', { source_ref: { kind: 'message', id } }, { readClass: 'background' }), bootstrap.instance_id) });
  const act = work => run(async () => { try { await work; } finally { paintViews('reactions'); } });
  // A thumbs-up reads its message in Core (docs/thumbs.md). One that read it
  // (Core settled the person's delivery of it, or cleared their mark on it)
  // places the New line afresh, as Mark read does, wherever the oldest unread
  // message now is; one on a message already read moves nothing.
  const thumbMessage = async (item, on) => {
    const receipt = await reactions.thumb(item, on);
    if (receipt?.result?.settled === true && receipt.result.topic_id === views?.topicId) { views.placeAfresh(); if (commitReload) run(commitReload); }
    return receipt;
  };
  // ⌘C on a lit message: its words as written, the words the Reader's ⇧⌘C
  // copies; a cut-off card's whole message, read from its source (lighting it
  // reads it, so it is usually here already). Nothing is said when it is
  // copied, as in the Reader; a refusal says how else to copy.
  const copyMessage = item => {
    const known = item.preview ? cardScroll.known(item.id) : item.body;
    const copied = known !== undefined ? copyText(known) : cardScroll.whole(item.id).then(body => copyText(body), () => false);
    copied.then(done => { if (!done) status(COPY_REFUSED); });
  };
  menu = new MessageMenu({ host: $('messages'), item: id => views.messages.get(id), viewer: bootstrap.actor, kind: bootstrap.actor_kind,
    reply: (id, card) => run(() => replyMessage(id, card)),
    // A thumbs-up on a reply deals with its stack up to it (stack-feed.mjs).
    thumb: (item, on) => act(thumbMessage(item, on).then(receipt => { if (on && receipt) stackFeed?.thumbed(item); return receipt; })), answer: (item, answer) => act(reactions.answer(item, answer)),
    more: openMessageMore, copy: copyMessage,
    expand: (card, item) => cardScroll.expand(card, item) });
  // The Reader's 👍 is a reply of one thumb, whether the reply is its quiet
  // line or being written: once Core holds it the Reader closes, as after
  // Send, keeping what the reply holds. Refused, or taken back, it stays.
  $('thumb-source').onclick = () => {
    const item = readerItem(), presentation = registry.current;
    if (!item) return;
    const on = !item.reactions?.thumbs?.some(thumb => thumb.actor_id === bootstrap.actor);
    run(async () => {
      try {
        const receipt = await thumbMessage(item, on);
        if (on && receipt && registry.isCurrent(presentation)) await registry.close(presentation);
      } catch (error) { reader.notice(error); } finally { paintReaderThumb$(); }
    });
  };
  pageReads = new PageReads({ recorded: () => { if (commitReload) run(commitReload); }, send: (id, revision) => {
    const { authority_id, authority_epoch } = registry.runtime.current;
    return api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'memory.read',
      target: { item_id: id }, expected: { authority: { authority_id, authority_epoch } }, args: { revision } });
  } });
  $('mark-unread').onclick = () => run(toggleMark);
  $('add-to-pipeline').onclick = () => (pipelineAddFor === null ? openPipelineAdd() : closePipelineAdd(true));
  $('reader-menu').onclick = () => openReaderMenu();
  $('messages').addEventListener('contextmenu', messageContextMenu);
  $('start-from-message').setAttribute('aria-expanded', 'false');
  $('start-from-message').onclick = () => openStartLine();
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
  // Back on the page, a stack dealt with folds, where it is not in front of the person.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') stackFeed?.cameBack(inView); });
  window.addEventListener('focus', noteRead);
  document.addEventListener('visibilitychange', notePageRead);
  window.addEventListener('focus', notePageRead);
  topicNavigation = new TopicNavigation({ registry, current: route, review: paintReview,
    navigateTarget: target => { marks.leave(); if (!shell.go(target)) shell.leave(routeHref(target)); } });
  await initializeInlineComposer();
  // The conversation has its own row, never one among the topics.
  topicRail = new TopicRail({ reader: bootstrap.actor, pageMax: pageMax(), pages: new TopicPages(bootstrap.instance_id, topic.workspace_id, here.page ? null : topic),
    host: $('topics'), more: $('more-topics'), retry: $('retry-topics'), message: $('topics-status'), key: $('topics-key'), ...topicFolds(),
    denied: error => readFailure(error).kind === 'forbidden',
    read: async args => {
      if (authorityReviewPending()) throw Error('The runtime changed. Review saved writing before reloading.');
      const answer = checkedView(await registry.cleanup.list(options => api.view('workspace_topics', args, options)), bootstrap.instance_id);
      if (registry.disposed || authorityReviewPending()) throw Error('The runtime changed. Reload after reviewing saved writing.');
      return answer;
    },
    open: (id, title) => openDestination({kind:'topic',id},title),
    // Read once: the outline takes this list in from then on (outline-rail.mjs).
    updated: () => { $('topic-navigation').dataset.listed = ''; },
  });
  outcomeReferences = new OutcomeReferences({ scope: topic.workspace_id, host: $('outcome-references'),
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
  // The rail shows only this topic's outcome. A message's Add to pipeline
  // follows the Pipeline row's read.
  const pipeline = pipelineSection(topic.workspace_id, false, paintReaderMark); pipelineRow = pipeline.row;
  // The latest read of the outcome's conversation; the page waits on its first
  // (below).
  let conversationRead = null;
  outcomeScope = new OutcomeScope({ workspaceId: topic.workspace_id, kind: 'topic', rail: document.querySelector('.rail'), home: $('outcomes-home'),
    attention, open: openDestination, sections: [{ name: 'conversation', node: $('conversation-navigation'), load: () => (conversationRead = loadConversation()) }, pipeline,
      { name: 'topics', node: $('topic-navigation'), load: () => topicRail.load() },
      { name: 'notebook', node: $('outcome-references'), load: () => outcomeReferences.load() }] });
  placeBrand(document.querySelector('.rail'));
  outcomeScope.load();
  const conversationShown = conversationRead;
  // The open topic's marks are the person's own, read by the person's scope
  // and paged; the open Reader's button follows them. The New line follows
  // what the person has read, here or anywhere else. The topic's own Notebook
  // pages' read state is read again too, so a page read since, here or
  // elsewhere, loses its light.
  commitReload = followCommits(async () => {
    const sections = await outcomeScope.load(), marked = await loadMarks(), unread = await loadUnread(), read = await loadReadState();
    await wakeLights.load(); participantsPanel?.paint();
    return sections !== false && marked !== false && unread !== false && read !== false;
  });
  $('review-versions').onclick = () => run(() => showVersions(reader.editor, $('review-versions'), reader.presentation));
  $('updates-retry').onclick = () => run(async () => {
    if (updateState?.kind === 'reconnect') {
      reconnectRetried = null;
      if (!await reconnect()) throw notAnswering();
      return;
    }
    if (updateState?.kind === 'authority') { const p = registry.interactive; if (p) await showVersions(p.editors[p.mode], $('updates-retry'), p); return; }
    if (registry.current?.sourceUnavailable || registry.current?.availabilityUnconfirmed || registry.inline?.editors.reply.unavailable || updateState?.kind === 'forbidden') freshness?.invalidate('availability', 0, true);
    await freshness?.request({ refresh: true, retry: true });
  });
  wakeOnPress($('messages'));
  $('more-messages').onclick = () => run(() => listPage('messages', true)); $('more-memory').onclick = () => run(() => listPage('memory', true));
  window.addEventListener('beforeunload', () => marks.leave());
  shell.guard(() => registry.hasUnprotectedWriting);
  window.addEventListener('pagehide', () => { freshness?.dispose(); registry.dispose(); journal.close(); revokeMedia(); });
  views.messagesPage(messageAnswer, { initial: true }); views.memoryPage(memoryAnswer, { initial: true });
  // What is drawn above the messages after they paint, in their column: the
  // marks line ("1 marked unread · Read it") and, on a conversation page, its
  // Show row and header, which land with the conversation's first read. The
  // outcome rail never is: it sits beside the topic, or on a phone in the
  // drawer behind "☰ Topics" (rail-drawer.mjs). Cards count as seen once each
  // has had its first answer, read or refused (noteRead), so neither moves a
  // card the page has already counted.
  Promise.allSettled([run(loadMarks), here.page ? conversationShown : null]).then(() => { laidOut = true; noteRead(); });
  document.body.dataset.ready = 'true'; enableFreshness(checkpoint, actorCheckpoint);
  // The rails beside the page read through this run from now on (rails.mjs).
  shell.ready({ api, bootstrap, live, workspaceId: topic.workspace_id, workspaceTitle: $('workspace-name').textContent, topic, pageMax: pageMax(),
    view: async (name, args, readClass = 'background') => checkedView(await api.view(name, args, { readClass }), bootstrap.instance_id),
    open: (target, title, from) => openDestination(target, title, from), readable: () => !topicUnavailable && !freshness?.stopped, currentTopic: () => topic,
    // The rail's Starred takes a star off (stack-feed.mjs).
    unstar: star => stackFeed?.unstar(star) });
  // A message's link opens its topic, or its outcome's conversation, with that
  // message in the Reader; the address then names the page alone, as any does.
  if (anchored) {
    const card = landOn(anchored);
    run(() => openSource({ kind: 'message', id: anchored }, card ?? $('main')));
  }
  // A Notebook page's link opens the page in the Reader, as its card or row does.
  if (pageAnchor) run(async () => openSource(await pageSource(pageAnchor), $('main')));
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
    if (receipt?.status !== 'committed') status(receipt?.error ?? 'Marking it read was not confirmed.');
  } finally {
    // Whether or not the answer arrived, the list shows what Core now holds.
    await attention.refresh();
  }
}
// A failed attempt says so where the page reports, like every other button.
const markSent = item => run(() => acknowledgeSent(item));
// The topic's participants, which whoever organises its outcome and its creator
// may change, and the names the composer offers.
function paintParticipants(current, participants) {
  participantsPanel?.paint(participants, managesTopic(current, bootstrap.actor));
  // The team's entries come first: they carry names, which participants do not.
  // A disabled person cannot be sent to, so they are not offered.
  fillNames($('addressable-names'), [...outcomeMembers ?? [], ...participants].filter(person => person.enabled !== false)
    .map(person => ({ id: person.actor_id, name: person.name, kind: person.kind })));
  // Who may be addressed changed: the composers' recipient chips say so again.
  if (reader?.sessions) reader.paintRecipients();
  if (inline?.editor) inline.paintRecipients();
}
// The topic's people a message can be to, as names tapped once: everyone in it but the reader.
function addressPeople() {
  return (views?.participants ?? []).filter(person => person.enabled !== false && person.actor_id !== bootstrap.actor).map(person => person.actor_id);
}
// Whether a message to name would reach them: they must be able to see the
// topic. Unknown when the outcome's team could not be read.
function recipientReach(name) {
  if (!topic || !views?.participants) return null;
  const manage = managesTopic(topic, bootstrap.actor);
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
let directoryRead = null, directoryPeople = [];
function refreshDirectory() {
  directoryRead ??= readDirectory(api, bootstrap.instance_id).then(({ items }) => {
    fillNames($('directory-names'), items);
    directoryPeople = items.map(item => ({ id: item.id, name: item.name, kind: item.kind }));
    teamPanel?.paintChoices(); participantsPanel?.paintChoices();
  })
    .catch(() => {}).finally(() => { directoryRead = null; });
  return directoryRead;
}
// A visible page reloads its lists after each commit and when shown again; a
// hidden one waits, as its reads do. load() settles false, or fails, when a
// list could not be read, and only then does the stream's return read again:
// anything saved while the stream was down changes its first number, which
// arrives as a commit, so a feed that keeps reconnecting rereads nothing.
// Returns the page's one reload, which its first read goes through as well;
// the page calls this before its first read, so a commit while that read is
// out is read after it.
function followCommits(load) {
  let owed = false;
  const reload = reloader(async () => { owed = true; owed = await load() === false; });
  if (live) {
    live.listen(event => { if ((event.kind === 'commit' || event.state === 'live' && owed) && document.visibilityState === 'visible') run(reload); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(reload); });
  }
  return reload;
}
// The outcome's conversation: read on every commit, as the rails are, so a
// take, an answer or a wait shows without a reload. A read that fails keeps
// what was painted and says so to the commit follower, which reads again.
async function loadConversation() {
  if (!here) return true;
  // An outcome that has its conversation (its workspace read says so) has its
  // row stand in its place from the start, so the topics and the page below it
  // do not move when its read lands; one that has none never draws it.
  if (!here.read && here.has) paintConversationNav();
  try {
    const answer = checkedView(await api.view('conversation', { workspace_id: here.workspaceId }, { readClass: 'background' }), bootstrap.instance_id);
    here.view = answer.conversation; here.read = true;
    paintConversationNav();
    if (here.page && here.view) {
      const page = checkedView(await api.view('topic_messages', { topic_id: here.view.topic_id, direction: 'before', limit: 100 }, { readClass: 'background' }),
        bootstrap.instance_id);
      for (const item of page.items) here.items.set(item.id, item);
      if (topic) paintHeader(topic);
      paintConversationPage();
    }
    return true;
  } catch {
    return false;
  }
}
// Whether an outcome has its conversation, as its workspace read says.
const hasConversation = workspace => typeof workspace?.conversation_id === 'string';
function paintConversationNav() {
  const target = { kind: 'conversation', id: here.workspaceId };
  const shown = paintConversationRow($('conversation-row'), { view: here.view ?? (here.read || !here.has ? null : {}), title: here.title, reader: bootstrap.actor, current: here.page,
    href: routeHref(target), open: () => openDestination(target, CONVERSATION_TITLE) });
  $('conversation-navigation').hidden = !shown;
}
const openLinked = (kind, id) => kind === 'topic' ? run(() => openDestination({ kind: 'topic', id }, 'Topic')) : goToMessage(id);
function paintConversationPage() {
  const view = here.view;
  if (!view) return;
  paintOnlyNew($('conversation-show'), { view, onlyNew: here.onlyNew, show: value => { here.onlyNew = value; paintConversationPage(); } });
  // The coordinator is known once the view is read: the writing box's "Answered by" row names them.
  if (inline?.editor) answeredBy(inline, $('inline-composer').querySelector('.audience'), inline.editor.draft.addressees, true);
  $('messages').classList.toggle('only-new', here.onlyNew);
  const empty = !views?.messages?.size;
  $('conversation-empty').hidden = !empty;
  if (empty) paintEmpty($('conversation-empty'), { view });
  // What the conversation's read says can keep a reply in view in its stack.
  if (views?.messages) stackMessages();
  for (const entry of entries($('messages'))) {
    const card = cardIn(entry), id = card?.dataset?.id, item = id ? conversationItem(id) : null;
    if (!item) continue;
    entry.dataset.item = item.item?.state ?? 'none';
    // Only new is its own view: a read New item can be folded in the stack.
    if (here.onlyNew && entry.dataset.item === 'new') entry.hidden = false;
    paintAbout(card, item, bootstrap.actor, openLinked);
    paintItemTags(card, item, view.waits, bootstrap.actor, openLinked);
    const author = card.querySelector('.message-author');
    if (author) paintAsksYou(author, item, view.waits, bootstrap.actor);
  }
}
// "Answered by [fable] [warp] [aim-ux] [Someone else]": the team's names tapped
// once (outcome-conversation.mjs), and a narrow field that names anyone else
// on Return. Naming someone addresses the message to them; with nobody named
// the coordinator answers. Off, the row is the plain Address row again.
const answering = new Set();
function answeredBy(composer, audience, names, on) {
  // Off, a row that was never turned on is already the plain Address row.
  if (!on && !answering.delete(audience)) return;
  if (on) answering.add(audience);
  // The row's label is the who panel's To (index.html), which it renames.
  // The topic's people and the name field are the naming sheet's (index.html).
  const label = audience.closest('.who-row').querySelector(':scope > .who-label'), input = audience.querySelector('.name-filter');
  const chips = audience.querySelector('.chips');
  if (!label.dataset.words) label.dataset.words = label.textContent;
  label.textContent = on ? 'Answered by' : label.dataset.words;
  input.placeholder = on ? 'Someone else' : 'Add a name';
  audience.classList.toggle('answered-by', on);
  let choices = audience.querySelector('.answerer-chips');
  if (!choices) {
    choices = document.createElement('span'); choices.className = 'answerer-chips'; choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', 'Who answers'); chips.parentElement.insertBefore(choices, chips);
  }
  choices.hidden = !on;
  const team = (outcomeMembers ?? []).filter(person => person.enabled !== false).map(person => person.actor_id);
  // The names wait for the conversation's view, which says who the coordinator is.
  const shown = on && here?.view ? paintAnswerers(choices, { coordinator: here.view.coordinator?.actor_id, members: team, names, reader: bootstrap.actor,
    toggle: (id, add) => add ? composer.addName(id) : composer.removeName(id) }) : [];
  if (!shown.length) choices.replaceChildren();
  // A team member named here shows as their pressed chip, not twice.
  for (const chip of chips.children) chip.hidden = shown.includes(chip.dataset.name);
}
// The Reader's To row: a message in an ordinary topic of this outcome may go to its conversation.
function offerConversation(host, source, topicId) {
  if (!here?.view || here.page || source.source_ref.kind !== 'message' || source.whisper || source.topic_id !== topic?.id) return false;
  conversationDestination(host, { topic, conversation: here.view.topic_id, outcome: here.title, chosen: topicId });
  return true;
}
// The outcome's conversation, when a reply's topic is it: the words for
// where the reply goes, and the line saying what going there means. The
// Reader says them wherever writing goes there from another topic.
function conversationPlace(topicId) {
  return here?.view && topicId === here.view.topic_id ? { name: CONVERSATION_PLACE, note: CONVERSATION_NOTE(here.view.coordinator?.actor_id) } : null;
}
function paintReaderAudience(topicId, names = null) {
  const on = Boolean(here?.view && !here.page && topicId === here.view.topic_id);
  if (reader?.sessions && (on || answering.size)) answeredBy(reader, $('reply-audience'), names ?? reader.names(), on);
}
// Switching the Reader between this topic and the conversation opens the same
// message with the other destination. The writing moves there only when that
// draft is empty; two drafts are never merged, and writing that stays is said
// in one line (switchWriting). Images cannot be chosen while the other place
// opens (an open stops them), and words typed meanwhile are read after it, so
// they move too.
async function switchDestination(value) {
  const p = registry.current, ref = p?.source?.source_ref;
  if (!ref || ref.kind !== 'message' || value === p.editors.reply.context.topicId) return;
  if (![topic.id, here?.view?.topic_id].includes(value)) { reader.notice('Choose this topic or the outcome\'s conversation.'); return; }
  const left = p.editors.reply, place = left.context.topicId === topic.id ? 'This topic' : 'the conversation';
  const shown = { kindOf: reader.kindOf, conversation: reader.toConversation(left) };
  const next = await registry.open(ref, { topicId: value, opener: p.opener });
  if (!next) return;
  const keep = editor => { if (reader.editor === editor) reader.drawEditor(); return registry.edited(editor); };
  if (await switchWriting(left, next.editors.reply, keep, shown)) reader.notice(`Your writing for ${place} is kept there.`);
}
// The Done and Archived lines under the topic list, where the person's choice
// to keep each open is remembered, and the area the lists keep still under.
function topicFolds() {
  let storage = null;
  try { storage = window.localStorage; } catch { /* each line starts closed */ }
  const fold = name => ({ details: $(`${name}-topics`), label: $(`${name}-topics-label`), host: $(`${name}-topic-list`), more: $(`more-${name}-topics`) });
  return { done: fold('done'), archived: fold('archived'), storage, area: $('topic-navigation') };
}
// Rows a reload may ask for at once, from the server's own limits.
const pageMax = () => Number.isSafeInteger(bootstrap.limits?.page_max) ? bootstrap.limits.page_max : undefined;
// A link in a message's words to one of this Theseus's places opens it here.
openLinksWith((target, title, link) => openDestination(target, title, link));
// A topic's name for a link in a message's words: the open topic's, a listed
// topic's, or else one read of the topic, kept for the page. A topic the
// reader may not see stays unnamed; a read that failed is tried again the
// next time a message names it.
const topicNames = new Map();
function topicName(id) {
  if (topic?.id === id) return topic.title || null;
  const listed = topicRail?.title(id);
  if (listed && listed !== id) return listed;
  if (!api || !bootstrap) return null;
  if (!topicNames.has(id)) {
    topicNames.set(id, api.view('topic', { topic_id: id }, { readClass: 'background' }).then(answer => {
      const found = checkedView(answer, bootstrap.instance_id).topic;
      return found?.id === id && typeof found.title === 'string' && found.title ? found.title : null;
    }).catch(error => { if (readFailure(error).kind !== 'forbidden') topicNames.delete(id); return null; }));
  }
  return topicNames.get(id);
}
nameTopicsWith(topicName);
// from: the link pressed, which takes the focus back when the Reader closes.
async function openDestination(target, title, from = null) {
  // A link to a message in the open topic opens it in the Reader, here.
  if (target.kind === 'topic' && target.message && topic && views && target.id === topic.id) {
    // A message the page shows is landed on first, its stack opened; the
    // rail's Starred lands on it and opens nothing more.
    const card = landOn(target.message, { full: target.land === true });
    if (card && target.land) { card.focus({ preventScroll: true }); return; }
    // From the Reader's own text, closing gives the focus to what opened the Reader.
    const opener = from?.closest?.('dialog') ? registry.current?.opener : from;
    return run(() => openSource({ kind: 'message', id: target.message }, opener?.isConnected ? opener : document.activeElement));
  }
  // A link to a Notebook page this page can show opens it here: in the Reader
  // when it is the open topic's or its outcome's, in place on its outcome's page.
  if (target.page) {
    const page = { id: target.page, revision: target.revision ?? null };
    if (topic && views && (target.kind === 'topic' ? target.id === topic.id : target.id === topic.workspace_id)) {
      const opener = from?.closest?.('dialog') ? registry.current?.opener : from;
      return run(async () => openSource(await pageSource(page), opener?.isConnected ? opener : document.activeElement));
    }
    if (!topic && pageHere && target.kind === 'workspace' && target.id === pageHereOutcome) {
      return run(async () => pageHere.open(await pageSource(page), from?.isConnected ? from : document.activeElement));
    }
  }
  // A page whose start failed has no navigation; leave it for the destination.
  if (!topicNavigation) { shell.leave(routeHref(target)); return; }
  const notice=$('topic-navigation-status');showLine(notice,'');
  const pending=topicNavigation.openTarget(target,title),serial=topicNavigation.serial;
  // A press on a rail row whose move went nowhere (the place being read, or a
  // move the guard refused) leaves the row no focus to ring (in-place-navigation.mjs).
  try { const moved = await pending; if (!moved) shell.stayed(); return moved; }
  catch(error) {
    if(serial!==topicNavigation.serial)return;
    shell.stayed();
    showLine(notice,error);
    // Said where the person is looking: the Reader or the New message sheet,
    // open over the page, covers the rail's notice, so it says why it stayed too.
    const near=$('reader').open?'reader-notice':$('new-message-sheet').open?'inline-notice':null;
    if(near)showLine($(near),error);else notice.scrollIntoView({block:'nearest'});
  }
}
// painted hears the outcome rows after each read (the outcome page's "Also waiting on you" line).
function initializeOutcomeNavigation(current=null,painted=()=>{}) {
  const home=event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();return openDestination({kind:'root'},'Outcomes');
  };
  $('outcomes-home').onclick=home;document.querySelector('.wordmark').onclick=home;
  // New outcome is one title line under the heading: Return creates it and opens its page.
  $('new-outcome').disabled=false;
  const outcomes=new OutcomeStart({api,bootstrap});
  const line=new OneLine({id:'new-outcome-title',label:'Title of the new outcome',placeholder:'New outcome title',className:'rail-line',
    submit:async title=>{const id=await outcomes.create(title);line.input.value='';close();await openDestination({kind:'workspace',id},title);}});
  const close=lineFromButton({button:$('new-outcome'),after:$('new-outcome').closest('.rail-heading'),line});
  const read=async args=>{
    if(registry&&authorityReviewPending())throw Error('The runtime changed. Review saved writing before reloading.');
    const answer=checkedView(await (registry ? registry.cleanup.list(options=>api.view('workspaces',args,options)) : api.view('workspaces',args,{readClass:'foreground'})),bootstrap.instance_id);
    if(registry&&(registry.disposed||authorityReviewPending()))throw Error('The runtime changed. Review saved writing before reloading.');
    return answer;
  };
  // What a row's light is made of, read when its peek opens (item 86).
  const peek=new LightPeek({host:$('light-tip'),read:async id=>checkedView(await api.view('outcome_light',{workspace_id:id},{readClass:'foreground'}),bootstrap.instance_id)});
  outcomeRail=new OutcomeRail({instanceId:bootstrap.instance_id,current,host:$('workspaces'),more:$('more-workspaces'),
    retry:$('retry-workspaces'),message:$('outcomes-status'),empty:$('outcomes-empty'),read,open:openDestination,
    denied:error=>readFailure(error).kind==='forbidden',pageMax:pageMax(),peek,painted});
}
async function initializeOutcomePage(route) {
  // There is no topic, implicit composer or source in a selection-only view.
  if(route.kind==='create')return initializeCreationPage(route);
  if(route.kind==='opening')return initializeOpeningPage(route);
  if(route.kind==='pipeline'||route.kind==='item')return initializePipelinePage(route);
  if(route.kind==='health')return initializeHealthPage();
  if(route.kind==='measurements')return initializeMeasurementsPage(route);
  if(route.kind==='cards')return initializeDeckPage(route);
  if(!['root','workspace'].includes(route.kind))throw Error('This opening link is not available yet. Open Outcomes to choose a place.');
  // A Notebook page's link opens the page in place once the outcome's lists are
  // up; the address then names the outcome alone, as a message's link does.
  const shown=route.page?{id:route.page,revision:route.revision??null}:null;
  if(shown){route={kind:'workspace',id:route.id};history.replaceState(history.state,'',routeHref(route)+location.hash);}
  status('');
  for(const id of ['notebook','topic-people','messages','topic-pending','inline-composer'])$(id).hidden=true;
  $('outcome-page').hidden=false;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>shell.leave(routeHref(target))});
  sentHost=$('sent-to-you');
  if(attention?.last)paintSent(sentHost,attention.last,{open:openSent,acknowledge:markSent,read:readSent,attachment:sentAttachment});
  if(route.kind==='root') {
    // What waits on the reader, every outcome's, heads the Outcomes home only (item 86):
    // an outcome's own page says its questions once, in "Where it stands".
    waitingHost=$('waiting-on-you');
    if(attention?.last)paintWaiting(waitingHost,attention.last,(id,title)=>openDestination({kind:'topic',id},title));
    $('topic-title').textContent='Outcomes';$('topic-description').textContent='Choose an outcome to see its topics.';
    $('outcomes-heading').textContent='Your outcomes';
    $('outcome-page').append($('outcome-navigation'));document.querySelector('.rail').hidden=true;
    initializeOutcomeNavigation();
    // The page an owner lands on says when wakes are not going out.
    // With no rail, the logo block heads the main column.
    placeBrand($('main'));
    const reload=followCommits(async()=>{const loaded=await outcomeRail.load();await wakeLights.load();return loaded;});
    await reload();
  } else {
    // Other outcomes' questions in one quiet line, or why the list they are read
    // from could not be read and Retry, then where this outcome stands, its target
    // and checks, the pipeline line, the improvement loop and the problems found
    // (D11), then its conversation's one row (outcome-conversation.mjs), then its topics;
    // its Notebook pages are listed after them, and one opens in place below them.
    $('outcome-page').append($('also-waiting'),$('outcomes-status'),$('retry-workspaces'),$('outcome-standing'),$('target-panel'),$('pipeline-line'),$('loop-panel'),$('problems-panel'),$('conversation-navigation'),$('topic-navigation'),$('outcome-references'),$('page-here'));
    const targets=new OutcomeTargets({hosts:{target:$('target-panel'),loop:$('loop-panel'),problems:$('problems-panel')},workspace:route.id,reader:bootstrap.actor,read:pipelineView,send:pipelineSend});
    // The page lists the outcome's topics and pages itself, so it has no rail:
    // the logo block, then "← Outcomes", head the main column.
    const rail=document.querySelector('.rail');rail.hidden=true;
    here={workspaceId:route.id,title:route.id,view:null,page:false,onlyNew:false,items:new Map()};
    $('main').prepend($('outcomes-home'));placeBrand($('main'));
    const scope=outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'workspace',rail,home:$('outcomes-home'),attention,open:openDestination});
    // The list of outcomes is read, not shown, for the line naming other outcomes' questions;
    // "← Outcomes" says its words when that line names fewer outcomes than its light counts.
    initializeOutcomeNavigation(route.id,items=>scope.alsoNamed(paintAlsoWaiting($('also-waiting'),items,route.id,(id,title)=>openDestination({kind:'workspace',id},title))));
    // Where it stands, read with the page and again on every commit.
    let standingSerial=0;
    const stands=async workspace=>{
      const serial=++standingSerial,retry=()=>run(reload);
      try {
        const answer=checkedView(await api.view('outcome_light',{workspace_id:route.id},{readClass:'foreground'}),bootstrap.instance_id);
        if(serial===standingSerial)paintStanding($('outcome-standing'),answer,{retry,outcome:workspace.title,open:(id,title)=>openDestination({kind:'topic',id},title)});
        return true;
      } catch {
        if(serial===standingSerial)paintStandingFailed($('outcome-standing'),retry);
        return false;
      }
    };
    // permitted: the latest read of the outcome let the reader see it.
    let refreshSerial=0,permitted=false;
    const refresh=async()=>{
      const serial=++refreshSerial;
      status('');
      let answer;
      try { answer=checkedView(await api.view('workspace',{workspace_id:route.id},{readClass:'foreground'}),bootstrap.instance_id); }
      catch(error) {
        if(serial!==refreshSerial)return;
        if(readFailure(error).kind==='forbidden') {
          permitted=false;$('topic-title').textContent='Outcome unavailable';$('topic-description').textContent='';$('outcome-team').hidden=true;
          $('topic-navigation').hidden=true;$('new-topic').disabled=true;
          // Its Notebook pages, and any open in place, go with it; a recovered read lists them again.
          $('outcome-references').hidden=true;$('page-here').hidden=true;$('outcome-standing').hidden=true;$('also-waiting').hidden=true;$('conversation-navigation').hidden=true;
        }
        throw error;
      }
      if(serial!==refreshSerial)return;
      const workspace=answer.workspace;
      if(workspace?.id!==route.id||typeof workspace.title!=='string')throw Error('The outcome identity could not be confirmed.');
      permitted=true;
      $('topic-title').textContent=workspace.title;
      purposeLine??=new PurposeLine({host:$('outcome-purpose'),description:$('topic-description'),
        save:(purpose,current)=>setPresence('workspace.update',{workspace_id:current.id},'workspace_revision',current.version,{purpose}).then(receipt=>{run(reload);return receipt;})});
      purposeLine.paint(workspace,organises(workspace,bootstrap.actor));
      $('workspace-name').textContent=workspace.id;enableNewTopic(workspace.id);here.title=workspace.title;here.has=hasConversation(workspace);
      await paintTeam(workspace,()=>reload());
      if(!topicRail)topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.id,null),host:$('topics'),more:$('more-topics'),
        retry:$('retry-topics'),message:$('topics-status'),...topicFolds(),key:$('topics-key'),denied:error=>readFailure(error).kind==='forbidden',
        read:async args=>checkedView(await api.view('workspace_topics',args,{readClass:'foreground'}),bootstrap.instance_id),
        open:(id,title)=>openDestination({kind:'topic',id},title),
        updated:()=>{$('outcome-empty').hidden=!topicRail.empty||!$('topics-status').hidden;}});
      if(!outcomeReferences)outcomeReferences=outcomePages(route.id,()=>run(reload));
      return (await Promise.all([stands(workspace),targets.load(),topicRail.load(),outcomeReferences.load(),loadConversation(),
        paintPipelineLine($('pipeline-line'),{workspace:route.id,read:pipelineView})])).every(read=>read!==false);
    };
    // A commit may change the team or the outcome's revision as well as its
    // topics, and other outcomes' questions in the line above them. Back from a
    // refusal, the topics show once that commit's reads have painted what stands
    // above them (those questions, where it stands, its conversation), so a topic
    // does not move down under a pointer as each lands.
    const reload=followCommits(async()=>{
      const reads=await Promise.allSettled([outcomeRail.load(),refresh()]);
      if(permitted)$('topic-navigation').hidden=false;
      for(const read of reads)if(read.status==='rejected')throw read.reason;
      return reads.every(read=>read.value!==false);
    });
    await reload();
    if(shown)run(async()=>pageHere.open(await pageSource(shown),$('main')));
  }
  document.body.dataset.ready='true';
}
// The pipeline's views and commands (item 84; docs/pipeline.md).
const pipelineView=async(name,args)=>checkedView(await api.view(name,args,{readClass:'foreground'}),bootstrap.instance_id);
// The pipeline page names each change's operation (pipeline.mjs change), so a change sent again is the same one.
function pipelineSend(kind,target,args,expected={},operation_id=crypto.randomUUID()) {
  const {authority_id,authority_epoch}=bootstrap.authority;
  return api.command({v:1,instance_id:bootstrap.instance_id,operation_id,kind,target,
    expected:{...expected,authority:{authority_id,authority_epoch}},args});
}
// The rail's Pipeline row (D19), placed by the outcome's rail between the
// conversation and the topics, and read with the rail on every commit.
// loaded hears each read (a message's Add to pipeline shows only while the pipeline is on).
function pipelineSection(workspace,current,loaded=()=>{}) {
  const row=new PipelineRow({section:$('pipeline-navigation'),host:$('pipeline-links'),workspace,current,read:pipelineView,reader:bootstrap.actor});
  return {name:'pipeline',node:$('pipeline-navigation'),row,load:()=>row.load().then(read=>{loaded(read);return read;})};
}
// An outcome's pipeline, or one item's record in it: the rail shows this
// outcome as a topic page's does (its conversation, Pipeline row, topics and
// Notebook pages); the page and the rail read again on every commit.
async function initializePipelinePage(route) {
  status('');
  for(const id of ['notebook','topic-people','messages','topic-pending','inline-composer'])$(id).hidden=true;
  $('pipeline-page').hidden=false;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>shell.leave(routeHref(target))});
  const page=new PipelinePage({host:$('pipeline-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},
    reader:bootstrap.actor,instanceId:bootstrap.instance_id,workspace:route.id,item:route.kind==='item'?Number(route.item):null,read:pipelineView,send:pipelineSend});
  enableNewTopic(route.id);
  topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.id,null),host:$('topics'),more:$('more-topics'),
    retry:$('retry-topics'),message:$('topics-status'),...topicFolds(),key:$('topics-key'),denied:error=>readFailure(error).kind==='forbidden',
    read:async args=>checkedView(await api.view('workspace_topics',args,{readClass:'foreground'}),bootstrap.instance_id),
    open:(id,title)=>openDestination({kind:'topic',id},title)});
  outcomeReferences=outcomePages(route.id,()=>{});
  // The outcome's title names its conversation's row, and whether it has one keeps the row's place.
  here={workspaceId:route.id,title:route.id,view:null,page:false,has:false,onlyNew:false,items:new Map()};
  try { const workspace=(await pipelineView('workspace',{workspace_id:route.id})).workspace;here.title=workspace.title;here.has=hasConversation(workspace); } catch {}
  outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'pipeline',rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:[{name:'conversation',node:$('conversation-navigation'),load:loadConversation},pipelineSection(route.id,route.kind==='pipeline'),{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},
      {name:'notebook',node:$('outcome-references'),load:()=>outcomeReferences.load()}]});
  placeBrand(document.querySelector('.rail'));
  await followCommits(async()=>(await Promise.all([outcomeScope.load(),page.load()])).every(read=>read!==false))();
  document.body.dataset.ready='true';
}
// The instance's Health page (docs/health.md): no rail, the logo block and
// "← Outcomes" head it; it reads the health view again on every commit and
// says at once when the live feed drops.
async function initializeHealthPage() {
  status('');
  for(const id of ['notebook','topic-people','messages','topic-pending','inline-composer'])$(id).hidden=true;
  document.querySelector('.rail').hidden=true;
  $('main').prepend($('outcomes-home'));placeBrand($('main'));
  $('health-link').setAttribute('aria-current','page');
  $('topic-title').textContent='Health';$('topic-description').textContent='Read live from Theseus; it follows every change.';
  const page=new HealthPage({host:$('health-page'),feed:()=>live?.state??null,
    read:async()=>checkedView(await api.view('health',{},{readClass:'foreground'}),bootstrap.instance_id)});
  $('health-page').hidden=false;
  live?.listen(event=>page.heard(event));
  await followCommits(()=>page.load())();
  document.body.dataset.ready='true';
}
// A Notebook page as a deck of cards (docs/decks.md): no rail, so the deck has
// the width; "← Outcomes" and the logo block head it, and the eyebrow goes
// back to the page in its topic or outcome. The deck reads again on commits.
async function initializeDeckPage(route) {
  status('');
  for(const id of ['notebook','topic-people','messages','topic-pending','inline-composer'])$(id).hidden=true;
  document.querySelector('.rail').hidden=true;
  $('main').prepend($('outcomes-home'));placeBrand($('main'));
  // The way back names the page's topic or outcome, or says only "The page" when that read fails.
  const place=async scope=>{
    const href=routeHref({kind:scope.kind,id:scope.id,page:route.id});
    try { return {href,title:scope.kind==='topic'?(await pipelineView('topic',{topic_id:scope.id})).topic.title:(await pipelineView('workspace',{workspace_id:scope.id})).workspace.title}; }
    catch { return {href,title:'The page'}; }
  };
  // A card's ask goes to the page's topic, or to its outcome's conversation, and to an agent there (docs/decks.md).
  const askIn=async scope=>{
    const topicId=scope.kind==='topic'?scope.id:(await pipelineView('conversation',{workspace_id:scope.id})).conversation?.topic_id;
    if(!topicId)return null;
    const {participants}=await pipelineView('topic',{topic_id:topicId});
    return {topicId,agents:participants.filter(p=>p.kind==='agent'&&p.enabled).map(p=>p.actor_id)};
  };
  const page=new DeckPage({host:$('deck-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},
    item:route.id,read:pipelineView,send:pipelineSend,place,askIn});
  $('deck-page').hidden=false;
  await followCommits(()=>page.load())();
  document.body.dataset.ready='true';
}
// An outcome's Measurements: every check's readings by release (docs/targets.md). The rail
// shows this outcome, as on its pipeline page; the page and the rail read again on every commit.
async function initializeMeasurementsPage(route) {
  status('');
  for(const id of ['notebook','topic-people','messages','topic-pending','inline-composer'])$(id).hidden=true;
  $('measurements-page').hidden=false;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>shell.leave(routeHref(target))});
  const page=new MeasurementsPage({host:$('measurements-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},workspace:route.id,read:pipelineView});
  enableNewTopic(route.id);
  topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.id,null),host:$('topics'),more:$('more-topics'),
    retry:$('retry-topics'),message:$('topics-status'),...topicFolds(),key:$('topics-key'),denied:error=>readFailure(error).kind==='forbidden',
    read:async args=>checkedView(await api.view('workspace_topics',args,{readClass:'foreground'}),bootstrap.instance_id),
    open:(id,title)=>openDestination({kind:'topic',id},title)});
  outcomeReferences=outcomePages(route.id,()=>{});
  outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'measurements',rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:[pipelineSection(route.id,false),{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},
      {name:'notebook',node:$('outcome-references'),load:()=>outcomeReferences.load()}]});
  placeBrand(document.querySelector('.rail'));
  await followCommits(async()=>(await Promise.all([outcomeScope.load(),page.load()])).every(read=>read!==false))();
  document.body.dataset.ready='true';
}
// An outcome's Notebook pages on its own page, each opening in place.
function outcomePages(workspace,recorded) {
  const view=async(name,args)=>checkedView(await api.view(name,args,{readClass:'foreground'}),bootstrap.instance_id);
  const reads=new PageReads({recorded,send:(id,revision)=>{
    const {authority_id,authority_epoch}=bootstrap.authority;
    return api.command({v:1,instance_id:bootstrap.instance_id,operation_id:crypto.randomUUID(),kind:'memory.read',
      target:{item_id:id},expected:{authority:{authority_id,authority_epoch}},args:{revision}});
  }});
  const here=pageHere=new PageHere({host:$('page-here'),reads,read:ref=>view('source',ref),cards:id=>routeHref({kind:'cards',id})});pageHereOutcome=workspace;
  return new OutcomeReferences({scope:workspace,host:$('outcome-references'),list:$('outcome-references-list'),more:$('more-references'),
    message:$('outcome-references-status'),pageMax:pageMax(),denied:error=>readFailure(error).kind==='forbidden',
    read:args=>view('memory_items',{owner_scope:{kind:'workspace',id:workspace},...args}),open:(ref,row)=>run(()=>here.open(ref,row))});
}
// An outcome's team, which its owner and its coordinator may change. The owner
// cannot be removed, so the owner's chip is fixed.
let teamPanel=null,purposeLine=null;
async function paintTeam(workspace,refresh) {
  const send=(id,present)=>setPresence('workspace.member_set',{workspace_id:workspace.id},'workspace_revision',workspace.version,{actor_id:id,present})
    .then(receipt=>{run(refresh);return receipt;});
  if(!teamPanel){
    const section=$('outcome-team');$('outcome-page').append(section);
    teamPanel=new PeoplePanel({host:$('team-people'),label:'Add someone to this outcome\'s team',fixed:()=>[teamPanel.owner],light:wakeLight,
      read:()=>readMembers(api,bootstrap.instance_id,workspace.id),candidates:()=>directoryPeople,opened:()=>refreshDirectory()});
  }
  Object.assign(teamPanel,{owner:workspace.owner_id,add:id=>send(id,true),remove:id=>send(id,false)});
  let members;
  await wakeLights.load();
  try { members=await readMembers(api,bootstrap.instance_id,workspace.id); }
  catch(error) { teamPanel.error=`The team could not be read: ${error.message}`;members=teamPanel.people; }
  teamPanel.paint(members,organises(workspace,bootstrap.actor));teamPanel.error='';
  $('outcome-team').hidden=false;
}
// New topic is one title line in the topic list: Return starts the topic with
// the reader in it and opens it; people and the first message are added there.
let topicLine=null;
function enableNewTopic(workspace) {
  $('new-topic').disabled=false;
  if(topicLine?.workspace===workspace)return;
  let starter=new TopicStart({api,bootstrap,workspace});
  const line=new OneLine({id:'new-topic-title',label:'Title of the new topic',placeholder:'New topic title',className:'rail-line',
    submit:async title=>{const id=await starter.start(title);starter=new TopicStart({api,bootstrap,workspace});line.input.value='';close();await openDestination({kind:'topic',id},title);}});
  const close=lineFromButton({button:$('new-topic'),after:$('new-topic').closest('.rail-heading'),line});
  topicLine={workspace,line};
}
async function initializeOpeningPage(route) {
  for(const id of ['notebook','topic-people','messages','topic-pending','inline-composer'])$(id).hidden=true;
  $('outcome-page').hidden=false;$('topic-title').textContent='New topic';$('topic-description').textContent='Write privately, then Send to create the topic.';
  const answer=checkedView(await api.view('workspace',{workspace_id:route.workspace},{readClass:'foreground'}),bootstrap.instance_id);
  if(answer.workspace?.id!==route.workspace)throw Error('The chosen outcome could not be confirmed.');
  $('workspace-name').textContent=answer.workspace.title;
  const store=await openOpeningStore({instanceId:bootstrap.instance_id,actor:bootstrap.actor});
  // Core owns the opening; a committed publication opens its topic.
  const draft=new OpeningDraft({api,bootstrap,store,workspace:route.workspace,opening:route.opening,topic:route.topic,source:route.from??null,
    published:receipt=>shell.leave(routeHref({kind:'topic',id:receipt.result.topic.id}))});
  topicNavigation=new TopicNavigation({current:route,beforeLeave:(target,title)=>draft.leave(target,title),navigateTarget:target=>shell.leave(routeHref(target))});
  const view=new OpeningView({host:$('outcome-page'),draft,workspace:answer.workspace,open:openDestination});
  shell.guard(()=>draft.unprotected);
  window.addEventListener('pagehide',()=>{draft.cancelSave();store.close();});
  await view.run(()=>draft.load());
  if(draft.editable)view.title.focus();
  view.run(()=>view.loadMembers());view.run(()=>draft.loadSource());
  // The rail beside the writing shows this outcome. Each commit reloads it and
  // reads the opening once; the draft takes a change from another device or
  // tab only while it holds no unsaved writing.
  enableNewTopic(route.workspace);
  topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.workspace,null),host:$('topics'),more:$('more-topics'),
    retry:$('retry-topics'),message:$('topics-status'),...topicFolds(),key:$('topics-key'),denied:error=>readFailure(error).kind==='forbidden',
    read:async args=>checkedView(await api.view('workspace_topics',args,{readClass:'foreground'}),bootstrap.instance_id),
    open:(id,title)=>openDestination({kind:'topic',id},title)});
  outcomeReferences=outcomePages(route.workspace,()=>{});
  here={workspaceId:route.workspace,title:answer.workspace.title,view:null,page:false,has:hasConversation(answer.workspace),onlyNew:false,items:new Map()};
  outcomeScope=new OutcomeScope({workspaceId:route.workspace,kind:'opening',rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:[{name:'conversation',node:$('conversation-navigation'),load:loadConversation},{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},{name:'notebook',node:$('outcome-references'),load:()=>outcomeReferences.load()}]});
  placeBrand(document.querySelector('.rail'));
  await followCommits(async()=>(await Promise.all([outcomeScope.load(),draft.follow().catch(()=>false)])).every(read=>read!==false))();
  document.body.dataset.ready='true';
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
  for(const id of ['notebook','topic-people','messages','topic-pending','inline-composer','topic-navigation'])$(id).hidden=true;
  $('outcome-page').hidden=false;$('topic-title').textContent='New outcome';$('topic-description').textContent='Create a place for related topics.';
  const intents=await ensureIntentJournal();
  outcomeCreation=new OutcomeCreation({api,bootstrap,journal:intents,intentId:route.intent});
  initializeOutcomeNavigation();const reload=followCommits(()=>outcomeRail.load());
  try { await outcomeCreation.load(); }
  catch(error) {
    // Another tab is starting this form: say so, and open it here once that tab lets go.
    if(!outcomeCreation.waiting)throw error;
    status(error);run(reload);document.body.dataset.ready='true';
    if(!await outcomeCreation.waiting)return;
    status('');
  }
  topicNavigation=new TopicNavigation({current:route,beforeLeave:(target,title)=>outcomeCreation.leave(target,title),navigateTarget:target=>shell.leave(routeHref(target))});
  const confirmed=async row=>{
    const answer=checkedView(await api.view('workspace',{workspace_id:row.workspace},{readClass:'foreground'}),bootstrap.instance_id);
    if(answer.workspace?.id!==row.workspace||answer.workspace.owner_id!==bootstrap.actor)throw Error('The created outcome detail could not be confirmed. Keep its original receipt.');
    $('workspace-name').textContent=answer.workspace.title;
  };
  const form=new CreateOutcomeView({host:$('outcome-page'),creation:outcomeCreation,open:openDestination,confirmed});
  if(outcomeCreation.row.phase==='confirmed')await form.run(()=>confirmed(outcomeCreation.row));
  shell.guard(()=>outcomeCreation.writable&&Boolean(outcomeCreation.pending||outcomeCreation.dirty||outcomeCreation.storageError));
  await reload();document.body.dataset.ready='true';
}
window.addEventListener('pageshow', event => { if (event.persisted) shell.leave(); });
// Every shown time follows the viewer's day: at midnight today's "4:40 AM"
// becomes "Yesterday 4:40 AM", with a topic's list held where the reader was.
const stopDays = watchDays({ doc: document, win: window, repaint: () => registry ? keepListAnchor(() => repaintTimes(document)) : repaintTimes(document) });
// A run ends as a page unloads, or as a move in place ends it: its live feed,
// its watchers and its timers stop with it.
window.addEventListener('pagehide', () => { live?.stop(); cardObserver?.disconnect(); middleObserver?.disconnect(); unheard(); stopDays(); });
// A start that fails says why, with a way to start again from nothing: the
// reload runs start afresh. Settles true when the page started.
// ? opens the short guide to the pointer and keys, on every page (interaction-guide.mjs).
document.addEventListener('keydown', event => { if (asksForGuide(event)) { event.preventDefault(); guide.open(); } });
function begin(starting = start) {
  return Promise.resolve().then(starting).then(() => true, error => {
    const again = node('button', 'Reload this page'); again.type = 'button'; again.id = 'start-reload'; again.onclick = () => shell.leave();
    status([error, again]);
    shell.failed(thisRun);
    return false;
  });
}
begin();
