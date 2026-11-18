import test from 'node:test';
import assert from 'node:assert/strict';
import { totals, elsewhere, shownUnder, asksIn } from '../web/outline-rail.mjs';

test('item 756 cover waits add once per cover, preserving said/ask and unread responsibilities',()=>{
  const a={id:'a',cover_waiting:2,unread:7,light:{light:'waiting',short:{kind:'asks',count:1}}};
  const b={id:'b',cover_waiting:3,unread:4};
  assert.deepEqual(totals([a,b]),{fresh:11,waiting:6});
  assert.equal(asksIn(a),1,'the question control still counts only its questions');
  assert.deepEqual(elsewhere([a,b],'a'),{fresh:4,where:1,waiting:3});
  assert.equal(shownUnder('waiting',b),true,'cover-only outcome survives filter');
  assert.equal(shownUnder('waiting',{cover_waiting:0}),false);
  assert.equal(shownUnder('waiting',{cover_waiting:-1}),false);
});
