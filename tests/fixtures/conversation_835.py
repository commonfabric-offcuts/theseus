"""Isolated Core responses for the browser-only conversation listing adapter."""
from __future__ import annotations
import json
import sys
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[2]), str(Path(__file__).resolve().parents[1])]
from test_conversation import ConversationCase

case = ConversationCase()
case.setUp()
try:
    question = case.posted('Which day?', actor='owner', intent='ask', addressees=['agent-a'])
    # Core records message exposure when an agent reads a question. Everything
    # except that existing exposure bookkeeping must remain byte-for-byte alike.
    before = case.records_beside_exposures()
    read = lambda name, args: case.store.view('agent-a', name, args)
    conversation = read('conversation', {'workspace_id': 'w1'})
    record = read('topic', {'topic_id': case.conversation})
    first = read('workspace_topics', {'workspace_id': 'w1', 'limit': 1})
    assert case.records_beside_exposures() == before, 'listing and metadata reads changed outcome, topic or work records'
    assert case.exposures().get(question) == 1
    assert question in [ask['message_id'] for ask in record['topic']['asks']]
    print(json.dumps({'conversation': conversation, 'topic': record, 'workspace_topics': first, 'question': question}))
finally:
    case.doCleanups()
