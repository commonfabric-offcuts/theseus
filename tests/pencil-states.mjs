import { createHash } from 'node:crypto';
// Branch inventory for the reshaped sheet. These are explicit presentation
// fixtures, except publication/access/save cases which hold the real boundary.
// They are not evidence of a production outage or a newly discovered defect.
export const PENCIL_STATES = [
  'publication pending', 'publication rejected', 'publication unknown',
  'loaded access visible', 'loaded access unavailable', 'loaded access checking', 'loaded access recovered',
  'local saving', 'server saving', 'saved', 'device-only', 'journal attention',
  'authority recovery', 'version conflict', 'recovery discovery', 'adopting', 'inactive', 'cleanup attention',
  'empty', 'normal writing', 'grown writing', 'shrunk writing',
  'agent menu open', 'name chooser', 'chosen recipient', 'agent menu done',
  'preparation busy', 'preparation unknown',
  'plus open', 'picker reserved',
  'image capturing', 'image uploading', 'image memory-only', 'image choice', 'image ready',
  'image storage error', 'image unknown', 'image refused', 'image authority blocked',
  'image server busy', 'image retained checking', 'image confirmed unattached', 'image opaque',
];
export const PENCIL_LATE_IMAGES = ['capturing', 'uploading', 'choice', 'memory-only', 'storage error', 'picker', 'ready'];

// Installed only in the isolated native fixture's fetched app module. The
// product module is otherwise unchanged; its real editor/upload/session owners
// and native event handlers drive the cases. No product test hook is shipped.
export function installPencilObservation(win, doc, Watch, getInline, getRegistry) {
  const calls = [];
  win.pencil = { get inline() { return getInline(); }, get registry() { return getRegistry(); }, calls };
  let installed = false;
  const install = () => {
    const owner = getInline();
    if (installed || !owner || doc.body?.dataset.ready !== 'true') return;
    installed = true;
    const original = owner.send;
    owner.send = function (...args) {
      const call = { id: calls.length + 1, settled: false };
      calls.push(call); win.pencilSendSettled = false;
      const settle = status => { call.status = status; call.settled = true; if (calls.at(-1) === call) win.pencilSendSettled = true; };
      let result;
      try { result = Reflect.apply(original, this, args); }
      catch (error) { settle('threw'); throw error; }
      if (result && typeof result.then === 'function') result.then(() => settle('fulfilled'), () => settle('rejected'));
      else settle('returned');
      return result;
    };
    observer.disconnect();
  };
  const observer = new Watch(install);
  observer.observe(doc.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-ready'] });
  install();
}
export const PENCIL_OBSERVE = `\n(${installPencilObservation.toString()})(window, document, MutationObserver, () => inline, () => registry);\n`;

export async function observePencil(p) {
  await p.route('**/app.mjs', async route => {
    const response = await route.fetch();
    const original=await response.text(),body=original+PENCIL_OBSERVE,hash=value=>createHash('sha256').update(value).digest('hex');
    p.pencilObservationProof={originalAppSha256:hash(original),observerSha256:hash(PENCIL_OBSERVE),servedAppSha256:hash(body)};
    await route.fulfill({ response, body });
  });
}
export const pencilModel = p => p.evaluate(() => {
  const {inline:i,registry:r}=window.pencil,e=i.editor,s=r.sessionFor(e);
  return { body:e.draft.body, version:e.localVersion, cycle:e.clientCycleId, active:i.admits(),
    readOnly:i.field.readOnly, sign:r.saveSign(e), checking:!!i.presentation.availabilityChecking,
    unconfirmed:!!i.presentation.availabilityUnconfirmed, unavailable:!!e.unavailable,
    retry:!i.$('retry').hidden, open:i.sheet.open,
    images:s.uploads.current().map(x=>({id:x.selection_id,bytes:x.bytes_state,status:s.uploads.status(x.selection_id)})),
    submissions:e.submissions.map(x=>({id:x.id,status:x.status,body:x.snapshot.body,prepared:x.preparationConfirmed,underWay:s.underWay(x.id)})) };
});

// Hold immediately before the actual capture or upload boundary. Selection is
// still a native + / Add image / file chooser act; release invokes the original.
export async function holdPencilImage(p, state) {
  await p.evaluate(state => {
    const {inline:i,registry:r}=window.pencil,u=r.sessionFor(i.editor).uploads;
    const gate=new Promise(resolve=>window.releasePencilImage=resolve);
    if(state==='capturing') {
      const capture=u.capture.bind(u);
      u.capture=async entry=>{window.pencilImageEntered=true;await gate;return capture(entry)};
    } else if(state==='uploading') {
      const api=u.api,upload=api.upload.bind(api);
      api.upload=async(...args)=>{window.pencilImageEntered=true;await gate;return upload(...args)};
    } else if(state==='memory-only') {
      const capture=u.journal.capture.bind(u.journal);
      u.journal.capture=async(...args)=>{u.journal.capture=capture;throw Error('Fixture device capture refused')};
    }
  }, state);
}
