import { mountFeedFences } from './feed-fence-copy.mjs';
import { keepLineRoom } from './line-room.mjs';
import { Api, notAnswering, unreached, answeredSince, heard, follow, notTaken, NOT_TAKEN } from './api.mjs';
import { openJournal } from './journal.mjs';
import { EditorRegistry } from './app-session.mjs';
import { Reader } from './reader.mjs';
import { InlineComposer } from './inline-composer.mjs';
import { PRIOR_PUBLICATION_NOTICE } from './session.mjs';
import { readableUploads, uploadWork, recoveryReadOnly, refusedCopyAtDraft, refusedAtDraft } from './upload-state.mjs';
import { typingField } from './writing-input.mjs';
import { Freshness, initialViews, actorBaseline, readFailure, checkedView, bindingOf } from './freshness.mjs';
import { TopicViews, followEdits } from './topic-views.mjs';
import { TopicPages, TopicNavigation, TopicRail, parseRoute, routeHref, topicTarget, paintChanged, changedSince } from './topic-navigation.mjs';
import { OutcomeRail } from './outcomes.mjs';
import { LightPeek, paintAlsoWaiting, paintStanding, paintStandingFailed } from './outcome-light.mjs';
import { keptToRead } from './outcome-light-words.mjs';
import { paintKeptLine, sendEnd } from './outcome-end.mjs';
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
import { NotebookCreate } from './notebook-create.mjs';
import { OneLine, OutcomeStart, TopicStart, lineFromButton, firstSentence } from './quick-create.mjs';
import { PurposeLine } from './outcome-purpose.mjs';
import { AgentInvite, Invitation } from './agent-invite.mjs';
import { Marks, paintMarkButton, paintAuthor, marksWords, carriesOf } from './marks.mjs';
import { replyLine } from './replies.mjs';
import { placeNewLine } from './unanswered.mjs';
import { betweenOthers, foldCard, cardIn, paintFold, paintFoldWords, opened } from './fold.mjs';
import { MessageEditWriting, messageEditStore, mayEdit, revisionOf, wasEdited } from './message-edit-writing.mjs';
import { MessageEdit } from './message-edit.mjs';
import { cardClass, paintCardColor, agentColor, paneClass } from './author-colors.mjs';
import { paintWhisperAuthor, mayStartFrom } from './whisper-choice.mjs';
import { AgentColors } from './colors.mjs';
import { openColorPicker } from './color-picker.mjs';
import { PageReads } from './page-reads.mjs';
import { PageHere } from './page-here.mjs';
import { imageStandIns } from './deck.mjs';
import { TITLE as CONVERSATION_TITLE, subtitle as conversationSubtitle, placeholder as conversationPlaceholder, CONVERSATION_NOTE, paintOnlyNew, paintEmpty, paintItemTags, paintAbout, paintAsksYou, paintConversationRow, conversationDestination, paintAnswerers, switchWriting, PLACE as CONVERSATION_PLACE } from './outcome-conversation.mjs';
import { WakeLights } from './wake-lights.mjs';
import { OutcomeScope, placeBrand } from './outcome-scope.mjs';
import { linkWords, openLinksWith, nameTopicsWith, shareLinksFrom, messageLink, pageLink } from './links.mjs';
import { closeOnOutsideClick } from './dismiss.mjs';
import { PipelinePage, PipelineRow, paintPipelineLine, pipelineHref, titleLine } from './pipeline.mjs';
import { firstLine } from './pipeline-words.mjs';
import { HealthPage } from './health.mjs';
import { NotebookPage } from './notebook-page.mjs';
import { NotebookSheet, returning as notebookReturning } from './notebook-sheet.mjs';
import { HealthLight } from './health-light.mjs';
import { phoneCheck } from './phone-check.mjs';
import { MeasurementsPage, OutcomeTargets, paintTopicTarget } from './targets.mjs';
import { ToolPage, OutcomeTools, ToolsRail, TopicTools } from './skills.mjs';
import { MessageMenu, openMessageMenu, sayOn, copyText, COPY_REFUSED } from './message-menu.mjs';
import { Reactions, learnReactions, paintReaderThumb, paintReaderReactions } from './reactions.mjs';
import { CardScroll } from './card-scroll.mjs';
import { InteractionGuide, asksForGuide } from './interaction-guide.mjs';
// How a topic reads (docs/topic-reading.md): read cards, quiet agent talk, replies and stacks, formatted words.
import { agentTalk, readNow, learnReply, learnAnswered, paintAwaiting, paintReading, seenRanges, wakeOnPress } from './card-reading.mjs';
import { entries, entryOf, lineSeq, reveal, headClick, foldedClick, stackState, stackPage, shownView, drawn, paintHeadCarries, paintFolderColors, fillFrom, paintFoldedNames } from './reply-stacks.mjs';
import { paintCardImages, dropCardImages } from './card-images.mjs';
import { StackFeed } from './stack-feed.mjs';
import { messagePreview } from './message-preview.mjs';
import { PressHold } from './press-hold.mjs';
import { readerSteps } from './stack-order.mjs';
import { headerClick } from './reply-stacks.mjs';
import { revealSelection } from './reveal.mjs';
import { deferFencePaint } from './fence-copy.mjs';
import { formatWords } from './message-format.mjs';
import { shell } from './rails.mjs';
import { SessionRenewal } from './session-renewal.mjs';
import { showLine, lineText } from './lines.mjs';

