"""Isolated Core responses for the browser-only conversation listing adapter."""
from __future__ import annotations
import json
import sys
from pathlib import Path
assert sys.version_info[:2] == (3, 9) and sys.flags.isolated and sys.pycache_prefix, "835 requires isolated CPython3.9 and a unique cache"
print('835_CHILD_RUNTIME ' + json.dumps({'executable': sys.executable, 'python': sys.version,
    'isolated': sys.flags.isolated, 'pycache_prefix': sys.pycache_prefix,
    'argv': [sys.executable, '-I', '-X', 'pycache_prefix=' + sys.pycache_prefix, str(Path(__file__).resolve())]}),
    file=sys.stderr, flush=True)
sys.path[:0] = [str(Path(__file__).resolve().parents[2]), str(Path(__file__).resolve().parents[1])]
from test_conversation import ConversationCase

case = ConversationCase()
case.setUp()
try:
    question = case.posted('Which day?', actor='owner', intent='ask', addressees=['agent-a'])
    # The helper verifies eligible first facts against actual agent revision
    # exposures, then compares every other record byte-for-byte.
    before = case.records_beside_exposures()
    read = lambda name, args: case.store.view('agent-a', name, args)
    conversation = read('conversation', {'workspace_id': 'w1'})
    record = read('topic', {'topic_id': case.conversation})
    first = read('workspace_topics', {'workspace_id': 'w1', 'limit': 1})
    assert case.records_beside_exposures() == before, 'listing and metadata reads changed outcome, topic or work records'
    assert case.exposures().get(question) == 1
    assert case.sql("SELECT by FROM message_first_exposures WHERE message_id=?", (question,)) == [("agent-a",)]
    assert question in [ask['message_id'] for ask in record['topic']['asks']]
    print(json.dumps({'conversation': conversation, 'topic': record, 'workspace_topics': first, 'question': question}))
finally:
    case.doCleanups()
