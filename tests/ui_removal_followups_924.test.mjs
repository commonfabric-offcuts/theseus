import test from 'node:test';
import assert from 'node:assert/strict';
import * as replies from '../web/replies.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';

const removal = {kind:'retracted',by:'author',at_ms:1234567890000};
const reply = {id:'reply',topic_id:'topic',seq:2,author_id:'reader',body:'My reply',revision:1,reply_to:'parent',
  reply_to_author:'author',reply_to_excerpt:'Original parent words',reply_to_removal:null};
const page = items => ({instance_id:'fixture924',items,next_cursor:null,relevant_versions:{topic:1}});

test('924 shared reply painter strikes only original parent words and labels the act once', () => {
  assert.equal(typeof replies.paintReplyLine,'function','actual shared reply painter exists');
  const doc=renderer799().list.ownerDocument, line=doc.createElement('span');
  replies.paintReplyLine(line,{...reply,reply_to_removal:removal});
  const words=line.querySelector('.retracted-words');
  assert.ok(words);assert.equal(words.text,reply.reply_to_excerpt);
  assert.ok(line.text.startsWith('Replying to author: '));
  assert.equal(line.querySelectorAll('.message-retracted').length,1);
  const label=line.querySelector('.message-retracted'), time=label.querySelector('time');
  assert.equal(label.closest('.retracted-words')===null,true,'label is never struck or dimmed');
  assert.equal(time.dataset.ms,String(removal.at_ms));
  replies.paintReplyLine(line,{...reply,reply_to_removal:removal});
  assert.equal(line.querySelectorAll('.message-retracted').length,1,'repaint never duplicates label');
  replies.paintReplyLine(line,reply);
  assert.equal(line.text,replies.replyLine(reply));
  assert.equal(line.querySelector('.message-retracted'),null);
  assert.equal(line.querySelector('.retracted-words'),null);
});

test('924 withheld parent and ordinary compact excerpts keep their old wording', () => {
  assert.equal(typeof replies.paintReplyLine,'function','actual shared reply painter exists');
  const doc=renderer799().list.ownerDocument, line=doc.createElement('span');
  for(const value of [reply,{...reply,reply_to_excerpt:'x'.repeat(90)+'\nsecond line'},
    {...reply,reply_to_excerpt:null,reply_to_author:null,reply_to_removal:null}]) {
    replies.paintReplyLine(line,value);assert.equal(line.text,replies.replyLine(value));
    assert.equal(line.querySelector('.message-retracted'),null);
  }
  replies.paintReplyLine(line,{...reply,reply_to_excerpt:'See https://example.test/a and more',reply_to_removal:removal});
  const link=line.querySelector('a');
  assert.ok(link,'the surviving parent link keeps its normal behavior');
  assert.equal(link.href,'https://example.test/a');
  assert.ok(link.closest('.retracted-words'));
});

test('924 loaded reply learns its retracted parent even when the parent is above the page', () => {
  const views=new TopicViews({instanceId:'fixture924',topicId:'topic'});
  views.messagesPage(page([{...reply}]),{initial:true});
  views.takeRevised();views.learnRemoval('parent',removal);
  assert.deepEqual(views.messages.get('reply').reply_to_removal,removal);
  assert.ok(views.takeRevised().has('reply'),'the actual reply card is scheduled for repaint');
  views.messagesPage(page([{...reply}]),{initial:true});
  assert.deepEqual(views.messages.get('reply').reply_to_removal,removal,'late page cannot remove the terminal fact');
});

test('924 a newer page learns parent removal while an older page cannot clear it or reveal a hidden parent', () => {
  const views=new TopicViews({instanceId:'fixture924',topicId:'topic'});
  views.messagesPage(page([{...reply}]),{initial:true});views.takeRevised();
  views.messagesPage(page([{...reply,reply_to_removal:removal}]),{initial:true});
  assert.ok(views.takeRevised().has('reply'),'unchanged reply words still repaint parent metadata');
  views.messagesPage(page([{...reply}]),{initial:true});
  assert.deepEqual(views.messages.get('reply').reply_to_removal,removal);
  views.messagesPage(page([{...reply,revision:2,body:'Edited reply'}]),{initial:true});
  assert.deepEqual(views.messages.get('reply').reply_to_removal,removal,'reply edits do not clear parent removal');
  views.messagesPage(page([{...reply}]),{initial:true});
  assert.deepEqual(views.messages.get('reply').reply_to_removal,removal,'older reply revision keeps parent removal');
  views.messagesPage(page([{...reply,reply_to_author:null,reply_to_excerpt:null}]),{initial:true});
  assert.equal(views.messages.get('reply').reply_to_removal,null,'unreadable parent never gains metadata from cache');
});
