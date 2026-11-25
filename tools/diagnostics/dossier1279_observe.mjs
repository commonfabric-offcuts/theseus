// Serialized into the real document by page.evaluate. No product calls are
// manufactured: controls below require a call made by the document itself.
export async function installDossierObserver(urls) {
  const q = window.__dossier1279;
  q.observerErrors ??= []; q.callSerial = 0;
  const errorIds = new WeakMap(); let errorSerial = 0;
  const errorOf = error => {
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      if (!errorIds.has(error)) errorIds.set(error, ++errorSerial);
      return { identity: errorIds.get(error), name: error.name, message: error.message,
        code: error.code, stack: error.stack };
    }
    return { value: String(error) };
  };
  // An observer error is retained separately and cannot skip the actual call,
  // change its return value/promise, or replace a product exception.
  const record = (kind, make) => {
    try { q.add(kind, make()); }
    catch (error) { q.observerErrors.push({ kind, wallMs: Date.now(), error: errorOf(error) }); }
  };
  const positionOf = value => value && Object.fromEntries([
    'root_id', 'through', 'below', 'order_key', 'order_tie', 'order_entry_key',
    'at', 'level', 'level_revision', 'place_revision', 'join_revision', 'cover_revision'
  ].map(key => [key, value[key]]));
  const state = owner => {
    const sample = q.sample();
    // StackFeed.messages is a provider function, not TopicViews' Map. Do not
    // call the provider just for observation or assume it has Map methods.
    const messages = owner.messages instanceof Map ? owner.messages : null;
    // Full canonical ids remain in batch/DOM snapshots and incoming read ids.
    // Repeated method records retain counts and exact target membership.
    if (sample.window) {
      const { loaded, ...window } = sample.window;
      sample.window = { ...window, loadedCount: loaded?.length,
        loadedTargets: loaded?.filter(id => [q.target.root, ...q.target.replies].includes(id)) };
    }
    return { sample, topicId: owner.topicId,
      records: [q.target.root, ...q.target.replies].map(id => ({ id,
        present: messages?.has(id), position: positionOf(messages?.get(id)?.stack_position) })),
      newest: owner.newest, windowEpoch: owner.windowEpoch,
      windowReadFloor: owner.windowReadFloor, windowKnowledge: owner.windowKnowledge,
      membership: owner.membershipRevision };
  };
  const resultOf = value => value == null || ['boolean', 'string', 'number'].includes(typeof value)
    ? value : { type: typeof value };
  const absoluteViews = await import('/topic-views.mjs');
  const absoluteFeed = await import('/stack-feed.mjs');
  const versionedViews = await import(urls.topicViews);
  const versionedFeed = await import(urls.stackFeed);
  q.observerIdentity = { ...urls,
    absoluteViewsSame: absoluteViews === versionedViews,
    absoluteFeedSame: absoluteFeed === versionedFeed,
    qualification: 'Identity checks are a control; document-owner entry/return is still required.' };
  const wrap = (prototype, ownerName, name, currentIndex) => {
    const actual = prototype[name];
    if (typeof actual !== 'function') throw Error(`Missing document owner ${ownerName}.${name}`);
    prototype[name] = function (...args) {
      const owner = this, call = ++q.callSerial;
      const kind = ownerName + '.' + name;
      // Keep the actual invocation in its own try; observation never enters it.
      record(kind + ':entry', () => ({ call, stack: new Error().stack,
        before: state(owner), key: name === 'refresh' ? args[0] : undefined,
        read: name === 'messagesPage' ? { ids: args[0]?.items?.map(item => item.id),
          commit_seq: args[0]?.commit_seq, frontier: args[1] } : undefined }));
      if (currentIndex !== undefined && typeof args[currentIndex] === 'function') {
        const current = args[currentIndex];
        args[currentIndex] = function (...input) {
          let value;
          try { value = current.apply(this, input); }
          catch (error) { record(kind + ':current-throw', () => ({ call, error: errorOf(error) })); throw error; }
          record(kind + ':current', () => ({ call, value }));
          return value;
        };
      }
      let result;
      try { result = actual.apply(owner, args); }
      catch (error) {
        record(kind + ':throw', () => ({ call, error: errorOf(error), after: state(owner) }));
        throw error; // The same original object reaches the original caller.
      }
      const pending = result instanceof Promise;
      record(kind + ':return', () => ({ call, pending, value: pending ? undefined : resultOf(result), after: state(owner) }));
      if (pending) result.then(
        value => record(kind + ':resolve', () => ({ call, value: resultOf(value), after: state(owner) })),
        error => record(kind + ':reject', () => ({ call, error: errorOf(error), after: state(owner) })));
      return result; // Preserve the original promise and the caller's retry.
    };
  };
  for (const name of ['messagesPage', 'trimWindow']) wrap(versionedViews.TopicViews.prototype, 'TopicViews', name);
  wrap(versionedViews.TopicViews.prototype, 'TopicViews', 'readPositions', 1);
  wrap(versionedViews.TopicViews.prototype, 'TopicViews', 'refresh', 3);
  wrap(versionedFeed.StackFeed.prototype, 'StackFeed', 'arrange');
  q.phase = 'positioning';
  return q.observerIdentity;
}
