import { ActionTimings, actionReporter, timingCall } from './action-timing.mjs';
let actionTimings = null;
const beginTiming = kind => timingCall(actionTimings, 'begin', kind);
import { paintPendingSends, pendingSendVisual, pendingSendReplyTo, adoptPendingSend, reconcilePlacedSend, clearPendingSends, keepPendingSendPlace } from './pending-sends.mjs';
import { paintCardWords, cardWordOptions } from './message-card-content.mjs';
import { paintReleaseCard, deferReleaseCard } from './release-card.mjs';
import { MessageChanges } from './message-changes.mjs';
import { OlderFeed } from './older-feed.mjs';
import { topicCloseUI } from './topic-close-ui.mjs';
import { QuestionStates, configureQuestionStates, Resolutions } from './question-state.mjs';
import { reviewDifferences } from './review-differences.mjs';
import { railDensity } from './rail-density.mjs';
import { railHotkeysFor } from './rail-hotkeys.mjs';
import { CardReplies } from './card-replies.mjs';
import { MentionNotices } from './mention-notices.mjs';
import { notebookDeleteUI } from './notebook-delete-ui.mjs';
import { finishPageNotice } from './page-notices.mjs';
import { panes } from './panes.mjs';
import { stackMenuItems } from './stack-menu-items.mjs';
import { outcomeMenuItems } from './outcome-menu-items.mjs';
import { consumeMenuRoute } from './menu-route.mjs';
import { writeTopicOnArrival } from './topic-writing.mjs';
import { menuDoor } from './outline-menus.mjs';
import { configureCoverAnswers } from './cover-answers.mjs';
import { configureCoverRefresh, firstCoverMenuItem, updateMenuItem, messageUpdateActivity, messageUpdateHost } from './cover-refresh.mjs';
import { mountFeedFences } from './feed-fence-copy.mjs';
import { keepLineRoom } from './line-room.mjs';
import { Api, notAnswering, unreached, answeredSince, heard, follow, notTaken, NOT_TAKEN } from './api.mjs';
import { openJournal } from './journal.mjs';
import { EditorRegistry } from './app-session.mjs';
import { Reader } from './reader.mjs';
import { InlineComposer } from './inline-composer.mjs';
import { PRIOR_PUBLICATION_NOTICE } from './session.mjs';
import { readableUploads, uploadWork, refusedCopyAtDraft, refusedAtDraft } from './upload-state.mjs';
import { typingField } from './writing-input.mjs';
import { Freshness, initialViews, actorBaseline, readFailure, checkedView, bindingOf } from './freshness.mjs';
import { OutcomeChanges, outcomeReads } from './outcome-refresh.mjs';
import { recordedActionRefresh } from './recorded-refresh.mjs';
import { DossierHeads } from './stack-order.mjs';
import { TopicViews, followEdits } from './topic-views.mjs';
import { visitNewFor, paintVisitNew } from './visit-new.mjs';
import { captureArchivedNew } from './archive-new.mjs';
import { resolveTopicLink, topicLinkNeedsLookup } from './topic-link-route.mjs';
import { readTopicList, TopicPages, TopicNavigation, TopicRail, parseRoute, routeHref, topicTarget, paintChanged, changedSince } from './topic-navigation.mjs';
import { ImagePage } from './image-page.mjs';
import { OnboardingPrompt } from './onboarding.mjs';
import { OutcomeRail } from './outcomes.mjs';
import { LightPeek, paintAlsoWaiting, paintStanding, paintStandingFailed } from './outcome-light.mjs';
import { keptToRead } from './outcome-light-words.mjs';
import { paintKeptLine, sendEnd } from './outcome-end.mjs';
import { OutcomeReferences } from './outcome-references.mjs';
import { OutcomeTopicCards } from './outcome-topic-cards.mjs';
import { OutcomePageLayout } from './outcome-page-layout.mjs';
import { NotebookViews } from './notebook-view.mjs';
import { openIntentJournal } from './intent-journal.mjs';
import { OpeningDraft } from './opening.mjs';
import { OpeningView, UnfinishedOpenings } from './opening-view.mjs';
import { openOpeningStore } from './opening-store.mjs';
import { OutcomeCreation } from './creation.mjs';
import { CreateOutcomeView, showUnfinished } from './creation-view.mjs';
import { ReadThrough } from './read-through.mjs';
import { Live, liveOffered, reloader } from './live.mjs';
import { railReadOrder } from './rail-read-order.mjs';
import { Attention } from './attention.mjs';
import { TopicStatePanel, paintWaiting, managesTopic, organises, topicUpdateEnvelope } from './topic-state.mjs';
import { paintTopicHeader } from './topic-header.mjs';
import { TopicSettings } from './topic-settings.mjs';
import { repaintTimes, watchDays } from './times.mjs';
import { PeoplePanel, CoordinatorChoice, fillNames, markSeatEnded, readDirectory, readMembers } from './people.mjs';
import { NotebookCreate } from './notebook-create.mjs';
import { OneLine, OutcomeStart, TopicStart, lineFromButton, firstSentence } from './quick-create.mjs';
import { PurposeLine } from './outcome-purpose.mjs';
import { AgentInvite, Invitation } from './agent-invite.mjs';
import { HeadlessSeatControl } from './headless-seat.mjs';
import { Marks, paintMarkButton, paintAuthor, marksWords, carriesOf, paintNoteCorner } from './marks.mjs';
import { replyLine, paintReplyLine } from './replies.mjs';
import { placeNewLine } from './unanswered.mjs';
import { betweenOthers, foldCard, cardIn, paintFold, paintFoldWords, paintOwnNoteFold, opened } from './fold.mjs';
import { MessageEditWriting, messageEditStore, mayEdit, revisionOf, wasEdited } from './message-edit-writing.mjs';
import { MessageEdit } from './message-edit.mjs';
import { ownWithdrawnQuestion, withdrawalItem, paintWithdrawal, Withdrawals, learnWithdrawal } from './question-withdrawal.mjs';
import { removalItem, paintRemoval, readRemoval, Removals } from './message-removal.mjs';
import { cardClass, paintCardColor, agentColor, paneClass } from './author-colors.mjs';
import { paintWhisperAuthor, mayStartFrom } from './whisper-choice.mjs';
import { AgentColors } from './colors.mjs';
import { OutcomeColorPicker } from './outcome-color-picker.mjs';
import { openColorPicker } from './color-picker.mjs';
import { PageReads } from './page-reads.mjs';
import { PageHere } from './page-here.mjs';
import { imageStandIns } from './deck.mjs';
import { CONVERSATION_NOTE, paintAbout, paintAsksYou, conversationDestination, paintAnswerers, switchWriting, PLACE as CONVERSATION_PLACE } from './outcome-conversation.mjs';
import { WakeLights } from './wake-lights.mjs';
import { OutcomeScope, placeBrand } from './outcome-scope.mjs';
import { linkWords, openLinksWith, nameTopicsWith, shareLinksFrom, messageLink, pageLink } from './links.mjs';
import { closeOnOutsideClick } from './dismiss.mjs';
import { PipelinePage, PipelineRow, paintPipelineLine, pipelineHref, titleLine } from './pipeline.mjs';
import { firstLine } from './pipeline-words.mjs';
import { HealthPage } from './health.mjs';
import { NotebookPage } from './notebook-page.mjs';
import { NotebookRailMenu } from './notebook-rail-menu.mjs';
import { notebookTransferDrag } from './notebook-transfer-drag.mjs';
import { NotebookSheet, notebookDockWanted, returning as notebookReturning } from './notebook-sheet.mjs';
import { HealthLight } from './health-light.mjs';
import { releaseToastsFor } from './release-toasts.mjs';
import { phoneCheck } from './phone-check.mjs';
import { MeasurementsPage, OutcomeTargets, paintTopicTarget } from './targets.mjs';
import { ToolPage, OutcomeTools, ToolsRail, TopicTools } from './skills.mjs';
import { openDossierMove } from './dossier-move.mjs';
import { MovedDossiers } from './moved-dossiers.mjs';
import { MessageMenu, openMessageMenu, sayOn, copyText, COPY_REFUSED } from './message-menu.mjs';
import { openNotebookMenu, notebookReaderMenuItems } from './notebook-menu.mjs';
import { NotebookStarts } from './notebook-start.mjs';
import { DossierSelectionQuote } from './dossier-selection-quote.mjs';
import { NotebookPassages } from './notebook-passages.mjs';
import { NotebookQuoteTransfer } from './notebook-quote-transfer.mjs';
import { Reactions, learnReactions, paintReaderThumb, paintReaderReactions, paintReactions, mayAnswer, thumbed } from './reactions.mjs';
import { CardScroll } from './card-scroll.mjs';
import { InteractionGuide, asksForGuide } from './interaction-guide.mjs';
// How a topic reads (docs/topic-reading.md): read cards, quiet agent talk, replies and stacks, formatted words.
import { agentTalk, readNow, learnReply, learnAnswered, paintAwaiting, paintReading, seenRanges, wakeOnPress } from './card-reading.mjs';
import { entries, entryOf, lineSeq, reveal, headClick, foldedClick, stackState, stackPage, shownView, drawn, paintHeadCarries, paintFolderColors, fillFrom, paintFoldedNames, checkDossierNew, forgetStackMessages } from './reply-stacks.mjs';
import { cardImages, paintCardImages, adoptCardImages, dropCardImages } from './card-images.mjs';
import { paintThumb } from './image-pick.mjs';
import { newestNew } from './stack-order.mjs';
import { StackFeed } from './stack-feed.mjs';
import { messagePreview } from './message-preview.mjs';
import { PressHold } from './press-hold.mjs';
import { readerSteps } from './stack-order.mjs';
import { headerClick } from './reply-stacks.mjs';
import { revealSelection } from './reveal.mjs';
import { deferFencePaint } from './fence-copy.mjs';
import { clipboardSelection, clipboardWords, copyWordsChoice, hasClipboardWords, notebookClipboard } from './copy-words.mjs';
import { copyOfCover } from './dossier-cover.mjs';
import { installCoverQuote } from './cover-quote-selection.mjs';
import { formatWords, redrawMessageWords } from './message-format.mjs';
import { TextDisplayPreferences } from './text-display-rules.mjs';
import {ParagraphSwitch} from './paragraph-switch.mjs';
import { shell } from './rails.mjs';
import { SessionRenewal } from './session-renewal.mjs';
import { showLine, lineText } from './lines.mjs';

// Each page is one run of this module (in-place-navigation.mjs). A run that a
// move in place has ended finds its own elements still, so work it had under
// way lands there and never on the page that followed it.
let retired = null, notebookSheet = null, outcomeColorPicker = null, mentionNotices = null;
const $ = id => retired?.get(id) ?? document.getElementById(id);
let outcomePageLayout = null, topicClosing = null, notebookDeleting=null, olderFeed = null, paragraphSwitch=null;
const thisRun = shell.begin({ open: (target, title) => openDestination(target, title), retire: ids => { actionTimings?.dispose(); anchorWatch?.stop(); roomy?.(); roomy = null; clearPendingSends(ids.get('messages')); retired = ids; dropCardDocuments(); olderFeed?.dispose(); mentionNotices?.dispose(); notebookSheet?.retire(); outcomeColorPicker?.dispose(); outcomeReferences?.dispose(); outcomePageLayout?.dispose(); paragraphSwitch?.dispose(); },
  updated: reload => updatedNotice(reload), refused: why => { shell.stayed(); stayedWhy(why); } });
// The901 shell restores the foot and separator from copies for each run.
railDensity();
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
let api, bootstrap, journal, registry, reader, inline, cardReplies, topic, opening = 0, freshness, views, updateState, live = null, attention = null, topicState = null, waitingHost = null;
let cardReplyRequest = 0;
let localEffectVersion = 0;
// The open page's outcome and its server-owned reply destination/coordinator.
let here = null;
let readerCoordinatorPainted = null;
let availabilitySerial = 0;
let inlineAvailabilitySerial = 0;
let topicUnavailable = false, listAccessEpoch = 0;
let settings = null, topicTools = null, topicRail, topicNavigation, outcomeRail, outcomeReferences, outcomeScope = null, inlineDiscovery = null, readerShowings = 0, participantsPanel = null, outcomeMembers = null, colors = null;
let intentJournal, intentOpening, outcomeCreation, readThrough, cardObserver, middleObserver, marks = null, commitReload = null, pageReads = null;
let pipelineRow = null, pipelineAddFor = null;
// An outcome page's Notebook page shown in place (page-here.mjs), and that outcome.
let pageHere = null, pageHereOutcome = null, linkOwnerScope = null, linkNotice = null;
// The topic page's light, message bar, thumbs-up and go-ahead answers (message-menu.mjs, reactions.mjs).
let menu = null, reactions = null, cardScroll = null, withdrawals = null, removals = null, resolutions = null, questionStates = null;
// Whether the open topic's outcome is reached, as its light last said: its
// messages are kept to read, so none offers Edit (Core refuses one too).
let outcomeReached = false;
// The Reader's edit of one of the person's messages, while it is open (editMessage).
let messageEdit = null;
// What the person does to reply stacks: star, rename, move, join, fold (stack-feed.mjs).
let stackFeed = null, dossierHeads = null, visitNew = null;
const feedMessages = () => dossierHeads?.messages(views.messages) ?? views.messages;
// A press held down on the page: the repaints that would move the list under it wait for it to end (press-hold.mjs).
const pressHold = new PressHold(document);
const guide = new InteractionGuide(document);
const halfShown = new Set(), atMiddle = new Set();
// Only observer-selected current entries, not every retained card.
const seenEntries = new Map();
let readingStopped = false;
// Whether what is drawn above the topic page's messages after they paint has
// had its first fill, so no card the page counts as seen moves (noteRead).
let laidOut = false;
const listLoads = new Map();
const candidates = new Map(), mediaURLs = new Set();
const review = $('version-review');
let comparison = null, reviewSerial = 0, reviewOpener = null;
// Whether each agent's wakes are getting through, said on its name where it is not.
const wakeLights = new WakeLights({ read: async () => checkedView(await api.view('wakes', {}, { readClass: 'background' }), bootstrap.instance_id),
  painted: () => { const words = wakeLights.notice(); $('wakes-status').textContent = words ?? ''; $('wakes-status').hidden = !words; finishPageNotice($('wakes-status')); } });