// Each page is one run of this module (in-place-navigation.mjs). A run that a
// move in place has ended finds its own elements still, so work it had under
// way lands there and never on the page that followed it.
let retired = null, notebookSheet = null;
const $ = id => retired?.get(id) ?? document.getElementById(id);
const thisRun = shell.begin({ open: (target, title) => openDestination(target, title), retire: ids => { retired = ids; notebookSheet?.retire(); },
  updated: reload => updatedNotice(reload), refused: why => { shell.stayed(); stayedWhy(why); } });
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
let settings = null, topicTools = null, topicRail, topicNavigation, outcomeRail, outcomeReferences, outcomeScope = null, inlineDiscovery = null, readerShowings = 0, sentHost = null, participantsPanel = null, outcomeMembers = null, colors = null;
let intentJournal, intentOpening, outcomeCreation, readThrough, cardObserver, middleObserver, marks = null, commitReload = null, pageReads = null;
let pipelineRow = null, pipelineAddFor = null;
// An outcome page's Notebook page shown in place (page-here.mjs), and that outcome.
let pageHere = null, pageHereOutcome = null;
// The topic page's light, message bar, thumbs-up and go-ahead answers (message-menu.mjs, reactions.mjs).
let menu = null, reactions = null, cardScroll = null;
// Whether the open topic's outcome is reached, as its light last said: its
// messages are kept to read, so none offers Edit (Core refuses one too).
let outcomeReached = false;
// The Reader's edit of one of the person's messages, while it is open (editMessage).
let messageEdit = null;
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
// now, so no editor an event hands in draws or erases one.
// A writing with no reply in doubt but one set aside whose words are kept only
// on its line has a Set aside chip in the same place, which opens the same list
// (docs/replies-in-doubt.md).
function paintReview() {
  const entries = registry?.inDoubt ?? [], composer = !$('inline-composer').hidden;
  const drawn = [...entries, ...(registry?.keptAside ?? []).filter(kept => !entries.some(entry => entry.editor.key === kept.editor.key))];
  const inComposer = entry => composer && entry.editor.context.sourceRef.kind === 'topic';
  const title = $('topic-pending'), hosts = new Map([...title.children].map(host => [host.dataset.key, host]));
  const rows = drawn.filter(entry => !inComposer(entry)).map(entry => {
    const host = hosts.get(entry.editor.key) ?? node('div'); host.dataset.key = entry.editor.key; reviewControl(host, entry); return host;
  });
  if (rows.length !== title.children.length || rows.some((host, n) => title.children[n] !== host)) title.replaceChildren(...rows);
  reviewControl($('inline-pending'), drawn.find(inComposer));
  const reading = registry?.current?.editors.reply?.key;
  reviewControl($('pending-submissions'), drawn.find(entry => entry.editor.key === reading));
}
function reviewControl(host, entry) {
  if (!entry) { host.replaceChildren(); return; }
  let control = host.firstElementChild;
  if (!control) { control = node('button'); control.type = 'button'; host.append(control); }
  // A small chip on the reply's line; what it is about is in its name.
  control.textContent = entry.label; control.onclick = () => run(() => showPending(entry.editor.key, control));
  const replies = `${entry.count} ${entry.count === 1 ? 'reply' : 'replies'}`;
  control.setAttribute('aria-label', entry.kept ? `${replies} set aside, words kept. Open` : `${replies} may not have sent. Review`);
  control.classList.toggle('kept', Boolean(entry.kept));
  if (entry.kept) control.title = 'Replies you set aside, their words kept here to copy, or Undo'; else control.removeAttribute('title');
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
  // The writing as it is now, wherever it shows, after its words came back or went.
  const redrawWriting = editor => {
    if (inline?.editor === editor) { inline.drawEditor(); inline.paintStatus(); inline.paintImages(); }
    if (reader?.editor === editor) { reader.drawEditor(); reader.paintStatus(); reader.paintImages(); }
  };
  // An act that changes whether a reply is set aside, then the writing and the list drawn again, whatever it answered.
  const settle = async (id, aside) => { try { await registry.setAside(writing(), id, aside); } finally { redrawWriting(writing()); draw(); } };
  const asideButton = (label, name, tip, action) => {
    const control = button(label, action); control.setAttribute('aria-label', name); control.title = tip; control.classList.add('aside-act'); return control;
  };
  // A reply set aside, as Core lists it (registry.asidesOf), says its words went
  // back into the writing, or shows them, its images opened in place and its
  // words with Copy; either way it offers Undo. So the words are always in the
  // writing or on this line, after a reload too.
  const asideCard = (aside, editor) => {
    const card = node('section', undefined, 'pending-card'); card.dataset.id = aside.id; card.dataset.state = 'aside';
    card.append(node('h3', 'Set aside'), node('p', `To ${aside.topic_id}`, 'muted'));
    if (aside.restored) card.append(node('p', 'Its words are back in your writing.', 'muted'));
    else {
      if (aside.body) card.append(node('pre', aside.body));
      if (aside.attachments.length) {
        card.append(node('p', 'Included in this reply · ' + imageSummary(editor, aside.attachments), 'muted'));
        for (const attachment of aside.attachments) card.append(attachmentControl(attachment, undefined, current, failure => reviewStatus(failure ? failure.message ?? String(failure) : '')));
      }
      if (aside.body) card.append(asideButton('Copy', 'Copy this reply\'s words', 'Copy its words', async () => { await navigator.clipboard.writeText(aside.body); reviewStatus('Copied.'); }));
    }
    card.append(asideButton('Undo', 'Undo set aside: this reply may not have sent', 'Put it back with the replies that may not have sent', () => settle(aside.id, false)));
    return card;
  };
  const makeCard = (item, editor, local, statusKey) => {
    const card = node('section', undefined, 'pending-card'); card.dataset.id = item.id;
    card.append(node('h3'), node('p', `To ${item.topicId ?? item.topic_id}`, 'muted'));
    card.dataset.state = 'doubt';
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
    // Item 548: a reply that may never go is set aside, so it is in doubt no more; its words are kept.
    if (!['confirmed', 'committed'].includes(statusKey)) {
      card.append(asideButton('Set aside', 'Set this reply aside', 'Set aside: stop counting it as maybe not sent. Its words are kept, and Undo puts it back.', () => settle(item.id, true)));
    }
    return card;
  };
  const draw = () => {
    const editor = writing();
    if (!current() || !editor) return;
    for (const id of registry.doubt(editor).ids) shown.add(id);
    const local = new Map(editor.submissions.map(item => [item.id, item]));
    const asides = new Map(registry.asidesOf(editor).map(item => [item.id, item]));
    const listed = [...local.values(), ...registry.pending(editor).items.filter(item => !local.has(item.id))].filter(item => shown.has(item.id) && !asides.has(item.id));
    for (const item of [...listed, ...asides.values()]) {
      const statusKey = item.status ?? item.send_status, aside = asides.get(item.id);
      let card = [...host.children].find(child => child.dataset.id === item.id);
      // A line is drawn again when its state changes, or when a reply set aside has its words back in the writing or not.
      if (!card || card.dataset.state !== (aside ? 'aside' : 'doubt') || aside && card.dataset.restored !== String(aside.restored)) {
        const made = aside ? asideCard(aside, editor) : makeCard(item, editor, local, statusKey);
        if (aside) made.dataset.restored = String(aside.restored);
        if (card) card.replaceWith(made); else host.append(made);
        card = made;
      }
      if (aside) continue;
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
  if (unreadLandingBusy) return;
  if ($('main').inert) return;
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
    let dossierError = null;
    try { await readReaderDossier(presentation, (name, args) => api.view(name, args, { readClass: 'foreground' })); }
    catch (error) { dossierError = error; }
    if (!registry.isCurrent(presentation)) return;
    revokeMedia(); reader.presentation = presentation;
    delete $('reader').dataset.discovered;
    reader.show(presentation.source, presentation.editors, { opener: presentation.opener, topics: [topic], presentation, mode: presentation.mode });
    if (presentation.sourceUnavailable) reader.notice('The source is unavailable. Your private writing is kept.');
    else if (dossierError) reader.notice(['Dossier name could not be read. The message and your writing are kept.', dossierError]);
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
  // data-discovered says this showing's discovery has finished: the source's
  // earlier copies were looked for, every copy found is listed, and Review is
  // drawn from them. A lookup that fails also finishes it. Its failure shows in
  // the Reader's notice while that writing is still the one shown, and the list
  // stays as the lookup left it: unchanged if it failed before listing a page,
  // that page if it failed after (settling image copies). Later checks (a
  // deferred copy checked again, a save's cleanup, More versions, Recover) are
  // their own events and may still change Review. Showing a source starts it
  // unmarked, and only its latest showing's discovery marks it; choosing Reply
  // or Note keeps the showing.
  const showing = ++readerShowings;
  discovery.then(() => { if (showing === readerShowings) $('reader').dataset.discovered = 'true'; });
  registry.neighbors(presentation).then(neighbors => {
    if (!neighbors || !registry.isSourceCurrent(presentation)) return;
    takeNeighbors(registry.current, neighbors);
  }).catch(error => { if (registry.isSourceCurrent(presentation)) reader.notice(error); });
  sourceAttachments(presentation);
}
// The Reader's ↑ and ↓ follow the page as shown (stack-order.mjs,
// readerSteps): ↑ the message above, ↓ the one below, down a stack to its
// newer replies and on to the stack below, over a dossier put below a closed
// More. next is the one above, previous below. Every neighbour leaves through
// its one exit (stepTarget): shown on the page, or not loaded by it. Another
// topic's message (opened from an About link) is no part of this page's view.
function onPage(presentation, core) {
  const here = presentation?.source?.topic_id === topic?.id;
  return readerSteps(presentation?.source?.source_ref, core, here ? stackPage(stackState($('messages'))) : null);
}
// Core's word on the Reader's neighbours is kept with what it shows (core),
// and what ↑ and ↓ may step to is worked out from it and the page as shown
// now: when the neighbours are read, and each time the page's stacks are
// drawn again while the Reader is open (another device put one aside, More
// opened), so the buttons never offer a message the page no longer shows.
function takeNeighbors(presentation, core) {
  presentation.core = core;
  presentation.neighbors = onPage(presentation, core);
  // While a message is edited the Reader steps nowhere; what it may step to once the edit ends is kept for then.
  if (reader?.editing) { reader.stepsBefore = [!presentation.neighbors.previous, !presentation.neighbors.next]; return; }
  $('previous-message').disabled = !presentation.neighbors.previous; $('next-message').disabled = !presentation.neighbors.next;
}
// Everything placed by what the page shows is placed again each time the
// stacks are drawn (More opened or closed, Only new, an act, another device):
// the Reader's ↑ and ↓, the New line and Earlier messages.
function stacksRedrawn() {
  reader?.keepReplyVisible();
  const presentation = registry?.current;
  if ($('reader').open && presentation?.core && registry.isSourceCurrent(presentation)) takeNeighbors(presentation, presentation.core);
  if (views) placeLine();
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
// One of a Notebook page's images, read through the page at ref (page-image.mjs): the Reader's and a page in place.
async function pageImage(attachment, ref) { return (await api.media(bootstrap.instance_id, attachment, ref)).blob; }
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
async function openSource(ref, opener, act = null, replyCard = null) {
  const request = ++opening;
  const from = registry.interactive;
  views.retain(views.currentItem, ref.kind === 'memory' ? ref.id : null);
  status('');
  try { await marks.open(registry, ref, { topicId: topic.id, opener, replyCard }, act); }
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
// it loaded. At the top of the topic, where its newest card drawn shows from
// its top edge, nothing is held: what arrives comes into view above that
// card, with the New line under it, instead of landing out of sight. A card
// held is one the page draws (drawn, the page's one view) before and after
// the repaint: when the repaint stops drawing it (put below More on another
// device), the card drawn next below it is held instead.
// roomy: gives back the room a hold kept (holdRoom).
let roomy = null;
function keepListAnchor(paint) {
  const at = document.activeElement, list = $('messages');
  const writing = inline?.root.contains(at) && registry.isCurrent(registry.inline);
  const field = !writing && $('main').contains(at) && typingField(at) && inView(at);
  const first = writing || field ? null : firstInView();
  const anchor = writing ? inline.field : field ? at : first && !first.dataset.seq && !first.classList.contains('memory-card') ? list : first;
  const control = anchor === list && (first.id === 'more-messages' || first.dataset.line === 'older') ? first : null;
  const cards = entries(list).filter(entry => drawn(list, entry.dataset.id));
  const held = cards.includes(anchor) ? cards.slice(cards.indexOf(anchor)) : [anchor];
  const tops = new Map(held.map(node => [node, node?.getBoundingClientRect().top]));
  const atTop = !writing && !field && anchor && anchor === cards[0] && tops.get(anchor) >= 0;
  const edge = control?.getBoundingClientRect().top, last = cards.at(-1), present = control ? new Set(entries(list)) : null;
  paint();
  // Room an earlier hold kept is given back first; the hold measures without it.
  if (roomy) { roomy(); roomy = null; }
  const landed = control && last ? loadedAfter(list, present, last) : null;
  if (landed) { window.scrollBy(0, landed.getBoundingClientRect().top - edge); return; }
  const hold = cards.includes(anchor) ? held.find(node => node.isConnected && drawn(list, node.dataset.id)) : anchor;
  if (hold?.isConnected && !atTop) window.scrollBy(0, holdRoom(list, hold, tops.get(hold)));
}
// How far the page scrolls to put hold back where it was (top). Where what is
// drawn above it shrank by more than the page is scrolled (a reply taking the
// place of a taller one, docs/reply-stacks.md), no scroll can: the page's top
// would cut it short. Then the list keeps the rest as room between what changed
// and the writing, so the writing stays exactly where it was (item 363): just
// above the New message composer resting among the messages (item 465, the
// sheet's --hold-room, aim.css), or at the list's end for a hold below it. The
// next hold gives that room back, and keeps only what it needs.
function holdRoom(list, hold, top) {
  const moved = hold.getBoundingClientRect().top - top, short = -(window.scrollY + moved);
  const home = $('new-message-sheet'), resting = home.parentElement === list && !home.open && home.contains(hold);
  if (!(short > 0) || !resting && (list.contains(hold) || !(list.compareDocumentPosition(hold) & Node.DOCUMENT_POSITION_FOLLOWING))) return moved;
  const [room, side] = resting ? [home, '--hold-room'] : [list, 'padding-bottom'];
  room.style.setProperty(side, `${short}px`); roomy = () => room.style.removeProperty(side);
  return hold.getBoundingClientRect().top - top;
}
function inView(node) { const box = node.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; }
// The first card in view. With More, or the New line that loads older
// messages, first in view at the top edge, what they load comes in where
// they were, and the Notebook below moves down, rather than holding still
// while the page jumps past all of it: the first card loaded after the last
// one drawn before goes where the control was. Since item 465 the New
// message composer rests between the last card and More, so the list's top
// no longer holds that place. When the repaint draws nothing after the last
// card, the list itself holds by its top. Loaded replies can gather messages
// above into their stacks; the page still stays where it was. A card in a
// reply stack is a card in view of its own, so a reply arriving above it in
// its stack moves it no more than one above the stack.
const MESSAGE_ENTRIES = '#messages > [data-id], #messages > .reply-stack > [data-id], #messages > .reply-stack > .stack-replies > [data-id]';
function firstInView() {
  return [...document.querySelectorAll(`${MESSAGE_ENTRIES}, #messages > [data-line=older], #more-messages, #memory-items .memory-card`)].find(inView);
}
// The first card drawn now, after last, that the list did not hold before:
// one loaded, not one a fold or a join only draws again.
function loadedAfter(list, before, last) {
  return entries(list).find(entry => !before.has(entry) && drawn(list, entry.dataset.id) && Boolean(last.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING));
}
// The New line, just below the oldest message the reader had not read when the
// topic opened, or further back as more became unread (TopicViews.line); faded
// where it is once nothing holds it (TopicViews.held).
function placeLine() {
  placeNewLine($('messages'), lineSeq($('messages'), views.line?.seq ?? null), document,
    views.olderCursor === null ? null : () => run(loadToUnread), views.line?.sent_ms ?? null, views.held);
  paintFoldedNames($('messages'), views.messages);
  paintMoreMessages();
}
// While the New line says more new messages lie below, it is the one way to
// load older messages; More messages, doing much the same, is hidden. A faded
// line promises nothing, so More comes back, and so does a line Only new does
// not draw (it draws New items alone).
function paintMoreMessages() {
  const view = stackFeed ? shownView(stackFeed.state) : null, aside = stackFeed?.state.belowCount;
  $('more-messages').textContent = aside ? 'Earlier messages' : 'More messages';
  $('more-messages').hidden = Boolean(aside && !view.asideShown) || views.olderCursor === null || (!view?.only &&
    [...$('messages').children].some(child => child.dataset?.line === 'older' && !child.classList.contains('new-line-read')));
}
function paintViews(kind) {
  if (kind === 'offer') { reader?.paintOffer(); return; }
  // All but the header and the people, which repaint in place, move the list:
  // under a press held down they wait for it to end, so the click lands where it began.
  if (kind !== 'topic' && pressHold.down) { pressHold.after(kind, () => paintViews(kind)); return; }
  // A thumbs-up reads its message (card-reading.mjs, readNow): its card, and its stack's count of new replies, read so.
  if (kind === 'reactions') { keepListAnchor(() => { paintCardReading(); stackMessages(); menu?.paint(); }); paintReaderThumb$(); return; }
  // A star, a stack's name, a join or a place, here or on another device (stack-feed.mjs).
  if (kind === 'acts') { keepListAnchor(() => { stackMessages(); menu?.paint(); }); return; }
  // A message edited, here or elsewhere: its card and the lines that read its words (docs/message-edit.md).
  if (kind === 'edited') { keepListAnchor(() => repaintEdited(views.takeRevised(), views.takeEdits())); return; }
  // The person's own note or saved reply on a message, saved, emptied or sent here or elsewhere: its card's marks (item 127).
  if (kind === 'yours') { keepListAnchor(() => repaintYours(views.takeYours())); return; }
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
    drawFeed(true);
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
      // A reply can live in the card: its controls must not be inside a
      // native button. Return remains the message menu's; Space opens it.
      card = node('div'); card.tabIndex = 0; card.setAttribute('role', 'button');
      card.onclick = () => run(() => openSource(ref, card, marks.capture(item.id)));
      card.addEventListener('keydown', event => {
        if (event.target !== card || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === ' ') { event.preventDefault(); if (!event.repeat) card.click(); }
      });
      card.className = cardClass(item, bootstrap.actor, agentShown); card.dataset.id = item.id; card.dataset.seq = item.seq;
      // An agent's name on its card opens its color picker instead of the message.
      const open = card.onclick;
      card.onclick = event => {
        if (event?.target?.closest?.('#reader')) return;
        // A stack's head row shows or hides its full message, or renames it (reply-stacks.mjs).
        if (headClick($('messages'), messageEntries.get(item.id), event)) return;
        // A message the reader folded is one row: a press on it unfolds it (stack-feed.mjs).
        if (foldedClick($('messages'), messageEntries.get(item.id), event)) return;
        // In a dossier a press on a message's header folds it; its words open it (item 471).
        if (headerClick($('messages'), messageEntries.get(item.id), event)) return;
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
      card.append(formatWords(node('span', undefined, 'message-preview'), item.body, { partial: item.preview === true, copyFences: 'feed', revision: revisionOf(item), struck: item.struck?.cuts }));
      if (item.preview) card.append(node('span', 'Excerpt · Open to read the rest', 'message-preview-cue'));
      // Its images as thumbnails after its words, each read through the message (card-images.mjs, item 474).
      paintCardImages(card, item, cardImageBytes(item.id));
      // A message between others is one quiet line that opens its card.
      const entry = betweenOthers(item, bootstrap.actor, bootstrap.actor_kind) ? foldCard(card, item, document) : card;
      paintFold(entry, marks?.state(item.id)?.marked === true);
      // A new card goes above the New message composer resting under the messages (item 465), so the stacks
      // drawn next move no card past it.
      while (following && following !== $('new-message-sheet') && !(Number(following.dataset.seq) < item.seq)) following = following.nextElementSibling;
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
      card = button('', () => openNotebook(item.id, { opener: card })); card.className = 'memory-card';
      card.dataset.id = item.id; card.append(node('strong'), node('span')); $('memory-items').append(card);
      memoryCards.set(item.id, card);
    }
    // A page read before and revised since wears its light, as in the sidebar.
    const identity = sourceIdentity(item.source_ref), changed = String(changedSince(item));
    if (card.dataset.source !== identity || card.dataset.changed !== changed) {
      const [title, body] = card.children;
      card.dataset.source = identity; card.dataset.changed = changed;
      title.replaceChildren(item.title || 'Notebook item'); paintChanged(title, item);
      // A card's image line reads as the image's name after its glyph (deck.mjs, imageStandIns), never its markup.
      linkWords(body, imageStandIns(item.body, { partial: item.preview === true }), { partial: item.preview === true });
    }
    card.onclick = () => run(() => openNotebook(item.id, { opener: card }));
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
// A card's image, read through its message, so only a reader of the message gets it (item 474).
const cardImageBytes = id => async attachment => (await api.media(bootstrap.instance_id, attachment, { kind: 'message', id })).blob;
// The color the reader sees an agent in: their choice, or the agent's own.
const agentShown = id => colors?.color(id) ?? agentColor(id);
// Only the label changes; all record lookup, color and routing keep the ID.
function displayActor(id) {
  const known = [...views?.participants ?? [], ...outcomeMembers ?? [], ...directoryPeople];
  return known.find(person => (person.actor_id ?? person.id) === id && person.name)?.name || id;
}
// Where someone chooses a recipient, equal display names must remain distinguishable.
function actorLabel(id) {
  const known = [...views?.participants ?? [], ...outcomeMembers ?? [], ...directoryPeople], names = new Map();
  for (const person of known) {
    const key = person.actor_id ?? person.id;
    if (person.name && !names.has(key)) names.set(key, person.name);
  }
  const name = names.get(id) || id;
  return known.some(person => {
    const other = person.actor_id ?? person.id;
    return other !== id && (names.get(other) || other).toLowerCase() === name.toLowerCase();
  }) ? `${name} (${id})` : name;
}
// Replies gather under the message they answer on every topic page, the
// conversation's included (reply-stacks.mjs). A folded stack keeps in view a
// reply the person has not read and, in the conversation, one whose card asks
// something of them: an item nothing has settled, or an ask waiting on them.
function stackMessages() { feedOf().arrange(); }
// The page's reply stacks and what the person does to them, made with the first messages.
function feedOf() {
  stackFeed ??= new StackFeed({ list: $('messages'), messages: () => views.messages, viewer: bootstrap.actor, instanceId: bootstrap.instance_id,
    authority: () => registry.runtime.current,
    // The page's own act, once Core answers it, tells the Reader's neighbours whether it could have moved them (item 426).
    send: async envelope => { const receipt = await api.command(envelope); if (receipt?.status === 'committed') views.ownAct(envelope.kind, receipt.result); return receipt; },
    quiet: item => agentTalk(item, bootstrap.actor, bootstrap.actor_kind, whisperPeople().kindOf), filterHost: $('agent-coordination-show'),
    keep: item => !cardRead(item) || stillOwed(item), unread: item => !cardRead(item), nameOf: id => (id === bootstrap.actor ? 'You' : displayActor(id)),
    refreshPositions: () => views.readPositions((name, args) => api.view(name, args)), moreChanged: paintMoreMessages, arranged: stacksRedrawn,
    hold: paint => keepListAnchor(paint), press: pressHold, status, line: () => $('app-status'), reread: () => { freshness?.invalidate('acts', 0, true); freshness?.request(); }, reply: (id, card) => run(() => replyMessage(id, card)),
    thumb: (item, on) => menu?.thumb(item, on), redrawn: () => { paintReaderStar(); paintReaderAside(); paintReaderTitle(); }, home: $('new-message-sheet'),
    // A title bar's ⋯ opens the menu a right-click on its first message opens (item 473).
    // On a phone its menu offers the title bar's Reply and Move below More first, as the glyphs fold into it (first).
    menu: (item, anchor, first = []) => openMessageMenu({ anchor, items: [...first, ...messageMenuItems(item, null, anchor)], label: 'This message', sheet: true }),
    // A dossier's folder wears its first poster's colour, as their cards do: an agent's, in the reader's colours (item 477).
    colorOf: item => (item.author_kind === 'agent' && item.author_id !== bootstrap.actor ? agentShown(item.author_id) : null) });
  return stackFeed;
}
// The topic's feed, its Notebook and its Team, drawn or not, with any other
// parts of the page named. The New message sheet rests in the feed, just above
// More (item 465), and a dialog in a box that is not drawn shows nothing, up
// over the page or not: where the feed is not drawn (an outcome's page, Health,
// a topic the reader can no longer read) the sheet rests at the page's end
// instead, put back first if it was up in the feed, its writing kept
// (arrangeStacks, which takes it back above More once the feed is drawn).
function drawFeed(on, ...parts) {
  const sheet = $('new-message-sheet'), inFeed = $('messages').contains(sheet);
  for (const id of ['messages', 'notebook', 'topic-people', ...parts]) $(id).hidden = !on;
  reader?.keepReplyVisible();
  if (on === inFeed) return;
  if (!on && sheet.open) sheet.close();
  if (stackFeed) stackFeed.arrange(); else if (!on) $('main').append(sheet);
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
// Each loaded card's read look, agent talk, reply arrow and the dots on the
// reader's own message while it waits for a reply, as they now stand.
function paintCardReading() {
  if (!views) return;
  const { kindOf } = whisperPeople();
  learnAnswered(views.messages, bootstrap.actor, kindOf);
  for (const entry of entries($('messages'))) {
    const card = cardIn(entry), item = views.messages.get(card.dataset.id);
    if (!item) continue;
    const quiet = agentTalk(item, bootstrap.actor, bootstrap.actor_kind, kindOf);
    entry.dataset.talk = quiet ? 'agents' : '';
    paintReading(card, item, { read: cardRead(item), quiet, go: goToMessage });
    paintAwaiting(card, item);
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
  // A dossier's folder wears its first poster's colour (item 477).
  paintFolderColors($('messages'));
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
function participantName(person, label = person.name || person.actor_id) {
  if (person.kind !== 'agent' || person.actor_id === bootstrap.actor) return null;
  let name = participantNames.get(person.actor_id);
  if (!name) {
    name = node('button'); name.type = 'button';
    name.setAttribute('aria-haspopup', 'dialog');
    name.onclick = () => run(() => pickColor(person.actor_id, name));
    participantNames.set(person.actor_id, name);
  }
  if (name.textContent !== label) name.textContent = label;
  name.title = `Change ${label}'s color`;
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
// Messages sent before times were kept have none. Beside the time, the marks of
// what the message carries: an image, the person's private note, a reply they
// saved and have not sent (carriesOf, item 127).
function paintCardAuthor(author, item) {
  paintAuthor(author, displayActor(item.author_id), Number.isSafeInteger(item.sent_ms) ? item.sent_ms : null, marks?.state(item.id)?.marked === true, wasEdited(item), carriesOf(item));
  if (item.whisper) paintWhisperAuthor(author, item, bootstrap.actor, document);
  if (here?.page) paintAsksYou(author, item, here.view?.waits, bootstrap.actor);
  // The star in its header, put back as the line is painted again (StackFeed.paintStar).
  stackFeed?.paintStar(author, item);
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
  if (!p || p.sourceUnavailable || ref?.kind !== 'message' || !topic || !mayStartFrom(p.source)) return;
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
  // an agent's whisper, which only answers (docs/whispers.md).
  $('start-from-message').hidden = !(p && !p.sourceUnavailable && ref?.kind === 'message' && topic && mayStartFrom(p.source));
  // A title line started from another message goes when the Reader moves on.
  if (startLine && (startLine.message !== ref?.id || $('start-from-message').hidden)) closeStartLine();
  // And, while the outcome's pipeline is on, become an item in it; an agent's
  // whisper never does (Core refuses it too). A person's may: the title line
  // shows what goes to the whole outcome before Return.
  $('add-to-pipeline').hidden = !(p && !p.sourceUnavailable && ref?.kind === 'message' && topic && pipelineRow?.on && mayStartFrom(p.source));
  if (pipelineAddFor !== null && pipelineAddFor !== ref?.id) closePipelineAdd(false);
  const state = p && !p.sourceUnavailable && p.mark && ref.kind === 'message' ? marks.state(ref.id) : null;
  paintMarkButton($('mark-unread'), state && { ...state, busy: marks.busy(ref.id) });
  // The ⋯ shows while it offers something: a message's or a Notebook page's
  // links (openReaderMenu), or the layout where the window has room to choose.
  $('reader-menu').hidden = !(p && !p.sourceUnavailable && ((ref?.kind === 'message' && topic) || (ref?.kind === 'memory' && p.source.owner_scope))) && !reader?.layoutChoice;
  paintReaderThumb$();
  paintReaderStar();
  paintReaderAside();
}
// The message the Reader shows, with its acts: its star and fold there are
// the reader's own (stack-feed.mjs). The page's reply stacks hold it, or, for
// a message of this topic no loaded page holds (opened alone, from a link to
// an older message), the page keeps its acts beside them (followReaderMessage).
// Null for a Notebook page, another topic's message, or until its acts are read.
function readerMessage() {
  const p = registry?.current, ref = p?.source?.source_ref;
  return stackFeed && !topicUnavailable && p && !p.sourceUnavailable && ref?.kind === 'message' && p.source.topic_id === topic?.id ? p.source : null;
}
function readerFeedItem() {
  const source = readerMessage(), id = source?.source_ref.id;
  return source ? views.messages.get(id) ?? views.aloneItem(id) : null;
}
// A message the Reader shows that no loaded page holds has its acts read with
// the loaded messages', and again whenever the topic's acts change: once the
// page reads what changes (freshness), which the next paint finds.
function followReaderMessage() {
  const source = readerMessage();
  if (freshness && views.showAlone(source?.source_ref.id ?? null, source?.seq)) freshness.invalidate('acts', 0, true);
}
// The star beside the Reader's title: the same act as Star for me in the
// card's ⋯ (StackFeed.star), so the card and the Reader agree. Outline until
// starred, filled once starred.
function paintReaderStar() {
  followReaderMessage();
  const button = $('reader-star'), item = readerFeedItem();
  button.hidden = !item;
  if (!item) return;
  const starred = Boolean(stackFeed.actsOf(item.id, item).starred), words = starred ? 'Unstar' : 'Star for me', glyph = starred ? '★' : '☆';
  // Its text is replaced only when it changes: Safari sends no click for a press whose text left the page before the
  // release, and a repaint held for a press runs at that release (press-hold.mjs).
  if (button.textContent !== glyph) button.textContent = glyph;
  button.setAttribute('aria-pressed', String(starred));
  button.setAttribute('aria-label', words); button.title = words;
}
function starFromReader() {
  const item = readerFeedItem();
  if (!item) return;
  stackFeed.star(item);
}
// The archive button beside the star (item 378): Move below More for the
// dossier the message is in, the same act as ⋯'s (StackFeed.setAside), with
// the count of the messages that go with it (StackFeed.asideOffer); Bring back once it is
// there, pressed. Only for a message the page's stacks hold, as ⋯ offers it.
function readerAside() {
  const item = readerFeedItem();
  return item && views.messages.has(item.id) ? stackFeed.asideOffer(item.id) : null;
}
function paintReaderAside() {
  const button = $('reader-aside'), offer = readerAside();
  button.hidden = !offer;
  if (!offer) return;
  const words = `${offer.below ? 'Bring back above More' : 'Move below More'}: ${offer.count} ${offer.count === 1 ? 'message' : 'messages'}`;
  // The number kept where it has not changed, as the star's glyph is (paintReaderStar).
  const count = button.querySelector('.aside-count'), shown = String(offer.count);
  if (count.textContent !== shown) count.textContent = shown;
  button.setAttribute('aria-pressed', String(offer.below));
  button.setAttribute('aria-label', words); button.title = words;
}
// The loaded feed owns its titles. An unloaded Reader source has one scoped
// lookup, refreshed with acts and neighbors, never a second feed/history cache.
// Fence every await on both the source and the newest lookup so a late answer
// cannot rename a newer Reader or undo a later name/join.
let dossierRead = 0;
async function readReaderDossier(presentation, read, current = () => true) {
  const lookup = ++dossierRead, accessEpoch = listAccessEpoch;
  const source = presentation?.source, id = source?.source_ref?.id;
  if (!presentation || presentation.sourceUnavailable || source.source_ref.kind !== 'message' ||
      source.topic_id !== topic?.id || views.messages.has(id) && stackFeed?.dossierName(id)) return true;
  const admitted = () => lookup === dossierRead && current() && accessEpoch === listAccessEpoch &&
    !topicUnavailable && registry.isSourceCurrent(presentation);
  const answer = checkedView(await read('stack_positions', { topic_id: source.topic_id, message_ids: [id] }), bootstrap.instance_id);
  if (!admitted()) return false;
  const position = answer.items.find(item => item.message_id === id)?.stack_position;
  if (answer.topic_id !== source.topic_id || !position?.root_id) throw Error('The dossier identity could not be confirmed.');
  let name = position.name?.text || null;
  if (!name && (position.root_id !== id || position.has_other_messages)) {
    let root = source;
    if (position.root_id !== id) {
      const page = checkedView(await read('topic_messages', { topic_id: source.topic_id, message_ids: [position.root_id] }), bootstrap.instance_id);
      if (!admitted()) return false;
      root = page.items.find(item => item.id === position.root_id);
      if (!root) throw Error('The dossier first message could not be confirmed.');
    }
    name = messagePreview(root);
  }
  registry.current.dossierName = name;
  registry.current.dossierPosition = position;
  return true;
}
// Item 550 retains the source dossier while the feed cannot name it. A scoped
// item 655 answer, including a cleared name, takes precedence while current.
function readerDossierName(source) {
  const ref = source?.source_ref;
  if (ref?.kind !== 'message' || source.topic_id !== topic?.id) return null;
  const drawnName = stackFeed && !topicUnavailable ? stackFeed.dossierName(ref.id) : null;
  if (drawnName) return drawnName;
  const p = registry.current, loaded = views.messages.get(ref.id), position = loaded?.stack_position;
  // A later loaded position must not revive metadata from its former dossier.
  if (!topicUnavailable && p?.source === source && p.dossierPosition) {
    return !loaded || position && position.root_id === p.dossierPosition.root_id &&
      position.name_revision === p.dossierPosition.name_revision &&
      position.at?.acts <= p.dossierPosition.at?.acts ? p.dossierName : null;
  }
  const dossier = source.dossier;
  if (!dossier) return null;
  return dossier.name?.text || (dossier.alone ? '' : messagePreview(dossier.first)) || null;
}
// The cover of that dossier (item 624), on the same terms: the Reader shows it as one line above the message.
function readerDossierCover(source) {
  const ref = source?.source_ref;
  return stackFeed && !topicUnavailable && ref?.kind === 'message' && source.topic_id === topic?.id ? stackFeed.dossierCover(ref.id) : null;
}
function paintReaderTitle() {
  const p = registry?.current;
  if (reader?.dialog?.open && p?.source && !p.sourceUnavailable) reader.paintTitle(p.source);
}
// A dossier holding a message the reader starred stays above More (item 635): the button shows as ever, and a
// press says why under it, moving nothing.
function asideFromReader() {
  const offer = readerAside();
  if (offer) stackFeed.setAside(offer.stack, !offer.below, { focus: false, at: $('reader-aside') });
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
  paintReaderReactions($('reader-reactions'), item, bootstrap.actor);
}
// Reply, or Return, on a lit message: the Reader opens on it with the cursor
// in the reply, and nothing quoted until the reader selects a passage. Return
// on a passage lit on its card, or words selected there (chosen), quotes them.
async function replyMessage(id, card, chosen = null) {
  await openSource({ kind: 'message', id }, card, marks.capture(id));
  if (!reader.dialog.open || registry.current?.source?.source_ref?.id !== id) return;
  if (chosen) reader.quoteFrom({ kind: 'message', id }, chosen); else reader.reply({ kind: 'message', id });
}
// Only the hover/touch bar's Reply docks the existing reply in its source
// card. Quote, Return and explicit Reader-opening controls keep their paths.
async function replyInCard(id, card) {
  await openSource({ kind: 'message', id }, card, marks.capture(id), card);
  if (reader.dialog.open && registry.current?.source?.source_ref?.id === id) reader.reply({ kind: 'message', id });
}
// Every page of the person's marks in this topic.
function loadMarks() {
  if (!marks || topicUnavailable) return Promise.resolve(true);
  if (authorityReviewPending()) return Promise.resolve(false);
  const landed = reading('marks');
  return marks.load(topic.id, async args => checkedView(await registry.cleanup.list(options => api.view('marks', args, options)), bootstrap.instance_id))
    .then(read => { if (read) landed(); return read; });
}
// The topic's own Notebook pages' read state, as loadMarks: nothing for a
// denied topic, and owed while the runtime changed.
// A Notebook page in the Reader that the topic's own changes do not cover (an
// outcome's page, or one of the topic's not loaded): each commit reads where it
// stands now, so the Reader offers a revision made since (docs/notebook-pages.md).
// A page the reader may no longer read has nothing to offer.
async function loadShownPage() {
  const ref = registry?.current?.source?.source_ref, id = ref?.kind === 'memory' ? ref.id : null;
  if (!id || views.memory.has(id) || topicUnavailable) return true;
  if (authorityReviewPending()) return false;
  try {
    const answer = checkedView(await registry.cleanup.list(options => api.view('memory_current', { item_id: id }, options)), bootstrap.instance_id);
    if (answer?.source_ref?.id !== id) throw Error('The Notebook page could not be confirmed.');
    views.revisions.observe(id, answer.source_ref.revision); reader.paintOffer();
    return true;
  } catch (error) { return readFailure(error).kind === 'forbidden'; }
}
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
    const { kind, why } = notTaken({ error });
    const words = kind === 'unreached' ? 'Connection interrupted; whether the mark was saved is unknown.' : kind === 'refused' ? `The mark was not saved${why ? `: ${why}` : ''}.`
      : kind === 'unconfirmed' ? `Not known whether the mark was saved: ${NOT_TAKEN[kind]}.` : `The mark was not saved: ${NOT_TAKEN[kind]}.`;
    if (registry.isSourceCurrent(p)) reader.notice(Error(`${words} Press again to send the same request.`, { cause: error }));
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
  const items = [...stack.first, { label: 'Copy Link', glyph: 'link', act: () => run(() => copyLink(item.topic_id, item.id, say)) }];
  const card = cardIn(messageEntries.get(item.id));
  if (cardScroll?.clipped(card, item)) items.push({ label: 'Show full message', glyph: 'full', act: () => run(() => cardScroll.showFull(card, item)) });
  // Edit, on the person's own message (docs/message-edit.md): the Reader opens on it to edit.
  if (mayEdit(item, editRights()) && !messageEdit) items.push({ label: 'Edit', glyph: 'pencil', act: () => run(() => editMessage(item.id, editOpener(item, anchor))) });
  if (marks && item.author_id !== bootstrap.actor && !topicUnavailable) {
    const marked = marks.state(item.id)?.marked === true;
    items.push({ label: marked ? 'Mark read' : 'Mark unread', glyph: marked ? 'read' : 'unread', act: () => run(() => markFromMenu(item.id, !marked)) });
  }
  return [...items, ...stack.last];
}
// A right-click on a message opens the same menu where the pointer is. On a
// link or a selection the browser's own menu stays, to copy what it offers.
function messageContextMenu(event) {
  if (event.target.closest('#reader')) return;
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
  } catch (error) {
    if (notTaken({ error }).kind === 'unreached') status(Error('Connection interrupted; whether the mark was saved is unknown. Choose it again to send the same request.', { cause: error }));
    else markRefused(messageId, marked, { error });
    return;
  }
  if (receipt?.status === 'committed' && !marked) { views.placeAfresh(); if (commitReload) run(commitReload); }
  if (receipt?.status !== 'committed') markRefused(messageId, marked, { receipt });
}
// A mark from a card's menu that Theseus answered without taking: said with
// its card until the marks, read again after it, show the card as Core holds
// them (stack-feed.mjs notTaken).
function markRefused(messageId, marked, failure) {
  cardSaid('message.mark', views.messages.get(messageId) ?? { id: messageId }, { marked }, 'marks')(failure);
  run(loadMarks);
}
// What says a card command Theseus answered without taking (stack-feed.mjs
// notTaken), and the read of what shows the cards that ends it (reading).
function cardSaid(kind, item, args, shows) { return failure => feedOf().notTaken(kind, item, args, failure, shows); }
function reading(what) { return stackFeed ? stackFeed.reading(what) : () => {}; }
// A Notebook page's link (docs/links.md, "A Notebook page's link"): the page as
// it stands, or with revision, that revision.
async function copyPageLink(source, revision, say) {
  const link = pageLink(source.owner_scope, source.source_ref.id, revision);
  if (!await copyText(link)) { status(`The link could not be copied here. Select it to copy it: ${link}`); return; }
  if (say?.getClientRects().length) sayOn(say, 'Link copied'); else status('Link copied.');
}
// The Reader's ⋯ (docs/reader.md): Copy Link, the mark, Quote selection while
// there is something to quote, Start a topic from this, Add to pipeline, and
// Wide or Stacked; for a Notebook page, Copy Link, Copy Link to Revision N and,
// for someone who may write it, Edit page (docs/notebook-writing.md).
// The message's own acts live here, not in a row under it; on a phone the
// menu opens as a sheet from the bottom.
function openReaderMenu() {
  const p = registry.current, ref = p?.source?.source_ref, button = $('reader-menu'), items = [];
  const message = Boolean(p && !p.sourceUnavailable && ref?.kind === 'message' && topic);
  if (message) items.push({ label: 'Copy Link', glyph: 'link', act: () => run(() => copyLink(p.source.topic_id, ref.id, button)) });
  // Edit turns the Reader to its edit mode on the message it shows (docs/message-edit.md).
  if (message && !messageEdit && mayEdit({ author_id: p.source.author }, editRights())) items.push({ label: 'Edit', glyph: 'pencil', act: () => run(() => editMessage(ref.id, button)) });
  if (p && !p.sourceUnavailable && ref?.kind === 'memory' && p.source.owner_scope) {
    items.push({ label: 'Copy Link', glyph: 'link', act: () => run(() => copyPageLink(p.source, null, button)) },
      { label: `Copy Link to Revision ${ref.revision}`, glyph: 'link', act: () => run(() => copyPageLink(p.source, ref.revision, button)) });
    // Edit page only for someone Core lets write the page (its reader_may_write, docs/notebook-pages.md).
    if (p.source.reader_may_write === true) items.push({ label: 'Edit page', glyph: 'pencil', act: () => { const opener = p.opener; $('reader-close').click(); run(() => openNotebook(ref.id, { opener })); } });
  }
  const state = message && p.mark ? marks.state(ref.id) : null;
  if (state) items.push({ label: state.marked ? 'Mark read' : 'Mark unread', glyph: state.marked ? 'read' : 'unread', act: () => run(toggleMark) });
  // Fold message: the reader's own fold, as Fold in the card's ⋯ (StackFeed.setFold); a starred message offers none.
  const item = message ? readerFeedItem() : null, acts = item ? stackFeed.actsOf(item.id, item) : {};
  if (item && acts.folded) items.push({ label: 'Unfold message', glyph: 'unfold', act: () => stackFeed.setFold(item, false, { focus: false }) });
  else if (item && !acts.starred) items.push({ label: 'Fold message', glyph: 'fold', act: () => stackFeed.setFold(item, true, { focus: false }) });
  if (reader.quotable) items.push({ label: 'Quote selection', glyph: 'quote', act: () => reader.quote() });
  if (!$('start-from-message').hidden) items.push({ label: 'Start a topic from this', glyph: 'topic', act: () => openStartLine() });
  if (!$('add-to-pipeline').hidden) items.push({ label: 'Add to pipeline', glyph: 'pipeline', act: () => (pipelineAddFor === null ? openPipelineAdd() : closePipelineAdd(true)) });
  if (reader.layoutChoice) items.push({ label: reader.layoutChoice, glyph: 'layout', act: () => reader.toggleLayout() });
  openMessageMenu({ anchor: button, items, label: ref?.kind === 'memory' ? 'This page' : 'This message', sheet: true });
}
// Who may edit which message here (message-edit-writing.mjs, mayEdit).
const editRights = () => ({ actor: bootstrap.actor, actorKind: bootstrap.actor_kind, unavailable: topicUnavailable, reached: outcomeReached });
// What an Edit chosen from a message's ⋯ gives the focus back to: its card,
// or the line it is folded to, rather than the bar's ⋯, which goes with the light.
function editOpener(item, anchor) {
  const entry = messageEntries.get(item.id), card = entry && cardIn(entry);
  if (card?.isConnected && !card.hidden) return card;
  return entry?.querySelector('.fold-line') ?? anchor ?? $('main');
}
// Edit on the person's own message (docs/message-edit.md). From a card's or a
// dossier row's ⋯ the Reader opens on the message, as a card's click opens
// it, and goes straight to its edit mode, as Edit page hands a page to its
// sheet; from the Reader's ⋯ the Reader turns to it in place. The edit mode
// has its own writing (message-edit-writing.mjs): it takes the message's edit
// session in Core, which holds the message from agents, keeps its draft in Core
// and on the device, and is saved with message.edit; the reply beside it is
// left as it is. The edit mode paints only once Core opened the session. Save,
// Cancel, Use saved and Escape end it, and the focus goes back to where Edit
// was chosen: a Reader opened for the edit closes onto the card.
async function editMessage(id, opener) {
  if (messageEdit) return;
  const shown = () => reader.dialog.open && registry.current?.source?.source_ref?.kind === 'message' &&
    registry.current.source.source_ref.id === id && !registry.current.sourceUnavailable;
  const opened = !shown();
  if (opened) await openSource({ kind: 'message', id }, opener);
  const p = registry.current;
  if (!shown() || messageEdit || !mayEdit({ author_id: p.source.author }, editRights())) return;
  let store;
  try { store = await messageEditStore({ instance_id: bootstrap.instance_id, actor_id: bootstrap.actor, message_id: id }); }
  catch (error) { reader.notice(error); return; }
  if (!registry.isSourceCurrent(p) || messageEdit) { store.close(); return; }
  const source = p.source;
  const writing = new MessageEditWriting({ message: { id, revision: revisionOf(source), body: source.body ?? '', attachments: source.attachments ?? [] },
    bootstrap, api, store, authority: () => registry.runtime.current,
    ...(Number.isSafeInteger(bootstrap.limits?.edit_hold_ms) ? { holdMs: bootstrap.limits.edit_hold_ms } : {}),
    read: async () => {
      const latest = checkedView(await api.view('source', { source_ref: { kind: 'message', id } }, { readClass: 'foreground' }), bootstrap.instance_id);
      return { revision: revisionOf(latest), body: latest.body };
    } });
  const session = messageEdit = { id, writing, opener, opened, presentation: p };
  // The edit mode shows only once the words kept on this device are read, and Core opened the session.
  try { await writing.load(); await writing.start(); } catch (error) { messageEdit = null; writing.close(); reader.notice(error); return; }
  // The Reader moved on while Core answered: the session it opened is closed again, once.
  if (!shown() || !registry.isSourceCurrent(p)) { messageEdit = null; await writing.abandon(); writing.close(); return; }
  const view = new MessageEdit({ host: $('message-edit'), writing, doc: document, done: state => run(() => finishEdit(session, state)) });
  reader.notice('');
  reader.startEdit({ field: view.field, save: () => run(() => writing.save()), leave: ({ closing = false } = {}) => leaveEdit(session, { closing }) });
  try { await writing.resume(); }
  catch (error) { if (messageEdit === session) { reader.notice(error); await writing.abandon(); leaveEdit(session); } }
}
// The edit mode goes: its writing stays on the device unless it ended
// (saved, cancelled, discarded). A Reader opened for the edit closes, giving
// the focus back to the card; one already open goes back to the message,
// with the focus on its ⋯.
function leaveEdit(session, { closing = false } = {}) {
  if (messageEdit !== session) return;
  messageEdit = null;
  session.writing.close();
  reader.stopEdit();
  if (closing) return;
  if (session.opened && registry.isSourceCurrent(session.presentation)) { run(() => reader.close()); return; }
  if (session.opener?.isConnected) session.opener.focus({ preventScroll: true });
}
// The edit ended. Saved: the Reader shows the new words at once, and the
// page reads the message from Core, which says the new revision to everyone
// reading it. Use saved: the saved words Core gave in the conflict.
function finishEdit(session, state) {
  const p = session.presentation, source = p.source, w = session.writing;
  if (state === 'saved') {
    if (revisionOf(source) < w.result.revision) Object.assign(source, { body: w.result.body, revision: w.result.revision, edited_ms: w.result.edited_ms });
    freshness?.invalidate('edit:' + session.id, w.result.revision); freshness?.request();
  } else if (state === 'discarded' && revisionOf(source) < w.base.revision) {
    Object.assign(source, { body: w.base.body, revision: w.base.revision });
    freshness?.invalidate('edit:' + session.id, w.base.revision); freshness?.request();
  }
  leaveEdit(session);
  if (registry.isSourceCurrent(p)) reader.redrawSource();
}
// A message edited (an actor-scope edit change, or the person's own Save): the
// page's copy of it, if loaded (TopicViews, edit:<id>), an attention row
// that shows it, and an open Reader on it, which shows the new words in place
// unless it is editing that very message: then its next Save is a conflict.
async function messageEdited(key, version, read, current) {
  const id = key.slice(5);
  // The rails beside the page keep a topic's newest messages by its version, which an edit does not move.
  shell.messageEdited(id);
  const done = await views.refresh(key, version, read, current);
  if (done === false || !current()) return done;
  if (attention?.last?.latest_addressed?.some(row => row?.message?.id === id)) attention.refresh();
  const p = registry.current;
  if (!reader.dialog.open || !p || p.sourceUnavailable || p.source.source_ref.kind !== 'message' || p.source.source_ref.id !== id) return done;
  if (messageEdit?.id === id || revisionOf(p.source) >= version) return done;
  // A page item may hold only the first words: the Reader reads the whole message.
  const loaded = views.messages.get(id);
  let latest = loaded && !loaded.preview && revisionOf(loaded) >= version ? loaded : null;
  // Refused (the message is no longer readable here): the Reader keeps what it shows, and the page goes on.
  try { latest ??= await read('source', { source_ref: { kind: 'message', id } }); }
  catch (error) { if (['FORBIDDEN', 'INVALID_ARGUMENT'].includes(error?.details?.error?.code)) return done; throw error; }
  if (!current() || !registry.isSourceCurrent(p) || messageEdit?.id === id || revisionOf(latest) <= revisionOf(p.source)) return done;
  Object.assign(p.source, { body: latest.body, revision: revisionOf(latest), edited_ms: latest.edited_ms ?? null, struck: latest.struck ?? null });
  reader.redrawSource();
  return done;
}
// Each card whose marks of the person's own note and saved reply changed
// (TopicViews.takeYours): its author line, then what the page puts back on
// that line as it is drawn afresh (the reply arrow, the bar), and the row of
// the stack it heads, which shows its marks (paintHeadCarries).
function repaintYours(ids) {
  for (const id of ids) {
    const item = views.messages.get(id), entry = messageEntries.get(id);
    if (!item || !entry) continue;
    const card = cardIn(entry);
    paintCardAuthor(card.querySelector(':scope > .message-author'), item);
    paintHeadCarries(card, item);
  }
  // The reply arrow goes back into each line painted again; the stacks are not arranged again, so the New line stays where it is.
  paintCardReading(); menu?.paint();
}
// Each card whose words an edit changed (TopicViews.takeRevised): the edited
// message's words, its excerpt cue, its folded line, its author line's
// "Edited" and whether it reads as read, and the reply line of each loaded reply to it; then the
// conversation's own copy of each edited message (edits, loaded here or not)
// and of each reply to one, and the stacks, whose rows read first lines.
function repaintEdited(ids, edits) {
  const CUE = 'Excerpt · Open to read the rest';
  if (here) followEdits(here.items, edits);
  for (const id of ids) {
    const item = views.messages.get(id), entry = messageEntries.get(id);
    if (!item || !entry) continue;
    const card = cardIn(entry);
    if (deferFencePaint(card, () => repaintEdited([id], edits))) continue;
    paintCardAuthor(card.querySelector(':scope > .message-author'), item);
    const line = card.querySelector(':scope > .message-reply-to'), answers = replyLine(item);
    if (line && answers) linkWords(line, answers, { partial: true });
    const preview = card.querySelector(':scope > .message-preview');
    if (preview) {
      formatWords(preview, item.body, { partial: item.preview === true, copyFences: 'feed', revision: revisionOf(item), struck: item.struck?.cuts });
      preview.classList.remove('scroll-in-place');
      const cue = card.querySelector(':scope > .message-preview-cue');
      if (item.preview && !cue) preview.after(node('span', CUE, 'message-preview-cue'));
      else if (cue && !item.preview) cue.remove();
      else if (cue) { cue.textContent = CUE; cue.hidden = false; }
    }
    paintCardImages(card, item, cardImageBytes(id));
    paintFoldWords(entry, item);
    cardScroll?.forget(id, card);
    // An agent's edit of words the person had read makes the message new to them again (item 614): Core says so
    // (unread), and opening it in the Reader earlier in this visit no longer reads it.
    if (item.unread === true) openedIds.delete(id);
  }
  paintCardReading(); stackMessages(); menu?.paint();
  if (here?.page) paintConversationPage();
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
// Older pages, one after another, until the message wanted() names ({id},
// or none) is loaded or no older page is left; its entry, or null. A read
// that moves nothing on (a refusal, or a review pending) ends it.
async function loadUntil(wanted) {
  const loaded = () => entries($('messages')).find(child => wanted() && child.dataset.id === wanted().id) ?? null;
  while (wanted() && !loaded() && views.olderCursor !== null) {
    const before = views.olderCursor, shared = listLoads.has('messages');
    await listPage('messages', true);
    if (!shared && views.olderCursor === before) break;
  }
  return loaded();
}
// The New line's "More new below": the line's message read in; then it takes
// the focus, with the line in its place below it.
async function loadToUnread() {
  return landUnreadMessage(views.line);
}
// What a topic's unread count leads to (item 613, docs/attention.md): the
// oldest message still unread for the reader, as Core finds it by the rule
// the count keeps, read in however far back it is, and on to its dossier's
// first message (its stack_position's root), so the dossier is drawn whole
// rather than from the message; its dossier open, its earlier-messages row
// expanded as far as it, the message whole, brought into view and given the
// focus, so it is plainly on the screen. Reading it there settles it, as any
// card read on screen, and the count goes with it.
async function landOnUnread() {
  // Pressed in the phone's drawer, the drawer gets out of the way as a move would close it (rail-drawer.mjs).
  if (shell.drawer?.isOpen()) shell.drawer.close();
  return landUnreadMessage(views.oldestUnread);
}
let unreadLanding = 0, unreadLandingBusy = false;
// Both explicit ways to read the oldest unread message earn the same view
// and the same revision-fenced mark clear. Capture before any page loads:
// another device renewing the mark while they run must keep its newer mark.
async function landUnreadMessage(wanted) {
  const request = ++unreadLanding, act = wanted && marks.capture(wanted.id);
  const current = () => request === unreadLanding && !registry.disposed;
  // Pagination can briefly put another unread card on screen on the way to
  // this one. Those transient positions are not a person's reading place.
  unreadLandingBusy = true;
  try {
    const found = await loadUntil(() => wanted);
    if (!current()) return;
    if (!found) return;
    const id = found.dataset.id, root = views.messages.get(id)?.stack_position?.root_id ?? null;
    if (root) await loadUntil(() => ({ id: root }));
    if (!current()) return;
    const entry = entries($('messages')).find(child => child.dataset.id === id);
    if (!entry) return;
    reveal(entry, { full: true, open: true });
    const card = opened(entry);
    revealSelection(card);
    card.focus({ preventScroll: true });
    marks.read(act, () => current() && card.isConnected && document.activeElement === card && onScreen(card));
  } finally {
    if (request === unreadLanding) { unreadLandingBusy = false; if (!registry.disposed) noteRead(); }
  }
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
    drawFeed(false);
    // Nor the pictures of its messages (card-images.mjs).
    dropCardImages($('messages'));
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
      if (key.startsWith('edit:')) return messageEdited(key, version, read, current);
      // The edit session of one of the person's messages moved (docs/message-edit.md): another device may have taken it.
      if (key.startsWith('edit_session:')) { if (messageEdit?.id === key.slice(13)) messageEdit.writing.sessionChanged(version); return true; }
      if (key !== 'neighbors') {
        const done = await views.refresh(key, version, read, current);
        if (key === 'acts' && done !== false && current()) {
          await readReaderDossier(registry.current, read, current);
          if (current()) paintReaderTitle();
        }
        return done;
      }
      const p = registry.current;
      if (!p || p.source.source_ref.kind !== 'message') return true;
      await readReaderDossier(p, read, current);
      if (!current() || !registry.isSourceCurrent(p)) return true;
      paintReaderTitle();
      p.neighbors = null; p.core = null;
      const result = await registry.neighbors(p, { read });
      if (!current() || !registry.isSourceCurrent(p) || !result) return true;
      takeNeighbors(registry.current, result); return true;
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
  // A topic's unread count opens it at its oldest unread message (item 613).
  const atUnread = route.kind === 'topic' && route.at === 'unread';
  if (anchored || pageAnchor || atUnread) { route = { kind: 'topic', id: topicId }; shell.rename(route, location.hash); }
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
  // The conversation's own items hold messages' words too (followEdits): an edit of one of them, or of one a reply among them answers, is read.
  const holds = id => Boolean(here?.items.has(id) || [...(here?.items.values() ?? [])].some(item => item.reply_to === id));
  views = new TopicViews({ instanceId: bootstrap.instance_id, topicId, reader: bootstrap.actor, paint: paintViews, invalidate: (key, version, force) => freshness?.invalidate(key, version, force), holds, reading });
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
  // "Tools this topic improves" (docs/skills-and-tools.md): read with the page, and again as Topic settings opens.
  // One for the topic being read: a topic reached in place replaces the one before, so its chips never paint here.
  settings ??= new TopicSettings({ dialog: $('topic-settings'), gear: $('settings-open'), heading: $('settings-title'), close: $('settings-close'),
    opened: () => { const tools = topicTools; if (tools) run(() => tools.load()); } });
  $('topic-tools').hidden = true; $('topic-tools').replaceChildren();
  topicTools = here.page ? null : new TopicTools({ host: $('topic-tools'), topicId: topic.id, instanceId: bootstrap.instance_id, read: pipelineView, send: pipelineSend });
  if (topicTools) { const tools = topicTools; run(() => tools.load()); }
  try {
    const workspace = validate(await api.view('workspace', { workspace_id: topic.workspace_id })).workspace;
    $('workspace-name').textContent = workspace.title;enableNewTopic(workspace.id);here.title = workspace.title;
    // A reached, archived or completed outcome's messages are kept to read: none offers Edit. Read in the background; Core
    // refuses an edit there anyway. Archived or completed (item 404), the header says so, with Bring back for its owner.
    const readKept = () => api.view('outcome_light', { workspace_id: workspace.id }, { readClass: 'background' }).then(answer => {
      const light = checkedView(answer, bootstrap.instance_id);
      outcomeReached = keptToRead(light);
      paintKeptLine($('outcome-kept'), light, workspace.owner_id === bootstrap.actor ? async () => {
        const current = validate(await api.view('workspace', { workspace_id: workspace.id })).workspace;
        await sendEnd(pipelineSend, workspace.id, 'open', current.version);
        await readKept();
        freshness?.request();
        $('inline-writing-body').focus();
      } : null);
    });
    readKept().catch(() => {});
    here.has ||= hasConversation(workspace);
    if (here.page) $('inline-writing-body').placeholder = conversationPlaceholder(workspace.title);
  } catch { $('workspace-name').textContent = topic.workspace_id; }
  // Those who can be added: the outcome's team, or everyone when the team cannot be read.
  participantsPanel = new PeoplePanel({ host: $('participants'), label: 'Add someone to this topic', dismissible: true,
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
    actorLabel,
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
    recipientsPainted: names => { if (here?.page || answering.size) answeredBy(inline, $('inline-composer').querySelector('.audience'), names, Boolean(here?.page)); },
  });
  reader = new Reader({
    images: topicImages, imageBytes, pageImage,
    cardSelection: card => menu?.passages.chosen(messageEntries.get(card.dataset.id)) ?? null,
    actorName: displayActor,
    actorLabel,
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
    close: async (_sessions, reason) => {
      const p = reader.presentation;
      try {
        if (!await registry.close(p, { explicit: true })) return false;
        if (reason === 'parent' && !p.sourceUnavailable && p.source.source_ref.kind === 'message' && p.source.topic_id === topic.id) {
          const source = p.source, id = source.source_ref.id, accessEpoch = listAccessEpoch;
          if (!views.messages.has(id)) {
            const foreground = registry.cleanup.foreground();
            try {
              const page = checkedView(await foreground.read(options => api.view('topic_messages', { topic_id: topic.id, audience: 'all', direction: 'before', cursor: source.seq + 1, limit: 30 }, options)), bootstrap.instance_id);
              if (accessEpoch !== listAccessEpoch || topicUnavailable || registry.current) return true;
              views.messagesPage(page, { anchored: true, cursor: source.seq + 1 });
            } finally { foreground.release(); }
          }
          if (accessEpoch !== listAccessEpoch || topicUnavailable || registry.current) return true;
          if (here?.page && here.onlyNew) { here.onlyNew = false; paintConversationPage(); }
          landOn(id, { full: true })?.focus({ preventScroll: true });
        }
        return true;
      } catch (error) { if (reader.dialog.open) reader.notice(error); else status(error); return false; }
    },
    step: async direction => {
      const presentation = registry.current, neighbors = onPage(presentation, presentation.core ?? await registry.neighbors(presentation));
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
    dossierName: source => readerDossierName(source),
    dossierCover: source => readerDossierCover(source),
    people: whisperPeople, actor: () => bootstrap.actor,
  });
  // The Reader's ⋯ offers Wide or Stacked only where the window can choose, so
  // a window that crosses a phone's width shows or hides it again.
  reader.narrow.addEventListener('change', paintReaderMark);
  registry = new EditorRegistry({ api, bootstrap, journal, present, changed,
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
    recorded: () => { attention?.refresh(); if (commitReload) run(commitReload); }, reading: id => reading('reaction:' + id) });
  mountFeedFences($('messages'));
  keepLineRoom($('main'), $('messages'));
  cardScroll = new CardScroll({ read: async (id, readClass) => checkedView(await api.view('source', { source_ref: { kind: 'message', id } }, { readClass }), bootstrap.instance_id), press: pressHold });
  const act = work => run(async () => { try { await work; } finally { paintViews('reactions'); } });
  // A thumbs-up reads its message in Core (docs/thumbs.md). One that read it
  // (Core settled the person's delivery of it, or cleared their mark on it)
  // places the New line afresh, as Mark read does, wherever the oldest unread
  // message now is; one on a message already read moves nothing.
  const thumbMessage = async (item, on, said = null) => {
    const receipt = await reactions.thumb(item, on, said);
    if (receipt?.result?.settled === true && receipt.result.topic_id === views?.topicId) { views.placeAfresh(); if (commitReload) run(commitReload); }
    return receipt;
  };
  // ⌘C on a lit message: its words as written, the words the Reader's ⇧⌘C
  // copies; a cut-off card's whole message, read from its source (lighting it
  // reads it, so it is usually here already; when that read has not come, the
  // copy reads it as the person's act, never behind the background lane).
  // Nothing is said when it is copied, as in the Reader; a refusal says how
  // else to copy.
  const copyMessage = (item, words) => {
    // A passage lit on the card: its words, as Return would quote them.
    if (words !== undefined) { copyText(words).then(done => { if (!done) status(COPY_REFUSED); }); return; }
    const known = item.preview ? cardScroll.known(item.id) : item.body;
    const copied = known !== undefined ? copyText(known) : cardScroll.whole(item.id, 'foreground').then(body => copyText(body), () => false);
    copied.then(done => { if (!done) status(COPY_REFUSED); });
  };
  menu = new MessageMenu({ host: $('messages'), item: id => views.messages.get(id), viewer: bootstrap.actor, kind: bootstrap.actor_kind,
    reply: (id, card) => run(() => replyMessage(id, card)),
    inlineReply: (id, card) => run(() => replyInCard(id, card)),
    quote: (id, card, chosen) => run(() => replyMessage(id, card, chosen)),
    // A thumbs-up on a reply deals with its stack up to it (stack-feed.mjs).
    // What Theseus answered without taking a card's 👍 or answer is said with its card (stack-feed.mjs notTaken).
    thumb: (item, on) => act(thumbMessage(item, on, cardSaid('message.thumb', item, { thumbed: on }, 'reaction:' + item.id)).then(receipt => { if (on && receipt) stackFeed?.thumbed(item); return receipt; })),
    answer: (item, answer) => act(reactions.answer(item, answer, cardSaid('message.answer', item, { answer }, 'reaction:' + item.id))),
    more: openMessageMore, copy: copyMessage,
    expand: (card, item) => cardScroll.expand(card, item),
    // The bar's Show full message and Fold (item 473), as ⋯ offers them.
    clipped: (card, item) => Boolean(cardScroll?.clipped(card, item)), showFull: (card, item) => run(() => cardScroll.showFull(card, item)),
    foldState: item => (stackFeed && !topicUnavailable ? stackFeed.foldState(item) : null),
    fold: item => { stackFeed?.toggleFold(item); if (menu?.lit) menu.paintBar(); } });
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
  $('reader-star').onclick = () => starFromReader();
  $('reader-aside').onclick = () => asideFromReader();
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
  topicNavigation = new TopicNavigation({ registry, current: route,
    navigateTarget: (target, still) => { marks.leave(); if (!shell.go(target, still)) shell.leave(routeHref(target)); } });
  await initializeInlineComposer();
  // The conversation has its own row, never one among the topics; the outline
  // holds this list, and the right rail the outcome's Build topics (item 297).
  topicRail = new TopicRail({ reader: bootstrap.actor, pageMax: pageMax(), pages: new TopicPages(bootstrap.instance_id, topic.workspace_id, here.page ? null : topic, 'active', true),
    host: $('topics'), more: $('more-topics'), retry: $('retry-topics'), message: $('topics-status'), key: $('topics-key'), ...topicFolds(),
    denied: error => readFailure(error).kind === 'forbidden',
    read: async args => {
      if (authorityReviewPending()) throw Error('The runtime changed. Review saved writing before reloading.');
      const answer = checkedView(await registry.cleanup.list(options => api.view('workspace_topics', args, options)), bootstrap.instance_id);
      if (registry.disposed || authorityReviewPending()) throw Error('The runtime changed. Reload after reviewing saved writing.');
      return answer;
    },
    open: (id, title, message, at) => openDestination(topicTarget(id, message, at), title),
    // Read once: the outline takes this list in from then on (outline-rail.mjs).
    updated: () => { $('topic-navigation').dataset.listed = ''; },
  });
  // The rail shows only this topic's outcome. A message's Add to pipeline
  // follows the Pipeline row's read.
  const pipeline = pipelineSection(topic.workspace_id, false, paintReaderMark); pipelineRow = pipeline.row;
  // The latest read of the outcome's conversation; the page waits on its first
  // (below).
  let conversationRead = null;
  outcomeScope = new OutcomeScope({ workspaceId: topic.workspace_id, kind: 'topic', rail: document.querySelector('.rail'), home: $('outcomes-home'),
    attention, open: openDestination, sections: [{ name: 'conversation', node: $('conversation-navigation'), load: () => (conversationRead = loadConversation()) }, pipeline,
      { name: 'topics', node: $('topic-navigation'), load: () => topicRail.load() }] });
  placeBrand(document.querySelector('.rail'));
  outcomeScope.load();
  const conversationShown = conversationRead;
  // The open topic's marks are the person's own, read by the person's scope
  // and paged; the open Reader's button follows them. The New line follows
  // what the person has read, here or anywhere else. The topic's own Notebook
  // pages' read state is read again too, so a page read since, here or
  // elsewhere, loses its light; and an outcome's page in the Reader is read
  // where it stands, so the Reader offers a revision made since.
  commitReload = followCommits(async () => {
    const sections = await outcomeScope.load(), marked = await loadMarks(), unread = await loadUnread(), read = await loadReadState(), shown = await loadShownPage();
    await wakeLights.load(); participantsPanel?.paint();
    return sections !== false && marked !== false && unread !== false && read !== false && shown !== false;
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
  $('more-messages').onclick = () => run(() => { fillFrom($('messages')); return listPage('messages', true); }); $('more-memory').onclick = () => run(() => listPage('memory', true));
  window.addEventListener('beforeunload', () => marks.leave());
  shell.guard(() => registry.hasUnprotectedWriting);
  // An edit open in the Reader sends nothing at unload (its hold lapses), and lets its Web Lock go.
  window.addEventListener('pagehide', () => { freshness?.dispose(); registry.dispose(); journal.close(); revokeMedia(); messageEdit?.writing.close(); });
  views.messagesPage(messageAnswer, { initial: true }); views.memoryPage(memoryAnswer, { initial: true });
  // What is drawn above the messages after they paint, in their column: the
  // marks line ("1 marked unread · Read it") and, on a conversation page, its
  // Show row and header, which land with the conversation's first read. The
  // outcome rail never is: it sits beside the topic, or on a phone in the
  // drawer behind "☰ Topics" (rail-drawer.mjs). Cards count as seen once each
  // has had its first answer, read or refused (noteRead), so neither moves a
  // card the page has already counted.
  const firstReading = Promise.allSettled([run(loadMarks), here.page ? conversationShown : null]).then(() => { laidOut = true; noteRead(); });
  document.body.dataset.ready = 'true'; enableFreshness(checkpoint, actorCheckpoint);
  // The rails beside the page read through this run from now on (rails.mjs).
  shell.ready({ api, bootstrap, live, workspaceId: topic.workspace_id, workspaceTitle: $('workspace-name').textContent, topic, pageMax: pageMax(),
    view: async (name, args, readClass = 'background') => checkedView(await api.view(name, args, { readClass }), bootstrap.instance_id),
    open: (target, title, from) => openDestination(target, title, from), readable: () => !topicUnavailable && !freshness?.stopped, currentTopic: () => topic,
    // The rail's Starred takes a star off (stack-feed.mjs); its Notebook section starts the topic's pages and the outcome's.
    unstar: star => stackFeed?.unstar(star), notebookCreate: notebookCreator });
  // A message's link opens its topic, or its outcome's conversation, with that
  // message in the Reader; the address then names the page alone, as any does.
  // This run's first marks read establishes what its reading act may clear.
  // The older pages begin only after that baseline, as on a card already shown.
  if (atUnread) run(() => firstReading.then(landOnUnread));
  if (anchored) {
    const card = landOn(anchored);
    run(async () => { await openSource({ kind: 'message', id: anchored }, card ?? $('main')); if (notebookReturning()) notebookSheetOf().resume(); });
  } else if (!pageAnchor && notebookReturning()) {
    // Back from a card's reply stack in another topic, by the way back its Reader showed (notebook-sheet.mjs).
    notebookSheetOf().resume();
  }
  // A Notebook page's link opens the page in the Reader, as its card or row does.
  if (pageAnchor) run(async () => (pageAnchor.revision ? openSource(await pageSource(pageAnchor), $('main')) : openNotebook(pageAnchor.id, { opener: $('main') })));
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
    // The background directory may arrive after a card. Update labels in
    // place, without reloading content or rearranging what is being read.
    if (views) for (const entry of entries($('messages'))) {
      const card = cardIn(entry), item = views.messages.get(card.dataset.id);
      if (item) paintCardAuthor(card.querySelector('.message-author'), item);
    }
    if (reader?.source && !registry?.current?.sourceUnavailable) reader.paintOrigin(reader.source);
    if (reader?.sessions) { reader.paintRecipients(); reader.paintChoice(); }
    if (inline?.editor) { inline.paintRecipients(); inline.paintChoice(); }
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
    const view = answer.conversation;
    // On the page the waits and the items are taken together: a paint between the two reads
    // (the messages' own, on every feed read) would put the new waits beside an item's old state.
    const page = here.page && view ? checkedView(await api.view('topic_messages', { topic_id: view.topic_id, direction: 'before', limit: 100 }, { readClass: 'background' }),
      bootstrap.instance_id) : null;
    here.view = view; here.read = true;
    for (const item of page?.items ?? []) here.items.set(item.id, item);
    paintConversationNav();
    if (page) {
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
    href: routeHref(target), open: (to = target) => openDestination(to, CONVERSATION_TITLE) });
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
  // Only new draws just the New items (aim.css): the Reader's ↑ and ↓ step along those (reply-stacks.mjs, shownView).
  stackState($('messages')).only = here.onlyNew ? item => conversationItem(item.id)?.item?.state === 'new' : null;
  const empty = !views?.messages?.size;
  $('conversation-empty').hidden = !empty;
  if (empty) paintEmpty($('conversation-empty'), { view });
  // What the conversation's read says can keep a reply in view in its stack.
  if (views?.messages) stackMessages();
  for (const entry of entries($('messages'))) {
    const card = cardIn(entry), id = card?.dataset?.id, item = id ? conversationItem(id) : null;
    entry.dataset.item = item?.item?.state ?? 'none';
    if (!item) continue;
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
    nameOf: actorLabel,
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
  const next = await registry.open(ref, { topicId: value, opener: p.opener, replyCard: p.replyCard });
  if (!next) return;
  const keep = editor => { if (reader.editor === editor) reader.drawEditor(); return registry.edited(editor); };
  if (await switchWriting(left, next.editors.reply, keep)) reader.notice(`Your writing for ${place} is kept there.`);
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
    // As it stands, it opens in the composer over the page (notebook-sheet.mjs); at a revision, to read.
    if (!page.revision) {
      const opener = from?.closest?.('dialog') ? registry?.current?.opener : from;
      if ((topic && views && (target.kind === 'topic' ? target.id === topic.id : target.id === topic.workspace_id)) || (!topic && pageHere && target.kind === 'workspace' && target.id === pageHereOutcome))
        return run(() => openNotebook(page.id, { opener: opener?.isConnected ? opener : document.activeElement }));
    }
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
  // move the guard refused) lands as a move does (in-place-navigation.mjs).
  try { const moved = await pending; if (!moved) shell.stayed(); return moved; }
  catch(error) {
    if(serial!==topicNavigation.serial)return;
    shell.stayed();
    stayedWhy(error);
  }
}
// Why the page stayed, said by the topic line: for a move the guard refused,
// and for one the shell refused once it had read the build (in-place-navigation.mjs, decide).
function stayedWhy(error) {
  const notice=$('topic-navigation-status');
  showLine(notice,error);
  // Said where the person is looking: the Reader or the New message sheet,
  // open over the page, covers the rail's notice, so it says why it stayed too.
  const near=$('reader').open?'reader-notice':$('new-message-sheet').open?'inline-notice':null;
  if(near)showLine($(near),error);else notice.scrollIntoView({block:'nearest'});
}
// A move found Theseus updated while writing here was not yet safe, or changed as the move waited
// (in-place-navigation.mjs, updated): the page stays, and says so where a refused move says why, with Reload,
// which goes through the browser's own guard, so words not yet kept are asked about first.
function updatedNotice(reload) {
  const said = () => { const again = node('button', 'Reload'); again.type = 'button'; again.className = 'updated-reload'; again.title = 'Reload Theseus'; again.onclick = reload; return ['Theseus updated.', again]; };
  const notice = $('topic-navigation-status');
  showLine(notice, said());
  const near = $('reader').open ? 'reader-notice' : $('new-message-sheet').open ? 'inline-notice' : null;
  if (near) showLine($(near), said()); else notice.scrollIntoView({ block: 'nearest' });
}
// painted hears the outcome rows after each read (the outcome page's "Also waiting on you" line).
// opens: what a press on an outcome opens, its page ('workspace') or its Conversation ('conversation').
function initializeOutcomeNavigation(current=null,painted=()=>{},opens='workspace') {
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
    denied:error=>readFailure(error).kind==='forbidden',pageMax:pageMax(),peek,painted,opens,
    // The home's "Archived (N)" rows: their owner brings one back from its row (item 404).
    reader:bootstrap.actor,bringBack:opens==='conversation'?item=>sendEnd(pipelineSend,item.id,'open',item.version):null});
}
async function initializeOutcomePage(route) {
  // There is no topic, implicit composer or source in a selection-only view.
  if(route.kind==='create')return initializeCreationPage(route);
  if(route.kind==='opening')return initializeOpeningPage(route);
  if(route.kind==='pipeline'||route.kind==='item')return initializePipelinePage(route);
  if(route.kind==='health')return initializeHealthPage();
  if(route.kind==='measurements')return initializeMeasurementsPage(route);
  if(route.kind==='tool')return initializeToolPage(route);
  if(route.kind==='cards')return initializeDeckPage(route);
  if(!['root','workspace'].includes(route.kind))throw Error('This opening link is not available yet. Open Outcomes to choose a place.');
  // A Notebook page's link opens the page in place once the outcome's lists are
  // up; the address then names the outcome alone, as a message's link does.
  const shown=route.page?{id:route.page,revision:route.revision??null}:null;
  if(shown){route={kind:'workspace',id:route.id};history.replaceState(history.state,'',routeHref(route)+location.hash);}
  status('');
  drawFeed(false,'topic-pending','inline-composer');
  $('outcome-page').hidden=false;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>shell.leave(routeHref(target))});
  sentHost=$('sent-to-you');
  if(attention?.last)paintSent(sentHost,attention.last,{open:openSent,acknowledge:markSent,read:readSent,attachment:sentAttachment});
  if(route.kind==='root') {
    // What waits on the reader, every outcome's, heads the Outcomes home only (item 86):
    // an outcome's own page says its questions once, in "Where it stands".
    waitingHost=$('waiting-on-you');
    if(attention?.last)paintWaiting(waitingHost,attention.last,(id,title)=>openDestination({kind:'topic',id},title));
    // The home has no heading of its own: the list of outcomes is the page, and a press on one opens its Conversation (item 384).
    document.querySelector('#main > .topic-header').hidden=true;
    $('outcomes-heading').textContent='Your outcomes';
    $('outcome-page').append($('outcome-navigation'));document.querySelector('.rail').hidden=true;
    initializeOutcomeNavigation(null,()=>{},'conversation');
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
    $('outcome-page').append($('also-waiting'),$('outcomes-status'),$('retry-workspaces'),$('outcome-standing'),$('target-panel'),$('pipeline-line'),$('loop-panel'),$('problems-panel'),$('conversation-navigation'),$('topic-navigation'),$('outcome-references'),$('page-here'),$('outcome-tools'));
    // Archived, completed or brought back (item 404): the page reads again, and once it is archived or completed the keys
    // go to Bring back on "Where it stands" (back, the target card gives them to the word that ended it).
    const targets=new OutcomeTargets({hosts:{target:$('target-panel'),loop:$('loop-panel'),problems:$('problems-panel')},workspace:route.id,reader:bootstrap.actor,read:pipelineView,send:pipelineSend,
      changed:async({state,refused})=>{await reload().catch(()=>{});if(!refused&&state!=='open')$('outcome-standing').querySelector('[data-hold="bring-back"]')?.focus();}});
    // Its skills and tools, and the ones it says it uses (docs/skills-and-tools.md).
    const outcomeTools=new OutcomeTools({host:$('outcome-tools'),workspace:route.id,instanceId:bootstrap.instance_id,read:pipelineView,send:pipelineSend,open:openDestination});
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
        if(serial===standingSerial)paintStanding($('outcome-standing'),answer,{retry,outcome:workspace.title,place:'outcome:'+route.id,open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title),
          bringBack:workspace.owner_id===bootstrap.actor?()=>targets.bringBack():null});
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
          $('outcome-references').hidden=true;$('page-here').hidden=true;$('outcome-standing').hidden=true;$('also-waiting').hidden=true;$('conversation-navigation').hidden=true;$('outcome-tools').hidden=true;
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
        open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title),
        updated:()=>{$('outcome-empty').hidden=!topicRail.empty||!$('topics-status').hidden;}});
      if(!outcomeReferences)outcomeReferences=outcomePages(route.id,()=>run(reload));
      return (await Promise.all([stands(workspace),targets.load(),topicRail.load(),outcomeTools.load(),outcomeReferences.load(),loadConversation(),
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
    if(shown)run(async()=>(shown.revision?pageHere.open(await pageSource(shown),$('main')):openNotebook(shown.id,{opener:$('main')})));
    else if(notebookReturning())notebookSheetOf().resume();
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
// The rail's Skills and tools (docs/skills-and-tools.md): the outcome's own and
// those it says it uses, names only; hidden when there are none.
function skillsSection(workspace,current=null) {
  const rail=new ToolsRail({section:$('skills-navigation'),host:$('skills-links'),workspace,current,instanceId:bootstrap.instance_id,read:pipelineView,open:openDestination});
  return {name:'skills',node:$('skills-navigation'),load:()=>rail.load()};
}
// An outcome's pipeline, or one item's record in it: the rail shows this
// outcome as a topic page's does (its conversation, Pipeline row, topics and
// Notebook pages); the page and the rail read again on every commit.
async function initializePipelinePage(route) {
  status('');
  drawFeed(false,'topic-pending','inline-composer');
  $('pipeline-page').hidden=false;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>shell.leave(routeHref(target))});
  const page=new PipelinePage({host:$('pipeline-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},
    reader:bootstrap.actor,instanceId:bootstrap.instance_id,workspace:route.id,item:route.kind==='item'?Number(route.item):null,read:pipelineView,send:pipelineSend});
  enableNewTopic(route.id);
  topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.id,null),host:$('topics'),more:$('more-topics'),
    retry:$('retry-topics'),message:$('topics-status'),...topicFolds(),key:$('topics-key'),denied:error=>readFailure(error).kind==='forbidden',
    read:async args=>checkedView(await api.view('workspace_topics',args,{readClass:'foreground'}),bootstrap.instance_id),
    open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title)});
  pagesInPlace(route.id,()=>{});
  // The outcome's title names its conversation's row, and whether it has one keeps the row's place.
  here={workspaceId:route.id,title:route.id,view:null,page:false,has:false,onlyNew:false,items:new Map()};
  try { const workspace=(await pipelineView('workspace',{workspace_id:route.id})).workspace;here.title=workspace.title;here.has=hasConversation(workspace); } catch {}
  outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'pipeline',rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:[{name:'conversation',node:$('conversation-navigation'),load:loadConversation},pipelineSection(route.id,route.kind==='pipeline'),{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},skillsSection(route.id)]});
  placeBrand(document.querySelector('.rail'));
  await followCommits(async()=>(await Promise.all([outcomeScope.load(),page.load()])).every(read=>read!==false))();
  document.body.dataset.ready='true';
}
// The instance's Health page (docs/health.md): no rail, the logo block and
// "← Outcomes" head it; it reads the health view again on every commit and
// says at once when the live feed drops.
async function initializeHealthPage() {
  status('');
  drawFeed(false,'topic-pending','inline-composer');
  document.querySelector('.rail').hidden=true;
  $('main').prepend($('outcomes-home'));placeBrand($('main'));
  $('health-link').setAttribute('aria-current','page');
  $('topic-title').textContent='Health';$('topic-description').textContent='Read live from Theseus; it follows every change.';
  const page=new HealthPage({host:$('health-page'),feed:()=>live?.state??null,
    control:(actor_id,desired,revision)=>api.command({v:1,instance_id:bootstrap.instance_id,operation_id:crypto.randomUUID(),
      kind:'agent.execution',target:{actor_id},args:{desired},expected:{execution_revision:revision,authority:{authority_id:bootstrap.authority.authority_id,authority_epoch:bootstrap.authority.authority_epoch}}}),
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
  drawFeed(false,'topic-pending','inline-composer');
  document.querySelector('.rail').hidden=true;
  $('main').prepend($('outcomes-home'));placeBrand($('main'));
  // The way back names the page's topic or outcome, or says only "The page" when that read fails.
  const place=async scope=>{
    const href=routeHref({kind:scope.kind,id:scope.id,page:route.id});
    try { return {href,title:scope.kind==='topic'?(await pipelineView('topic',{topic_id:scope.id})).topic.title:(await pipelineView('workspace',{workspace_id:scope.id})).workspace.title}; }
    catch { return {href,title:'The page'}; }
  };
  const page=new NotebookPage({host:$('deck-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},
    item:route.id,read:pipelineView,send:pipelineSend,place,askIn:notebookAskIn,api,bootstrap,mode:route.view??'cards'});
  shell.guard(()=>Boolean(page.writing?.journalPending||page.writing?.journalError));
  $('deck-page').hidden=false;
  await followCommits(()=>page.load())();
  if(route.write==='new' && page.base && !page.base.body && !page.readOnly) page.start();
  document.body.dataset.ready='true';
}
// An outcome's Measurements: every check's readings by release (docs/targets.md). The rail
// shows this outcome, as on its pipeline page; the page and the rail read again on every commit.
async function initializeMeasurementsPage(route) {
  status('');
  drawFeed(false,'topic-pending','inline-composer');
  $('measurements-page').hidden=false;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>shell.leave(routeHref(target))});
  const page=new MeasurementsPage({host:$('measurements-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},workspace:route.id,read:pipelineView});
  enableNewTopic(route.id);
  topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.id,null),host:$('topics'),more:$('more-topics'),
    retry:$('retry-topics'),message:$('topics-status'),...topicFolds(),key:$('topics-key'),denied:error=>readFailure(error).kind==='forbidden',
    read:async args=>checkedView(await api.view('workspace_topics',args,{readClass:'foreground'}),bootstrap.instance_id),
    open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title)});
  pagesInPlace(route.id,()=>{});
  outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'measurements',rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:[pipelineSection(route.id,false),{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},skillsSection(route.id)]});
  placeBrand(document.querySelector('.rail'));
  await followCommits(async()=>(await Promise.all([outcomeScope.load(),page.load()])).every(read=>read!==false))();
  document.body.dataset.ready='true';
}
// A skill's or tool's page (docs/skills-and-tools.md): in its home outcome, whose
// rail it shows when the reader can read the home; with no rail otherwise, the
// logo block and "← Outcomes" head it. The page and the rail read again on every commit.
async function initializeToolPage(route) {
  status('');
  for(const id of ['notebook','topic-people','messages','topic-pending','inline-composer'])$(id).hidden=true;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>shell.leave(routeHref(target))});
  const page=new ToolPage({host:$('tool-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},toolId:route.tool,
    instanceId:bootstrap.instance_id,read:pipelineView,send:pipelineSend,open:openDestination});
  await page.load();
  const homeReadable=page.answer?.tool.home.readable===true&&page.answer.tool.home.workspace_id===route.id;
  if(homeReadable) {
    enableNewTopic(route.id);
    topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.id,null),host:$('topics'),more:$('more-topics'),
      retry:$('retry-topics'),message:$('topics-status'),...topicFolds(),key:$('topics-key'),denied:error=>readFailure(error).kind==='forbidden',
      read:async args=>checkedView(await api.view('workspace_topics',args,{readClass:'foreground'}),bootstrap.instance_id),
      open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title)});
    pagesInPlace(route.id,()=>{});
    // The outcome's title names its conversation's row, and whether it has one keeps the row's place.
    here={workspaceId:route.id,title:page.answer.tool.home.title,view:null,page:false,has:false,onlyNew:false,items:new Map()};
    try { here.has=hasConversation((await pipelineView('workspace',{workspace_id:route.id})).workspace); } catch {}
  }
  outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'skill',homeReadable,rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:homeReadable?[{name:'conversation',node:$('conversation-navigation'),load:loadConversation},pipelineSection(route.id,false),{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},skillsSection(route.id,route.tool)]:[]});
  if(homeReadable)placeBrand(document.querySelector('.rail'));
  else { document.querySelector('.rail').hidden=true;$('main').prepend($('outcomes-home'));placeBrand($('main')); }
  await followCommits(async()=>(await Promise.all([outcomeScope.load(),page.load()])).every(read=>read!==false))();
  document.body.dataset.ready='true';
}
function notebookCreator(host, scope) {
  // A new page opens in the composer over the page, its first card ready to write.
  return new NotebookCreate({ host, scope, api, bootstrap, open: (route, opener) => openNotebook(route.id, { write: route.write, opener }) });
}
// A card's ask goes to the page's topic, or to its outcome's conversation, and to an agent there (docs/decks.md).
async function notebookAskIn(scope) {
  const topicId=scope.kind==='topic'?scope.id:(await pipelineView('conversation',{workspace_id:scope.id})).conversation?.topic_id;
  if(!topicId)return null;
  const {participants}=await pipelineView('topic',{topic_id:topicId});
  return {topicId,agents:participants.filter(p=>p.kind==='agent'&&p.enabled).map(p=>p.actor_id)};
}
// A Notebook page in the composer over the page being read (item 396; notebook-sheet.mjs): the full page's
// Text and Cards, saving and recovery. The page showing is read again on every commit; one closed is not.
function notebookSheetOf() {
  if (notebookSheet) return notebookSheet;
  notebookSheet = new NotebookSheet({
    make: (id, host, header, idSuffix, revisionShown) => {
      const page = new NotebookPage({ host, header, item: id, read: pipelineView, send: pipelineSend, askIn: notebookAskIn, api, bootstrap, mode: 'cards', idSuffix, shortKeys: true, revisionShown,
        place: async scope => ({ href: routeHref({ kind: scope.kind, id: scope.id, page: id }), title: '' }) });
      followCommits(() => notebookSheet.followed(page));
      return page;
    },
    fullHref: (id, mode) => routeHref({ kind: 'cards', id, ...(mode === 'text' ? { view: 'text' } : {}) }),
    // A stack in the open topic opens in its Reader over the feed; one elsewhere opens its topic's page.
    openStack: async (topicId, messageId) => {
      if (topic && views && topicId === topic.id) { await openSource({ kind: 'message', id: messageId }, $('main')); return true; }
      await openDestination({ kind: 'topic', id: topicId, message: messageId }, 'the reply');
      return false;
    },
    goBack: address => openDestination(parseRoute(new URL(address, location.href)), 'the Notebook page'),
    // A topic's page records reads as its Reader did; an outcome's page as its pages opened in place do.
    reads: () => pageReads ?? pageHere?.reads ?? null,
    source: async ref => checkedView(await api.view('source', ref, { readClass: 'foreground' }), bootstrap.instance_id) });
  shell.guard(() => notebookSheet.holds());
  return notebookSheet;
}
function openNotebook(id, options = {}) { return notebookSheetOf().open(id, options); }

