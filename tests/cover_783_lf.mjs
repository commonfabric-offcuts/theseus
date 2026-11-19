import assert from 'node:assert/strict';
import { WORDS783 } from './cover_783_oracle.mjs';
// Actual release99 preserves LF only in stands. Other fields keep their one-line contract.
export const inputLF783 = answer => ({ stands: WORDS783.stands,
  waiting: [{ text: WORDS783.wait.replace('a real', 'a\nreal'), default: WORDS783.default.replace('exact default', 'exact\ndefault') }],
  payload: { text: WORDS783.payload.replace('#words, not', '#words,\nnot'), message_id:answer, kind:'answer' } });
export const UPDATED783 = Object.freeze({ ...WORDS783, stands: WORDS783.stands.replace('none','Friday') });
export async function updateLF783(control, topic, ids, actor, phase='updated') {
  const words=phase==='updated'?UPDATED783:WORDS783;
  const args={...inputLF783(ids.answer),stands:words.stands};
  for(const value of [args.stands,args.waiting[0].text,args.waiting[0].default,args.payload.text])assert.ok(value.includes('\n'),'783 actual LF supplied in each field');
  const receipt=await control({method:'stack_act',sender:'aim-core',kind:'stack.cover',message_id:ids.root,operation_id:`${topic}-lf-${phase}`,args});
  assert.equal(receipt.status,'committed',JSON.stringify(receipt));
  const held=await control({method:'agent_view',actor,name:'dossier_cover',args:{message_id:ids.answer}});
  assert.ok(!held.error && held.cover && held.root_id===ids.root,'783 successful dossier_cover shape: '+JSON.stringify(held));
  assert.equal(receipt.result.changed,true,'783 actual changed cover recorded');
  assert.deepEqual(held.cover,receipt.result.cover,'783 receipt/view exact cover binding');
  for(const cover of [receipt.result.cover,held.cover])assertLF783(cover,words);
  return {words,receipt,held};
}
export function assertLF783(cover, words=WORDS783) {
  assert.equal(cover.stands,words.stands,'783 actual stands LF');
  assert.deepEqual(cover.waiting,[{text:words.wait,default:words.default}],'783 wait/default LF folds per predecessor contract');
  assert.equal(cover.payload.text,words.payload,'783 payload LF folds per predecessor contract');
}