const wakeLight = person => !person.seat_ended && (person.kind === 'agent' || person.kind === undefined) ? wakeLights.words(person.actor_id) : null;
const sourceIdentity = ref => JSON.stringify(ref);
const validate = answer => {
  if (answer?.error) throw Error(answer.error.message);
  if (answer?.instance_id !== bootstrap.instance_id) throw Error('This view belongs to a different instance.');
  return answer;
};
const reviewStatus = message => { $('review-status').textContent = message; $('review-status').hidden = !message; };
const presentationFor = editor => [registry?.current, registry?.inline, ...registry?.cards?.values() ?? []].find(p => p && Object.values(p.editors).includes(editor));
const writingSurface = p => p?.surface === 'card' ? cardReplies.surface(p) : p?.surface === 'inline' ? inline : reader;
const differences = editor => reviewDifferences(editor, candidates.get(editor.key)?.items ?? []);
const needsReview = editor => differences(editor).length > 0;
const reviewState = editor => {
  const first = differences(editor)[0];
  if (first) return { hidden: false, text: 'Check recovery', title: first.label };
  // Current writing keeps its own admission guards. Unknown contents are not a version
  // difference, and an empty upload-state object is not a recovery action.
  const unsettled = candidates.get(editor.key)?.items.some(row => row.active !== 0 && !row.superseded_by && (row.availability !== 'available' || row.snapshot?.authorityRecovery ||
    row.snapshot?.attempts?.some(attempt => !attempt.detached && !attempt.receipt) ||
    row.snapshot?.submissions?.some(item => !item.detached && ['preparing', 'prepared'].includes(item.status))));
  const retained = !editor.uploadOpaque && Array.isArray(editor.uploadState?.entries) && editor.uploadState.entries.some(entry => entry && (!entry.selected && entry.bytes_ref ||
    Array.isArray(entry.attempts) && entry.attempts.some(attempt => !attempt.detached && !attempt.receipt && attempt.publish_response?.recorded !== true &&
      !(attempt.begin_response?.recorded === true && attempt.begin_response.status === 'rejected'))));
  const recovery = editor.authorityRecovery || editor.conflict || editor.uploadOpaque || editor.imageStorageError || editor.recoveryDiscovery || editor.cleanupError || unsettled || retained;
  return { hidden: !recovery, text: 'Check recovery', title: recovery ? 'Check saved writing and connection recovery' : '' };
};
const paintVersionButton = (button, editor) => {
  const state = reviewState(editor); button.hidden = state.hidden; button.textContent = state.text; button.title = state.title;
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
  const serial = beginReview(differences(editor).length ? 'Review versions' : 'Saved writing and recovery', opener), session = registry.sessionFor(editor);
  const current = () => serial === reviewSerial && review.open && registry.isCurrent(presentation);
  const action = run => () => { if (current() && registry.isCurrent(presentation, editor)) return run(); };
  const make = (label, run) => button(label, action(run));
  const localVersion = editor.localVersion, recovery = structuredClone(editor.authorityRecovery);
  const destination = editor.context.kind === 'note' ? 'Private note · only you' : `Reply to ${editor.context.topicId}`;
  // Each opening reads the current remote before choosing the first difference.
  // A failed read leaves it unknown, never displays a stale cached comparison.
  const conflict = editor.conflict;
  let remote = recovery ? (recovery.authority ? recovery.remote : undefined) : undefined;
  if (!recovery && conflict) {
    conflict.remote = undefined;
    try {
      const state = validate(await api.view('editor_state', { source_ref: editor.sourceRef, topic_id: editor.context.topicId }));
      registry.validateState(state, editor.sourceRef, editor.context.topicId);
      if (!current() || editor.conflict !== conflict) return;
      remote = editor.context.kind === 'note' ? state.note : state.draft;
      conflict.remote = remote; changed(editor);
    } catch (error) { if (current()) reviewStatus(error.message); }
  }
  if (!current()) return;
  const first = differences(editor)[0];
  $('review-title').textContent = first ? 'Review versions' : 'Saved writing and recovery';
  if (first) $('review-content').append(version(first.label, first.draft?.body ?? null, first.draft ? imageSummary(editor, first.draft.attachments ?? []) : ''));
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
  if ((recovery || editor.conflict) && !first?.remote) $('review-content').append(version('Saved private version', remote === undefined ? 'Saved version unavailable. Retry to read it; your writing is kept.' : remote?.body ?? null,
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
            const kept = await registry.keepCurrentWriting(editor, candidate);
            const known = candidates.get(editor.key);
            if (known) known.items = known.items.map(row => row.id === kept.id ? kept : row);
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
const restoredSendViews = new WeakSet();
function pendingSendCard(id) {
  return [...$('messages').querySelectorAll('[data-pending-send]')].find(card => card.dataset.pendingSend === id) ?? null;
}
function restorePendingSendPlace(card, top) {
  // A send keeps its place within the natural scroll range. Manufacturing
  // range here leaves padding that the next generic hold captures and renews.
  // Release room from the inner list paint before measuring the settled card.
  roomy?.(); roomy = null;
  const moved = card.getBoundingClientRect().top - top;
  if (moved) window.scrollBy({ top: moved, behavior: 'instant' });
}
function pendingSendTarget(ref) {
  if (ref?.kind !== 'message') return null;
  const list = $('messages'), state = stackState(list);
  const stack = stackFeed?.stackFor(ref.id);
  const section = stack && state.sections.get(stack.id);
  // stackFor includes folded/earlier/source heads absent from messageEntries.
  return section?.isConnected ? section.querySelector(':scope > .stack-replies') : null;
}
function focusPendingSend(item) {
  const canonical = item.status === 'confirmed' && messageEntries.get(item.receipt?.result?.message_id);
  const card = pendingSendCard(item.id) ?? (canonical ? cardIn(canonical) : null);
  if (card) { card.tabIndex = -1; card.scrollIntoView({ block: 'nearest', behavior: 'instant' }); card.focus({ preventScroll: true }); }
}
async function handoffReaderSend(p, editor, item, current, owns) {
  const access = listAccessEpoch, destination = topic;
  const available = () => !retired && !registry.disposed && !topicUnavailable && !authorityReviewPending() &&
    topic === destination && listAccessEpoch === access && !item.detached && !editor.unavailable && !editor.conflict && !editor.authorityRecovery &&
    item.authority?.authority_id === registry.runtime.current.authority_id && item.authority?.authority_epoch === registry.runtime.current.authority_epoch;
  if (!current() || !available() || !pendingSendCard(item.id)) return false;
  // close keeps both registered editors locally; its predicate fences input
  // and Reader state that could change during that keep. No command is awaited.
  const finish = cardReplies?.trackReaderHandoff(p, editor, item);
  let handed = false;
  try { handed = await registry.close(p, { current: () => owns() && available() }); }
  finally { finish?.(handed); }
  if (!handed) return false;
  if (!registry.current && !registry.pendingOpen && available() && owns(false)) focusPendingSend(item);
  return true;
}
function paintSubmittedWriting() {
  if (!registry || !views || !topic) return;
  const editors = [...registry.sessions.values()].map(session => session.editor);
  const sourceViews = views, access = listAccessEpoch, destination = topic;
  const current = () => !retired && !registry.disposed && !topicUnavailable && !authorityReviewPending() &&
    views === sourceViews && listAccessEpoch === access && topic === destination;
  if (current()) for (const editor of editors) for (const item of editor.submissions ?? []) {
    const id = item.status === 'confirmed' ? item.receipt?.result?.message_id : null;
    const canonical = id && messageEntries.get(id), message = id && views.messages.get(id);
    if (canonical && message && pendingSendCard(item.id)) keepPendingSendPlace($('messages'),
      () => reconcilePlacedSend($('messages'), editors, message, canonical, { topicId: topic.id, authority: registry.runtime.current, current }),
      { current, restore: restorePendingSendPlace });
  }
  keepPendingSendPlace($('messages'), () => paintPendingSends($('messages'), editors, {
    topicId: topic.id,
    current: () => !retired && !registry.disposed && !topicUnavailable && !authorityReviewPending(),
    visual: (editor, item) => pendingSendVisual(editor, item, { authorKind: bootstrap.actor_kind,
      parent: pendingSendReplyTo(item) ? feedMessages().get(pendingSendReplyTo(item)) : null }),
    nameOf: displayActor, displayRules: displayRules(), end: $('new-message-sheet'),
    readImage: (editor, item, attachment) => registry.sessionFor(editor).uploads.previewSubmission(item, attachment),
    underway: (editor, item) => registry.sessionFor(editor).underWay(item.id),
    target: pendingSendTarget,
    placed: id => Boolean(id && messageEntries.get(id)?.isConnected && drawn($('messages'), id)),
    check: (editor, item) => run(async () => {
      if (item.status !== 'confirmed') await registry.checkConfirmation(editor);
      if (item.status === 'confirmed') { await landOnMessage(item.receipt.result.message_id); paintSubmittedWriting(); }
    }),
    restored: (editor, item, card) => {
      if (restoredSendViews.has(item) || editor.restoredVersion !== editor.localVersion ||
          !(document.activeElement === card || card.contains(document.activeElement))) return;
      restoredSendViews.add(item);
      if (inline?.editor === editor && registry.isCurrent(inline.presentation, editor)) {
        inline.drawEditor(); inline.pop();
      } else if (item.sourceRef?.kind === 'message') {
        const source = messageEntries.get(item.sourceRef.id);
        if (source) cardReplies?.open(item.sourceRef.id, source).catch(error => status(error));
      }
    },
  }), { current, restore: restorePendingSendPlace });
  if (current()) for (const editor of editors) for (const item of editor.submissions ?? []) {
    if (pendingSendCard(item.id)?.isConnected) timingCall(registry.sessionFor?.(editor)?.timingFor?.(item), 'endpoint', 'send_pending_dom');
  }
}
const submittedPlacements = new Map();
function placeSubmittedWriting(editor, item) {
  if (!item.presentPending || item.detached || item.status !== 'confirmed' || item.topicId !== topic?.id) return Promise.resolve(false);
  if (submittedPlacements.has(item.id)) return submittedPlacements.get(item.id);
  const timing = registry.sessionFor?.(editor)?.timingFor?.(item);
  const currentTopic = topic, access = listAccessEpoch, generation = registry.generation;
  const current = () => topic === currentTopic && access === listAccessEpoch && generation === registry.generation &&
    !retired && !registry.disposed && !topicUnavailable && !authorityReviewPending();
  const task = (async () => {
    const id = item.receipt.result.message_id;
    if (!current()) return false;
    if (!views.messages.has(id)) {
      const foreground = registry.cleanup.foreground();
      try {
        let seq = item.receipt.result.seq;
        if (!Number.isSafeInteger(seq) || seq < 1) {
          const source = checkedView(await foreground.read(options => api.view('source', { kind: 'message', id }, { ...options, timing })), bootstrap.instance_id);
          if (!current() || source.source_ref?.id !== id || source.topic_id !== item.topicId) return false;
          seq = source.seq;
        }
        if (!Number.isSafeInteger(seq) || seq < 1) throw Error('The sent message could not be placed. Check confirmation.');
        const cursor = seq + 1;
        const page = checkedView(await foreground.read(options => api.view('topic_messages', { topic_id: item.topicId, audience: 'all', direction: 'before', cursor, limit: 30 }, { ...options, timing })), bootstrap.instance_id);
        if (!current()) return false;
        views.messagesPage(page, { anchored: true, cursor });
      } finally { foreground.release(); }
    }
    if (current()) {
      const pending = pendingSendCard(item.id);
      if (pending && document.activeElement === pending) {
        const card = landOn(id, { full: true });
        card?.focus({ preventScroll: true });
      }
      paintSubmittedWriting();
      if (messageEntries.get(id)?.isConnected) timingCall(timing, 'endpoint', 'send_canonical_dom');
    }
    return current() && Boolean(messageEntries.get(id)?.isConnected);
  })().catch(error => { if (current()) status(error); return false; });
  submittedPlacements.set(item.id, task);
  task.finally(() => { if (submittedPlacements.get(item.id) === task) submittedPlacements.delete(item.id); });
  return task;
}
function paintReview() {
  paintSubmittedWriting();
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
  if (control.textContent !== entry.label) control.textContent = entry.label;
  control.onclick = () => run(() => showPending(entry.editor.key, control));
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
    paintVersionButton($('review-versions'), reader.editor);
  }
  if (inline?.editor === editor) inline.paintStatus();
  cardReplies?.paint(editor);
  invalidateComparison(editor);
  const version = registry.localTopicVersion(editor);
  if (version > localEffectVersion) {
    if (editor.context.topicId === topic?.id) releaseTopArrivals();
    localEffectVersion = version; freshness?.invalidate('topic', version); freshness?.request();
  }
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
function readingAllowed() {
  return !readingStopped && !retired && !registry?.disposed && !unreadLandingBusy && !$('main').inert && readThrough && topic && !topicUnavailable &&
    !$('messages').hidden && !authorityReviewPending() && !review.open &&
    document.visibilityState === 'visible' && document.hasFocus();
}
function noteRead() {
  if (!readingAllowed()) return;
  const source = registry.current?.source;
  if (source) {
    if (registry.current.sourceUnavailable || source.source_ref.kind !== 'message' || source.topic_id !== topic.id) return;
    views.opened(source.seq);
    if (source.author !== bootstrap.actor) { readThrough.seen(topic.id, source.seq, source.seq); openedHere(source.source_ref.id); }
    return;
  }
  if (!laidOut) return;
  const shown = new Set(), arrivals = [];
  for (const entry of seenEntries.values()) {
    const seq = Number(entry.dataset.seq), id = entry.dataset.id, item = views.messages.get(id);
    if (!entry.isConnected || messageEntries.get(id) !== entry) { forgetReadEntry(entry); continue; }
    if (item?.topic_id !== topic.id || item.seq !== seq || entry.dataset.stackContext === 'true') continue;
    if ((halfShown.has(seq) || atMiddle.has(seq)) && onScreen(entry)) {
      shown.add(seq);
      if (item.author_id !== bootstrap.actor) arrivals.push(id);
    }
  }
  if (!shown.size) return;
  for (const [from, through] of seenRanges([...views.messages.values()], seq => shown.has(seq), id => views.runOf(id), bootstrap.actor))
    views.sighted(from, through, readThrough.seen(topic.id, from, through));
  let changed = false;
  for (const id of arrivals) changed = newAbove.delete(id) || changed;
  if (changed) paintNewAbove();
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
  if (readingStopped || retired) return;
  for (const entry of entries) {
    const target = entry.target, id = target.dataset.id, seq = Number(target.dataset.seq);
    if (!target.isConnected || messageEntries.get(id) !== target) continue;
    if (test(entry)) shown.add(seq); else shown.delete(seq);
    if (halfShown.has(seq) || atMiddle.has(seq)) seenEntries.set(seq, target);
    else if (seenEntries.get(seq) === target) seenEntries.delete(seq);
  }
  noteRead();
};
function observeReadEntry(entry) {
  if (readingStopped) return;
  cardObserver?.observe(entry); middleObserver?.observe(entry);
}
function forgetReadEntry(entry) {
  const seq = Number(entry.dataset.seq);
  if (seenEntries.get(seq) === entry) { seenEntries.delete(seq); halfShown.delete(seq); atMiddle.delete(seq); }
  cardObserver?.unobserve(entry); middleObserver?.unobserve(entry);
}
function stopReadTracking() {
  readingStopped = true;
  cardObserver?.disconnect(); middleObserver?.disconnect();
  seenEntries.clear(); halfShown.clear(); atMiddle.clear();
}
function revokeMedia() { for (const url of mediaURLs) URL.revokeObjectURL(url); mediaURLs.clear(); }
async function present(presentation) {
  if (presentation.surface === 'card') { cardReplies?.surface(presentation)?.show(presentation); cardReplies?.paint(); return; }
  if (presentation.surface === 'inline') inline.show(presentation);
  else {
    // A newly opened cold source consumes a canonical slot immediately,
    // without waiting for another arrival to retire passive feed records.
    if (views?.windowOptions && views.messages.size) { views.trimWindow(); paintViews('messages'); }
    retainRevisionTargets(presentation);
    offerAuthor(presentation);
    let dossierError = null;
    try { await readReaderDossier(presentation, (name, args) => api.view(name, args, { readClass: 'foreground', timing: presentation.timing })); }
    catch (error) { dossierError = error; }
    if (!registry.isCurrent(presentation)) return;
    revokeMedia(); reader.presentation = presentation;
    delete $('reader').dataset.discovered;
    reader.show(presentation.source, presentation.editors, { opener: presentation.opener, topics: [topic], presentation, mode: presentation.mode });
    $('source-body').classList.toggle('notebook-reading-source', presentation.source.source_ref.kind === 'memory');
    receiveNotebookQuote(presentation);
    cardReplies?.paint();
    if (presentation.fromCardReply) {
      if (presentation.fromCardReply.wide && !reader.narrow.matches) reader.temporaryWide = true;
      reader.widenInlineReply?.(); reader.applyLayout();
    }
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
  return readerSteps(presentation?.source?.source_ref, core, here ? stackPage(stackState($('messages')), feedMessages()) : null);
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
  if (views?.windowOptions) paintWindowGaps();
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
async function discover(presentation, editor) {
  const discovery = editor.versionDiscovery = (editor.versionDiscovery ?? 0) + 1;
  const current = () => editor.versionDiscovery === discovery && registry.isCurrent(presentation, editor);
  try {
    let cursor;
    do {
      const page = await registry.recoveryCandidates(editor, { limit: 10, ...(cursor ? { cursor } : {}) }, (page, continued) => listCandidates(editor, page, continued));
      cursor = page.nextCursor;
    } while (cursor && current());
    const conflict = editor.conflict;
    if (current() && conflict && conflict.remote === undefined && !editor.authorityRecovery) {
      const state = validate(await api.view('editor_state', { source_ref: editor.sourceRef, topic_id: editor.context.topicId }));
      registry.validateState(state, editor.sourceRef, editor.context.topicId);
      if (current() && editor.conflict === conflict) { conflict.remote = editor.context.kind === 'note' ? state.note : state.draft; changed(editor); }
    }
  } catch (error) { if (current()) writingSurface(presentation).notice(error); }
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
// One attachment of a source: an existing thumbnail beside Open for a verified
// inline image (653); Open still fetches it, shows it in place and offers the
// file to save. The thumbnail keeps 651's new-tab act. current() says the place it was
// offered from still shows that source; a refusal goes to notice, and an open
// that succeeds sends notice('') to say an earlier refusal no longer holds.
// Focus pressed onto Open moves to Download, or back to Open on a refusal,
// unless the person has put it somewhere else meanwhile.
function attachmentControl(attachment, sourceRef, current, notice, keepURL = url => mediaURLs.add(url)) {
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
      keepURL(url); host.replaceChildren(); host.classList.remove('attachment-control');
      if (media.inline) { const image = node('img'); image.alt = attachment.name; image.src = url; host.append(image); }
      const download = node('a', `Download ${attachment.name}`); download.href = url; download.download = attachment.name; host.append(download);
      notice('');
      if (held && unplaced()) download.focus();
    } catch (error) { if (available()) notice(error); }
    finally { if (available() && show.isConnected) { show.disabled = false; if (held && unplaced()) show.focus(); } }
  }); host.append(show);
  // Unknown/non-inline files keep Open alone. Never discover an image by
  // speculatively reading a file; use the same verified descriptors as cards.
  if (attachment.inline === true && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.content_type)) {
    host.classList.add('attachment-control'); show.classList.add('attachment-open');
    const key = JSON.stringify(['attachment', sourceRef ?? 'own', attachment.id, attachment.sha256]);
    paintThumb(host, key, async () => {
      // A queued read belongs only to the control still offering this source.
      // Open may already have replaced it, or its page may have moved on.
      const currentImage = () => !retired && available() && show.isConnected;
      if (!currentImage()) return null;
      const media = await api.media(bootstrap.instance_id, attachment, sourceRef);
      return currentImage() && media.inline ? media.blob : null;
    });
  }
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
// A first body click opens its reply immediately. The next nearby click
// opens the Reader (Edit for an editable own message), even while the first
// read waits. The 890 timing and travel bounds keep drags out of this act.
let editBodyClick = null, editPointer = null;
const editClickControl = target => {
  const control = target?.closest?.('a, button, input, textarea, select, img, [contenteditable], [role="button"], .image-thumb, .feed-fence-copy, .message-bar, .stack-head, .fold-line, .replied-mark, .note-corner, .cover-refresh-glyph, .stack-new-action');
  // The card itself has role=button for Space; its body is still the body.
  return control && !control.classList.contains('message-card');
};
const editClickChoice = (id, card) => {
  const item = views && feedMessages().get(id);
  return item && messageMenuItems(item, null, card).find(choice => choice.label === 'Edit');
};
const editClickMatches = event => {
  const first = editBodyClick;
  return first && !retired && !event.defaultPrevented && event.button === 0 && event.detail > 0 && ['mouse', 'touch'].includes(editPointer?.type) && !editPointer.dragged &&
    !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
    (event.detail >= 2 || event.timeStamp >= first.time && event.timeStamp - first.time <= 400) &&
    Math.hypot(event.clientX - first.x, event.clientY - first.y) <= 6 &&
    !editClickControl(event.target) && event.target?.closest?.('.message-preview')?.parentElement === first.card &&
    (!first.shown || cardReplies?.shown(first.id));
};
document.addEventListener('pointerdown', event => {
  editPointer = { type: event.pointerType, id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  if (!['mouse', 'touch'].includes(event.pointerType)) editBodyClick = null;
}, true);
for (const kind of ['pointermove', 'pointerup']) document.addEventListener(kind, event => {
  if (editPointer?.id === event.pointerId && Math.hypot(event.clientX - editPointer.x, event.clientY - editPointer.y) > 4) editPointer.dragged = true;
}, true);
document.addEventListener('pointercancel', () => { editBodyClick = null; }, true);
document.addEventListener('keydown', () => { editBodyClick = null; }, true);
document.addEventListener('click', event => {
  const first = editBodyClick, choice = editClickMatches(event);
  editBodyClick = null;
  if (!choice) return;
  event.preventDefault(); event.stopImmediatePropagation();
  // Only the accepted click replaces word selection; a drag stays a drag.
  document.defaultView.getSelection?.()?.removeAllRanges();
  run(async () => {
    const p = await first.opened;
    if (retired || !p || p.sourceUnavailable || !first.card.isConnected) return;
    if (registry.current === p && reader.dialog.open) return;
    if (!cardReplies?.shown(first.id)) return;
    return openMessageReader(first.id, first.card);
  });
}, true);
function rememberEditBodyClick(id, card, event, opened) {
  if (event?.detail > 0 && event.button === 0 && ['mouse', 'touch'].includes(editPointer?.type) && !editPointer.dragged &&
      !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
      event.target?.closest?.('.message-preview')?.parentElement === card && !editClickControl(event.target)) {
    const first = editBodyClick = { id, card, x: event.clientX, y: event.clientY, time: event.timeStamp, opened, shown: null };
    opened.then(p => { first.shown = p; if (!p && editBodyClick === first) editBodyClick = null; });
  }
}
// act: what the person's act of reading captured (Marks.capture), for a card
// or Read it; every other open passes none and clears nothing.
async function openSource(ref, opener, act = null, mode = 'reply', replyCard = null, { land = false, fromCardReply = false, timing = null } = {}) {
  if (ref.kind === 'message') clearVisitNew(ref.id);
  const request = ++opening;
  const from = registry.interactive, currentTopic = topic, currentViews = views, accessEpoch = listAccessEpoch;
  views.retain(views.currentItem, ref.kind === 'memory' ? ref.id : null);
  status('');
  try {
    const presentation = await marks.open(registry, ref, { topicId: topic.id, opener, mode, replyCard, fromCardReply, timing }, act);
    // A cancelled open can resolve null. Even a returned presentation must
    // still be the current, available source actually shown by the Reader.
    const source = presentation?.source;
    if (ref.kind === 'message' && presentation && request === opening && !retired &&
        topic === currentTopic && views === currentViews && accessEpoch === listAccessEpoch &&
        presentation.token === registry.generation && registry.isCurrent(presentation) &&
        !presentation.sourceUnavailable && !presentation.availabilityUnconfirmed &&
        reader.dialog.open && reader.presentation === presentation && reader.source === source &&
        source?.instance_id === bootstrap.instance_id && source.source_ref?.kind === ref.kind &&
        source.source_ref.id === ref.id && source.source_ref.revision === ref.revision) {
      // A link's feed landing and Reader opening are one destination. Delegate
      // its sole release to landOn when loaded; otherwise the Reader owns it.
      if (!land || !landOn(ref.id)) releaseTopArrivals();
      return presentation;
    }
  }
  catch (error) {
    if (request === opening) {
      if (from?.surface !== 'inline' && registry.isCurrent(from)) reader.notice(error);
      else status(error);
    }
  }
  finally { if (request === opening) { views.retain(views.currentItem, null); reader.paintOffer(); } }
}
// Synchronous repaint owners retain writing, fields, card acts and More.
// Only recorded arrivals can own a continuous hold after that repaint.
// More keeps its existing landing rule. A card no longer drawn hands the hold
// to the next card below it. roomy gives back the room holdRoom kept.
let roomy = null, anchorDepth = 0, anchorWatch = null, anchorActing = false, listActAnchor = null, anchorHold = null;
const newAbove = new Set();
let newAboveButton = null;
// A later gesture owns its own place (including More and keyboard navigation).
// Reads/settlement have no gesture, so keep the acted identity until then.
for (const kind of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  document.addEventListener(kind, () => { listActAnchor = null; windowReadSerial++; }, { capture: true, passive: true });
}
function actedListCard(mark) {
  if (!mark || mark.list !== $('messages') || mark.views !== views) return null;
  const entry = entries(mark.list).find(node => node.dataset.id === mark.id);
  if (!entry?.isConnected || !drawn(mark.list, mark.id)) return null;
  const section = entry.closest('.reply-stack'), card = cardIn(entry);
  const dossier = stackState(mark.list).stacks.find(stack => stack.id === section?.dataset.stack)?.dossier;
  if (mark.title && dossier !== mark.dossier) return null;
  const node = mark.title ? [...(section?.querySelectorAll('.stack-rename, .stack-head') ?? [])]
    .find(node => node.getClientRects().length) : card.getClientRects().length ? card : entry;
  return node?.getClientRects().length && node.getBoundingClientRect().height > 0 ? { entry, node, mark } : null;
}
function captureListAnchor() {
  const at = document.activeElement, list = $('messages');
  const writing = inline?.root.contains(at) && registry.isCurrent(registry.inline);
  const field = !writing && $('main').contains(at) && typingField(at) && inView(at);
  const acted = !writing && !field ? actedListCard(listActAnchor) : null;
  const first = writing || field || acted ? null : firstInView();
  const loading = first?.dataset.line === 'older';
  const anchor = writing ? inline.field : field ? at : acted ? acted.node : loading ? list : first;
  const control = anchor === list && (first?.dataset.line === 'older') ? first : null;
  const cards = entries(list).filter(entry => drawn(list, entry.dataset.id));
  const cardHold = !writing && !field && !acted && anchor !== list && list.contains(anchor);
  const cardSet = new Set(cards);
  const following = anchor ? cards.filter(card => card !== anchor && anchor.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) : [];
  const preceding = anchor ? cards.filter(card => card !== anchor && card.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING).reverse() : [];
  const held = [anchor, ...following, ...preceding], backward = new Set(preceding);
  const box = anchor?.getBoundingClientRect();
  const tops = new Map([[anchor, box?.top]]);
  if (acted) tops.set(anchor, acted.mark.top);
  // Inside a long card, hold the line crossing the edge, so an image or
  // rewrap above that line is absorbed even when the card's own top stayed.
  let point = null;
  if (cardHold && tops.get(anchor) < 0) {
    const x = Math.max(1, Math.min(innerWidth - 1, box.left + box.width / 2));
    const caret = document.caretPositionFromPoint?.(x, 1), old = caret ? null : document.caretRangeFromPoint?.(x, 1);
    const text = caret?.offsetNode ?? old?.startContainer, offset = caret?.offset ?? old?.startOffset;
    if (text?.nodeType === Node.TEXT_NODE && anchor.contains(text)) {
      const range = document.createRange();
      range.setStart(text, offset); range.setEnd(text, Math.min(text.length, offset + 1));
      if (range.getClientRects().length) point = { range, text, words: text.data, top: range.getBoundingClientRect().top };
    }
  }
  const edge = control?.getBoundingClientRect().top, last = cards.at(-1), present = control ? new Set(entries(list)) : null;
  return { list, anchor, cards, cardSet, held, backward, tops, point, control, edge, last, present, y: window.scrollY,
    topicViews: views,
    acted, baseline: Boolean(writing || field || acted || control || anchor !== cards[0] || tops.get(anchor) < 0),
    height: document.documentElement.scrollHeight,
    newest: entries(list).reduce((seq, card) => Math.max(seq, Number(card.dataset.seq) || 0), 0) };
}
// Called only around a product repaint, after it has placed actual records.
// Older pages, initial rendering, own sends and generic paints grant no owner.
function recordListArrivals(saved, revised = []) {
  if (!saved?.newest || saved.topicViews !== views || retired || topicUnavailable ||
      authorityReviewPending() || !saved.list.isConnected || saved.list.hidden) return;
  const changed = new Set(revised);
  saved.arrivals = new Map(entries(saved.list).flatMap(entry => {
    const item = views.messages.get(entry.dataset.id);
    return item && item.topic_id === topic.id && item.author_id !== bootstrap.actor &&
      messageEntries.get(item.id) === entry &&
      ((!saved.cardSet.has(entry) && item.seq > saved.newest) || changed.has(item.id)) ? [[entry, item]] : [];
  }));
}
// Record geometry in document coordinates: scrolling is a separate owner.
function arrivalLayout(saved) {
  const nodes = [saved.list, ...entries(saved.list)];
  return new Map(nodes.map(node => {
    const box = node.getBoundingClientRect();
    return [node, { top: box.top + window.scrollY, left: box.left, width: box.width, height: box.height }];
  }));
}
function releaseRetiredAnchorReferences(saved) {
  // Repaint captured this snapshot before window disposal. Keep fallbacks
  // through restoration, then release detached cards before retaining a hold.
  const connected = node => Boolean(node?.isConnected);
  for (const key of ['cards', 'held']) saved[key] = saved[key].filter(connected);
  for (const key of ['cardSet', 'backward', 'present']) if (saved[key])
    saved[key] = new Set([...saved[key]].filter(connected));
  for (const key of ['tops', 'arrivals', 'arrivalOwners', 'arrivalLayout']) if (saved[key])
    saved[key] = new Map([...saved[key]].filter(([node]) => connected(node)));
  for (const key of ['last', 'control']) if (!connected(saved[key])) saved[key] = null;
  if (saved.point && !connected(saved.point.text)) saved.point = null;
  if (saved.acted && (!connected(saved.acted.entry) || !connected(saved.acted.node))) saved.acted = null;
}
function retainArrivalAnchor(saved) {
  anchorHold = null;
  if (!saved.arrivals?.size || !saved.anchor?.isConnected) return;
  saved.arrivalOwners = new Map([...saved.arrivals].filter(([entry]) =>
    entry.isConnected && drawn(saved.list, entry.dataset.id) && entry.getBoundingClientRect().height > 0 &&
    (entry.compareDocumentPosition(saved.anchor) & Node.DOCUMENT_POSITION_FOLLOWING)));
  if (!saved.arrivalOwners.size) return;
  releaseRetiredAnchorReferences(saved);
  saved.y = window.scrollY;
  saved.arrivalLayout = arrivalLayout(saved);
  anchorHold = saved;
}
// A size notification is evidence only when the recorded arrivals' own height
// explains every displaced card and the list. No residual page layout is held.
function arrivalLayoutChanged(saved) {
  if (saved.topicViews !== views || saved.y !== window.scrollY || topicUnavailable || authorityReviewPending()) return null;
  const before = saved.arrivalLayout, after = arrivalLayout(saved), growth = new Map();
  if (!before || before.size !== after.size) return null;
  for (const [entry, item] of saved.arrivalOwners) {
    if (views.messages.get(item.id) !== item || messageEntries.get(item.id) !== entry ||
        !entry.isConnected || !drawn(saved.list, item.id) || !before.has(entry) || !after.has(entry)) return null;
    growth.set(entry, after.get(entry).height - before.get(entry).height);
  }
  for (const [node, old] of before) {
    const box = after.get(node);
    if (!box || box.left !== old.left || box.width !== old.width) return null;
    const height = node === saved.list ? [...growth.values()].reduce((sum, n) => sum + n, 0) : growth.get(node) ?? 0;
    const shift = node === saved.list ? 0 : [...growth].reduce((sum, [entry, n]) => sum +
      (entry !== node && (entry.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) ? n : 0), 0);
    if (box.height - old.height !== height || box.top - old.top !== shift) return null;
  }
  return [...growth.values()].some(n => n !== 0);
}
function restoreListAnchor(saved) {
  if (!saved || retired || !saved.list.isConnected || saved.list.hidden) return;
  // An arrival restoration may not reverse a scroll made since its capture.
  if (saved.arrivals?.size && saved.y !== window.scrollY) { anchorHold = null; return; }
  const { list, anchor, cards, cardSet, held, backward, tops, point, control, edge, last, present, acted } = saved;
  // Room an earlier hold kept is given back first; the hold measures without it.
  if (roomy) { roomy(); roomy = null; }
  const landed = control && last ? loadedAfter(list, present, last) : null;
  if (landed) { anchorHold = null; window.scrollBy({ top: landed.getBoundingClientRect().top - edge, behavior: 'instant' }); return; }
  const afterAct = acted && actedListCard(acted.mark);
  if (acted && !afterAct && listActAnchor === acted.mark) listActAnchor = null;
  const hold = afterAct?.node ?? held.find(node => node?.isConnected && (cardSet.has(node) ? drawn(list, node.dataset.id) && (!acted || node.getBoundingClientRect().height > 0) : node.getClientRects().length));
  const line = hold === anchor && point?.text.isConnected && point.text.data === point.words && point.range.getClientRects().length ? point : null;
  if (hold && (saved.baseline || saved.arrivals?.size || hold !== anchor)) {
    const position = line ? () => line.range.getBoundingClientRect().top
      : !afterAct && backward.has(hold) ? () => hold.getBoundingClientRect().bottom : undefined;
    const delta = holdRoom(list, hold, line ? line.top : tops.get(anchor), position, Boolean(afterAct));
    window.scrollBy({ top: delta, behavior: 'instant' });
    retainArrivalAnchor(saved);
  } else if (anchorHold === saved) anchorHold = null;
  // Older pages and the person's own writing never make this offer. Remember
  // arrivals by identity, so a later repaint or a new reply cannot lose it.
  if (saved.newest && hold?.isConnected) for (const entry of entries(list)) {
    if (saved.arrivals?.has(entry) && Number(entry.dataset.seq) > saved.newest && drawn(list, entry.dataset.id) &&
        views.messages.get(entry.dataset.id)?.author_id !== bootstrap.actor && entry.getBoundingClientRect().top < 0) newAbove.add(entry.dataset.id);
  }
}
function rememberListAnchor(landing = false) {
  if (landing) anchorHold = null;
  if (retired || !$('messages')?.isConnected) return;
  paintNewAbove();
  anchorWatch?.observe();
  anchorWatch?.mutations.takeRecords();
}
// The visible page prefix cannot be scrolled away to make room for an arrival
// while also keeping the card below it still. New above stands for that card
// until it can enter above the window or the reader chooses another view.
function holdTopArrivals(saved) {
  if (!saved || saved.y !== 0 || saved.topicViews !== views ||
      retired || topicUnavailable || authorityReviewPending() || saved.list.hidden ||
      !saved.list.isConnected || !saved.newest || anchorActing) return;
  const incoming = entries(saved.list).filter(entry => Number(entry.dataset.seq) > saved.newest &&
    views.messages.get(entry.dataset.id)?.topic_id === topic.id &&
    views.messages.get(entry.dataset.id).author_id !== bootstrap.actor);
  if (!(saved.tops.get(saved.anchor) > 0) || !saved.anchor?.isConnected) return;
  const state = stackState(saved.list), edge = saved.anchor.getBoundingClientRect().top;
  let changed = false;
  for (const entry of incoming) {
    const box = entry.getBoundingClientRect();
    if (!drawn(saved.list, entry.dataset.id) || box.top < 0 || box.top >= edge ||
        !(entry.compareDocumentPosition(saved.anchor) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    state.waiting.add(entry.dataset.id); newAbove.add(entry.dataset.id); changed = true;
  }
  if (changed) { releaseRetiredAnchorReferences(saved); anchorHold = saved; feedOf().arrange(); }
}
function releaseTopArrivals(absorb = false) {
  const list = $('messages'), waiting = stackState(list).waiting;
  if (!waiting?.size || retired || topicUnavailable || authorityReviewPending() ||
      !list.isConnected || list.hidden) return;
  const saved = absorb ? captureListAnchor() : null;
  const released = [...waiting];
  anchorHold = null;
  for (const id of waiting) {
    const entry = messageEntries.get(id);
    if (entry?.isConnected) entry.hidden = false;
  }
  waiting.clear();
  anchorDepth++;
  try { feedOf().arrange(); }
  finally {
    anchorDepth--;
    if (saved) { recordListArrivals(saved, released); restoreListAnchor(saved); }
  }
}
function keepListAnchor(paint, act = null, revised = []) {
  const list = $('messages'), sourceViews = views, access = listAccessEpoch;
  const paintHeld = () => {
    if (act) {
      anchorHold = null;
      const entry = entries(list).find(node => node.dataset.id === act.id);
      listActAnchor = entry ? { list, views, id: act.id,
        title: Boolean(act.anchor?.closest?.('.stack-tools, .stack-head')) || entry.getBoundingClientRect().height === 0,
        dossier: stackState(list).stacks.find(stack => stack.id === entry.closest('.reply-stack')?.dataset.stack)?.dossier } : null;
      const captured = actedListCard(listActAnchor);
      if (captured && inView(captured.node)) listActAnchor.top = captured.node.getBoundingClientRect().top;
      else listActAnchor = null;
    }

    // Nested stack arrangements belong to the same repaint and the same hold.
    if (anchorDepth || anchorActing && !act) return paint();
    // A new paint starts from the current place, never a previous hold's top.
    anchorHold = null;
    const saved = captureListAnchor();
    anchorDepth++;
    try { return paint(); }
    finally {
      recordListArrivals(saved, revised);
      if (saved.arrivals?.size) holdTopArrivals(saved);
      anchorDepth--; restoreListAnchor(saved); rememberListAnchor();
    }
  };
  // A local submission may be the visible reading owner while it is absent
  // from canonical selectors. Nested paints and deliberate acts keep theirs.
  return !act && !anchorDepth && !anchorActing ? keepPendingSendPlace(list, paintHeld, {
    current: () => Boolean(registry && views && !registry.disposed && !retired && !topicUnavailable &&
      !authorityReviewPending() && views === sourceViews && listAccessEpoch === access),
    restore: restorePendingSendPlace,
  }) : paintHeld();
}
function paintNewAbove() {
  const list = $('messages'), { trashed } = stackState(list);
  for (const id of newAbove) {
    const entry = messageEntries.get(id), item = views.messages.get(id);
    // Count retained arrival offers, not an estimate of current visibility.
    // Only activation measures its chosen card; passive paints need no scan.
    if (trashed?.has(id) || !entry?.isConnected || entry.dataset.id !== id || !item || item.id !== id ||
        item.topic_id !== topic?.id || item.author_id === bootstrap.actor) newAbove.delete(id);
  }
  if (!newAboveButton && newAbove.size) {
    newAboveButton = button('New above ↑', () => {
      const entry = entries(list).find(card => newAbove.has(card.dataset.id));
      if (!entry || retired || topicUnavailable || authorityReviewPending() || !list.isConnected || list.hidden) return;
      const id = entry.dataset.id, currentTopic = topic, message = views.messages.get(id);
      if (!message || message.topic_id !== currentTopic?.id || messageEntries.get(id) !== entry) return;
      releaseTopArrivals();
      anchorHold = null;
      reveal(entry);
      entry.scrollIntoView({ block: 'start', behavior: 'instant' });
      const card = opened(entry);
      card.focus({ preventScroll: true });
      const rect = entry.getBoundingClientRect();
      // Retire this arrival once the activation really reaches it. Native
      // scrolling may round the edge by a fraction of a CSS pixel.
      if (!retired && topic === currentTopic && views.messages.get(id) === message &&
          messageEntries.get(id) === entry && list.isConnected && !list.hidden &&
          entry.isConnected && drawn(list, id) && card.contains(document.activeElement) &&
          rect.top >= -1 && rect.top < innerHeight && rect.bottom > 0) newAbove.delete(id);
      rememberListAnchor();
    });
    newAboveButton.className = 'new-above';
    newAboveButton.setAttribute('aria-label', 'Read new messages above');
    $('main').append(newAboveButton);
  }
  if (newAboveButton) {
    const count = newAbove.size, words = `New above · ${count} ↑`;
    if (newAboveButton.textContent !== words) newAboveButton.textContent = words;
    newAboveButton.setAttribute('aria-label', `Read ${count} new ${count === 1 ? 'message' : 'messages'} above`);
    newAboveButton.hidden = !count || list.hidden || retired || topicUnavailable || authorityReviewPending();
    newAboveButton.style.left = `${list.getBoundingClientRect().left}px`;
  }
}
function watchListAnchor() {
  anchorWatch?.stop();
  const list = $('messages'), main = $('main'), observed = new Set();
  const settle = () => {
    if (retired || anchorDepth) return;
    const saved = anchorHold;
    const changed = saved && !anchorActing && saved.y === window.scrollY ? arrivalLayoutChanged(saved) : null;
    if (changed) restoreListAnchor(saved);
    else if (changed === null) anchorHold = null;
    rememberListAnchor();
  };
  const sizes = new ResizeObserver(settle);
  const observe = () => {
    const wanted = new Set(anchorHold?.arrivalOwners?.keys() ?? []);
    for (const node of observed) if (!wanted.has(node)) { sizes.unobserve(node); observed.delete(node); }
    for (const node of wanted) if (!observed.has(node)) { sizes.observe(node); observed.add(node); }
  };
  // This broad observer can INVALIDATE ownership, never create it. Mutation
  // outside the actual arrival entries includes sheet/Reader/composer layout.
  const mutations = new MutationObserver((records = []) => {
    if (records.some(record => record.type === 'attributes' && ['class', 'style'].includes(record.attributeName) ||
      ![...(anchorHold?.arrivalOwners?.keys() ?? [])].some(entry => entry.contains(record.target)))) anchorHold = null;
    settle();
  });
  mutations.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  const scrolled = event => {
    if (anchorDepth) return;
    // Own compensation's delayed event already has the saved y. Any changed
    // page offset or nested scroller invalidates; a scroll handler never restores.
    if (anchorHold?.y !== window.scrollY || event?.target && event.target !== document && event.target !== window) anchorHold = null;
    if (stackState(list).waiting?.size && list.getBoundingClientRect().top < 0) releaseTopArrivals(true);
    rememberListAnchor();
  };
  // Capture before handlers and accept their final layout before paint.
  // A frame callback also covers handlers that stop the event's bubbling.
  let actionFrame = 0;
  const acted = () => {
    anchorHold = null;
    anchorActing = true;
    // This owner only records the action frame. Each deliberate destination
    // releases its arrivals itself; writing and card acts keep them hidden.
    if (!actionFrame) actionFrame = requestAnimationFrame(() => {
      actionFrame = 0; anchorActing = false; rememberListAnchor();
    });
  };
  const acts = ['pointerdown', 'click', 'keydown', 'input', 'wheel', 'touchstart', 'touchmove', 'touchend', 'focusin'];
  for (const kind of acts) document.addEventListener(kind, acted, true);
  window.addEventListener('scroll', scrolled, { passive: true });
  main.addEventListener('scroll', scrolled, { capture: true, passive: true });
  window.addEventListener('resize', acted);
  anchorWatch = { mutations, observe, stop: () => {
    roomy?.(); roomy = null;
    mutations.disconnect(); sizes.disconnect();
    if (actionFrame) cancelAnimationFrame(actionFrame);
    anchorActing = false; anchorHold = null;
    for (const kind of acts) document.removeEventListener(kind, acted, true);
    window.removeEventListener('scroll', scrolled); window.removeEventListener('resize', acted);
    main.removeEventListener('scroll', scrolled, true);
  } };
  observe(); rememberListAnchor();
}
// How far the page scrolls to put hold back where it was (top). Where what is
// drawn above it shrank by more than the page is scrolled (a reply taking the
// place of a taller one, docs/reply-stacks.md), no scroll can: the page's top
// would cut it short. Then the list keeps the rest as room between what changed
// and the writing, so the writing stays exactly where it was (item 363): just
// above the New message composer resting among the messages (item 465, the
// sheet's --hold-room, aim.css), at the list's top for a card, or at the
// list's end for a hold below it. The
// next hold gives that room back, and keeps only what it needs.
function holdRoom(list, hold, top, position = () => hold.getBoundingClientRect().top, acted = false) {
  const keep = (room, side, value) => {
    const before = room.style.getPropertyValue(side), priority = room.style.getPropertyPriority(side);
    room.style.setProperty(side, value);
    const installed = room.style.getPropertyValue(side), installedPriority = room.style.getPropertyPriority(side);
    const release = () => {
      if (roomy !== release || room.style.getPropertyValue(side) !== installed ||
          room.style.getPropertyPriority(side) !== installedPriority) return;
      if (before) room.style.setProperty(side, before, priority);
      else room.style.removeProperty(side);
    };
    roomy = release;
  };
  const moved = position() - top, short = -(window.scrollY + moved);
  // An acted card can cross More or move to either end. Supply only the
  // scroll range missing at that end, through the same temporary-room owner.
  if (acted) {
    const end = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const extra = short > 0 ? short : window.scrollY + moved - end;
    if (extra > 0) {
      const side = short > 0 ? 'padding-top' : 'padding-bottom';
      const padding = parseFloat(getComputedStyle(list).getPropertyValue(side)) || 0;
      keep(list, side, `${padding + extra}px`);
    }
    return hold.getBoundingClientRect().top - top;
  }
  const home = $('new-message-sheet'), resting = home.parentElement === list && !home.open && home.contains(hold);
  if (!(short > 0) || !resting && !list.contains(hold) && !(list.compareDocumentPosition(hold) & Node.DOCUMENT_POSITION_FOLLOWING)) return moved;
  const [room, side] = resting ? [home, '--hold-room'] : [list, list.contains(hold) ? 'padding-top' : 'padding-bottom'];
  keep(room, side, `${short}px`);
  return position() - top;
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
  return [...document.querySelectorAll(`${MESSAGE_ENTRIES}, #messages .dossier-cover, #messages .stack-earlier, #messages > [data-line=older]`)].find(inView);
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
}
function paintViews(kind, reactionId = null) {
  if (kind === 'reactions' && reactionId !== null) { paintThumbMessage(reactionId, false); return; }
  if (questionStates) for (const item of feedMessages().values()) questionStates.of(item);
  // Notebook pages remain admitted in TopicViews for reads and links. Their
  // visible list belongs to the right rail, so a memory update moves no feed.
  if (kind === 'memory') return;
  if (kind === 'offer') { reader?.paintOffer(); return; }
  // All but the header and the people, which repaint in place, move the list:
  // under a press held down they wait for it to end, so the click lands where it began.
  if (kind !== 'topic' && pressHold.down) { pressHold.after(kind, () => paintViews(kind)); return; }
  if (kind === 'acts' || kind === 'edited') stackFeed?.shelf?.refresh();
  if (kind === 'messages' && stackFeed && stackFeed.archiveNewest !== views.newest) {
    if (stackFeed.archiveNewest !== undefined) stackFeed.shelf?.refresh();
    stackFeed.archiveNewest = views.newest;
  }
  if (kind === 'starred') { keepListAnchor(paintStarredStatus); return; }
  if (kind === 'window') { keepListAnchor(paintWindowGaps); return; }
  // A thumbs-up reads its message (card-reading.mjs, readNow): its card, and its stack's count of new replies, read so.
  if (kind === 'reactions') { keepListAnchor(() => { paintCardReading(); stackMessages(); menu?.paint(); }); paintReaderThumb$(); return; }
  // A star, a stack's name, a join or a place, here or on another device (stack-feed.mjs).
  // An act changes marks/positions, not the admitted original's body. Keep
  // its entry for the acted-card anchor; sync retires only changed membership.
  if (kind === 'acts') { keepListAnchor(() => { stackMessages(); paintMessageUpdates(); menu?.paint(); }); return; }
  // A message edited, here or elsewhere: its card and the lines that read its words (docs/message-edit.md).
  if (kind === 'edited') {
    const revised = views.takeRevised(), edits = views.takeEdits();
    keepListAnchor(() => repaintEdited(revised, edits), null, revised); return;
  }
  // The person's own note or saved reply on a message, saved, emptied or sent here or elsewhere: its card's marks (item 127).
  if (kind === 'yours') { keepListAnchor(() => repaintYours(views.takeYours())); return; }
  // The line moves under the reader's eyes: the card they are looking at stays where it is.
  if (kind === 'line') { keepListAnchor(placeLine); return; }
  if (kind === 'topic') {
    if (authorityReviewPending()) return;
    topicUnavailable = false;
    topic = views.topic;
    if (questionStates && questionStates.archived !== Boolean(topic.archived)) {
      questionStates.archived = Boolean(topic.archived);
      freshness?.invalidate('acts', 0, true);
    }
    shell.topicChanged();
    // The panel paints the header with the newest topic it has seen.
    if (topicState) topicState.paint(topic, views.participants); else paintHeader(topic);
    if (registry.inline) { registry.inline.topic = structuredClone(topic); inline.$('destination').textContent = `To ${topic.title}`; }
    topicRail?.updateCurrent(topic);
    paintParticipants(topic, views.participants);
    drawFeed(true);
    if (registry?.current?.topicUpdatesPaused) { registry.current.topicUpdatesPaused = false; reader.paintStatus(); }
    paintMarks(); noteRead(); return;
  }
  const paint = () => keepListAnchor(() => {
  if (kind === 'messages' && views.windowOptions) { releaseWindowReferences(); syncDossierHeads(); }
  // Newest first, so where each new card goes is at or after where the one before it went.
  const renderedMessages = kind === 'messages' ? feedMessages() : null;
  if (kind === 'messages') for (const [id, entry] of messageEntries) if (!renderedMessages.has(id)) {
    dropCardDocuments(entry); dropCardImages(entry); forgetReadEntry(entry); entry.remove(); messageEntries.delete(id);
  }
  let following = $('messages').firstElementChild;
  const messages = kind === 'messages' ? feedMessages() : null;
  for (const item of messages ? [...messages.values()].sort((a, b) => b.seq - a.seq) : []) {
    let card = messageEntries.get(item.id);
    if (!card) {
      const adoption = registry && adoptPendingSend($('messages'), [...registry.sessions.values()].map(session => session.editor), item, {
        topicId: topic.id, authority: registry.runtime.current,
        current: () => !retired && !registry.disposed && !topicUnavailable && !authorityReviewPending(),
      });
      const ref = { kind: 'message', id: item.id };
      // The revision a click or keypress may clear is the one the card shows.
      // A reply can live in the card: its controls must not be inside a
      // native button. Return remains the message menu's; Space opens it.
      card = adoption?.card ?? node('div'); card.tabIndex = 0; card.setAttribute('role', 'button');
      card.onclick = () => run(() => cardReplies?.shown(item.id) ? openMessageReader(item.id, card) : replyInCard(item.id, card));
      card.addEventListener('keydown', event => {
        if (event.target !== card || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === ' ') { event.preventDefault(); if (!event.repeat) card.click(); }
      });
      card.className = cardClass(item, bootstrap.actor, agentShown); card.dataset.id = item.id; card.dataset.seq = item.seq;
      // An agent's name on its card opens its color picker instead of the message.
      // Decide a source drag from its pointer travel, before the browser has
      // created any selection. A return to the starting point is still a drag.
      let sourcePress = null;
      card.addEventListener('pointerdown', event => {
        const words = event.target.closest?.('.message-preview');
        sourcePress = event.button === 0 && words?.parentElement === card ?
          { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false } : null;
      });
      const sourceTravel = event => {
        if (sourcePress?.id === event.pointerId && Math.hypot(event.clientX - sourcePress.x, event.clientY - sourcePress.y) > 4) sourcePress.dragged = true;
      };
      card.addEventListener('pointermove', sourceTravel);
      card.addEventListener('pointerup', sourceTravel);
      card.addEventListener('pointercancel', () => { if (sourcePress) sourcePress.dragged = true; });
      const open = card.onclick;
      card.onclick = event => {
        if (event?.target?.closest?.('#reader, .card-reply-composer')) return;
        if (event?.detail > 0 && sourcePress?.dragged) return;
        // A stack's head row shows or hides its full message, or renames it (reply-stacks.mjs).
        if (headClick($('messages'), messageEntries.get(item.id), event)) return;
        // A message the reader folded is one row: a press on it unfolds it (stack-feed.mjs).
        if (foldedClick($('messages'), messageEntries.get(item.id), event)) return;
        // In a dossier a press on a message's header folds it; its words open it (item 471).
        if (headerClick($('messages'), messageEntries.get(item.id), event)) return;
        const name = event?.target?.closest?.('.author-name');
        if (name && item.author_kind === 'agent' && item.author_id !== bootstrap.actor) return run(() => pickColor(item.author_id, name, card));
        const opened = open(event);
        rememberEditBodyClick(item.id, card, event, opened);
        return opened;
      };
      // On its card first, so a whisper's words name the card for a screen reader.
      const author = card.querySelector(':scope > .message-author') ?? node('span', undefined, 'message-author');
      if (author.parentElement !== card) card.prepend(author);
      paintCardAuthor(author, item);
      paintCardWords(card, item, cardWordOptions(item, { revision: revisionOf(item),
        showChanges: messageChanges?.shown(item.id, revisionOf(item)) ?? true, displayRules: displayRules() }));
      paintReleaseCard(card, item);
      // Its images as thumbnails after its words, each read through the message (card-images.mjs, item 474).
      if (adoption) adoptCardImages(card, item, cardImageBytes(item.id));
      paintCardImages(card, item, cardImageBytes(item.id));
      // A message between others is one quiet line that opens its card.
      const entry = betweenOthers(item, bootstrap.actor, bootstrap.actor_kind) ? foldCard(card, item, document) : card;
      paintFold(entry, marks?.state(item.id)?.marked === true);
      // A new card goes above the New message composer resting under the messages (item 465), so the stacks
      // drawn next move no card past it.
      while (following && following !== $('new-message-sheet') && !(Number(following.dataset.seq) < item.seq)) following = following.nextElementSibling;
      $('messages').insertBefore(entry, following);
      messageEntries.set(item.id, entry);
      observeReadEntry(entry);
    }
    paintCardDocuments(cardIn(messageEntries.get(item.id)), item);
    paintReplyContext(cardIn(messageEntries.get(item.id)), item, messages);
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
  if (kind === 'messages') { syncDossierHeads(); feedOf().arrived([...views.messages.values()]); paintCardReading(); }
  if (kind === 'messages') {
    movedDossiers.paint($('messages'), views.movedPointers ?? []);
    placeLine(); menu?.paint(); paintDossierSourceStatus();
  }
  if (kind === 'messages') {
    paintMessageContext(); syncCardReplies(); paintSubmittedWriting();
  }
  });
  if (kind === 'messages') keepPendingSendPlace($('messages'), paint, {
    current: () => !retired && !topicUnavailable && !authorityReviewPending(),
    restore: restorePendingSendPlace,
  }); else paint();
  if (kind === 'messages') noteRead();
}
// Each admitted canonical message's entry; local submitted writing is separate.
const messageEntries = new Map();
const windowEvictions = new Set(), windowTargets = new Set();
let windowGapHost = null, windowReadSerial = 0, coldArrivals = null;
function topicWindowOptions() {
  const pins = new Set(windowTargets), visible = [], external = new Set();
  const active = document.activeElement;
  const selection = document.getSelection?.();
  const ranges = selection && !selection.isCollapsed ? Array.from({ length: selection.rangeCount }, (_, n) => selection.getRangeAt(n)) : [];
  for (const [id, entry] of messageEntries) {
    if (pressHold.down) pins.add(id);
    if (halfShown.has(Number(entry.dataset.seq)) || atMiddle.has(Number(entry.dataset.seq))) { pins.add(id); visible.push(id); }
    if (entry.contains(active)) pins.add(id);
    if (ranges.some(range => range.intersectsNode(entry))) pins.add(id);
  }
  // Covers are siblings of canonical message entries. Protect the current
  // displayed head, letting the existing planner reserve its dossier root.
  // Recompute each time: reading a cover never pins all historical members.
  for (const section of $('messages').querySelectorAll(':scope > .reply-stack')) {
    const id = section.dataset.stack, cover = section.querySelector(':scope > .dossier-cover');
    if (!cover?.isConnected || !messageEntries.has(id) || !cover.getClientRects().length) continue;
    const box = cover.getBoundingClientRect();
    const shown = box.height > 0 && box.width > 0 && box.bottom > 0 && box.top < innerHeight;
    if (shown || cover.contains(active) || ranges.some(range => range.intersectsNode(cover))) pins.add(id);
    if (shown) visible.push(id);
  }
  for (const source of [reader?.source, registry?.current?.source]) {
    if (source?.source_ref?.kind === 'message') {
      pins.add(source.source_ref.id);
      if (!views.messages.has(source.source_ref.id)) external.add(source.source_ref.id);
    }
  }
  if (messageEdit?.id) { pins.add(messageEdit.id); if (!views.messages.has(messageEdit.id)) external.add(messageEdit.id); }
  if (menu?.lit?.isConnected) pins.add(menu.lit.dataset.id);
  if (listActAnchor?.id) pins.add(listActAnchor.id);
  const held = anchorHold?.anchor?.closest?.('[data-id]')?.dataset.id;
  if (held) pins.add(held);
  for (const session of registry?.sessions.values() ?? []) for (const submission of session.editor.submissions) {
    const pending = pendingSendCard(submission.id);
    if (!pending) continue;
    // A local reply can sit inside its parent's dossier. Retiring that
    // placement would disconnect its independent writing/image owner.
    if (submission.snapshot?.reply_to) pins.add(submission.snapshot.reply_to);
    const sectionHead = pending.closest?.('.reply-stack')?.dataset.stack;
    if (sectionHead) pins.add(sectionHead);
    if (submission.status === 'confirmed') pins.add(submission.receipt.result.message_id);
  }
  return { pins, budget: Math.max(0, 300 - external.size), anchor: held ?? listActAnchor?.id ?? visible[0] ?? null };
}
function queueWindowEvictions(ids) {
  for (const id of ids) windowEvictions.add(id);
}
function releaseWindowReferences() {
  if (!windowEvictions.size) return;
  for (const id of windowEvictions) {
    const entry = messageEntries.get(id), seq = Number(entry?.dataset.seq);
    if (newAbove.delete(id) && Number.isSafeInteger(seq)) coldArrivals = {
      before: Math.max(coldArrivals?.before ?? 0, seq + 1), after: Math.min(coldArrivals?.after ?? seq - 1, seq - 1) };
    if (entry) {
      dropCardDocuments(entry); dropCardImages(entry); cardScroll?.forget(id, cardIn(entry));
      forgetReadEntry(entry); entry.remove(); messageEntries.delete(id);
    }
    halfShown.delete(seq); atMiddle.delete(seq); openedIds.delete(id);
    cardReplies?.retire(id); cardReplies?.closed.delete(id); cardReplies?.queue.delete(id);
    if (registry?.cards.get(id) !== registry?.current) registry?.cards.delete(id);
    messageChanges?.hidden.delete(id);
  }
  windowEvictions.clear();
  const retained = new Set([...views.messages.keys(), ...views.windowRoots]);
  // A previous size hold may contain retired cards, layouts and arrival
  // objects. The surrounding repaint captures/restores its current anchor.
  anchorHold = null;
  visitNew?.retain(retained);
  const facts = new Set(retained);
  for (const id of views.windowHints.keys()) facts.add(id);
  for (const id of [reader?.source?.source_ref?.id, registry?.current?.source?.source_ref?.id, messageEdit?.id]) if (id) facts.add(id);
  for (const map of [messageChanges?.hidden, questionStates?.closed, questionStates?.removed]) {
    if (map) for (const id of map.keys()) if (!facts.has(id)) map.delete(id);
  }
  forgetStackMessages($('messages'), retained); stackFeed?.forgetMessages(retained);
}
async function readWindowGap(gap) {
  if (retired || topicUnavailable || registry.disposed || authorityReviewPending()) return false;
  const request = ++windowReadSerial, currentViews = views, currentTopic = topic, access = listAccessEpoch, generation = registry.generation;
  const windowReadStart = views.windowKnowledge;
  const current = () => request === windowReadSerial && views === currentViews && topic === currentTopic && access === listAccessEpoch &&
    generation === registry.generation && !retired && !topicUnavailable && !registry.disposed && !authorityReviewPending();
  const foreground = registry.cleanup.foreground();
  try {
    const page = checkedView(await foreground.read(options => api.view('topic_messages', {
      topic_id: currentTopic.id, audience: 'all', direction: 'before', cursor: gap.before, limit: 30 }, options)), bootstrap.instance_id);
    if (!current()) return false;
    const wanted = page.items.filter(item => item.seq > gap.after).at(-1);
    if (wanted) windowTargets.add(wanted.id);
    try {
      // This still-current foreground navigation admits into today's window;
      // passive arrivals alone do not cancel the person's read-back gesture.
      if (!views.messagesPage(page, { anchored: true, contiguous: true, cursor: gap.before, windowEpoch: views.windowEpoch, windowReadStart })) return false;
      if (coldArrivals === gap) coldArrivals = page.next_cursor !== null && page.next_cursor > gap.after
        ? { before: page.next_cursor, after: gap.after } : null;
      if (wanted && current()) { const card = landOn(wanted.id, { full: true }); card?.focus({ preventScroll: true }); }
      paintWindowGaps(); return true;
    } finally { if (wanted) windowTargets.delete(wanted.id); }
  } finally { foreground.release(); }
}
function paintWindowGaps() {
  if (!views?.windowOptions) return;
  windowGapHost ??= node('nav', undefined, 'topic-window-gaps');
  windowGapHost.setAttribute('aria-label', 'More topic messages');
  if (windowGapHost.parentElement !== $('messages').parentElement) $('messages').after(windowGapHost);
  const gaps = [...(coldArrivals ? [{ ...coldArrivals, arrival: true, original: coldArrivals }] : []), ...views.windowGaps];
  const before = new Map([...windowGapHost.children].map(control => [control.dataset.windowGap, control]));
  const controls = gaps.map(gap => {
    const key = `${gap.arrival ? 'new' : 'gap'}:${gap.before}:${gap.after}`;
    const control = before.get(key) ?? node('button', gap.arrival ? 'New messages' : 'More messages');
    control.type = 'button'; control.dataset.windowGap = key;
    control.onclick = () => run(() => readWindowGap(gap.original ?? gap));
    return control;
  });
  if (views.windowPressure) {
    const status = before.get('pressure') ?? node('span', 'More messages are waiting while this view is held.');
    status.dataset.windowGap = 'pressure'; status.setAttribute('role', 'status'); controls.push(status);
  }
  if (controls.length !== windowGapHost.children.length || controls.some((control, n) => control !== windowGapHost.children[n])) windowGapHost.replaceChildren(...controls);
  windowGapHost.hidden = topicUnavailable || !controls.length;
}
const movedDossiers = new MovedDossiers({ doc: document, actorName: displayActor,
  href: (topicId, rootId) => routeHref(rootId ? topicTarget(topicId, rootId) : { kind: 'topic', id: topicId }) });
// Documents use the Reader's actual Open/Download control (1117), but their
// URLs belong to the card. An unrelated Reader releases none of these files.
const cardDocumentStates = new Map();
const cardDocumentKey = item => JSON.stringify([item.id, revisionOf(item), item.attachments ?? []]);
function dropCardDocuments(root = null) {
  for (const [card, state] of cardDocumentStates) if (!root || root === card || root.contains(card)) {
    state.active = false;
    for (const url of state.urls) URL.revokeObjectURL(url);
    state.urls.clear(); state.strip.remove(); cardDocumentStates.delete(card);
  }
}
function paintCardDocuments(card, item) {
  const images = new Set(cardImages(item));
  const files = (item.attachments ?? []).filter(file => file && !images.has(file));
  if (!files.length || item.removal || retired || topicUnavailable || registry?.disposed || authorityReviewPending()) { dropCardDocuments(card); return; }
  const key = cardDocumentKey(item), epoch = listAccessEpoch;
  const previous = cardDocumentStates.get(card);
  if (previous?.key === key && previous.epoch === epoch) return;
  dropCardDocuments(card);
  const strip = node('span', undefined, 'attachments card-documents');
  // Preserve the native button/link act without also replying or folding.
  strip.addEventListener('click', event => event.stopPropagation());
  strip.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
  const state = { key, epoch, strip, urls: new Set(), active: true };
  cardDocumentStates.set(card, state);
  const current = () => {
    const latest = feedMessages().get(item.id);
    return state.active && cardDocumentStates.get(card) === state && card.isConnected &&
      cardIn(messageEntries.get(item.id)) === card && !retired && !topicUnavailable && !registry.disposed &&
      !authorityReviewPending() && listAccessEpoch === epoch && latest && !latest.removal && cardDocumentKey(latest) === key;
  };
  for (const file of files) {
    const row = node('span', undefined, 'card-document');
    const notice = node('span', undefined, 'card-document-notice'); notice.setAttribute('role', 'status'); showLine(notice, '');
    row.append(attachmentControl(file, { kind: 'message', id: item.id }, current,
      failure => showLine(notice, failure ? [`${file.name ?? 'attachment'}:`, failure] : ''), url => state.urls.add(url)), notice);
    strip.append(row);
  }
  card.append(strip);
}
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
function refreshDossierHeads(id = null) {
  if (!dossierHeads) return;
  dossierHeads.invalidate(id);
  syncDossierHeads();
}
function syncDossierHeads() {
  if (!dossierHeads || topicUnavailable || registry?.disposed || authorityReviewPending()) return;
  // Position reads may split/join dossiers without a new message page.
  // Recompute their supplemental-original reservations before admitting DOM.
  views.trimWindow?.();
  dossierHeads.sync(views.messages, views.removals, views.windowOptions ? views.windowRoots : null);
  const messages = feedMessages();
  for (const [id, entry] of messageEntries) if (!messages.has(id)) {
    if (views.windowOptions) { windowEvictions.add(id); continue; }
    dropCardDocuments(entry); dropCardImages(entry); forgetReadEntry(entry);
    entry.remove(); messageEntries.delete(id);
  }
  if (views.windowOptions) releaseWindowReferences();
}
function stackMessages() { syncDossierHeads(); feedOf().arrange(); paintDossierSourceStatus(); paintWindowGaps(); paintSubmittedWriting(); }
function paintStarredStatus() {
  const line = $('starred-status'), words = $('starred-status-words'), retry = $('starred-retry');
  const hidden = Boolean(topicUnavailable || authorityReviewPending() || !views.starredPending), quiet = !views.starredError;
  if (line.hidden !== hidden) line.hidden = hidden;
  if (line.classList.contains('sr-only') !== quiet) line.classList.toggle('sr-only', quiet);
  const said = views.starredError ? 'Could not finish loading starred dossiers. ' : 'Loading starred dossiers…';
  if (words.textContent !== said) words.textContent = said;
  if (retry.hidden !== quiet) retry.hidden = quiet;
  retry.onclick = () => { views.resetStars(); freshness?.request({ retry: true }); };
}
// The fallback is a real canonical dossier route, guarded by the same writing
// preservation as all other in-app links. No source body is inferred here.
function paintDossierSourceStatus() {
  for (const line of $('messages').querySelectorAll('.dossier-source-status')) line.remove();
  for (const stack of stackFeed?.state.stacks ?? []) {
    const record = dossierHeads?.records.get(stack.dossier);
    if (!record || record.state === 'available') continue;
    const entry = messageEntries.get(stack.id);
    if (!entry) continue;
    const line = node('span', undefined, 'dossier-source-status');
    line.setAttribute('role', 'status');
    line.classList.toggle('sr-only', record.state === 'loading');
    const label = stack.head.stack_position?.name?.text || 'this dossier';
    const link = node('a', `Reply in ${label}`);
    link.href = routeHref({ kind: 'topic', id: topic.id, message: stack.dossier });
    link.onclick = event => { event.preventDefault(); event.stopPropagation(); run(() => openSource({ kind: 'message', id: stack.dossier }, link)); };
    const words = { loading: 'Loading first message… ', error: 'Could not load first message. ', refused: 'First message unavailable. ', missing: 'First message unavailable. ' };
    line.append(node('span', words[record.state]));
    if (record.state !== 'loading') line.append(link);
    if (record.state === 'error') {
      const retry = node('button', 'Retry'); retry.type = 'button';
      retry.onclick = event => { event.stopPropagation(); refreshDossierHeads(stack.dossier); stackMessages(); };
      line.append(retry);
    }
    cardIn(entry).prepend(line);
  }
}
// The page's reply stacks and what the person does to them, made with the first messages.
function feedOf() {
  stackFeed ??= new StackFeed({ list: $('messages'), messages: feedMessages, viewer: bootstrap.actor, instanceId: bootstrap.instance_id,
    readNamed: (name, args) => api.view(name, args, { readClass: 'foreground' }),
    authority: () => registry.runtime.current,
    // The page's own act, once Core answers it, tells the Reader's neighbours whether it could have moved them (item 426).
    send: async envelope => { const receipt = await api.command(envelope); if (receipt?.status === 'committed') views.ownAct(envelope.kind, receipt.result); return receipt; },
    quiet: item => agentTalk(item, bootstrap.actor, bootstrap.actor_kind, whisperPeople().kindOf), filterHost: $('agent-coordination-show'),
    keep: newOnPage, unread: newOnPage, acted: clearVisitNew, captureArchive: captureArchiveReading,
    captureEmptyReply: id => cardReplies?.captureEmpty(id),
    closeReplyToFold: id => cardReplies?.close(id, { focus: false }),
    nameOf: id => (id === bootstrap.actor ? 'You' : displayActor(id)),
    newest: (stack, mark) => run(() => openDossierNew(stack, mark)),
    landReply: id => run(() => landOnMessage(id, undefined, undefined, false, true)),
    archiveTopic: topic?.id, landArchive: (id, loaded) => {
      panes.things?.leave();
      return run(() => landOnMessage(id, undefined, undefined, !loaded, true));
    },
    refreshPositions: () => views.readPositions((name, args) => api.view(name, args)), arranged: stacksRedrawn,
    hold: (paint, act) => keepListAnchor(paint, act), navigate: () => releaseTopArrivals(), press: pressHold, status, line: () => $('app-status'), reread: () => { freshness?.invalidate('acts', 0, true); freshness?.request(); }, reply: (id, card) => run(() => replyInCard(id, card)),
    thumb: (item, on) => menu?.thumb(item, on), thumbPending: id => reactions?.pending.get(id) ?? null,
    redrawn: () => { paintReaderStar(); paintReaderAside(); paintReaderTitle(); paintMessageUpdates(); }, home: $('new-message-sheet'),
    // A title bar's ⋯ opens the menu a right-click on its first message opens (item 473).
    // On a phone its menu offers the title bar's Reply and Archive first, as the glyphs fold into it (first).
    menu: (item, anchor, first = []) => {
      const cover = anchor.closest('.reply-stack')?.querySelector(':scope > .dossier-cover');
      const copy = menu?.copyChoice?.(item, { say: anchor, cover });
      openMessageMenu({ anchor, items: messageMenuItems(item, null, anchor, copy ? [...first, copy] : first), label: 'This message', sheet: true });
    },
    // A dossier's folder wears its first poster's colour, as their cards do: an agent's, in the reader's colours (item 477).
    colorOf: item => (item.author_kind === 'agent' && item.author_id !== bootstrap.actor ? agentShown(item.author_id) : null) });
  return stackFeed;
}
// The topic's feed and its Team, drawn or not, with any other
// parts of the page named. The New message sheet rests in the feed, just above
// More (item 465), and a dialog in a box that is not drawn shows nothing, up
// over the page or not: where the feed is not drawn (an outcome's page, Health,
// a topic the reader can no longer read) the sheet rests at the page's end
// instead, put back first if it was up in the feed, its writing kept
// (arrangeStacks, which takes it back above More once the feed is drawn).
function drawFeed(on, ...parts) {
  const sheet = $('new-message-sheet'), inFeed = $('messages').contains(sheet);
  if (stackFeed) {
    stackFeed.archiveAvailable = on;
    stackFeed.shelf?.setAvailable(on);
  }
  for (const id of ['messages', 'topic-people', ...parts]) $(id).hidden = !on;
  if (!on && windowGapHost) windowGapHost.hidden = true;
  reader?.keepReplyVisible();
  if (on) paintStarredStatus(); else $('starred-status').hidden = true;
  if (on === inFeed) return;
  if (!on && sheet.open) sheet.close();
  if (stackFeed) stackFeed.arrange(); else if (!on) $('main').append(sheet);
}
// Messages this visit opened in the Reader: each reads as read at once.
const openedIds = new Set();
function openedHere(id) { clearVisitNew(id); if (openedIds.has(id)) return; openedIds.add(id); paintCardReading(id, feedMessages()); queueReadingPaint(id); }
const newOnPage = item => !cardRead(item) || Boolean(visitNew?.has(item.id));
let visitPaintQueued = null;
function captureArchiveReading(root, through) {
  const epoch = listAccessEpoch, topicId = topic?.id, instanceId = bootstrap.instance_id;
  const authority = { authority_id: registry.runtime.current.authority_id, authority_epoch: registry.runtime.current.authority_epoch };
  return captureArchivedNew({ root, through, messages: feedMessages, viewer: bootstrap.actor, marks, visit: visitNew, revisionOf,
    current: () => !retired && !topicUnavailable && !registry.disposed && !authorityReviewPending() &&
      epoch === listAccessEpoch && topic?.id === topicId && bootstrap.instance_id === instanceId &&
      registry.runtime.current.authority_id === authority.authority_id && registry.runtime.current.authority_epoch === authority.authority_epoch,
    changed: () => {
      paintReadChanges([...feedMessages().values()].filter(item => (item.stack_position?.root_id ?? item.id) === root && item.seq <= through).map(item => item.id));
      attention?.refresh();
      if (commitReload) run(commitReload);
    } });
}
// The batch owns its page/epoch, not whichever page is current when its
// microtask runs. Keep every affected id, including distinct coalesced clears.
function queueReadingPaint(id) {
  let batch = visitPaintQueued;
  if (!batch || batch.views !== views || batch.epoch !== listAccessEpoch) {
    batch = { views, epoch: listAccessEpoch, ids: new Set() }; visitPaintQueued = batch;
    queueMicrotask(() => {
      if (visitPaintQueued === batch) visitPaintQueued = null;
      if (retired || registry?.disposed || topicUnavailable || views !== batch.views || listAccessEpoch !== batch.epoch) return;
      paintReadChanges([...batch.ids]);
    });
  }
  batch.ids.add(id);
}
function paintReadChanges(ids) {
  const messages = feedMessages();
  ids = [...new Set(ids)].filter(id => messages?.has(id));
  if (!ids.length) return;
  if (visitPaintQueued?.views === views && visitPaintQueued.epoch === listAccessEpoch) for (const id of ids) visitPaintQueued.ids.delete(id);
  keepListAnchor(() => {
    for (const id of ids) paintCardReading(id, messages);
    feedOf().updateReading(ids);
    paintMessageUpdates(ids);
  });
}
function clearVisitNew(id) {
  if (visitNew?.clear(id)) queueReadingPaint(id);
}
const cardRead = item => readNow(item, { viewer: bootstrap.actor, marked: marks?.state(item.id)?.marked === true, opened: openedIds.has(item.id) });
// Each loaded card's read look, agent talk, reply arrow and the dots on the
// reader's own message while it waits for a reply, as they now stand.
function paintCardReading(id = null, messages = views?.messages) {
  if (!views) return;
  const { kindOf } = whisperPeople();
  if (id === null) learnAnswered(messages, bootstrap.actor, kindOf);
  else if (messages.has(id)) learnAnswered(new Map([[id, messages.get(id)]]), bootstrap.actor, kindOf);
  const selected = id === null ? entries($('messages')) : [messageEntries.get(id)].filter(Boolean);
  for (const entry of selected) {
    const card = cardIn(entry), item = messages.get(card.dataset.id);
    if (!item) continue;
    const quiet = agentTalk(item, bootstrap.actor, bootstrap.actor_kind, kindOf);
    entry.dataset.talk = quiet ? 'agents' : '';
    paintReading(card, item, { read: cardRead(item), quiet, go: goToMessage });
    paintAwaiting(card, item);
    paintOwnNoteFold(entry, item);
    // The shortcut is the card's last act, after its words and controls.
    paintNoteCorner(card, item, (id, opener) => run(() =>
      openSource({ kind: 'message', id }, opener, marks.capture(id), 'note')));
  }
}
// Local pending feedback changes no confirmed reading/stack state and does no
// feed scan or anchor capture. Reconciliation paints only the named card and
// its dossier's existing New marks; actual fold/line effects keep their owners.
function paintThumbMessage(id, pendingOnly = true, timing = null, endpoint = null) {
  if (!pendingOnly && pressHold.down) { pressHold.after('thumb:' + id, () => paintThumbMessage(id, false, timing, endpoint)); return; }
  const entry = messageEntries.get(id), item = feedMessages().get(id);
  const paint = () => {
    if (item && entry) {
      if (!pendingOnly) { paintCardReading(id, feedMessages()); stackFeed?.paintReactionReading(cardIn(entry)); }
      stackFeed?.paintFoldedThumb(cardIn(entry), item);
    }
    menu?.paintMessage(id, entry);
  };
  if (pendingOnly) paint(); else keepListAnchor(paint, entry ? { id, anchor: cardIn(entry) } : null);
  if (readerItem()?.id === id) paintReaderThumb$();
  if (endpoint && (entry?.isConnected || readerItem()?.id === id && reader.dialog.open)) timingCall(timing, 'endpoint', endpoint);
}
// A message the page shows, brought into view: its stack opened first when it
// folds the message away, and its fold opened. A hidden structural question
// lands on its first visible dossier card. Null when no visible card is loaded.
function landOn(id, { full = false } = {}) {
  releaseTopArrivals();
  const entry = stackFeed.landingEntry(id);
  if (!entry) return null;
  anchorHold = null;
  reveal(entry, { full });
  const card = opened(entry);
  card.scrollIntoView({ block: 'nearest' });
  rememberListAnchor(true);
  return card;
}
// A rail landing can name a card outside the loaded page. Read only its
// anchored page, preserving the paging gap. With no visible card, the exact
// source opens through the ordinary Reader owner instead.
let landingSerial = 0;
async function landOnMessage(id, serial = ++landingSerial, current = () => true, dossier = false, exact = false) {
  const accessEpoch = listAccessEpoch, generation = registry.generation, windowRequest = ++windowReadSerial, windowReadStart = views.windowKnowledge;
  const mine = () => !retired && !registry.disposed && !topicUnavailable &&
    accessEpoch === listAccessEpoch && serial === landingSerial && generation === registry.generation && windowRequest === windowReadSerial && current();
  if (!mine()) return false;
  const openExact = () => openSource({ kind: 'message', id }, document.activeElement);
  const local = exact ? feedMessages().get(id) : null;
  if (local && ownWithdrawnQuestion(local, bootstrap.actor)) return Boolean(await openExact());
  if (dossier || !(views.messages.has(id) || local && stackFeed.entryFor(id))) {
    const foreground = registry.cleanup.foreground();
    try {
      let cursor = Number.MAX_SAFE_INTEGER, args = { topic_id: topic.id, limit: 30 };
      if (dossier) args.dossier_id = id;
      else {
        const source = checkedView(await foreground.read(options => api.view('source', { kind: 'message', id }, options)), bootstrap.instance_id);
        if (!mine()) return false;
        if (source.source_ref?.kind !== 'message' || source.source_ref.id !== id || source.topic_id !== topic.id ||
            !Number.isSafeInteger(source.seq) || source.seq < 1) throw Error('This message could not be found in this topic.');
        cursor = source.seq + 1;
        args = { ...args, audience: 'all', direction: 'before', cursor };
      }
      const page = checkedView(await foreground.read(options => api.view('topic_messages', args, options)), bootstrap.instance_id);
      if (!mine()) return false;
      if (dossier && (!Array.isArray(page.items) || !page.items.some(item => item.id === id) || page.items.length > args.limit ||
          page.items.some(item => item.stack_position?.root_id !== id))) throw Error('This dossier could not be confirmed.');
      windowTargets.add(id);
      try { if (!views.messagesPage(page, { anchored: true, cursor, windowReadStart, sparse: dossier })) return false; }
      finally { windowTargets.delete(id); }
    } finally { foreground.release(); }
  }
  if (!mine()) return false;
  // A loaded same-topic target can land during the rail's tap handler,
  // before its bubbling click closes the drawer and removes main's inertness.
  if (shell.drawer?.isOpen()) shell.drawer.close();
  // An authored withdrawal has no card in this reader's feed. Echo
  // activation still opens the exact original instead of selecting a reply.
  if (exact && ownWithdrawnQuestion(feedMessages().get(id), bootstrap.actor)) return Boolean(await openExact());
  const card = landOn(id, { full: true });
  if (!card) return Boolean(await openExact());
  card.focus({ preventScroll: true });
  return true;
}
// The header New act is an in-feed open, never an editor navigation. Delivery
// reads alone leave the visit's New intact; only a confirmed explicit act earns
// openedHere. Keep an unknown request for an exact retry under the same authority.
const dossierNewFlights = new Map(), dossierNewReads = new Map();
let dossierNewSelection = 0;
function openDossierNew(stack, mark) {
  const previous = dossierNewFlights.get(stack.id), epoch = listAccessEpoch;
  const task = (async () => {
    if (previous) await previous.catch(() => {});
    if (epoch !== listAccessEpoch) return;
    return readDossierNew(stack, mark);
  })();
  dossierNewFlights.set(stack.id, task);
  return task.finally(() => { if (dossierNewFlights.get(stack.id) === task) dossierNewFlights.delete(stack.id); });
}
async function readDossierNew(stack, mark) {
  if (topicUnavailable || authorityReviewPending() || registry.disposed ||
      $('reader').open || $('main').inert || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const selection = ++dossierNewSelection;
  const epoch = listAccessEpoch, topicId = topic.id;
  const authority = { authority_id: registry.runtime.current.authority_id, authority_epoch: registry.runtime.current.authority_epoch };
  const current = () => selection === dossierNewSelection && epoch === listAccessEpoch && topic?.id === topicId && !topicUnavailable && !registry.disposed &&
    !authorityReviewPending() && !$('reader').open && !$('main').inert && document.visibilityState === 'visible' && document.hasFocus();
  // New explicitly chooses a reading destination, including arrivals waiting
  // above this dossier. Rebuild its current stack before selecting the newest.
  releaseTopArrivals();
  // Use the current stack, not a header closure from before a join or a read.
  const now = stackState($('messages')).stacks.find(each => each.id === stack.id);
  if (!now) return;
  const selected = newestNew(now, newOnPage);
  if (!selected) { await checkDossierNew($('messages'), now, mark); return; }
  const item = views.messages.get(selected.id);
  if (!item) return;
  const revision = revisionOf(item), act = marks.capture(item.id);
  const same = () => current() && views.messages.has(item.id) && revisionOf(views.messages.get(item.id)) === revision;
  const liveEntry = () => entries($('messages')).find(each => each.dataset.id === item.id);
  const entry = liveEntry();
  if (!entry) return;
  reveal(entry, { full: true, open: true });
  // Select the live node now, before loading whole words. Focus may already
  // be here (especially the head), so the green light is an explicit act.
  const select = () => {
    const live = liveEntry();
    if (!live?.isConnected) return null;
    const card = opened(live);
    revealSelection(card); card.focus({ preventScroll: true }); menu?.light(live);
    return card;
  };
  let card = select();
  if (!card || !await cardScroll.showFull(card, item) || !same() ||
      (item.preview && cardScroll.revisions.get(item.id) !== revision)) return;
  const after = liveEntry(), afterCard = after && opened(after);
  // A later user action owns focus. Compare against the chosen message,
  // never the dossier head that the click's capture listener focused.
  if (!afterCard?.isConnected || (document.activeElement !== card && document.activeElement !== afterCard)) return;
  card = select();
  if (!card || !onScreen(card)) return;
  const key = JSON.stringify([topicId, item.id, revision, authority]);
  let envelope = dossierNewReads.get(key);
  if (!envelope) {
    envelope = { v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'topic.read_through',
      target: { topic_id: topicId }, expected: { authority }, args: { from_seq: item.seq, seq: item.seq } };
    dossierNewReads.set(key, envelope);
  }
  const receipt = await api.command(envelope);
  // A recorded refusal ends this operation too; a later explicit press is
  // a new act. Only an unconfirmed attempt retains its exact request.
  if (receipt?.recorded === true && receipt.operation_id === envelope.operation_id) dossierNewReads.delete(key);
  if (receipt?.recorded !== true || receipt.operation_id !== envelope.operation_id || receipt.status !== 'committed' ||
      receipt.result?.topic_id !== topicId || receipt.result.from_seq !== item.seq || receipt.result.seq !== item.seq)
    throw Error('Reading this message was not confirmed. Press New to try again.');
  if (!same()) return;
  if (act) {
    const { envelope: clearing } = marks.envelope(act.messageId, false, act.revision);
    const clear = await marks.send(act.messageId, false, act.revision);
    if (clear?.recorded !== true || clear.operation_id !== clearing.operation_id || clear.status !== 'committed' ||
        clear.result?.message_id !== item.id || clear.result.mark_revision !== act.revision + 1)
      throw Error('The unread mark changed or could not be cleared. Press New to try again.');
  }
  if (!same()) return;
  const keepSelection = document.activeElement === card;
  openedHere(item.id); paintReadChanges([item.id]);
  // Re-acquire after the receipt redraw, without stealing a later focus.
  if (keepSelection) select();
  attention?.refresh();
  if (commitReload) run(commitReload);
}

// A message a link on the page names (the person's reply, or a tag's), opened
// in the Reader from its card, landing only once that open succeeds; one not loaded opens alone.
function goToMessage(id) {
  const entry = entries($('messages')).find(child => child.dataset.id === id), card = entry && cardIn(entry);
  // Opened as its card's click opens it; a click on the card itself would only light it on a phone (message-menu.mjs).
  run(() => openSource({ kind: 'message', id }, card || document.activeElement, card ? marks.capture(id) : null, 'reply', null, { land: true }));
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
  name.title = person.seat_ended ? 'seat ended' : `Change ${label}'s color`;
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
  paintTopicHeader({ title: $('topic-title'), subtitle: $('topic-description'), gear: $('settings-open'), pencil: $('topic-title-rename') }, current, bootstrap.actor,
    { settings: current.kind !== 'conversation', done: current.kind !== 'conversation' && topicState?.says ? () => topicState.markDone() : null,
      question: id => run(() => openDestination(topicTarget(current.id, id), current.title)) });
  const menu = $('topic-menu');
  menu.hidden = current.kind === 'conversation' || topicUnavailable; menu.dataset.topicId = current.id;
  menu.onclick = () => {
    if (!retired && !topicUnavailable && shell.handles?.route?.kind === 'topic' && shell.handles.route.id === current.id) panes.outline?.menus.open(menu);
  };
}
// Messages sent before times were kept have none. Beside the time, the marks of
// what the message carries: an image, the person's private note, a reply they
// saved and have not sent (carriesOf, item 127).
function paintMessageUpdates(ids = null) {
  const messages = ids === null ? views.messages : feedMessages();
  const selected = ids === null ? messageEntries : [...new Set(ids)].map(id => [id, messageEntries.get(id)]).filter(([, entry]) => entry);
  for (const [id, entry] of selected) {
    const item = messages.get(id), card = cardIn(entry), author = card && messageUpdateHost(card, entry);
    if (item && author) {
      const update = messageUpdateActivity(document, item, updateContext(item.topic_id), entry.querySelector('.message-update'));
      for (const old of entry.querySelectorAll('.message-update')) if (old !== update) old.remove();
      if (update && update.parentElement !== author) author.append(update);
      // A dossier's tab already has the shared New control. Its message's
      // own header (or folded row) carries the individual arrival mark.
      // A between-others entry wraps a button and a hidden card. Its badge
      // belongs inside the visible button, not below that overlapping row.
      const host = entry !== card && card.hidden ? entry.querySelector(':scope > .fold-line')
        : author.classList.contains('stack-head') ? card.querySelector(':scope > .message-author') : author;
      paintVisitNew(entry, host, Boolean(visitNew?.has(id)));
    }
  }
  if (reader?.source?.source_ref.kind === 'message') {
    reader.source.acts = readerFeedItem()?.acts ?? reader.source.acts;
    reader.paintOrigin(reader.source);
  }
}
// Generated context may quote a parent whose withdrawal arrived after this
// reply. Authored words stay unchanged; only this line reads the projection.
function paintReplyContext(card, item, messages = feedMessages()) {
  const context = { parent: messages.get(item.reply_to), viewer: bootstrap.actor };
  const answers = replyLine(item, context);
  let line = card.querySelector(':scope > .message-reply-to');
  if (!answers) { line?.remove(); return; }
  if (!line) { line = node('span', undefined, 'message-reply-to'); card.insertBefore(line, card.querySelector(':scope > .message-preview')); }
  // The excerpt is cut, so an address at its end remains words.
  paintReplyLine(line, item, context);
}
function paintCardAuthor(author, item) {
  const retained = messageEntries.get(item.id), entry = retained ?? author, previousUpdate = entry.querySelector('.message-update');
  const struck = cardScroll?.revisions.get(item.id) === revisionOf(item) && cardScroll.wholes.has(item.id)
    ? cardScroll.strikes.get(item.id) : item.struck;
  const changes = { struck, shown: () => messageChanges?.shown(item.id, revisionOf(item)) ?? true,
    toggle: () => toggleMessageChanges(item.id, revisionOf(item)) };
  paintAuthor(author, displayActor(item.author_id), Number.isSafeInteger(item.sent_ms) ? item.sent_ms : null, marks?.state(item.id)?.marked === true, wasEdited(item), carriesOf(item), changes);
  paintWithdrawal(author, item, document);
  paintRemoval(author, item, document);
  author.parentElement?.classList.toggle('retracted-message', item.removal?.kind === 'retracted');
  if (item.whisper) paintWhisperAuthor(author, item, bootstrap.actor, document);
  if (here?.conversation && !item.withdrawal && !item.removal) paintAsksYou(author, item, here.view?.waits, bootstrap.actor);
  else author.querySelector(':scope > .asks-you')?.remove();
  // The star in its header, put back as the line is painted again (StackFeed.paintStar).
  stackFeed?.paintStar(author, item);
  const update = messageUpdateActivity(document, item, updateContext(item.topic_id), previousUpdate);
  for (const old of entry.querySelectorAll('.message-update')) if (old !== update) old.remove();
  const host = retained ? messageUpdateHost(cardIn(retained), retained) ?? author : author;
  if (update && update.parentElement !== host) host.append(update);
  paintVisitNew(author, author, Boolean(visitNew?.has(item.id)));
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
    .map(person => ({ id: person.actor_id, name: person.name ?? null, ...(actorSeatEnded(person.actor_id) ? { seat_ended: true } : {}) }));
  return { kindOf: name => kinds.get(name), everyone, members };
}
// What the page knows of the person's marks: the topic's line, each loaded
// card's pill and the Reader's button.
// Per drawn entry, presentation only. A replacement card has its own stamp;
// current mark authority is still read from Marks for every action.
const paintedMarkStates = new WeakMap();
function paintMarks() {
  if (!marks || !topic) return;
  const count = marks.marked(topic.id).length;
  $('topic-marks-words').textContent = marksWords(count);
  $('topic-marks').hidden = !count || topicUnavailable;
  const affected = [], messages = feedMessages();
  keepListAnchor(() => {
    for (const entry of entries($('messages'))) {
      const card = cardIn(entry), item = messages.get(card.dataset.id);
      if (!item) continue;
      const state = marks.state(item.id), key = JSON.stringify([state?.marked === true, state?.mark_revision ?? null, revisionOf(item)]);
      if (paintedMarkStates.get(entry) === key) continue;
      paintedMarkStates.set(entry, key);
      paintCardAuthor(card.querySelector('.message-author'), item); paintFold(entry, state?.marked === true);
      paintCardReading(item.id, messages); affected.push(item.id);
    }
  });
  for (const id of affected) queueReadingPaint(id);
  paintReaderMark();
}
// "Start a topic from this": one title line right in the Reader, filled from the
// message's first sentence. Return starts the topic with the message quoted as
// its opening and its author in it; people and more words come afterwards, in
// the topic. Escape starts it too; an empty Escape or second press closes it. Each message keeps its own
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
  if (ref?.kind !== 'message' || !topic || p.sourceUnavailable || !mayStartFrom(source)) return;
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
// Core records the message's author as who raised it. Escape uses that same submit.
function openPipelineAdd() {
  const p = registry?.current, ref = p?.source?.source_ref, host = $('pipeline-add');
  if (!p || p.sourceUnavailable || ref?.kind !== 'message' || !topic || !mayStartFrom(p.source)) return;
  const author = p.source.author, raised = !author ? '' : author === bootstrap.actor ? ', raised by you' : `, raised by ${author}`;
  const workspace = topic.workspace_id;
  pipelineAddFor = ref.id;
  const line = titleLine({ key: 'message-add', value: firstLine(p.source.body), label: 'Title of the new pipeline item',
    hint: `Return or Escape adds it to Candidates${raised}`,
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
        return false;
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
// The archive button beside the star (item 378): Archive for the
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
  const words = `${offer.below ? 'Bring back' : 'Archive'}: ${offer.count} ${offer.count === 1 ? 'message' : 'messages'}`;
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
      source.topic_id !== topic?.id || stackFeed?.dossierName(id)) return true;
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
  return stackFeed && !topicUnavailable && ref?.kind === 'message' && source.topic_id === topic?.id ? stackFeed.dossierCover(ref.id, { alone: true }) : null;
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
// The loaded card can learn reactions before the Reader does. The revision
// and edit time still belong to the words the Reader shows.
function readerItem() {
  const p = registry?.current, source = p?.source, ref = source?.source_ref;
  if (!p || p.sourceUnavailable || ref?.kind !== 'message') return null;
  const loaded = views?.messages.get(ref.id);
  const item = loaded ?? { id: ref.id, author_id: source.author, addressees: source.addressees, go_ahead: source.go_ahead,
    withdrawal: source.withdrawal, removal: source.removal, removal_action: source.removal_action };
  const known = (loaded?.reactions?.version ?? 0) >= (source.reactions?.version ?? 0)
    ? loaded?.reactions ?? source.reactions : source.reactions;
  return { ...item, reactions: known, revision: revisionOf(source), edited_ms: source.edited_ms };
}
// A thumbs-up that read its message places New at the oldest unread again.
async function thumbMessage(item, on, said = null) {
  const timing = beginTiming('thumb');
  clearVisitNew(item.id);
  const receipt = await reactions.thumb(item, on, said, timing);
  if (receipt?.result?.settled === true && receipt.result.topic_id === views?.topicId) {
    views.placeAfresh();
    if (commitReload) run(commitReload);
  }
  return receipt;
}
function paintReaderThumb$() {
  const item = readerItem();
  paintReaderThumb($('thumb-source'), reactions && item, bootstrap.actor, Boolean(item && reactions?.busy.has(item.id)), item ? reactions?.pending.get(item.id) ?? null : null);
  paintReaderReactions($('reader-reactions'), reactions && item, bootstrap.actor, bootstrap.actor_kind, {
    busy: Boolean(item && reactions?.busy.has(item.id)), answer: (id, choice) => run(() => answerFromReader(id, choice)),
    repeat: () => thumbFromReader(false, item) });
}
function thumbFromReader(closeOnGive = true, expected = null) {
  const item = readerItem(), presentation = registry.current;
  if (!item || (expected && (item.id !== expected.id || item.revision !== expected.revision))) return;
  const on = closeOnGive ? !thumbed(item, bootstrap.actor) : true;
  run(async () => {
    try {
      const receipt = await thumbMessage(item, on);
      if (on && closeOnGive && receipt && registry.isCurrent(presentation)) await registry.close(presentation);
    } catch (error) { reader.notice(error); } finally { paintReaderThumb$(); }
  });
}
// Reader answers (including linked Waiting-on cover choices) use the normal
// close/save owner after Core records success. A late answer owns only the
// presentation captured at its press, never a Reader opened meanwhile (889).
async function closeReaderAfterAnswer(presentation, receipt) {
  if (receipt?.status === 'committed') return closeReaderAfterAction(presentation);
}
async function closeReaderAfterAction(presentation) {
  if (!registry.isCurrent(presentation) ||
      reader.presentation !== presentation || !reader.dialog.open) return;
  return reader.close();
}
// A swipe waits for the same personal fold the feed uses. Only its recorded
// answer may close this presentation; the normal close owner keeps writing.
async function foldReaderMessage(source) {
  const presentation = registry.current, feed = stackFeed;
  if (!feed || reader.presentation !== presentation || reader.source !== source) return;
  const current = readerFeedItem();
  const item = source?.source_ref?.kind === 'message' && current?.id === source.source_ref.id ? current : null;
  const reason = feed.foldReason(item, true);
  if (reason) { feed.refuseFold(reason); reader.notice(reason); return; }
  try {
    await feed.setFold(item, true, { focus: false });
    await closeReaderAfterAction(presentation);
  } catch (error) {
    if (registry.isCurrent(presentation) && reader.presentation === presentation)
      reader.notice(feed.notices.get(error.envelope?.operation_id)?.words ?? error);
  }
}
// Read the current item at the press: an old button cannot answer a new source.
async function answerFromReader(id, choice) {
  const item = readerItem(), presentation = registry.current;
  if (!reactions || !item || item.id !== id || !mayAnswer(item, bootstrap.actor, bootstrap.actor_kind)) return;
  try {
    const pending = reactions.answer(item, choice);
    paintReaderThumb$();
    const receipt = await pending;
    await closeReaderAfterAnswer(presentation, receipt);
  } catch (error) { if (registry.isCurrent(presentation)) reader.notice(error); }
  finally { paintReaderThumb$(); }
}
// Reply, or Return, on a lit message: the Reader opens on it with the cursor
// in the reply, and nothing quoted until the reader selects a passage. Return
// on a passage lit on its card, or words selected there (chosen), quotes them.
async function replyMessage(id, card, chosen = null) {
  const timing = beginTiming('reply_open');
  await openSource({ kind: 'message', id }, card, marks.capture(id), 'reply', null, { timing });
  if (!reader.dialog.open || registry.current?.source?.source_ref?.id !== id) { timingCall(timing, 'retire'); return; }
  if (chosen) reader.quoteFrom({ kind: 'message', id }, chosen); else reader.reply({ kind: 'message', id });
  if (reader.dialog.contains(document.activeElement) && document.activeElement?.matches('textarea, [contenteditable=true]')) timingCall(timing, 'endpoint', 'reply_focused');
  timingCall(timing, 'finish', timingCall(timing, 'hasEndpoint', 'reply_focused') ? 'complete' : 'incomplete', null);
}
// Reply and the first body click open a message's own composer. A second
// click opens the Reader with that same registered writing.
function syncCardReplies() {
  cardReplies?.sync(feedMessages().values(), id => { const entry = messageEntries.get(id); return entry && opened(entry); });
}
async function openMessageReader(id, card) {
  const fromCardReply = cardReplies?.from(id) ?? false;
  const p = await openSource({ kind: 'message', id }, card, marks.capture(id), 'reply', null, { fromCardReply });
  if (p && registry.current === p && reader.dialog.open && !p.sourceUnavailable)
    await readerMessageMenuItems(p).find(choice => choice.label === 'Edit')?.act();
  return p;
}
async function replyInCard(id, card) {
  const timing = beginTiming('reply_open');
  const request = ++cardReplyRequest, readerRequest = opening;
  let entry = messageEntries.get(id);
  if (!card?.getClientRects?.().length) entry = stackFeed?.land(id) ?? entry;
  if (entry) card = opened(entry);
  if (!card?.isConnected) { timingCall(timing, 'retire'); return; }
  const act = marks.capture(id);
  clearVisitNew(id);
  let p;
  try { p = await (timing ? cardReplies.open(id, card, { timing }) : cardReplies.open(id, card)); }
  catch {
    // The Reader can show a source refusal alongside authorized kept writing.
    // An old failed click must not replace a newer card or Reader opening.
    if (request !== cardReplyRequest || readerRequest !== opening || retired || !card.isConnected || registry.disposed) return;
    timingCall(timing, 'finish', 'failed', 'unknown');
    return openSource({ kind: 'message', id }, card, act);
  }
  if (p && registry.isCurrent(p)) {
    marks.read(act, () => registry.isCurrent(p)); openedHere(id); releaseTopArrivals();
  }
  timingCall(timing, 'finish', timingCall(timing, 'hasEndpoint', 'reply_focused') ? 'complete' : 'incomplete', null);
  return p;
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
  const presentation = registry?.current, generation = registry?.generation, source = presentation?.source;
  const ref = source?.source_ref, revision = ref?.revision, id = ref?.kind === 'memory' ? ref.id : null;
  if (!id || topicUnavailable) return true;
  if (authorityReviewPending()) return false;
  try {
    const answer = checkedView(await registry.cleanup.list(options => api.view('memory_current', { item_id: id }, options)), bootstrap.instance_id);
    if (answer?.source_ref?.kind !== 'memory' || answer.source_ref.id !== id ||
        !Number.isSafeInteger(answer.source_ref.revision) || answer.source_ref.revision < 1) throw Error('The Notebook page could not be confirmed.');
    // A read belongs to the presentation that asked for it. Undo can reopen
    // this same item while its deletion answer is still on the way, and a
    // newer revision can also become known without replacing the source.
    if (registry.current !== presentation || registry.generation !== generation || !registry.isCurrent(presentation) ||
        presentation.source !== source || source.source_ref?.kind !== 'memory' || source.source_ref.id !== id ||
        answer.source_ref.revision < Math.max(revision, source.source_ref.revision, source.current_revision ?? 0, views.revisions.values.get(id) ?? 0)) return true;
    if(answer.deleted) {
      presentation.sourceUnavailable=true;presentation.accessMessage='This Notebook page was deleted. Your private writing is kept.';
      source.body='';source.attachments=[];
      for(const editor of Object.values(presentation.editors)){editor.unavailable=true;registry.cancelSave(editor);}
      revokeMedia();reader.hideUnavailableSource();paintReaderMark();
    }
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
  clearVisitNew(item.id);
  const copy = menu?.copyChoice?.(item, { say: more });
  openMessageMenu({ anchor: more, items: messageMenuItems(item, more, more, copy ? [copy] : []), label: 'This message', sheet: true });
}
// Capture before any menu callback mutates pending acts, folds or content.
// Include the title bar's phone-only items and the second Move or join sheet.
function cardMenuActs(item, items, anchor) {
  const feed = stackFeed;
  return feed ? items.map(choice => ({ ...choice, act: () => {
    const result = feed.cardAct(item.id, choice.act, anchor), mark = listActAnchor;
    // Show full message can grow/scroll the card after its source read.
    // A later gesture or another act makes this completion obsolete.
    if (result?.finally) return result.finally(() => { if (mark && listActAnchor === mark && actedListCard(mark)) keepListAnchor(() => {}); });
    return result;
  } })) : items;
}
// say: the ⋯ that says "Link copied", or null where none shows. anchor: what
// the menu opened from, where a phone's "Move or join…" sheet opens too.
// What the message's stack offers comes first, its moves and joins last (stack-feed.mjs).
function messageMenuItems(item, say, anchor = say, first = []) {
  const items = sharedMessageMenuItems(item, { say, anchor }), shared = new Set(items.map(item => item.label));
  return cardMenuActs(item, [...first.filter(item => !shared.has(item.label)), ...items], anchor);
}
// Every message menu consumes this list. Only arrangement and clipped-card
// expansion belong to the feed; the Reader adds its selection and layout.
function sharedMessageMenuItems(item, { say, anchor = say, presentation = null, remote = null } = {}) {
  const inReader = Boolean(presentation), phone = Boolean(window.matchMedia?.('(max-width: 760px)').matches);
  const available = remote ? Boolean(item.stack_position) : !topicUnavailable, ended = remote ? false : outcomeReached;
  const rights = remote ? { ...editRights(), unavailable: !available, reached: false } : editRights();
  const stack = remote ? stackMenuItems(remote.stack, () => {}) : stackFeed && !topicUnavailable && item.topic_id === topic?.id ? stackFeed.menuItems(item, { phone, reader: inReader, at: inReader ? anchor : null,
    rename: act => inReader ? run(() => leaveReaderForRename(presentation, act)) : act(),
    more: moves => anchor && openMessageMenu({ anchor, items: cardMenuActs(item, moves, anchor), label: 'Move or join', sheet: true }) }) : { first: [], last: [] };
  const move = item.stack_position?.can_move || item.dossier?.can_move
    ? [{ label: 'Move to topic…', glyph: 'movetopic', act: () => moveDossier(item.id, anchor) }] : [];
  const items = [...stack.first, ...move, { label: 'Copy Link', glyph: 'link', act: () => run(() => copyLink(item.topic_id, item.id, say)) }];
  if (!inReader && !remote) {
    const card = cardIn(messageEntries.get(item.id));
    if (cardScroll?.clipped(card, item)) items.push({ label: 'Show full message', glyph: 'full', act: () => run(() => cardScroll.showFull(card, item)) });
  }
  if (mayEdit(item, rights) && (remote || !messageEdit)) items.push({ label: 'Edit', glyph: 'pencil',
    act: () => run(() => editMessage(item.id, inReader ? anchor : editOpener(item, anchor))) });
  const update = available && !ended && updateMenuItem(document, item, updateContext(item.topic_id));
  if (update) items.push(update);
  const withdraw = withdrawalItem(item, rights, item => run(() => withdrawals.withdraw(item)));
  if (withdraw) items.push(withdraw);
  const remove = removalItem(item, rights, item => run(() => removals.remove(item)));
  if (remove) items.push(remove);
  if ((remote || marks) && item.author_id !== bootstrap.actor && available) {
    // A source read carries no mark revision. Offer both explicit choices
    // until the current destination owner can confirm the mark.
    const states = remote ? [true, false] : [marks.state(item.id)?.marked === true];
    for (const marked of states) items.push({ label: marked ? 'Mark read' : 'Mark unread', glyph: marked ? 'read' : 'unread',
      act: () => run(() => markFromMenu(item.id, !marked)) });
  }
  if (available && !ended && (remote || topic)) {
    const fromSource = act => run(() => withMenuSource(item, presentation, anchor, act));
    if (mayStartFrom(item)) {
      items.push({ label: 'Start a topic from this', glyph: 'topic', act: () => fromSource(() => openStartLine()) });
      if (remote || pipelineRow?.on) items.push({ label: 'Add to pipeline', glyph: 'pipeline',
        act: () => fromSource(() => pipelineAddFor === null ? openPipelineAdd() : closePipelineAdd(true)) });
    }
    if (remote || !messageEdit && item.topic_id === topic.id) items.push({ label: 'Start a new dossier', glyph: 'pencil',
      act: () => fromSource(p => startNewDossier(p, inReader)) });
  }
  return [...items, ...stack.last].map(choice => ({ ...choice, key: choice.key ?? choice.label,
    ...(remote ? { act: () => remote.choose(choice.key ?? choice.label, choice.label) } : {}) }));
}
function messageCopyChoice(item, { say, presentation, cover, selected, notice = status } = {}) {
  const entry = messageEntries.get(item.id);
  const host = cover ?? (presentation ? reader.sourceBody : cardIn(entry)?.querySelector(':scope > .message-preview'));
  const selection = selected ?? clipboardSelection(host, () => presentation ? reader.selectedPassage() : menu?.passages.selected(entry)?.text);
  const coverWords = cover && copyOfCover(cover);
  const page = shell.page, shownTopic = topic, serial = landingSerial;
  const revision = revisionOf(presentation?.source ?? item);
  const current = () => !retired && !topicUnavailable && shell.page === page && topic === shownTopic &&
    landingSerial === serial && !authorityReviewPending() &&
    (!cover || cover.isConnected && copyOfCover(cover) === coverWords) && revisionOf(presentation?.source ?? item) === revision &&
    (presentation ? registry.isSourceCurrent(presentation) && !presentation.availabilityUnconfirmed
      : feedMessages().get(item.id) === item);
  const known = coverWords ? coverWords() : presentation ? presentation.source.body
    : item.preview ? cardScroll?.known(item.id) : item.body;
  const render = body => clipboardWords(body, document, { displayRules: topic?.id === item.topic_id ? displayRules() : [] });
  return copyWordsChoice({ selection, empty: !selection && known !== undefined && !hasClipboardWords(known),
    contents: () => known !== undefined ? render(known) : cardScroll.whole(item.id, 'foreground').then(render),
    say, current, status: notice });
}

function readerCopyChoice(p, { say, cover, selected }) {
  const source = p?.source, ref = source?.source_ref;
  if (!source || p.sourceUnavailable) return null;
  const notice = words => reader.notice(words);
  if (ref?.kind === 'message') {
    return topic ? messageCopyChoice({ ...source, id: ref.id }, { say, cover, selected, presentation: p, notice }) : null;
  }
  if (ref?.kind !== 'memory' || !source.owner_scope) return null;
  const copied = copyWordsChoice({ empty: !hasClipboardWords(source.body), contents: () => notebookClipboard(source.body, 'text'),
    say, status: notice, current: () => registry.isSourceCurrent(p) && reader.source === source });
  return { ...copied, key: 'copy-text' };
}

// A rail menu already holds its scoped message, including a preview when long.
// A copy may get the whole source without opening that dossier or navigating.
function railMessageCopyChoice(item, anchor, notice) {
  const handles = shell.handles;
  const current = () => !retired && shell.handles === handles && handles?.readable?.() !== false;
  const read = async () => {
    const source = await handles.view('source', { source_ref: { kind: 'message', id: item.id } }, 'foreground');
    if (!current() || source.source_ref?.kind !== 'message' || source.source_ref.id !== item.id ||
        source.topic_id !== item.topic_id || typeof source.body !== 'string') throw Error(COPY_REFUSED);
    return clipboardWords(source.body);
  };
  return copyWordsChoice({ empty: !item.preview && !hasClipboardWords(item.body),
    contents: () => item.preview ? read() : clipboardWords(item.body), current,
    doc: anchor.ownerDocument, status: notice ?? status });
}
// A feed action that needs the full source opens that exact message first.
// No late open is allowed to act on a different Reader, topic or source.
async function withMenuSource(item, presentation, anchor, act) {
  const currentTopic = topic;
  const p = presentation ?? await openSource({ kind: 'message', id: item.id }, anchor);
  if (!p || retired || topic !== currentTopic || topicUnavailable || outcomeReached || !registry.isCurrent(p) ||
      p.sourceUnavailable || p.availabilityUnconfirmed || p.source?.source_ref?.kind !== 'message' ||
      p.source.source_ref.id !== item.id || p.source.topic_id !== topic?.id ||
      reader.presentation !== p || reader.source !== p.source) return;
  return act(p);
}
async function startNewDossier(presentation, moveReply) {
  try {
    const source = presentation.source, people = whisperPeople();
    const moved = await registry.startDossier(presentation, {
      link: messageLink(source.topic_id, source.source_ref.id), moveReply,
      names: moveReply ? reader.names(presentation.editors.reply) : [], kindOf: people.kindOf,
    });
    if (moved && registry.isCurrent(registry.inline)) { inline.show(registry.inline); inline.pop(); }
  } catch (error) {
    if (registry.isSourceCurrent(presentation)) reader.notice(error); else status(error);
  }
}
// Rename is the feed's existing inline field. Retain the Reader writing and
// close its modal before handing focus to that field.
async function leaveReaderForRename(presentation, act) {
  const currentTopic = topic, generation = registry.generation;
  if (!registry.isCurrent(presentation)) return;
  const closed = await registry.close(presentation);
  if (closed && !retired && topic === currentTopic && registry.generation === generation + 1 && !registry.current) act();
  else if (!closed && registry.isCurrent(presentation)) reader.notice('The reply could not be kept before renaming. Finish saving it first.');
}
function moveDossier(id, anchor) {
  openDossierMove({ anchor, messageId: id,
    apart: topicRail?.pages.apart ?? true,
    read: (name, args) => api.view(name, args, { readClass: 'foreground' }),
    send: envelope => api.command(envelope),
    binding: () => ({ instanceId: bootstrap.instance_id, authority: registry.runtime.current }),
    moved: () => { freshness?.invalidate('dossier_move', 0, true); freshness?.request(); }
  });
}
// The rail reads one source; it does not open it to construct this list.
function railDossierMenu(item, anchor, choose, notice) {
  const loaded = item.topic_id === topic?.id && views?.messages.get(item.id);
  const copy = notice ? [railMessageCopyChoice(loaded ?? item, anchor, notice)] : [];
  if (loaded && !topicUnavailable) return [...copy, ...messageMenuItems(loaded, null, anchor).map(choice => ({ ...choice,
    act: () => choose(choice.key ?? choice.label, choice.label) }))];
  const acts = item.acts ?? {}, position = item.stack_position;
  return [...copy, ...sharedMessageMenuItems(item, { anchor, remote: { choose, stack: {
    cover: firstCoverMenuItem(document, { id: item.id, dossier: item.id, head: item, replies: [] }),
    starred: Boolean(acts.starred) || position.starred?.length > 0, folded: Boolean(acts.folded), head: true, hasReplies: true,
    position: true, below: position.below, found: true, reader: false,
    phone: Boolean(window.matchMedia?.('(max-width: 760px)').matches), open: false,
    joined: Boolean(acts.joined), placed: position.placed != null, undo: true,
    foldable: true, openable: true,
  } } })];
}
let railMarks = null;
async function markFromRail(item, marked) {
  const handles = shell.handles;
  const owner = marks ?? (railMarks ??= new Marks({ api, instanceId: bootstrap.instance_id, authority: () => bootstrap.authority }));
  if (!await owner.load(item.topic_id, args => api.view('marks', args, { readClass: 'foreground' }))) throw Error('The message marks could not be read. Try again.');
  if (retired || shell.handles !== handles || handles.readable?.() === false) throw Error('The page changed before the mark could be saved.');
  const receipt = await owner.send(item.id, marked, owner.state(item.id)?.mark_revision ?? 0);
  if (receipt?.status !== 'committed') throw Error(receipt?.error?.message ?? 'The mark was not confirmed. Choose it again to retry the same request.');
}
function runDossierMenuChoice(id, key, label, anchor) {
  if (retired || topicUnavailable) return false;
  const item = views?.messages.get(id);
  if (!item || item.topic_id !== topic?.id) return false;
  const choice = messageMenuItems(item, null, anchor).find(choice => (choice.key ?? choice.label) === key && choice.label === label);
  if (!choice || choice.disabled) return false;
  choice.act(); return true;
}
function openDossierMenuRoute(id, route) {
  const item = views?.messages.get(id), entry = messageEntries.get(id), anchor = entry && cardIn(entry);
  if (retired || topicUnavailable || !item || item.topic_id !== topic?.id || !anchor) return status('That dossier action is no longer available here.');
  const items = messageMenuItems(item, null, anchor), key = route.act === 'rename' ? 'rename' : route.choice;
  const choice = items.find(item => item.key === key);
  if (!choice || choice.disabled) return status('That action is no longer available. Open the dossier menu to choose again.');
  if (route.act === 'rename' || route.act === 'ui') return choice.act();
  return openMessageMenu({ anchor, items, focusKey: key, label: 'This message', sheet: true });
}
// A right-click on a message or its cover opens the menu at the pointer.
function messageContextMenu(event) {
  if (retired || event.defaultPrevented) return;
  if (event.target.closest('#reader')) return;
  if (event.target.closest('a, input, textarea, select, [contenteditable]') || window.getSelection()?.isCollapsed === false) return;
  // A message on its own or in a reply stack (reply-stacks.mjs).
  const section = event.target.closest('.reply-stack');
  const cover = event.target.closest('.dossier-cover');
  const header = section?.parentElement === $('messages') && (cover || event.target === section || event.target.closest('.stack-head, .stack-frame-head, .stack-toggle'));
  const entry = header ? section.querySelector(':scope > [data-id]') : entryOf($('messages'), event.target), item = entry && views?.messages.get(entry.dataset.id);
  if (!item) return;
  if (header && item.stack_position?.root_id && item.stack_position.root_id !== item.id) return;
  event.preventDefault();
  const card = cardIn(entry), shown = !card.hidden, anchor = cover ?? (shown ? card : entry.querySelector('.fold-line') ?? entry);
  const at = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null;
  const copy = menu?.copyChoice?.(item, { cover });
  openMessageMenu({ anchor, at, items: messageMenuItems(item, menu?.moreFor(entry) ?? null, anchor, copy ? [copy] : []), label: 'This message', sheet: true });
}
async function copyOutcomeLink(id) {
  const link = new URL(routeHref({ kind: 'workspace', id }), location.href).href;
  if (await copyText(link)) status('Link copied.');
  else status(`The link could not be copied here. Select it to copy it: ${link}`);
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
// The Reader's message descriptors also own a body double-click's Edit:
// ending that edit keeps the Reader open and returns focus to its own More.
function readerMessageMenuItems(p) {
  const ref = p?.source?.source_ref, button = $('reader-menu');
  if (!p || p.sourceUnavailable || ref?.kind !== 'message' || !topic) return [];
  const items = sharedMessageMenuItems({ ...p.source, ...readerFeedItem(), id: ref.id, author_id: p.source.author }, { say: button, anchor: button, presentation: p });
  const current = topicState?.topic;
  // Explicit topic labels keep these separate from the message's Archive.
  // The normal departure guard retains Reader writing before it closes.
  if (p.source.topic_id === topic.id && current?.id === topic.id && current.kind !== 'conversation' && !retired && !topicUnavailable) {
    if (topicState.says && current.state !== 'done') items.push({ label: 'Mark topic done', glyph: 'kept', act: () => run(() => runTopicMenuAction(current, 'state')) });
    if (topicState.controls?.managed && !current.archived) items.push({ label: 'Archive topic', glyph: 'archive', act: () => run(() => runTopicMenuAction(current, 'archive')) });
  }
  return items;
}
// The Reader's text borrows the same Edit descriptor and More focus return.
// Controls and whitespace keep their own gestures; eligibility is read anew.
function readerTextEdit(event) {
  const body = $('source-body'), target = event.target;
  if (!reader.dialog.open || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
      target === body || !body.contains(target) || target.closest('a, button, input, textarea, select, [contenteditable], [role="button"], img, svg')) return null;
  return readerMessageMenuItems(registry.current).find(item => item.label === 'Edit');
}
function openReaderMenu() {
  openReaderMenuAt();
}
let readerCopyHeld = null;
function openReaderMenuAt(at = null, host = null) {
  const p = registry.current, ref = p?.source?.source_ref, button = $('reader-menu');
  const cover = host?.closest('.dossier-cover') ?? null;
  const held = readerCopyHeld; readerCopyHeld = null;
  const selected = !host && held && held.presentation === p && held?.source === p?.source ? held.selection : null;
  const items = readerMessageMenuItems(p);
  const copy = reader.copyMenuWords?.(p, { say: at ? null : button, cover, selected });
  if (ref?.kind === 'message' && copy) items.push(copy);

  if (p && !p.sourceUnavailable && ref?.kind === 'memory' && p.source.owner_scope) {
    const source=p.source;
    const act=key=>run(async()=>{
      if(registry.current!==p||p.sourceUnavailable||reader.source!==source)return;
      if(key==='copy'||key==='revision')return copyPageLink(source,key==='revision'?ref.revision:null,button);
      if(key.startsWith('start-'))return notebookStartsOf().show({kind:key.slice(6),source,link:pageLink(source.owner_scope,ref.id),host:$('source-body').parentElement,anchor:button,current:()=>registry.current===p&&!p.sourceUnavailable});
      const opener=p.opener;$('reader-close').click();
      if(await openNotebook(ref.id,{opener})){
        const page=notebookSheetOf().current;
        if(key==='edit')return;
        page.menuItems({rail:true}).find(item=>item.key===key&&!item.disabled)?.act();
      }
    });
    items.push(...notebookReaderMenuItems(source,act,copy));
  }
  if (reader.quotable) items.push({ label: 'Quote selection', glyph: 'quote', act: () => reader.quote() });
  if (reader.layoutChoice) items.push({ label: reader.layoutChoice, glyph: 'layout', act: () => reader.toggleLayout() });
  (ref?.kind==='memory'?openNotebookMenu:openMessageMenu)({ anchor: host ?? button, at, items, label: ref?.kind === 'memory' ? 'This page' : 'This message', sheet: true });
}
// Terminal state belongs to its exact message, even when a receipt arrives after a Reader step.
function learnQuestionState({ message_id, question }) {
  if (!question) return;
  const known = questionStates.learn(message_id, question);
  const item = feedMessages().get(message_id);
  if (item) item.question = known;
  const source = registry.current?.source;
  if (source?.source_ref?.kind === 'message' && source.source_ref.id === message_id) {
    source.question = known; reader.paintOrigin(source);
  }
  const card = cardIn(messageEntries.get(message_id)), author = card?.querySelector('.message-author');
  if (author && item) { paintCardAuthor(author, item); paintReactions(card, item, bootstrap.actor, bootstrap.actor_kind, document); }
  paintReaderThumb$();
}
// The actor's withdrawal event also covers replies whose original is outside
// this page. Their existing authorized context can be updated without a read.
function learnWithdrawnReplyContext(messageId, messages) {
  views.rememberParentWithdrawal(messageId);
  let changed = false;
  for (const reply of messages.values()) {
    if (reply.reply_to !== messageId || !reply.reply_to_author || reply.reply_to_withheld || reply.reply_to_withdrawn) continue;
    reply.reply_to_withdrawn = true;
    changed = true;
    const entry = messageEntries.get(reply.id);
    if (entry) paintReplyContext(cardIn(entry), reply, messages);
  }
  return changed;
}
// A message's withdrawal is permanent and belongs only to that identity, even after a Reader step.
function learnQuestionWithdrawal({ message_id, withdrawal }) {
  questionStates?.learn(message_id, { state: 'withdrawn', waiting_on: [], may_resolve: false, ...withdrawal });
  const messages = feedMessages(), item = messages.get(message_id);
  learnWithdrawal(item, withdrawal);
  const card = cardIn(messageEntries.get(message_id)), author = card?.querySelector('.message-author');
  if (author && item) { paintCardAuthor(author, item); paintReactions(card, item, bootstrap.actor, bootstrap.actor_kind, document); }
  if (learnWithdrawnReplyContext(message_id, messages) || item) stackMessages();
  menu?.paint();
  const source = registry.current?.source;
  if (source?.source_ref?.kind === 'message' && source.source_ref.id === message_id) {
    learnWithdrawal(source, withdrawal); reader.paintOrigin(source);
  }
}
function learnMessageRemoval({ message_id, removal }) {
  questionStates?.remove(message_id);
  // Bind the shared terminal map before learnRemoval paints. A separate head
  // or its pending read then sees the same fact as the loaded page.
  dossierHeads?.sync(views.messages, views.removals);
  views?.learnRemoval(message_id, removal);
  if (typeof stackFeed !== 'undefined') stackFeed?.shelf?.removed(message_id, removal);
  const item = feedMessages().get(message_id), entry = messageEntries.get(message_id), card = cardIn(entry);
  if (entry) dropCardDocuments(entry);
  if (removal.kind === 'unsent') { if (entry) dropCardImages(entry); entry?.remove(); messageEntries.delete(message_id); clearVisitNew(message_id); }
  else if (card && item) { paintCardAuthor(card.querySelector('.message-author'), item); paintFoldWords(entry, item); paintAwaiting(card, item); paintReactions(card, item, bootstrap.actor, bootstrap.actor_kind, document); }
  const presentation = registry.current, source = presentation?.source;
  if (source?.source_ref?.kind === 'message' && source.source_ref.id === message_id) {
    source.removal = removal; source.removal_action = null;
    if (removal.kind === 'unsent') {
      presentation.sourceUnavailable = true; presentation.accessMessage = 'This message was unsent. Your private writing is kept.';
      source.body = ''; source.attachments = []; source.quotes = [];
      for (const editor of Object.values(presentation.editors)) { editor.unavailable = true; registry.cancelSave(editor); }
      revokeMedia(); reader.hideUnavailableSource(); paintReaderMark();
    } else { reader.paintOrigin(source); paintReaderThumb$(); }
  }
  menu?.paint();
}
// Who may edit which message here (message-edit-writing.mjs, mayEdit).
const updateContext = topicId => ({ viewer: bootstrap.actor, nameOf: displayActor, topicId });
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
  refreshDossierHeads(id);
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
  if (!current() || !registry.isSourceCurrent(p) || p.sourceUnavailable || p.availabilityUnconfirmed || messageEdit?.id === id || revisionOf(latest) <= revisionOf(p.source)) return done;
  const apply = () => {
    if (!current() || !registry.isSourceCurrent(p) || p.sourceUnavailable || p.availabilityUnconfirmed ||
        !reader.dialog.open || reader.source !== p.source || messageEdit?.id === id || revisionOf(latest) <= revisionOf(p.source)) return;
    // Hold the source revision and its reactions with the words under Copy.
    if (deferFencePaint(reader.sourceBody, apply)) return;
    Object.assign(p.source, { body: latest.body, revision: revisionOf(latest), edited_ms: latest.edited_ms ?? null,
      struck: latest.struck ?? null, acts: latest.acts ?? p.source.acts, release_card: latest.release_card });
    reader.redrawSource();
  };
  if (deferReleaseCard(reader.sourceBody, latest, apply, {
    protect: () => reader.dialog.open, current: () => current() && registry.isSourceCurrent(p) && !p.sourceUnavailable && !p.availabilityUnconfirmed && reader.dialog.open && reader.source === p.source })) return done;
  apply();
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
  // A private note keeps its card whole, including when its flag arrives
  // after the dossier was folded. The arrangement retains its visit state.
  stackFeed?.arrange();
  paintCardReading(); menu?.paint(); syncCardReplies();
}
// Each card whose words an edit changed (TopicViews.takeRevised): the edited
// message's words, its excerpt cue, its folded line, its author line's
// "Edited" and whether it reads as read, and the reply line of each loaded reply to it; then the
// conversation's own copy of each edited message (edits, loaded here or not)
// and of each reply to one, and the stacks, whose rows read first lines.
function repaintEdited(ids, edits, releaseUpdate = false) {
  const CUE = 'Excerpt · Open to read the rest';
  for (const id of ids) {
    const item = views.messages.get(id), entry = messageEntries.get(id);
    if (!item || !entry) continue;
    const card = cardIn(entry);
    if (deferReleaseCard(card, item, () => repaintEdited([id], edits, true), {
      force: releaseUpdate,
      protect: () => reader?.dialog.open && reader.source?.source_ref?.id === id,
      current: () => !retired && messageEntries.get(id) === entry && views.messages.get(id) === item && !item.removal })) continue;
    if (deferFencePaint(card, () => repaintEdited([id], edits))) continue;
    paintCardAuthor(card.querySelector(':scope > .message-author'), item);
    paintReplyContext(card, item);
    const preview = card.querySelector(':scope > .message-preview');
    const keepingWhole = reader?.card === card && item.preview;
    if (preview && !keepingWhole) {
      formatWords(preview, item.body, { partial: item.preview === true, replyBasis: item.reply_basis, agentReply: item.author_kind === 'agent' && Boolean(item.reply_to), copyFences: 'feed', revision: revisionOf(item), struck: item.struck, showChanges: messageChanges?.shown(item.id, revisionOf(item)) ?? true, displayRules: displayRules() });
      preview.classList.remove('scroll-in-place');
      const cue = card.querySelector(':scope > .message-preview-cue');
      if (item.preview && !cue) preview.after(node('span', CUE, 'message-preview-cue'));
      else if (cue && !item.preview) cue.remove();
      else if (cue) { cue.textContent = CUE; cue.hidden = false; }
    }
    paintCardImages(card, item, cardImageBytes(id));
    paintCardDocuments(card, item);
    paintReleaseCard(card, item);
    paintFoldWords(entry, item);
    if (keepingWhole) {
      // Keep the old whole source while its revision is read, rather than
      // briefly shrinking this reply's source to the arriving excerpt.
      cardScroll.forget(id);
      run(async () => {
        await cardScroll.showFull(card, item, () => reader.card === card && revisionOf(views.messages.get(id)) === revisionOf(item));
      });
    } else cardScroll?.forget(id, card);
    // An agent's edit of words the person had read makes the message new to them again (item 614): Core says so
    // (unread), and opening it in the Reader earlier in this visit no longer reads it.
    if (item.unread === true) openedIds.delete(id);
  }
  paintCardReading(); stackMessages(); menu?.paint();
  paintMessageContext();
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
  const currentTopic = topic, currentViews = views, generation = registry.generation;
  const windowEpoch = views.windowEpoch, windowRequest = windowReadSerial, windowReadStart = views.windowKnowledge;
  const outcome = { topic: currentTopic, views: currentViews, generation, accessEpoch, applied: false, rowsAdded: 0, cursorAdvanced: false };
  const cursor = kind === 'messages' ? views.olderCursor : views.memoryCursor;
  if (more && cursor === null) return Promise.resolve();
  const foreground = registry.cleanup.foreground();
  const args = kind === 'messages' ? { topic_id: topic.id, audience: 'all', direction: 'before', limit: 30 }
    : { owner_scope: views.scope, limit: 20 };
  if (more) args.cursor = cursor;
  const run = foreground.read(options => api.view(kind === 'messages' ? 'topic_messages' : 'memory_items', args, options)).then(page => {
    checkedView(page, bootstrap.instance_id);
    if (!mayPaint || accessEpoch !== listAccessEpoch || authorityReviewPending() || retired || registry.disposed ||
        topic !== currentTopic || views !== currentViews || generation !== registry.generation || more && windowRequest !== windowReadSerial) return outcome;
    if (kind === 'messages') {
      // Measure only this synchronous application, not another load that
      // advanced the same frontier while this request was in flight.
      const beforeRows = views.messages.size, beforeCursor = views.olderCursor;
      const moved = more && cursor !== views.olderCursor;
      const applied = views.messagesPage(page, { initial: !more, cursor, anchored: moved, contiguous: more,
        windowEpoch: more ? views.windowEpoch : windowEpoch, windowReadStart });
      if (applied && moved) views.olderCursor = page.next_cursor === null || views.olderCursor === null ? null : Math.min(views.olderCursor, page.next_cursor);
      return { ...outcome, applied, rowsAdded: applied ? views.messages.size - beforeRows : 0,
        cursorAdvanced: applied && beforeCursor !== null && (views.olderCursor === null || views.olderCursor < beforeCursor) };
    }
    else views.memoryPage(page, { initial: !more, cursor });
  }).finally(() => { foreground.release(); listLoads.delete(kind); });
  listLoads.set(kind, run); return run;
}
async function loadOlderMessages() {
  const currentTopic = topic, currentViews = views, generation = registry.generation, accessEpoch = listAccessEpoch;
  fillFrom($('messages'));
  const outcome = await listPage('messages', true);
  if (outcome?.applied && (outcome.rowsAdded > 0 || outcome.cursorAdvanced) &&
      outcome.topic === currentTopic && outcome.views === currentViews && outcome.generation === generation && outcome.accessEpoch === accessEpoch &&
      topic === currentTopic && views === currentViews && registry.generation === generation && listAccessEpoch === accessEpoch &&
      !registry.disposed && !retired && !topicUnavailable && !authorityReviewPending()) releaseTopArrivals();
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
  const accessEpoch = listAccessEpoch, generation = registry.generation;
  const current = () => request === unreadLanding && !registry.disposed && !retired && !topicUnavailable &&
    accessEpoch === listAccessEpoch && generation === registry.generation;
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
    releaseTopArrivals();
    anchorHold = null;
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
  if (state.kind === 'authority') { ++listAccessEpoch; dossierHeads?.invalidate(); views?.resetStars(); }
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
  finishPageNotice($('updates-status'));
  // Updates that ran again may be retried after a later refusal.
  if (state.kind === 'current') reconnectRetried = null;
  if (state.kind === 'reconnect') run(reconnect);
}
async function checkAvailability(read, current, topicDenied = true) {
  dossierHeads?.invalidate();
  views.resetStars();
  if (topicDenied) {
    topicUnavailable = true; ++listAccessEpoch;
    dossierHeads?.invalidate();
    drawFeed(false);
    // Nor the pictures of its messages (card-images.mjs).
    clearPendingSends($('messages')); dropCardDocuments(); dropCardImages($('messages'));
    $('topic-title').textContent = 'Topic unavailable'; $('topic-description').textContent = '';
    // No settings for a topic the reader cannot see.
    $('settings-open').hidden = true; $('topic-menu').hidden = true; settings?.close();
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
    checkInlineAvailability(read, current), checkSourceAvailability(read, current, topicDenied), checkCardAvailability(read, current),
  ]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}
async function checkCardAvailability(read, current) {
  const queue = [...registry.cards.values()];
  // A scoped access check, bounded like initial saved-reply restoration.
  const worker = async () => { while (queue.length && current() && !registry.disposed) await registry.refreshCard(queue.shift(), read, current); };
  try { await Promise.allSettled([worker(), worker()]).then(results => {
    const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
  }); }
  finally { if (!current()) freshness?.invalidate('availability', 0, true); }
}
async function retryCard(p) {
  if (!p || p.availabilityChecking || p.editors.reply.authorityRecovery) return;
  const foreground = registry.cleanup.foreground(), current = () => !registry.disposed && registry.cards.get(p.source.source_ref.id) === p;
  try {
    await registry.refreshCard(p, async (name, args) => checkedView(await foreground.read(options => api.view(name, args, options)), bootstrap.instance_id), current);
    if (current()) cardReplies.surface(p)?.notice('');
  } catch (error) {
    if (current()) {
      const failure = readFailure(error);
      if (failure.kind === 'authority') { await registry.parkAuthority(bindingOf(bootstrap), failure.code); updateStatus(failure); }
      cardReplies.surface(p)?.notice(['Could not confirm reply access. Your writing is kept.', error]);
    }
  } finally { foreground.release(); }
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
      if (key === 'starred') return views.readStarred(read, () => current() && !topicUnavailable && !authorityReviewPending());
      if (key === 'acts' || key === 'topic') views.resetStars();
      if (key.startsWith('question:')) {
        const id = key.slice('question:'.length);
        const source = registry.current?.source;
        if (!views.messages.has(id) && !dossierHeads?.records.has(id) && source?.source_ref?.id !== id) return true;
        const answer = checkedView(await read('source', { kind: 'message', id }), bootstrap.instance_id);
        if (!current()) return false;
        learnQuestionState({ message_id: id, question: answer.question });
        freshness.invalidate('acts', 0, true); return true;
      }
      if (key.startsWith('withdrawal:')) {
        const id = key.slice('withdrawal:'.length);
        const source = registry.current?.source;
        if (!views.messages.has(id) && !dossierHeads?.records.has(id) && source?.source_ref?.id !== id) {
          if (learnWithdrawnReplyContext(id, feedMessages())) stackMessages();
          return true;
        }
        let answer;
        try { answer = checkedView(await read('source', { kind: 'message', id }), bootstrap.instance_id); }
        catch (error) {
          if (!current()) return false;
          // Only this source is unreadable. The separate removal resource
          // learns its terminal act; availability still owns topic denial.
          if ((error?.details?.error ?? error?.error ?? error)?.code === 'FORBIDDEN') return true;
          throw error;
        }
        if (!current()) return false;
        if (!answer.withdrawal) throw Error('The question withdrawal has not arrived yet.');
        learnQuestionWithdrawal({ message_id: id, withdrawal: answer.withdrawal });
        freshness.invalidate('acts', 0, true); return true;
      }
      if (key.startsWith('removal:')) {
        const id = key.slice('removal:'.length);
        // The actor-scoped terminal event is enough to discard a no-longer
        // readable identity; no cache or delayed page can put it back.
        const removal = await readRemoval(read, id);
        if (!current()) return false;
        learnMessageRemoval({ message_id: id, removal });
        return true;
      }
      if (key.startsWith('edit:')) return messageEdited(key, version, read, current);
      // The edit session of one of the person's messages moved (docs/message-edit.md): another device may have taken it.
      if (key.startsWith('edit_session:')) { if (messageEdit?.id === key.slice(13)) messageEdit.writing.sessionChanged(version); return true; }
      if (key !== 'neighbors') {
        const done = await views.refresh(key, version, read, current);
        if (key.startsWith('yours:') && done !== false && current()) {
          const result = await registry.refreshSharedReply(key.slice(6), read, current);
          if (result === false) return false;
          if (result?.retired && current()) cardReplies?.sharedSent(result.presentation);
        }
        if (key === 'dossier_move' && done !== false && current() && registry.current?.source?.source_ref?.kind === 'message') {
          const p = registry.current, source = checkedView(await read('source', p.source.source_ref), bootstrap.instance_id);
          if (current() && registry.current === p) { Object.assign(p.source, source); paintReaderTitle(); }
        }
        if (key === 'acts' && done !== false && current()) {
          await readReaderDossier(registry.current, read, current);
          if (current()) {
            const source = registry.current?.source;
            if (source?.source_ref?.kind === 'message') {
              const answer = checkedView(await read('source', source.source_ref), bootstrap.instance_id);
              if (current() && registry.current?.source === source) learnQuestionState({ message_id: source.source_ref.id, question: answer.question });
            }
            if (current()) paintReaderTitle();
          }
        }
        if (key === 'topic' && done !== false && current()) {
          const source = registry.current?.source;
          // Archival and legacy waits can change without an exact question act.
          // Read only the question in the open Reader, never unloaded history.
          if (source?.source_ref?.kind === 'message' && source.question) {
            const answer = checkedView(await read('source', source.source_ref), bootstrap.instance_id);
            if (current() && registry.current?.source === source) learnQuestionState({ message_id: source.source_ref.id, question: answer.question });
          }
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
  views.resetStars();
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
    if (registry?.current?.availabilityUnconfirmed || registry?.inline?.availabilityUnconfirmed || [...registry.cards.values()].some(p => p.availabilityUnconfirmed)) { freshness?.invalidate('availability', 0, true); freshness?.request(); }
  }
  if (updateState?.kind === 'reconnect' && reconnectRetried !== api.token) {
    reconnectRetried = api.token; await freshness?.request({ refresh: true, retry: true });
  }
  return true;
}
let textDisplayPreferences = null, messageChanges = null;
const displayRules = () => textDisplayPreferences?.enabled ?? [];

function toggleMessageChanges(id, revision) {
  messageChanges?.toggle(id, revision);
  const focus = document.activeElement;
  let replacement = null;
  keepListAnchor(() => {
    const item = views.messages.get(id), entry = messageEntries.get(id), card = entry && cardIn(entry);
    if (!item || !card || revisionOf(item) !== revision) return;
    const author = card.querySelector(':scope > .message-author');
    const focused = author?.contains(focus) && focus?.classList.contains('message-changes-toggle');
    const preview = card.querySelector(':scope > .message-preview');
    if (preview) redrawMessageWords(preview, displayRules(), { showChanges: messageChanges.shown(id, revision) });
    if (author) paintCardAuthor(author, item);
    if (focused) replacement = author.querySelector('.message-changes-toggle');
  });
  if (reader?.dialog.open && reader.source?.source_ref?.kind === 'message' && reader.source.source_ref.id === id && !reader.presentation?.sourceUnavailable) {
    const origin = $('reader-origin'), focused = origin?.contains(focus) && focus?.classList.contains('message-changes-toggle');
    reader.redrawSource();
    if (focused) replacement = origin.querySelector('.message-changes-toggle');
  }
  replacement?.focus({ preventScroll: true });
}

function redrawTextDisplay() {
  keepListAnchor(() => {
    for (const host of document.querySelectorAll('.message-preview')) redrawMessageWords(host, displayRules());
  });
  // Source-only repaint: no writing, session, read mark or delivery action.
  if (reader?.dialog.open && reader.source?.source_ref?.kind === 'message' && !reader.presentation?.sourceUnavailable) {
    reader.redrawSource();
  }
}

let startup = null;
function start() {
  if (!startup) startup = initialize().then(()=>{notebookDeleting?.start();}).finally(() => { startup = null; });
  return startup;
}
async function initialize() {
  const token = document.querySelector('meta[name="aim-next-session"]')?.content;
  if (!token || token === '__AIM_SESSION_TOKEN__') throw Error('This page needs a session from the Theseus server.');
  api = new Api(token); api.refused = () => run(reconnect);
  bootstrap = await api.bootstrap();
  if (!bootstrap?.instance_id || !bootstrap.actor || bootstrap.error) throw Error('The instance and reader identity could not be established.');
  if (!actionTimings) {
    try {
      actionTimings = new ActionTimings({ instanceId: bootstrap.instance_id,
        build: document.querySelector('script[type="module"][src]')?.src?.match(/\/b\/([^/]+)\//)?.[1] ?? 'unversioned',
        burden: () => ({ loaded_messages: views?.messages?.size ?? 0, retained_messages: feedMessages()?.size ?? 0,
          rendered_cards: [...messageEntries.values()].filter(entry => entry.isConnected).length, window_limit: 300 }),
        report: actionReporter({ instanceId: bootstrap.instance_id, send: envelope => api.command(envelope),
          authority: () => registry?.runtime?.current ?? bootstrap.authority }) });
      actionTimings.observe();
      window.addEventListener('pagehide', () => actionTimings?.dispose(), { once: true });
    } catch { actionTimings = null; }
  }
  railHotkeysFor(document)?.bind(bootstrap,()=>!retired&&shell.page===thisRun&&document.body.dataset.ready==='true');
  notebookDeleting=await notebookDeleteUI({doc:document,shell,api,bootstrap,current:()=>!retired&&shell.page===thisRun,
    open:async(id,mode,scope)=>{if(!retired)await openNotebook(id,{mode});}});
  notebookTransferDrag({doc:document,bootstrap,rail:()=>panes.outline?.list,current:()=>!retired&&shell.page===thisRun,
    perform:async(id,kind,scope)=>{if(!await openNotebook(id)||retired)return;const page=notebookSheet?.current;if(page?.item===id)await page.transferPage(kind,scope);},
    refused:words=>panes.outline?.menus.notice(words)});
  topicClosing = await topicCloseUI({ doc: document, shell, api, bootstrap,
    open: openDestination, current: () => !retired && shell.page === thisRun });
  let displayStorage;
  try { displayStorage = window.localStorage; } catch { /* device preferences stay in memory */ }
  textDisplayPreferences = new TextDisplayPreferences(bootstrap.instance_id, bootstrap.actor, displayStorage);
  messageChanges = new MessageChanges(bootstrap.instance_id, bootstrap.actor, displayStorage);
  paragraphSwitch?.dispose();
  paragraphSwitch=new ParagraphSwitch({doc:document,preferences:textDisplayPreferences,changed:redrawTextDisplay,current:()=>!retired&&shell.page===thisRun});
  // Every page, the phone check among them, takes the restarted server's session in place.
  renewal ??= new SessionRenewal({ api, bootstrap, live: () => live, makeApi: fresh => new Api(fresh),
    adopted: fresh => { document.querySelector('meta[name="aim-next-session"]').content = fresh; } });
  // The phone check is a page of its own: no topic, no live updates (docs/device-evidence.md).
  const asked = parseRoute(new URL(location.href));
  if (asked.kind === 'phone-check') { await phoneCheck({ api, bootstrap, topicId: asked.id }); document.body.dataset.ready = 'true'; return; }
  configureCoverAnswers(() => ({ reactions, changed: () => { freshness?.invalidate('acts', 0, true); freshness?.request(); } }));
  configureCoverRefresh(() => ({ api, bootstrap: { ...bootstrap, authority: registry?.runtime.current ?? bootstrap.authority },
    changed: () => { freshness?.invalidate('acts', 0, true); freshness?.request(); } }));
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
    const releaseToasts = releaseToastsFor(document, bootstrap.instance_id, bootstrap.actor);
    healthLight = new HealthLight({ link: $('health-link'), feed: () => live?.state ?? null,
      observe: answer => { if (!retired) releaseToasts.observe(answer); },
      read: async () => checkedView(await api.view('health_light', {}, { readClass: 'background' }), bootstrap.instance_id) });
    window.addEventListener('pagehide', () => releaseToasts.dispose());
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
  const arrivalNavigation = landingSerial, quotedNotebook = notebookQuoteRoute(route);
  if(route.page && !quotedNotebook) {
    try {
      const resolved=await resolveTopicLink(route,{read:(name,args)=>api.view(name,args,{readClass:'foreground'}),instanceId:bootstrap.instance_id,current:()=>!retired});
      if(retired)return;
      if(resolved&&(resolved.kind!==route.kind||resolved.id!==route.id)){route=resolved;history.replaceState(history.state,'',routeHref(route));}
    } catch { /* Core did not confirm new ownership; ordinary reads keep their refusal. */ }
  }
  if (!['topic', 'conversation'].includes(route.kind)) {
    await initializeOutcomePage(route);
    if(['root','workspace'].includes(route.kind))run(()=>initializeUnfinished(route));
    return;
  }
  // Keep the existing early color read independent of topic confirmation.
  if (!colors) {
    colors = new AgentColors({ api, instanceId: bootstrap.instance_id, authority: () => registry?.runtime.current ?? bootstrap.authority });
    colors.listen(paintAgentColors);
  }
  const colorsRead = colors.load('foreground').catch(() => {});
  if (!quotedNotebook && topicLinkNeedsLookup(route)) {
    try { route = await resolveTopicLink(route, { read: (name, args) => api.view(name, args, { readClass: 'foreground' }), instanceId: bootstrap.instance_id }) ?? route; }
    catch { /* An unconfirmed label keeps the route's existing startup path. */ }
    if (!['topic', 'conversation'].includes(route.kind)) {
      await initializeOutcomePage(route);
      if (['root', 'workspace'].includes(route.kind)) run(() => initializeUnfinished(route));
      return;
    }
  }
  // An outcome's conversation is its one topic of kind conversation (outcome-conversation.mjs).
  let topicId = route.id;
  // A message's link names the message to open once the page is up (docs/links.md).
  const anchored = route.kind === 'topic' ? route.message ?? null : null;
  const anchoredLand = route.land, anchoredDossier = anchoredLand === 'dossier';
  const menuArrival = route.act ? { ...route } : null;
  // So does a Notebook page's link, the page and perhaps its revision.
  const pageAnchor = route.kind === 'topic' && route.page ? { id: route.page, revision: route.revision ?? null } : null;
  // A topic's unread count opens it at its oldest unread message (item 613).
  const atUnread = route.kind === 'topic' && route.at === 'unread';
  if (anchored) {
    const linked = checkedView(await api.view('source', { source_ref: { kind: 'message', id: anchored } }, { readClass: 'foreground' }), bootstrap.instance_id);
    topicId = linked.topic_id;
  }
  if (anchored || pageAnchor || atUnread) { route = { kind: 'topic', id: topicId }; if (!menuArrival) shell.rename(route, location.hash); }
  if (route.kind === 'conversation') {
    const found = validate(await api.view('conversation', { workspace_id: route.id })).conversation;
    if (!found) throw Error('This outcome has no conversation yet.');
    topicId = found.topic_id;
    route = { kind: 'topic', id: topicId };
    shell.rename(route, location.hash);
  }
  // The saved feed position precedes topic, messages and Notebook startup reads.
  const checkpoint = await initialViews({ api, bootstrap, topicId, load: async () => {} });
  const actorCheckpoint = await actorBaseline({ api, bootstrap });
  const holds = id => Boolean(dossierHeads?.records.has(id));
  visitNew = visitNewFor(document, { instanceId: bootstrap.instance_id, actor: bootstrap.actor, authority: bootstrap.authority });
  views = new TopicViews({ instanceId: bootstrap.instance_id, topicId, reader: bootstrap.actor, paint: paintViews, invalidate: (key, version, force) => freshness?.invalidate(key, version, force), holds, reading, actMessages: feedMessages, arrived: items => visitNew.arrive(items), window: topicWindowOptions, evicted: queueWindowEvictions, offPageActs: () => stackFeed?.shelf?.refresh() });
  const headViews = views;
  const inspectWindow = () => {
    if (views !== headViews || retired) return null;
    const full = new Set(views.messages.keys()), heads = [];
    for (const [id, record] of dossierHeads?.records ?? []) if (record.state === 'available') { full.add(id); heads.push(id); }
    for (const source of [reader?.source, registry?.current?.source]) if (source?.source_ref?.kind === 'message') full.add(source.source_ref.id);
    if (messageEdit?.id) full.add(messageEdit.id);
    return { budget: 300, fullRecords: full.size, canonicalDOM: messageEntries.size,
      loaded: [...views.messages.keys()], heads, runs: new Set(views.runs.values()).size, hints: views.windowHints.size,
      gaps: views.windowGaps.length, protected: [...topicWindowOptions().pins], pressure: views.windowPressure,
      documents: cardDocumentStates.size, replySurfaces: cardReplies?.rows.size ?? 0, sourcePresentations: registry?.cards.size ?? 0,
      originalOperations: [...registry?.sessions.values() ?? []].reduce((n, session) => n + session.editor.submissions.filter(item => item.status !== 'confirmed').length, 0) };
  };
  const inspection = Symbol.for('theseus.topicWorkingSet'); window[inspection] = inspectWindow;
  window.addEventListener('pagehide', () => { if (window[inspection] === inspectWindow) delete window[inspection]; windowReadSerial++; });
  dossierHeads = new DossierHeads({ topicId,
    read: (name, args) => api.view(name, args, { readClass: 'background' }).then(answer => checkedView(answer, bootstrap.instance_id)),
    current: () => views === headViews && !registry?.disposed && !topicUnavailable && !authorityReviewPending(),
    changed: () => keepListAnchor(() => paintViews('messages')) });
  const result = validate(await api.view('topic', { topic_id: topicId })); topic = result.topic;
  views.topic = topic; views.participants = result.participants;
  if (topic.id !== topicId) throw Error('The topic identity could not be confirmed.');
  here = { workspaceId: topic.workspace_id, title: topic.workspace_id, view: null, conversation: topic.kind === 'conversation' };
  paintHeader(topic);
  // "Tools this topic improves" (docs/skills-and-tools.md): read with the page, and again as Topic settings opens.
  // One for the topic being read: a topic reached in place replaces the one before, so its chips never paint here.
  settings ??= new TopicSettings({ dialog: $('topic-settings'), gear: $('settings-open'), heading: $('settings-title'), close: $('settings-close'),
    opened: () => { topicState?.restoreTitleSurface(); const tools = topicTools; if (tools) run(() => tools.load()); } });
  $('topic-tools').hidden = true; $('topic-tools').replaceChildren();
  topicTools = here.conversation ? null : new TopicTools({ host: $('topic-tools'), topicId: topic.id, instanceId: bootstrap.instance_id, read: pipelineView, send: pipelineSend });
  if (topicTools) { const tools = topicTools; run(() => tools.load()); }
  // Every independent read starts in this turn after the confirmed topic.
  // Join them at their first use; fatal lists/journal failures settle even
  // while optional reads are pending, with no early editor or source wiring.
  const journalRead = openJournal({ instanceId: bootstrap.instance_id, actor: bootstrap.actor });
  let messageAnswer, memoryAnswer, workspace;
  try {
    [messageAnswer, memoryAnswer, , journal, workspace, , outcomeMembers] = await Promise.all([
      api.view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 30 }).then(answer => checkedView(answer, bootstrap.instance_id)),
      api.view('memory_items', { owner_scope: views.scope, limit: 20 }).then(answer => checkedView(answer, bootstrap.instance_id)),
      colorsRead,
      journalRead,
      api.view('workspace', { workspace_id: topic.workspace_id }).then(answer => validate(answer).workspace).catch(() => null),
      wakeLights.load(),
      readMembers(api, bootstrap.instance_id, topic.workspace_id).catch(() => null),
    ]);
  } catch (error) {
    // A refused list may finish before the device opens its journal. Close
    // that attempt's journal when it arrives, never a newer startup's owner.
    journalRead.then(opened => opened.close()).catch(() => {});
    throw error;
  }
  try {
    $('workspace-name').hidden=false;$('workspace-name').textContent = workspace.title;enableNewTopic(workspace.id);here.title = workspace.title;
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
  } catch { $('workspace-name').textContent = topic.workspace_id; }
  // Those who can be added: the outcome's team, or everyone when the team cannot be read.
  participantsPanel = new PeoplePanel({ host: $('participants'), label: 'Add someone to this topic', dismissible: true,
    candidates: () => outcomeMembers ? outcomeMembers.filter(person => person.enabled !== false).map(({ actor_id, ...person }) => ({ ...person, id: actor_id })) : directoryPeople,
    opened: () => { refreshMembers(); refreshDirectory(); },
    add: id => setParticipation(id, true), remove: id => setParticipation(id, false), named: participantName, light: wakeLight, pill: participantPill,
    read: async () => (await readTopic()).participants });
  // The joined wake/member reads inform the topic's participants and who
  // can receive a message. An unreadable member list retains its fallback.
  paintParticipants(topic, result.participants);
  // The topic as the topic view gives it, read once after a change that was not confirmed.
  const readTopic = async () => validate(await registry.cleanup.list(options => api.view('topic', { topic_id: topicId }, options)));
  topicState = new TopicStatePanel({ host: $('topic-state'), reader: bootstrap.actor, refresh: () => freshness?.request(), painted: paintHeader, read: readTopic,
    titleSurface: { host: $('topic-title-edit'), title: $('topic-title'), pencil: $('topic-title-rename') },
    // Words not saved are shown, in Topic settings, even when leaving it was what saved them.
    attention: () => { if (!$('topic-settings').open) settings.open(); },
    // Each save names its operation: sent again, it is the same command, and Core answers what it holds for it.
    send: (current, args, fields, operation_id) => topicClosing.send(current, topicUpdateEnvelope(bootstrap, current, args, fields, operation_id)),
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
  // The images #img offers (topic_images, docs/conversation.md), and one image's
  // verified bytes, read through the message that carries it.
  const topicImages = async editor => checkedView(await registry.cleanup.list(options => api.view('topic_images', { topic_id: editor.context.topicId }, options)), bootstrap.instance_id);
  const imageBytes = async item => (await api.media(bootstrap.instance_id, item.attachment, item.source_ref)).blob;
  inline = new InlineComposer({
    instanceId: bootstrap.instance_id,
    notebook: { api, bootstrap, mayWrite: memoryAnswer.reader_may_write === true, open: (id, options) => openNotebook(id, options),
      pages: () => panes.things.notebookPages(topicId), append: (id, job) => notebookSheetOf().appendNote(id, job) },
    images: topicImages, imageBytes,
    actorLabel,
    admits: (p, editor) => registry?.isCurrent(p, editor),
    reach: recipientReach, addressable: addressPeople, seatEnded: actorSeatEnded,
    uploads: editor => registry.sessionFor(editor).uploads,
    edit: (editor, p) => run(() => { if (registry.isCurrent(p, editor)) return registry.edited(editor); }),
    status: editor => registry.status(editor), sign: editor => registry.saveSign(editor).state, savedAt: editor => registry.savedTime(editor), needsReview, reviewState,
    send: (editor, p) => registry.send(editor, { presentation: p, stay: true, timing: beginTiming('send') }),
    pending: (_p, _editor, item) => Boolean(pendingSendCard(item.id)),
    settled: (editor, item) => timingCall(item && registry.sessions.get(editor.key)?.timingFor?.(item), 'endpoint', 'composer_settled'),
    pendingFocus: focusPendingSend,
    sent: (p, result, current) => landOnMessage(result.receipt.result.message_id, ++landingSerial, current),
    review: (editor, p, opener) => run(() => showVersions(editor, opener, p)),
    renderPending: () => paintReview(),
    retry: () => run(retryInline),
    people: whisperPeople,
    recipientsPainted: names => { if (here?.conversation || answering.size) answeredBy(inline, $('inline-composer').querySelector('.audience'), names, Boolean(here?.conversation)); },
  });
  questionStates = new QuestionStates(); configureQuestionStates(questionStates);
  reader = new Reader({
    images: topicImages, imageBytes, pageImage, displayRules,
    messageChanges: () => messageChanges, toggleMessageChanges,
    sourceRedrawn: paintReaderThumb$,
    cardSelection: card => menu?.passages.chosen(messageEntries.get(card.dataset.id)) ?? null,
    actorName: displayActor,
    actorLabel,
    admits: (p, editor) => registry?.isCurrent(p, editor),
    writes: (p, editor) => registry?.isWritable(p, editor),
    closing: p => registry?.isClosing(p),
    reach: recipientReach, addressable: addressPeople, seatEnded: actorSeatEnded,
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
    send: (editor, options) => registry.send(editor, { ...options, presentation: reader.presentation, timing: beginTiming('send') }),
    settled: (editor, item) => timingCall(item && registry.sessions.get(editor.key)?.timingFor?.(item), 'endpoint', 'composer_settled'),
    pending: handoffReaderSend,
    sent: (p, result, current) => cardReplies?.readerSent(p, result, current),
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
              windowTargets.add(id);
              try { views.messagesPage(page, { anchored: true, cursor: source.seq + 1 }); }
              finally { windowTargets.delete(id); }
            } finally { foreground.release(); }
          }
          if (accessEpoch !== listAccessEpoch || topicUnavailable || registry.current) return true;
          const card = landOn(id, { full: true });
          if (card) card.focus({ preventScroll: true });
          else await openSource({ kind: 'message', id }, p.opener);
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
    resolvingQuestion: id => resolutions?.busy.has(id),
    resolveQuestion: id => run(async () => {
      try { await resolutions.resolve(id); }
      finally { if (registry.current?.source?.source_ref?.id === id) reader.paintOrigin(registry.current.source); }
    }),
    answered: closeReaderAfterAnswer,
    foldMessage: foldReaderMessage,
    people: whisperPeople, actor: () => bootstrap.actor,
  });
  // The Reader's ⋯ offers Wide or Stacked only where the window can choose, so
  // a window that crosses a phone's width shows or hides it again.
  reader.narrow.addEventListener('change', paintReaderMark);
  registry = new EditorRegistry({ api, bootstrap, journal, present, changed,
    published: (editor, item, timing) => { placeSubmittedWriting(editor, item).then(placed => {
      if (placed) { timingCall(timing, 'endpoint', 'send_canonical_dom'); timingCall(timing, 'finish'); }
      else timingCall(timing, 'finish', 'incomplete', 'retired');
    }); if (inline.editor === editor) inline.published(item); cardReplies?.published(editor, item); mentionNotices?.published(editor, item); },
    activity: () => { inline.paintStatus(); reader.paintStatus(); cardReplies?.paint(); },
    closed: presentation => { if (reader.presentation === presentation) { reader.finishClose?.(); revokeMedia(); views.retain(null, null); } cardReplies?.readerClosed(presentation); cardReplies?.paint(); noteRead(); } });
  mentionNotices = new MentionNotices({ host: $('page-notices'), api, instanceId: bootstrap.instance_id,
    authority: () => registry.runtime.current, current: () => !retired && !registry.disposed && !authorityReviewPending() });
  cardReplies = new CardReplies({ template: $('inline-composer'), registry, topic: () => topic,
    callbacks: { ...inline.callbacks, notebook: null, recipientsPainted: null, retry: retryCard,
      sent: (result, current) => landOnMessage(result.receipt.result.message_id, ++landingSerial, current) }, offer: offerAuthor, discover, say: status,
    changed: id => {
      const feed = stackFeed;
      // The Fold action arranges immediately after keeping its draft. Other
      // composer closes reapply the saved fold before the next paint.
      if (feed?.state.writing.has(id)) requestAnimationFrame(() => {
        if (!retired && feed === stackFeed && feed.state.writing.has(id)) feed.arrange();
      });
    } });
  registry.cleanup.resumeListeners.add(rechecked);
  // After any recorded answer to a mark, this page shows what Core now holds,
  // with or without the live stream.
  marks = new Marks({ api, instanceId: bootstrap.instance_id, authority: () => registry.runtime.current, cancelOpen: () => registry.cancelOpen(),
    recorded: receipt => { attention?.refresh(); if (commitReload) run(() => commitReload(receipt?.status !== 'committed')); } });
  marks.listen(paintMarks);
  const reactionPage = shell.page, reactionRegistry = registry;
  reactions = new Reactions({ api, instanceId: bootstrap.instance_id, viewer: bootstrap.actor, authority: () => reactionRegistry.runtime.current,
    current: () => !retired && shell.page === reactionPage && !reactionRegistry.disposed,
    changed: (id, timing, endpoint) => paintThumbMessage(id, true, timing, endpoint),
    learned: (answer, kind, timing) => {
      const source = registry.current?.source;
      if (source?.source_ref?.id === answer.message_id) Object.assign(source, { reactions: answer.reactions, go_ahead: answer.go_ahead });
      if (learnReactions(views.messages, answer)) {
        if (kind === 'message.thumb') paintThumbMessage(answer.message_id, false); else paintViews('reactions');
      } else if (source?.source_ref?.id === answer.message_id) paintReaderThumb$();
    },
    // A 👍 or an answer that cleared the person's mark on its message: the card, its pill and the marks line read so at once.
    cleared: (result, kind) => {
      const quiet = kind === 'message.thumb';
      const changed = marks.learn(result.message_id, result.mark_revision, { topicId: result.topic_id, seq: result.seq }, quiet);
      if (!quiet || !changed) return;
      const entry = messageEntries.get(result.message_id), item = feedMessages().get(result.message_id);
      if (entry && item) {
        const card = cardIn(entry);
        paintCardAuthor(card.querySelector('.message-author'), item);
        paintFold(entry, marks.state(item.id)?.marked === true);
      }
      const count = marks.marked(topic.id).length;
      $('topic-marks-words').textContent = marksWords(count); $('topic-marks').hidden = !count || topicUnavailable;
      paintReaderMark();
    },
    recorded: () => { attention?.refresh(); if (commitReload) run(commitReload); }, reading: id => reading('reaction:' + id) });
  const withdrawalPage = shell.page;
  withdrawals = new Withdrawals({ api, instanceId: bootstrap.instance_id, authority: () => registry.runtime.current,
    current: () => shell.page === withdrawalPage, learned: result => {
      learnQuestionWithdrawal(result);
      if (views?.topic && stackFeed?.state) views.paint('acts');
      paintReaderTitle();
    },
    say: (words, item) => { if (reader.dialog.open && registry.current?.source?.source_ref?.id === item.id) reader.notice(words); else status(words); },
    recorded: () => { attention?.refresh(); if (commitReload) run(commitReload); } });
  removals = new Removals({ api, instanceId: bootstrap.instance_id, authority: () => registry.runtime.current,
    current: () => shell.page === withdrawalPage, learned: learnMessageRemoval, refresh: item => {
      const held = feedMessages().get(item.id), source = registry.current?.source;
      if (held && !held.removal) held.removal_action = item.removal_action;
      if (source?.source_ref?.kind === 'message' && source.source_ref.id === item.id && !source.removal)
        source.removal_action = item.removal_action;
      menu?.paint();
    },
    say: (words, item) => { if (reader.dialog.open && registry.current?.source?.source_ref?.id === item.id) reader.notice(words); else status(words); },
    recorded: () => { attention?.refresh(); if (commitReload) run(commitReload); } });
  resolutions = new Resolutions({ api, instanceId: bootstrap.instance_id, authority: () => registry.runtime.current,
    current: () => shell.page === withdrawalPage, learned: result => {
      learnQuestionState(result);
      // A confirmed local receipt paints the loaded view immediately. Remote
      // changes instead invalidate acts and follow the ordinary refresh path.
      if (views?.topic && stackFeed?.state) views.paint('acts');
      paintReaderTitle();
    },
    say: (words, id) => { if (reader.dialog.open && registry.current?.source?.source_ref?.id === id) { reader.notice(words); reader.paintOrigin(registry.current.source); } },
    recorded: () => { attention?.refresh(); if (commitReload) run(commitReload); } });
  mountFeedFences($('messages'));
  keepLineRoom($('main'), $('messages'));
  watchListAnchor();
  cardScroll = new CardScroll({ read: async (id, readClass) => checkedView(await api.view('source', { source_ref: { kind: 'message', id } }, { readClass }), bootstrap.instance_id), press: pressHold, displayRules, changes: messageChanges, changed: (card, item) => paintCardAuthor(card.querySelector(':scope > .message-author'), item) });
  const act = work => run(async () => { try { await work; } finally { paintViews('reactions'); } });
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
  installCoverQuote({ host: $('messages'), template: $('quote-selection'),
    available: source => !retired && !topicUnavailable && !outcomeReached && !authorityReviewPending() && !registry.disposed &&
      !freshness?.stopped && !registry.current && Boolean(topic) && (!source || messageEntries.has(source.id)),
    copy: words => copyText(words).then(done => { if (!done) status(COPY_REFUSED); }),
    quote: quote => run(async () => {
      const id = quote.source.id, entry = messageEntries.get(id), shownTopic = topic;
      const p = await replyInCard(id, entry && cardIn(entry));
      if (!p || retired || topic !== shownTopic || !registry.isCurrent(p) || p.sourceUnavailable ||
          p.source?.source_ref?.id !== id || p.source.topic_id !== shownTopic.id) return;
      cardReplies.surface(p)?.appendQuote(quote, p);
    }) });
  new DossierSelectionQuote({ host: $('messages'), template: $('quote-selection'),
    entryOf: target => menu?.entryOf(target), selected: entry => menu?.passages.selected(entry),
    eligible: (id, entry) => !retired && !topicUnavailable && !authorityReviewPending() && !registry.disposed &&
      !freshness?.stopped && views.messages.has(id) && messageEntries.get(id) === entry && drawn($('messages'), id),
    quote: (id, card, chosen) => run(() => replyMessage(id, card, chosen)) });
  menu = new MessageMenu({ host: $('messages'), acted: clearVisitNew, item: id => feedMessages().get(id), viewer: bootstrap.actor, kind: bootstrap.actor_kind,
    pending: id => reactions?.pending.get(id) ?? null,
    editChoice: (item, card) => messageMenuItems(item, null, card).find(choice => choice.label === 'Edit'),
    navigate: () => releaseTopArrivals(),
    reply: (id, card) => run(() => replyMessage(id, card)),
    inlineReply: (id, card) => run(() => replyInCard(id, card)),
    quote: (id, card, chosen) => run(() => replyMessage(id, card, chosen)),
    // A thumbs-up on a reply deals with its stack up to it (stack-feed.mjs).
    // What Theseus answered without taking a card's 👍 or answer is said with its card (stack-feed.mjs notTaken).
    thumb: (item, on) => {
      const closeReply = on && cardReplies.captureEmpty(item.id);
      return run(async () => {
        const receipt = await thumbMessage(item, on, cardSaid('message.thumb', item, { thumbed: on }, 'reaction:' + item.id));
        if (on && receipt?.status === 'committed') {
          if (closeReply && closeReply()) stackFeed?.arrange();
          stackFeed?.thumbed(item);
        }
        return receipt;
      });
    },
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
  $('thumb-source').onclick = () => thumbFromReader();
  pageReads = new PageReads({ recorded: () => { if (commitReload) run(commitReload); }, send: (id, revision) => {
    const { authority_id, authority_epoch } = registry.runtime.current;
    return api.command({ v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'memory.read',
      target: { item_id: id }, expected: { authority: { authority_id, authority_epoch } }, args: { revision } });
  } });
  $('mark-unread').onclick = () => run(toggleMark);
  $('add-to-pipeline').onclick = () => (pipelineAddFor === null ? openPipelineAdd() : closePipelineAdd(true));
  menu.copyChoice = messageCopyChoice;
  reader.copyMenuWords = readerCopyChoice;
  const readerMore = $('reader-menu');
  // A touch press can clear the Reader's browser selection before click.
  readerMore.addEventListener('pointerdown', () => {
    const presentation = registry.current;
    readerCopyHeld = {
      presentation, source: presentation?.source,
      selection: clipboardSelection(reader.sourceBody, () => reader.selectedPassage()),
    };
  }, true);
  for (const kind of ['pointercancel', 'keydown']) readerMore.addEventListener(kind, () => { readerCopyHeld = null; });
  readerMore.onclick = () => openReaderMenu();
  const readerDoor = $('reader');
  const readerMenuHost = target => target.closest('a, button, input, textarea, select, [contenteditable]') ? null : target.closest('.dossier-cover, #source-body');
  const cancelReaderHold = menuDoor(readerDoor, readerMenuHost, (host, at) => openReaderMenuAt(at, host), { context: false });
  readerDoor.addEventListener('contextmenu', event => {
    const host = readerMenuHost(event.target);
    if (!host || event.defaultPrevented || window.getSelection()?.isCollapsed === false) return;
    event.preventDefault();
    openReaderMenuAt({ x: event.clientX, y: event.clientY }, host);
  });
  window.addEventListener('pagehide', cancelReaderHold);
  $('source-body').addEventListener('mousedown', event => {
    if (event.detail === 2 && readerTextEdit(event)) event.preventDefault();
  });
  $('source-body').addEventListener('dblclick', event => {
    const edit = event.detail === 2 && readerTextEdit(event);
    if (!edit) return;
    event.preventDefault(); event.stopPropagation();
    window.getSelection()?.removeAllRanges(); edit.act();
  });
  $('reader-star').onclick = () => starFromReader();
  $('reader-aside').onclick = () => asideFromReader();
  const cancelDossierHold = menuDoor($('messages'), target => {
    if (target.closest('a, input, textarea, select, [contenteditable]')) return null;
    const section = target.closest('.reply-stack');
    if (section?.parentElement === $('messages') && (target === section || target.closest('.stack-head, .stack-frame-head, .stack-toggle'))) return section;
    return target.closest('.dossier-cover') ?? entryOf($('messages'), target);
  }, (target, at) => messageContextMenu({ target, clientX: at?.x ?? 0, clientY: at?.y ?? 0, preventDefault() {} }), { context: false });
  $('messages').addEventListener('contextmenu', messageContextMenu);
  window.addEventListener('pagehide', cancelDossierHold);
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
  syncCardReplies();
  // Every ordinary topic row, including the conversation; Build topics stay
  // in the right rail (item 297).
  // A followed outline is the shared owner; without one, this page owns its list.
  topicRail = shell.outline?.topicsFor(bootstrap, topic, pageMax()) ?? new TopicRail({ reader: bootstrap.actor, pageMax: pageMax(), pages: new TopicPages(bootstrap.instance_id, topic.workspace_id, topic, 'active', true),
    host: $('topics'), more: $('more-topics'), retry: $('retry-topics'), message: $('topics-status'), key: $('topics-key'), ...topicFolds(),
    denied: error => readFailure(error).kind === 'forbidden',
    read: async args => {
      if (authorityReviewPending()) throw Error('The runtime changed. Review saved writing before reloading.');
      const answer = checkedView(await registry.cleanup.list(options => readTopicList((name, query) => api.view(name, query, options), args)), bootstrap.instance_id);
      if (registry.disposed || authorityReviewPending()) throw Error('The runtime changed. Reload after reviewing saved writing.');
      return answer;
    },
    open: (id, title, message, at) => openDestination(topicTarget(id, message, at), title),
    // The standalone list reports its initial read just as before.
    updated: () => { $('topic-navigation').dataset.listed = ''; },
  });
  // The rail shows only this topic's outcome. A message's Add to pipeline
  // follows the Pipeline row's read.
  const pipeline = pipelineSection(topic.workspace_id, false, paintReaderMark); pipelineRow = pipeline.row;
  outcomeScope = new OutcomeScope({ workspaceId: topic.workspace_id, kind: 'topic', rail: document.querySelector('.rail'), home: $('outcomes-home'),
    attention, open: openDestination, sections: [pipeline,
      { name: 'topics', node: $('topic-navigation'), load: () => topicRail.load() }] });
  placeBrand(document.querySelector('.rail'));
  outcomeScope.load();
  run(loadConversation);
  // The open topic's marks are the person's own, read by the person's scope
  // and paged; the open Reader's button follows them. The New line follows
  // what the person has read, here or anywhere else. The topic's own Notebook
  // pages' read state is read again too, so a page read since, here or
  // elsewhere, loses its light; and an outcome's page in the Reader is read
  // where it stands, so the Reader offers a revision made since.
  commitReload = recordedActionRefresh({ follow: followCommits, bootstrap, workspaceId: topic.workspace_id, topicId: topic.id,
    read: async (name, args) => checkedView(await registry.cleanup.read(options => api.view(name, args, options)), bootstrap.instance_id),
    binding: () => ({ ...bootstrap, authority: registry.runtime.current }),
    current: () => !retired && shell.page === thisRun && !registry.disposed && !authorityReviewPending(),
    shown: () => registry.current?.source?.source_ref?.kind === 'memory',
    owners: { sections: dirty => outcomeScope.load(dirty), conversation: loadConversation, marks: loadMarks,
      unread: loadUnread, read: loadReadState, shown: loadShownPage, wakes: () => wakeLights.load(),
      participants: seatChanged => {
        if (seatChanged) return refreshSeatPeople();
        participantsPanel?.paint(); return true;
      } },
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
  olderFeed = new OlderFeed({ feed: $('messages'), ready: () => !retired && laidOut && !topicUnavailable && !registry.disposed &&
    document.visibilityState === 'visible' && !authorityReviewPending() && views.olderCursor !== null && !listLoads.has('messages') &&
    !document.querySelector('dialog[open]:not(.notebook-docked)') && !document.querySelector('[role=menu]'),
    load: loadOlderMessages, failed });
  window.addEventListener('beforeunload', () => marks.leave());
  shell.guard(() => registry.hasUnprotectedWriting);
  // An edit open in the Reader sends nothing at unload (its hold lapses), and lets its Web Lock go.
  window.addEventListener('pagehide', () => { dropCardDocuments(); olderFeed?.dispose(); topicState?.dispose(); freshness?.dispose(); registry.dispose(); cardReplies?.dispose(); mentionNotices?.dispose(); journal.close(); revokeMedia(); messageEdit?.writing.close(); });
  views.messagesPage(messageAnswer, { initial: true }); views.memoryPage(memoryAnswer, { initial: true });
  // What is drawn above the messages after they paint, in their column: the
  // marks line ("1 marked unread · Read it") and, on a conversation page, its
  // Show row and header, which land with the conversation's first read. The
  // outcome rail never is: it sits beside the topic, or on a phone in the
  // drawer behind "☰ Topics" (rail-drawer.mjs). Cards count as seen once each
  // has had its first answer, read or refused (noteRead), so neither moves a
  // card the page has already counted.
  const firstReading = Promise.allSettled([run(loadMarks)]).then(() => { laidOut = true; noteRead(); });
  document.body.dataset.ready = 'true'; enableFreshness(checkpoint, actorCheckpoint);
  // The rails beside the page read through this run from now on (rails.mjs).
  readyRails(topic.workspace_id, { topic, topicRail, topicReadAllowed: () => !authorityReviewPending() && !registry.disposed, readable: () => !topicUnavailable && !freshness?.stopped, currentTopic: () => topic,
    readingNavigation: () => releaseTopArrivals(),
    // The rail's Starred takes a star off (stack-feed.mjs); its Notebook section starts the topic's pages and the outcome's.
    unstar: star => stackFeed?.unstar(star) });
  // A message's link opens its topic, or its outcome's conversation, with that
  // message in the Reader; the address then names the page alone, as any does.
  // This run's first marks read establishes what its reading act may clear.
  // The older pages begin only after that baseline, as on a card already shown.
  writeTopicOnArrival({ route, topic, registry, shell, field: inline.field, current: () => !retired && landingSerial === arrivalNavigation });
  if (['topic-rename', 'topic-settings'].includes(route.act) && consumeMenuRoute(route)) run(() => runTopicMenuAction(topic, route.act.slice(6)));
  if (atUnread) run(() => firstReading.then(landOnUnread));
  freshness.invalidate('dossier_move', 0); freshness.request();
  if (anchored) {
    if (anchoredLand) run(async () => { const arrival = menuArrival && consumeMenuRoute(menuArrival); if (!await landOnMessage(anchored, undefined, undefined, anchoredDossier)) return; if (retired || topicUnavailable) return; if (arrival) openDossierMenuRoute(anchored, menuArrival); else if (notebookReturning()) notebookSheetOf().resume(); });
    else {
      const entry = entries($('messages')).find(child => child.dataset.id === anchored), card = entry && cardIn(entry);
      run(async () => { await openSource({ kind: 'message', id: anchored }, card || $('main'), null, 'reply', null, { land: true }); if (notebookReturning()) notebookSheetOf().resume(); });
    }
  } else if (!pageAnchor && notebookReturning()) {
    // Back from a card's reply stack in another topic, by the way back its Reader showed (notebook-sheet.mjs).
    notebookSheetOf().resume();
  }
  // A Notebook page's link opens the page in the Reader, as its card or row does.
  if (pageAnchor) run(async () => (pageAnchor.revision ? openSource(await pageSource(pageAnchor), $('main')) : openNotebook(pageAnchor.id, { opener: $('main') })));
}
// One handoff to the shell-owned outline, things rail and phone drawers for
// both topic and outcome pages. The shell owns their lifetime and read queue.
function runTopicMenuAction(current, key) {
  if (retired || topicUnavailable || topicState?.topic?.id !== current.id) return false;
  if (key === 'state') {
    if (!topicState.says) throw Error('You can no longer change this topic.');
    return topicState.tap('state', () => current.state === 'done' ? 'active' : 'done', true);
  }
  if (key === 'archive') {
    if (!topicState.controls?.managed) throw Error('You can no longer archive this topic.');
    return topicState.tap('archived', () => !current.archived, true);
  }
  if (key === 'settings' || key === 'rename') {
    if (key === 'rename' && !topicState.controls?.managed) throw Error('You can no longer rename this topic.');
    settings.open(); if (key === 'rename') topicState.renaming(true); return true;
  }
  return false;
}
function readyRails(workspaceId, handles = {}) {
  shell.ready({ api, bootstrap, live, railReadOrder, workspaceId, workspaceTitle: $('workspace-name').textContent, topic: null, pageMax: pageMax(),
    navigationCurrent: () => { const serial = landingSerial; return () => !retired && landingSerial === serial; },
    view: async (name, args, readClass = 'background') => checkedView(await api.view(name, args, { readClass }), bootstrap.instance_id),
    open: (target, title, from) => openDestination(target, title, from), notebookCreate: notebookCreator, dossierMenu: railDossierMenu, dossierMenuChoice: runDossierMenuChoice, topicMenuAction: runTopicMenuAction,
    closeTopic: (current, envelope) => topicClosing.send(current, envelope),
    notebookMenu: (source, row, choose) => notebookRailMenu().items(source, choose, row.ownerDocument),
    notebookMenuAction: (source, key, label, row, commands, notice) => notebookRailMenu().act(source, key, label, row, commands, shell.handles, notice),
    markMenu: markFromRail, captureArchiveReading: (root, through, topicId) => topic?.id === topicId ? captureArchiveReading(root, through) : null,
    menuChanged: () => { freshness?.invalidate('acts', 0, true); freshness?.request(); }, ...handles });
  topicClosing?.start();
}
// A notification opens its readable topic, or Outcomes when access is gone.
function openSent(item) {
  return item.topic_readable ? openDestination({ kind: 'topic', id: item.topic.id }, item.topic.title) : openDestination({ kind: 'root' }, 'Outcomes');
}
// The topic's participants, which whoever organises its outcome and its creator
// may change, and the names the composer offers.
function paintParticipants(current, participants) {
  const people = participants.map(person => !person.seat_ended && actorSeatEnded(person.actor_id) ? { ...person, seat_ended: true } : person);
  participantsPanel?.paint(people, current.kind !== 'conversation' && managesTopic(current, bootstrap.actor));
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
function actorSeatEnded(id) {
  return [...views?.participants ?? [], ...outcomeMembers ?? [], ...directoryPeople]
    .some(person => (person.actor_id ?? person.id) === id && person.seat_ended);
}
// Whether a message to name would reach them: they must be able to see the
// topic. Unknown when the outcome's team could not be read.
function recipientReach(name) {
  if (!topic || !views?.participants) return null;
  const manage = topic.kind !== 'conversation' && managesTopic(topic, bootstrap.actor);
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
// Seat events can change both team and participant badges without changing the topic version.
async function refreshSeatPeople() {
  const current = views, id = topic.id, access = listAccessEpoch;
  const currentRun = () => !retired && !registry.disposed && views === current && topic.id === id &&
    access === listAccessEpoch && !authorityReviewPending();
  if (topicUnavailable) return true;
  if (!currentRun()) return false;
  const team = async () => {
    try { return await readMembers(api, bootstrap.instance_id, topic.workspace_id); }
    catch (error) { if (error.details?.error?.code === 'FORBIDDEN') return null; throw error; }
  };
  let answer, members;
  try {
    [answer, members] = await Promise.all([
      api.view('topic', { topic_id: id }, { readClass: 'background' }).then(reply => checkedView(reply, bootstrap.instance_id)),
      team(),
    ]);
  } catch (error) {
    if (!currentRun()) return false;
    if (topicUnavailable || readFailure(error).kind === 'forbidden') return true;
    throw error;
  }
  if (topicUnavailable) return true;
  if (!currentRun() || !Array.isArray(answer.participants) || !Array.isArray(current.participants)) return false;
  outcomeMembers = members;
  const ended = new Set(answer.participants.filter(person => person.seat_ended).map(person => person.actor_id));
  current.participants = current.participants.map(person => ended.has(person.actor_id) ? { ...person, seat_ended: true } : person);
  paintParticipants(topic, current.participants);
  for (const row of document.querySelectorAll('.mention-pick [data-actor-id]')) markSeatEnded(row, actorSeatEnded(row.dataset.actorId));
  return true;
}
// The directory feeds every field that adds someone to a team or topic; it is
// read at start and again whenever such a field is focused.
let directoryRead = null, directoryPeople = [];
function refreshDirectory() {
  directoryRead ??= readDirectory(api, bootstrap.instance_id).then(({ items }) => {
    fillNames($('directory-names'), items);
    directoryPeople = items;
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
function followCommits(load, changes = null, before = Promise.resolve()) {
  let owed = false, full = true;
  const pass = reloader(async () => {
    await before;
    if (changes && !changes.current()) return;
    owed = true;
    let batch = null;
    if (changes && !full) {
      try { batch = await changes.next(); }
      catch {
        // A failed change window is no evidence that the lists are current.
        // Use their existing full-read/error owners without accepting a cursor.
        // A resync clears its cursor in OutcomeChanges; the next pass baselines.
        full = true;
      }
    }
    const dirty = full || !batch ? null : batch.dirty;
    full = false;
    try { owed = Boolean(!dirty || dirty.size) && await load(dirty) === false; }
    finally { if (!dirty && owed) full = true; }
    if (!owed) batch?.accept();
  });
  const reload = (all = true) => { full ||= all; return pass(); };
  if (live) {
    live.listen(event => { changes?.observe(event); if ((event.kind === 'commit' || event.state === 'live' && owed) && document.visibilityState === 'visible') run(() => reload(false)); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(reload); });
  }
  return reload;
}
// Retain the server's reply destination and coordinator rules. No special
// page, extra message cache, filter or navigation row is painted.
async function loadConversation() {
  if (!here) return true;
  try {
    const answer = checkedView(await api.view('conversation', { workspace_id: here.workspaceId }, { readClass: 'background' }), bootstrap.instance_id);
    here.view = answer.conversation;
    if (reader?.sessions && (here.view?.coordinator?.actor_id ?? null) !== readerCoordinatorPainted) {
      reader.paintRecipients(); reader.paintChoice();
    }
    if (inline?.editor && here.conversation) answeredBy(inline, $('inline-composer').querySelector('.audience'), inline.editor.draft.addressees, true);
    paintMessageContext();
    return true;
  } catch { return false; }
}
const openLinked = (kind, id) => kind === 'topic' ? run(() => openDestination({ kind: 'topic', id }, 'Topic')) : goToMessage(id);
function paintMessageContext() {
  for (const entry of entries($('messages'))) {
    const card = cardIn(entry), item = card && views?.messages?.get(card.dataset.id);
    if (!item) continue;
    paintAbout(card, item, bootstrap.actor, openLinked);
    const author = card.querySelector('.message-author');
    if (author && here?.conversation) paintAsksYou(author, item, here.view?.waits, bootstrap.actor);
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
  if (!here?.view || here.conversation || source.source_ref.kind !== 'message' || source.whisper || source.topic_id !== topic?.id) return false;
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
  const on = Boolean(here?.view && !here.conversation && topicId === here.view.topic_id);
  if (reader?.sessions && (on || answering.size)) answeredBy(reader, $('reply-audience'), names ?? reader.names(), on);
  // Remember the coordinator used by this paint, including paints before a
  // conversation refresh settles, so that read does not paint it twice.
  if (reader?.sessions) readerCoordinatorPainted = here?.view?.coordinator?.actor_id ?? null;
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
openLinksWith((target, title, link, writtenQuery) => openDestination(target, title, link, writtenQuery));
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
async function openDestination(target, title, from = null, writtenQuery = false, { notebookQuote = false } = {}) {
  const landing = ++landingSerial;
  // Here the shared sheet reads the page by id through Core itself. Resolving
  // its label first must not replace this local opening or lose its opener.
  // Authored URL queries still confirm existence/access before opening. An
  // active Notebook quote already names its exact source and reply topic.
  const localPage = !writtenQuery && target.page && !target.revision && ((topic && views &&
    (target.kind === 'topic' ? target.id === topic.id : target.kind === 'workspace' && target.id === topic.workspace_id)) ||
    (!topic && pageHere && target.kind === 'workspace' && target.id === pageHereOutcome));
  if (!localPage && !notebookQuote && (writtenQuery || target.page) && (target.kind === 'topic' || target.page || target.kind === 'cards')) {
    const original = target;
    topicNavigation?.cancelPending();
    try {
      target = await resolveTopicLink(target, { read: (name, args) => api.view(name, args, { readClass: 'foreground' }),
        instanceId: bootstrap.instance_id, workspaceId: topic?.workspace_id ?? shell.handles?.workspaceId ?? pageHereOutcome,
        ownerScope: linkOwnerScope?.(), current: () => !retired && landing === landingSerial, confirm: true, currentTopicId: topic?.id });
      if (!target || retired || landing !== landingSerial) return false;
    } catch (error) {
      if (retired || landing !== landingSerial) return false;
      if (!['TOPIC_NAME_UNKNOWN', 'TOPIC_NAME_AMBIGUOUS', 'LINK_DESTINATION_UNAVAILABLE', 'LINK_DESTINATION_UNCONFIRMED'].includes(error.code)) target = original;
      else {
        if (notebookSheet?.showing && notebookSheet.current) notebookSheet.current.say(error.message, 'attention');
        else if (linkNotice) linkNotice(error.message);
        else stayedWhy(error);
        return false;
      }
    }
  }
  // A link to a message in the open topic opens it in the Reader, here.
  if (target.kind === 'topic' && target.message && topic && views && target.id === topic.id) {
    if (target.land) return run(async () => { if (!await landOnMessage(target.message, landing, undefined, target.land === 'dossier')) return false; if (landing === landingSerial && target.act) return openDossierMenuRoute(target.message, target); });
    // Ordinary message links keep their Reader-opening behavior.
    // From the Reader's own text, closing gives the focus to what opened the Reader.
    const opener = from?.closest?.('dialog') ? registry.current?.opener : from;
    return run(() => openSource({ kind: 'message', id: target.message }, opener?.isConnected ? opener : document.activeElement, null, 'reply', null, { land: true }));
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
// Home rows offer the owner's Bring back action.
function initializeOutcomeNavigation(current=null,painted=()=>{},homeRows=false) {
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
    denied:error=>readFailure(error).kind==='forbidden',pageMax:pageMax(),peek,painted,
    // The home's "Archived (N)" rows: their owner brings one back from its row (item 404).
    reader:bootstrap.actor,bringBack:homeRows?item=>sendEnd(pipelineSend,item.id,'open',item.version):null});
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
  if(route.kind==='image')return initializeImagePage(route);
  if(!['root','workspace'].includes(route.kind))throw Error('This opening link is not available yet. Open Outcomes to choose a place.');
  // A Notebook page's link opens the page in place once the outcome's lists are
  // up; the address then names the outcome alone, as a message's link does.
  const shown=route.page?{id:route.page,revision:route.revision??null}:null;
  if(shown){route={kind:'workspace',id:route.id};shell.rename(route,location.hash);}
  status('');
  drawFeed(false,'topic-pending','inline-composer');
  $('outcome-page').hidden=false;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:(target,still)=>{if(!shell.go(target,still))shell.leave(routeHref(target));}});
  if(route.kind==='root') {
    // What waits on the reader, every outcome's, heads the Outcomes home only (item 86):
    // an outcome's own page says its questions once, in "Where it stands".
    waitingHost=$('waiting-on-you');
    if(attention?.last)paintWaiting(waitingHost,attention.last,(id,title)=>openDestination({kind:'topic',id},title));
    // The home has no heading of its own: the list of outcomes is the page, and a press on one opens its home (item 835).
    document.querySelector('#main > .topic-header').hidden=true;
    $('outcomes-heading').textContent='Your outcomes';
    $('outcome-page').append($('outcome-navigation'));document.querySelector('.rail').hidden=true;
    initializeOutcomeNavigation(null,()=>{},true);
    // The page an owner lands on says when wakes are not going out.
    // With no rail, the logo block heads the main column.
    placeBrand($('main'));
    const reload=followCommits(async()=>{const loaded=await outcomeRail.load();await wakeLights.load();return loaded;});
    await reload();
    readyRails(null);
  } else {
    // The title, Team and menu share the topic header. Notes, topics and
    // tools come before outcome setup; secondary context follows (item 842).
    $('outcome-page').append($('outcomes-status'),$('retry-workspaces'),$('team-invite'),$('outcome-references'),$('page-here'),$('topic-navigation'),$('outcome-tools'),$('outcome-standing'),$('outcome-purpose'),$('target-panel'),$('pipeline-line'),$('also-waiting'),$('loop-panel'),$('problems-panel'));
    outcomeColorPicker = new OutcomeColorPicker({ title: $('topic-title'), api, bootstrap, workspaceId: route.id, current: () => !retired && shell.page === thisRun });
    const cardsHost=document.createElement('div');cardsHost.className='outcome-topic-cards';
    // Keep the shared New topic heading, but let the outline own all lists.
    for(const child of [...$('topic-navigation').children])if(!child.classList.contains('rail-heading'))child.hidden=true;
    $('topic-navigation').append(cardsHost);
    const topicCards=new OutcomeTopicCards({host:cardsHost,color:agentShown,named:displayActor,painted:values=>outcomePageLayout?.topics(values)});
    outcomePageLayout=new OutcomePageLayout({host:$('outcome-page'),team:$('outcome-team'),cards:topicCards,reader:bootstrap.actor,color:agentShown,scope:route.id});
    colors??=new AgentColors({api,instanceId:bootstrap.instance_id,authority:()=>bootstrap.authority});
    outcomePageLayout.unlisten=colors.listen(()=>{if(!retired){topicCards.repaint();outcomePageLayout.paint();}});
    run(()=>colors.load('foreground'));
    const topicPencil = $('new-message').querySelector('svg')?.cloneNode(true);
    if (topicPencil) $('new-topic').replaceChildren(topicPencil);
    $('new-topic').classList.add('notebook-create');
    $('new-topic').setAttribute('aria-label', 'New topic');
    $('new-topic').title = 'New topic';
    topicCards.paint(null);
    // Archived, completed or brought back (item 404): the page reads again, and once it is archived or completed the keys
    // go to Bring back on "Where it stands" (back, the target card gives them to the word that ended it).
    const targets=new OutcomeTargets({hosts:{target:$('target-panel'),loop:$('loop-panel'),problems:$('problems-panel')},workspace:route.id,reader:bootstrap.actor,read:pipelineView,send:pipelineSend,
      changed:async({state,refused})=>{await reload().catch(()=>{});if(!refused&&state!=='open')$('outcome-standing').querySelector('[data-hold="bring-back"]')?.focus();}});
    // Its skills and tools, and the ones it says it uses (docs/skills-and-tools.md).
    const outcomeTools=new OutcomeTools({host:$('outcome-tools'),workspace:route.id,instanceId:bootstrap.instance_id,read:pipelineView,send:pipelineSend,open:openDestination});
    // Keep the shell's rails beside this page, just as beside a topic.
    const rail=document.querySelector('.rail');rail.hidden=false;
    here={workspaceId:route.id,title:route.id,view:null,conversation:false};
    placeBrand(rail);
    const scope=outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'workspace',rail,home:$('outcomes-home'),attention,open:openDestination});
    // The list of outcomes is read, not shown, for the line naming other outcomes' questions;
    // "← Outcomes" says its words when that line names fewer outcomes than its light counts.
    const paintOutcomes = (items, error, reread) => {
      const notice = $('outcomes-status'), retry = $('retry-workspaces');
      notice.hidden = !error; retry.hidden = !error;
      if (error) notice.textContent = `${readFailure(error).message} Retry outcomes.`;
      retry.onclick = () => run(reread);
      scope.alsoNamed(paintAlsoWaiting($('also-waiting'),error ? [] : items,route.id,(id,title)=>openDestination({kind:'workspace',id},title)));
      if (!permitted) $('also-waiting').hidden = true;
    };
    initializeOutcomeNavigation(route.id,paintOutcomes);
    $('outcomes-status').hidden = true; $('retry-workspaces').hidden = true;
    // Where it stands, read with the page and again on every commit.
    const outcomeChoices = workspace => outcomeMenuItems(workspace, { actor: bootstrap.actor, act: key => {
      if (key === 'new-topic') return $('new-topic').click();
      if (key === 'copy') return run(() => copyOutcomeLink(workspace.id));
      if (key === 'up' || key === 'down') return panes.outline?.moveOutcome(workspace.id, key === 'up' ? -1 : 1);
      if (key === 'onboarding') return onboarding.open();
      return run(() => targets.endAs(key));
    } });
    const onboarding=new OnboardingPrompt({button:$('outcome-menu'),reader:bootstrap.actor,read:pipelineView,menuItems:outcomeChoices});
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
    const changes = new OutcomeChanges({ api, bootstrap, workspaceId: route.id, outcomesKey: live?.outcomes ?? null, current: () => !retired && shell.page === thisRun });
    const before = changes.baseline().catch(() => false);
    const refresh=async(dirty=null)=>{
      if (retired) return false;
      dirty = dirty && permitted ? dirty : outcomeReads();
      const serial=++refreshSerial;
      status('');
      const rails = changes.notify(dirty); rails.catch(() => {});
      let workspace = onboarding.workspace;
      try {
        if (dirty.has('workspace')) workspace = checkedView(await api.view('workspace',{workspace_id:route.id},{readClass:'foreground'}),bootstrap.instance_id).workspace;
      }
      catch(error) {
        if(serial!==refreshSerial||retired)return;
        if(readFailure(error).kind==='forbidden') {
          onboarding.paint(null);outcomeColorPicker.paint(null);permitted=false;$('topic-title').textContent='Outcome unavailable';$('topic-description').textContent='';$('outcome-team').hidden=true;
          $('topic-navigation').hidden=true;$('new-topic').disabled=true;
          // Its Notebook pages, and any open in place, go with it; a recovered read lists them again.
          $('outcome-references').hidden=true;$('page-here').hidden=true;$('outcome-standing').hidden=true;$('also-waiting').hidden=true;$('outcome-tools').hidden=true;
          outcomePageLayout.members([]);
          shell.topicChanged();
        }
        await rails;
        throw error;
      }
      if(serial!==refreshSerial||retired)return;
      if(workspace?.id!==route.id||typeof workspace.title!=='string')throw Error('The outcome identity could not be confirmed.');
      permitted=true;
      if (dirty.has('workspace')) {
        $('topic-title').textContent=workspace.title;
        outcomeColorPicker.paint(workspace);
        purposeLine??=new PurposeLine({host:$('outcome-purpose'),description:$('topic-description'),
          save:(purpose,current)=>setPresence('workspace.update',{workspace_id:current.id},'workspace_revision',current.version,{purpose}).then(receipt=>{run(reload);return receipt;})});
        purposeLine.paint(workspace,organises(workspace,bootstrap.actor));
        outcomePageLayout.setPurpose(purposeLine);
        onboarding.paint(workspace);
        $('workspace-name').hidden=true;enableNewTopic(workspace.id);here.title=workspace.title;
        shell.topicChanged();
      }
      if(!outcomeReferences)outcomeReferences=outcomePages(route.id,()=>run(reload));
      const jobs = [['team',()=>paintTeam(workspace,()=>reload(),members=>{outcomeMembers=members;outcomePageLayout.members(members);topicCards.repaint();})], ['standing',()=>stands(workspace)], ['targets',()=>targets.load()],
        ['tools',()=>outcomeTools.load()], ['references',()=>outcomeReferences.load()],
        ['pipeline',()=>paintPipelineLine($('pipeline-line'),{workspace:route.id,read:pipelineView})]];
      return (await Promise.all([rails,...jobs.filter(([key])=>dirty.has(key)).map(([,read])=>read())])).every(read=>read!==false);
    };
    // A commit may change the team or the outcome's revision as well as its
    // topics, and other outcomes' questions in the line above them. Back from a
    // refusal, the topics show once that commit's reads have painted what stands
    // above them (standing, target and Pipeline), so a topic
    // does not move down under a pointer as each lands.
    const reload=followCommits(async dirty=>{
      const reads=await Promise.allSettled([refresh(dirty)]);
      if(permitted)$('topic-navigation').hidden=false;
      for(const read of reads)if(read.status==='rejected')throw read.reason;
      return reads.every(read=>read.value!==false);
    },changes,before);
    await before;
    if (retired) return;
    readyRails(route.id, { outcomeChanges: changes, outcomeList: paintOutcomes, workspaceTitle: here.title, currentWorkspaceTitle: () => here.title, readable: () => permitted, outcomeTopics: values => topicCards.paint(values), centerPane: topicCards, outcomeMenuChoice: key => {
      const choice = outcomeChoices(onboarding.workspace).find(choice => choice.key === key);
      if (!choice) return false; choice.act(); return true;
    } });
    await reload();
    if (route.act === 'onboarding' && consumeMenuRoute(route)) {
      if (permitted && onboarding.workspace?.owner_id === bootstrap.actor) onboarding.open();
      else status('The onboarding prompt is no longer available to you.');
    }
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
// topics, and read with the rail on every commit.
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
// outcome as a topic page's does (Pipeline row, topics and
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
    read:async args=>checkedView(await readTopicList((name, query)=>api.view(name,query,{readClass:'foreground'}),args),bootstrap.instance_id),
    open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title)});
  pagesInPlace(route.id,()=>{});
  here={workspaceId:route.id,title:route.id,view:null,conversation:false};
  try { const workspace=(await pipelineView('workspace',{workspace_id:route.id})).workspace;here.title=workspace.title; } catch {}
  outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'pipeline',rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:[pipelineSection(route.id,route.kind==='pipeline'),{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},skillsSection(route.id)]});
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
// A copied image address rechecks its source before showing verified bytes.
async function initializeImagePage(route) {
  drawFeed(false, 'topic-pending', 'inline-composer', 'topic-navigation');
  document.querySelector('.rail').hidden = true;
  $('topic-title').textContent = 'Image'; $('topic-description').textContent = '';
  const host = $('image-page'); host.hidden = false;
  const page = new ImagePage({ host, route, current: () => !retired, handles: { api, bootstrap,
    view: (name, args) => pipelineView(name, args), inTurn: job => job() } });
  window.addEventListener('pagehide', () => page.dispose());
  await followCommits(() => page.load())();
  document.body.dataset.ready = 'true';
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
  // Route construction supplies the binding port; only actual saved words
  // need the shared controller, and a retired run must not create one.
  const passages={
    bind(entry,state){if(!retired)notebookPassagesOf().bind(entry,state);},
    openEditor(entry,state){return !retired&&notebookPassagesOf().openEditor(entry,state);}
  };
  const page=new NotebookPage({host:$('deck-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},
    item:route.id,read:pipelineView,send:pipelineSend,place,deleteUI:notebookDeleting,closeDeleted:async page=>{page.close();page.writing.close();await page.writing.serial;await page.store.close();return openDestination({kind:page.source.owner_scope.kind,id:page.source.owner_scope.id},'the Notebook page’s topic or outcome');},askIn:notebookAskIn,api,bootstrap,startNotebook:options=>notebookStartsOf().show(options),mode:route.card?'cards':route.view,viewPreference:notebookViewsOf(),passages});
  linkOwnerScope = () => page.source?.owner_scope;
  linkNotice = words => page.say(words, 'attention');
  shell.guard(()=>Boolean(page.writing?.journalPending||page.writing?.journalError));
  $('deck-page').hidden=false;
  await followCommits(()=>page.load())();
  if(route.card && page.base)page.pickCardId(route.card);
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
    read:async args=>checkedView(await readTopicList((name, query)=>api.view(name,query,{readClass:'foreground'}),args),bootstrap.instance_id),
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
  for(const id of ['topic-people','messages','topic-pending','inline-composer'])$(id).hidden=true;
  topicNavigation=new TopicNavigation({current:route,navigateTarget:target=>shell.leave(routeHref(target))});
  const page=new ToolPage({host:$('tool-page'),header:{eyebrow:$('workspace-name'),title:$('topic-title'),description:$('topic-description')},toolId:route.tool,
    instanceId:bootstrap.instance_id,read:pipelineView,send:pipelineSend,open:openDestination});
  await page.load();
  const homeReadable=page.answer?.tool.home.readable===true&&page.answer.tool.home.workspace_id===route.id;
  if(homeReadable) {
    enableNewTopic(route.id);
    topicRail=new TopicRail({reader:bootstrap.actor,pageMax:pageMax(),pages:new TopicPages(bootstrap.instance_id,route.id,null),host:$('topics'),more:$('more-topics'),
      retry:$('retry-topics'),message:$('topics-status'),...topicFolds(),key:$('topics-key'),denied:error=>readFailure(error).kind==='forbidden',
      read:async args=>checkedView(await readTopicList((name, query)=>api.view(name,query,{readClass:'foreground'}),args),bootstrap.instance_id),
      open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title)});
    pagesInPlace(route.id,()=>{});
    here={workspaceId:route.id,title:page.answer.tool.home.title,view:null,conversation:false};
  }
  outcomeScope=new OutcomeScope({workspaceId:route.id,kind:'skill',homeReadable,rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:homeReadable?[pipelineSection(route.id,false),{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},skillsSection(route.id,route.tool)]:[]});
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
let notebookStarts=null;
function notebookStartsOf(){return notebookStarts??=new NotebookStarts({api,bootstrap,read:pipelineView,open:openDestination});}
async function notebookAskIn(scope) {
  const topicId=scope.kind==='topic'?scope.id:(await pipelineView('conversation',{workspace_id:scope.id})).conversation?.topic_id;
  if(!topicId)return null;
  const {participants}=await pipelineView('topic',{topic_id:topicId});
  return {topicId,agents:participants.filter(p=>p.kind==='agent'&&p.enabled).map(p=>p.actor_id)};
}
let notebookPassages = null;
function notebookPassagesOf() {
  return notebookPassages ??= new NotebookPassages({ template: $('quote-selection'), quote: quoteNotebookPassage });
}
function notebookQuoteNotice(what) {
  const line = notebookSheet?.showing && notebookSheet.current?.pageNotice;
  if (line) showLine(line, what); else status(what);
}
// Links to Notebook pages follow the page's owner. A pending quote instead
// opens its exact page revision in the Reader of its confirmed reply topic.
function notebookQuoteRoute(route) {
  if (route.kind !== 'topic' || !route.page || !route.revision) return false;
  try { return Boolean(new NotebookQuoteTransfer(bootstrap).forRoute(route)); }
  catch { return false; }
}
async function quoteNotebookPassage(choice, opener) {
  try {
    // Reuse the hosting topic's destination, or the Notebook's existing
    // topic/conversation destination when this page has no composer.
    const topicId = topic && views ? topic.id : (await notebookAskIn(choice.owner_scope))?.topicId;
    if (!topicId) throw Error('The page has no conversation to quote into.');
    new NotebookQuoteTransfer(bootstrap).keep(topicId, choice);
    if (topic && views) {
      const open = () => openSource(choice.source, opener);
      if (notebookSheet?.showing) await notebookSheet.quoteWith(open); else await open();
    } else {
      await openDestination({ kind: 'topic', id: topicId, page: choice.source.id, revision: String(choice.source.revision) },
        'the page quote', opener, false, { notebookQuote: true });
    }
  } catch (error) { notebookQuoteNotice(error); }
}
function receiveNotebookQuote(presentation) {
  if (!topic || presentation.source?.source_ref?.kind !== 'memory') return;
  let transfer, pending;
  try { transfer = new NotebookQuoteTransfer(bootstrap); pending = transfer.forSource(topic.id, presentation.source); }
  catch (error) { reader.notice(error); return; }
  if (!pending) return;
  if (presentation.sourceUnavailable || presentation.availabilityUnconfirmed) return;
  const editor = presentation.editors.reply, before = editor.draft.quotes.length;
  const contiguous = presentation.source.body.includes(pending.choice.text), parts = pending.choice.parts;
  if (!contiguous && (!Array.isArray(parts) || parts.join('') !== pending.choice.text ||
      parts.some(part => !presentation.source.body.includes(part)))) {
    reader.notice('The selected passage could not be matched to this page revision.'); return;
  }
  // Remove the exact intent before the synchronous edit. A storage refusal
  // leaves both draft and intent untouched, so a reload cannot quote twice.
  try { if (!transfer.claim(pending)) return; }
  catch (error) { reader.notice([error, 'The selected passage is kept for retry.']); return; }
  try {
    if (contiguous) reader.quoteFrom(pending.choice.source, { ...pending.choice, revision: pending.choice.source.revision });
    // Hidden image/detail/stack lines split the displayed selection into
    // exact source substrings; the existing composer joins their writing.
    else reader.quoteInto(parts, null, pending.choice.source.revision);
  } catch (error) { reader.notice(error); }
  finally {
    if (editor.draft.quotes.length === before) {
      try { transfer.restore(pending); }
      catch (error) { reader.notice([error, 'The passage could not be kept for retry.']); }
    }
  }
}
// A Notebook page in the composer over the page being read (item 396; notebook-sheet.mjs): the full page's
// Text and Cards, saving and recovery. The page showing is read again on every commit; one closed is not.
function notebookSheetOf() {
  if (notebookSheet) return notebookSheet;
  notebookSheet = new NotebookSheet({
    make: (id, host, header, idSuffix, revisionShown) => {
      const page = new NotebookPage({ host, header, item: id, read: pipelineView, send: pipelineSend, askIn: notebookAskIn, api, bootstrap, startNotebook:options=>notebookStartsOf().show(options), viewPreference: notebookViewsOf(), deleteUI:notebookDeleting,closeDeleted:page=>{if(notebookSheet.current===page){notebookSheet.close();notebookSheet.current=null;}const target={...shell.route()};if(target.page===page.item){delete target.page;history.replaceState(history.state,'',routeHref(target));}page.more.remove();page.host.remove();page.close();}, idSuffix, shortKeys: true, revisionShown, passages: notebookPassagesOf(),
        place: async scope => ({ href: routeHref({ kind: scope.kind, id: scope.id, page: id }), title: '' }) });
      followCommits(() => notebookSheet.followed(page));
      return page;
    },
    fullHref: (id, mode) => routeHref({ kind: 'cards', id, ...(mode === 'text' ? { view: 'text' } : {}) }),
    feed: topic && views ? { topicId: topic.id, read: (name, args) => pipelineView(name, args),
      open: (id, message) => openDestination({ kind: 'topic', id, message, land: true }, 'the dossier') } : null,
    // A stack in the open topic opens in its Reader over the feed; one elsewhere opens its topic's page.
    openStack: async (topicId, messageId, land = false) => {
      if (topic && views && topicId === topic.id) { await openSource({ kind: 'message', id: messageId }, $('main')); return true; }
      await openDestination({ kind: 'topic', id: topicId, message: messageId, ...(land ? { land: true } : {}) }, 'the reply');
      if (land && !retired) return true; // A refused navigation brings the kept sheet back here.
      return false;
    },
    goBack: address => openDestination(parseRoute(new URL(address, location.href)), 'the Notebook page'),
    // A topic's page records reads as its Reader did; an outcome's page as its pages opened in place do.
    reads: () => pageReads ?? pageHere?.reads ?? null,
    source: async ref => checkedView(await api.view('source', ref, { readClass: 'foreground' }), bootstrap.instance_id) });
  shell.guard(() => notebookSheet.holds());
  return notebookSheet;
}
let railNotebook = null;
function notebookRailMenu() {
  return railNotebook ??= new NotebookRailMenu({
    loaded: id => notebookSheet?.showing && notebookSheet.current?.item === id && !notebookSheet.current.writing?.closed ? notebookSheet.current : null,
    open: (id, options) => openNotebook(id, options),
    mode: id => notebookViewsOf().get(id),
    layout: () => {
      if (notebookSheet) return { ...notebookSheet, docked: notebookSheet.canDock() && notebookSheet.dockWanted, canDock: () => notebookSheet.canDock() };
      const canDock = Boolean(topic && views && globalThis.matchMedia?.('(min-width: 1280px)').matches);
      return { canDock: () => canDock, docked: canDock && notebookDockWanted(), dossiers: Boolean(topic && views) };
    },
    current: handles => !retired && shell.handles === handles && handles?.readable?.() !== false,
    notice: words => panes.outline?.menus.notice(words), changed: () => panes.outline?.notebookStars.refresh(),
  });
}
function openNotebook(id, options = {}) {
  const sheet = notebookSheetOf();
  if (options.beside && !sheet.canDock()) return openDestination({ kind: 'cards', id, ...(options.mode === 'text' ? { view: 'text' } : {}), ...(options.card ? { card: options.card } : {}) }, 'the Notebook page');
  return sheet.open(id, options);
}

// An outcome's Notebook page opening in place, on a page of the outcome's with no
// topic of its own: the outcome's page, its pipeline, its Measurements, a new topic.
function pagesInPlace(workspace,recorded) {
  const reads=new PageReads({recorded,send:(id,revision)=>{
    const {authority_id,authority_epoch}=bootstrap.authority;
    return api.command({v:1,instance_id:bootstrap.instance_id,operation_id:crypto.randomUUID(),kind:'memory.read',
      target:{item_id:id},expected:{authority:{authority_id,authority_epoch}},args:{revision}});
  }});
  pageHere=new PageHere({host:$('page-here'),reads,read:ref=>pipelineView('source',ref),status:id=>pipelineView('memory_status',{item_id:id}),media:pageImage,cards:id=>routeHref({kind:'cards',id,view:'text'}),passages:notebookPassagesOf()});pageHereOutcome=workspace;
  const shown=pageHere;followCommits(()=>shown.follow());
}
// The outcome's own page lists its Notebook pages first, each opening
// in the composer over it; the side rail lists none (docs/notebook-pages.md).
let notebookViews=null;
function notebookViewsOf(){return notebookViews??=new NotebookViews(bootstrap);}
function outcomePages(workspace,recorded) {
  pagesInPlace(workspace,recorded);
  return new OutcomeReferences({scope:workspace,host:$('outcome-references'),create:()=>notebookCreator($('outcome-references'),{kind:'workspace',id:workspace}),list:$('outcome-references-list'),more:$('more-references'),
    message:$('outcome-references-status'),menuHandles:()=>!retired ? shell.handles : null,pageMax:pageMax(),viewPreference:notebookViewsOf(),denied:error=>readFailure(error).kind==='forbidden',painted:shown=>outcomePageLayout?.notes(shown),
    read:args=>pipelineView('memory_items',{owner_scope:{kind:'workspace',id:workspace},...args}),open:(ref,row)=>run(()=>openNotebook(ref.id,{opener:row}))});
}
// An outcome's team, which its owner and its coordinator may change. The owner
// cannot be removed, so the owner's chip is fixed.
let teamPanel=null,purposeLine=null,teamInvite=null,headlessSeats=null,headlessGuardPage=null,coordinatorChoice=null,teamReadSerial=0;
async function paintTeam(workspace,refresh,loaded=()=>{}) {
  const serial=++teamReadSerial;
  const send=(id,present)=>setPresence('workspace.member_set',{workspace_id:workspace.id},'workspace_revision',workspace.version,{actor_id:id,present})
    .then(receipt=>{run(refresh);return receipt;});
  if(!teamPanel){
    teamPanel=new PeoplePanel({host:$('team-people'),label:'Add someone to this outcome\'s team',fixed:()=>[teamPanel.owner],light:wakeLight,pill:participantPill,dismissible:true,
      read:()=>readMembers(api,bootstrap.instance_id,workspace.id),candidates:()=>directoryPeople,opened:()=>refreshDirectory()});
  }
  Object.assign(teamPanel,{owner:workspace.owner_id,add:id=>send(id,true),remove:id=>send(id,false)});
  if(!coordinatorChoice){
    const page=shell.page;
    coordinatorChoice=new CoordinatorChoice({panel:teamPanel,instanceId:bootstrap.instance_id,
      binding:()=>JSON.stringify([bootstrap.instance_id,bootstrap.actor,bootstrap.authority]),
      current:()=>!retired&&shell.page===page,
      failed:words=>{if($('outcome-team').hidden)status(words);},
      send:(current,id,operation)=>pipelineSend('workspace.coordinator_set',{workspace_id:current.id},{actor_id:id},{workspace_revision:current.version},operation)});
  }
  let members,failed=null;
  const wakes = wakeLights.load();
  try { members=await readMembers(api,bootstrap.instance_id,workspace.id); }
  catch(error) { failed=error;members=teamPanel.people; }
  await wakes;
  if(serial!==teamReadSerial||retired)return;
  if(failed)teamPanel.error=`The team could not be read: ${failed.message}`;
  coordinatorChoice.refresh=refresh;
  coordinatorChoice.paint(workspace,members,!failed&&members.some(person=>person.actor_id===bootstrap.actor));
  teamPanel.paint(members,organises(workspace,bootstrap.actor));teamPanel.error='';
  // The shared Add popover hosts the existing invitation form; its prompt stays on the page.
  if(teamInvite?.outcome!==workspace.id){
    headlessSeats?.dispose();headlessSeats=null;
    teamInvite?.dispose();
    teamInvite=new AgentInvite({host:$('team-invite'),panel:teamPanel,invitation:new Invitation({api,bootstrap}),workspace:()=>teamInvite.current,invited:()=>run(refresh)});
    teamInvite.outcome=workspace.id;
    const closed=teamPanel.closed;teamPanel.closed=()=>{closed?.();coordinatorChoice.toggle(false,false);};
    headlessSeats=new HeadlessSeatControl({panel:teamPanel,api,bootstrap,workspace:{id:workspace.id,version:workspace.version},
      closeOthers:()=>{teamInvite?.toggle(false,false);coordinatorChoice?.toggle(false,false);}});
    const inviteAction=teamInvite.opener.onclick;
    teamInvite.opener.onclick=()=>{headlessSeats?.toggle(false,false);inviteAction();};
  }
  const teamPage=shell.page;
  headlessSeats.current=()=>!retired&&shell.page===teamPage;
  headlessSeats.added=()=>run(refresh);
  if(headlessGuardPage!==teamPage){headlessGuardPage=teamPage;shell.guard(()=>shell.page===teamPage&&Boolean(headlessSeats?.unprotectedWriting));}
  teamInvite.current={id:workspace.id,version:workspace.version};
  teamInvite.paint(organises(workspace,bootstrap.actor));teamPanel.paintChoices();
  $('outcome-team').hidden=false;
  loaded(members);
  await headlessSeats.refresh({id:workspace.id,version:workspace.version},members,workspace.owner_id===bootstrap.actor);
  return !failed;
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
    read:async args=>checkedView(await readTopicList((name, query)=>api.view(name,query,{readClass:'foreground'}),args),bootstrap.instance_id),
    open:(id,title,message,at)=>openDestination(topicTarget(id,message,at),title)});
  pagesInPlace(route.workspace,()=>{});
  here={workspaceId:route.workspace,title:answer.workspace.title,view:null,conversation:false};
  outcomeScope=new OutcomeScope({workspaceId:route.workspace,kind:'opening',rail:document.querySelector('.rail'),home:$('outcomes-home'),attention,open:openDestination,
    sections:[{name:'topics',node:$('topic-navigation'),load:()=>topicRail.load()},skillsSection(route.workspace)]});
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
window.addEventListener('pagehide', () => { anchorWatch?.stop(); live?.stop(); stopReadTracking(); unheard(); stackFeed?.dispose(); stopDays(); });
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