// An outcome's Notebook page opening in place, on a page of the outcome's with no
// topic of its own: the outcome's page, its pipeline, its Measurements, a new topic.
function pagesInPlace(workspace,recorded) {
  const reads=new PageReads({recorded,send:(id,revision)=>{
    const {authority_id,authority_epoch}=bootstrap.authority;
    return api.command({v:1,instance_id:bootstrap.instance_id,operation_id:crypto.randomUUID(),kind:'memory.read',
      target:{item_id:id},expected:{authority:{authority_id,authority_epoch}},args:{revision}});
  }});
  pageHere=new PageHere({host:$('page-here'),reads,read:ref=>pipelineView('source',ref),media:pageImage,cards:id=>routeHref({kind:'cards',id,view:'text'})});pageHereOutcome=workspace;
}
// The outcome's own page lists its Notebook pages after its topics, each opening
// in the composer over it; the side rail lists none (docs/notebook-pages.md).
function outcomePages(workspace,recorded) {
  pagesInPlace(workspace,recorded);
  return new OutcomeReferences({scope:workspace,host:$('outcome-references'),create:()=>notebookCreator($('outcome-references'),{kind:'workspace',id:workspace}),list:$('outcome-references-list'),more:$('more-references'),
    message:$('outcome-references-status'),pageMax:pageMax(),denied:error=>readFailure(error).kind==='forbidden',
    read:args=>pipelineView('memory_items',{owner_scope:{kind:'workspace',id:workspace},...args}),open:(ref,row)=>run(()=>openNotebook(ref.id,{opener:row}))});
}
// An outcome's team, which its owner and its coordinator may change. The owner
// cannot be removed, so the owner's chip is fixed.
let teamPanel=null,purposeLine=null,teamInvite=null;
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
  // Inviting a new agent, beside "+ Add" (agent-invite.mjs): a new outcome starts it afresh.
  if(teamInvite?.outcome!==workspace.id){
    teamInvite=new AgentInvite({host:$('team-invite'),invitation:new Invitation({api,bootstrap}),workspace:()=>teamInvite.current,invited:()=>run(refresh)});
    teamInvite.outcome=workspace.id;
  }
  teamInvite.current={id:workspace.id,version:workspace.version};
  teamInvite.paint(organises(workspace,bootstrap.actor));
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
  drawFeed(false,'topic-pending','inline-composer');
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
    open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title)});
  pagesInPlace(route.workspace,()=>{});
  here={workspaceId:route.workspace,title:answer.workspace.title,view:null,page:false,has:hasConversation(answer.workspace),onlyNew:false,items:new Map()};
  outcomeScope=new OutcomeScope({workspaceId:route.workspace,kind:'opening',rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:[{name:'conversation',node:$('conversation-navigation'),load:loadConversation},{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},skillsSection(route.workspace)]});
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
  drawFeed(false,'topic-pending','inline-composer','topic-navigation');
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
window.addEventListener('pagehide', () => { live?.stop(); cardObserver?.disconnect(); middleObserver?.disconnect(); unheard(); stackFeed?.dispose(); stopDays(); });
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
