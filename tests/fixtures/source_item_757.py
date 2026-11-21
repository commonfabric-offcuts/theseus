from __future__ import annotations

"""Synthetic record fixture shared by below-browser controls and native cases.

No server, profile, external data or stored cover projection is used here.
Every seed/transition calls Core; readbacks contain only this fixture's facts.
"""


class SourceItem757:
    def __init__(self, store, command, viewer, writer, private_owner):
        self.store, self.command = store, command
        self.viewer, self.writer, self.private_owner = viewer, writer, private_owner
        self.serial = 0

    def act(self, f, kind, args, target=None, expected=None, sender=None):
        self.serial += 1
        receipt = self.command(kind, f['key'] + '-act-' + str(self.serial), args,
                               target or {}, expected or {}, sender or self.viewer)
        assert receipt['status'] == 'committed' and receipt['recorded'], receipt
        return receipt['result']

    def view(self, name, args, reader=None):
        result = self.store().view(reader or self.viewer, name, args)
        assert 'error' not in result, result
        return result

    def settings(self, f, **args):
        current = self.view('pipeline', {'workspace_id': f['workspace'], 'limit': 1})['pipeline']
        return self.act(f, 'pipeline.configure', dict(enabled=True, **args),
                        {'workspace_id': f['workspace']}, {'pipeline_revision': current['version'] if current else 0})

    def stages(self, f, rounds=False, releases=False):
        stages = [{'stage_id': 'build', 'name': 'Build'},
                  dict(stage_id='review', name='Review', **({'rounds': 'split'} if rounds else {})),
                  {'stage_id': 'wait', 'name': 'Wait'}]
        if releases:
            stages += [{'stage_id': 'checks', 'name': 'Check candidate', 'scope': 'release'},
                       {'stage_id': 'live-name', 'name': 'Live', 'scope': 'release'}]
        current = self.view('pipeline', {'workspace_id': f['workspace'], 'limit': 1})['pipeline']
        self.act(f, 'pipeline.stages_set', {'stages': stages}, {'workspace_id': f['workspace']},
                 {'pipeline_revision': current['version']})

    def topic(self, f, name):
        topic = f['key'] + '-' + name
        draft = topic + '-draft'
        self.act(f, 'draft.save', {
            'source_ref': {'kind': 'new_topic', 'id': topic + '-opening', 'workspace_id': f['workspace']},
            'topic_id': topic, 'generation': topic + '-generation', 'body': 'Synthetic fixture opening',
            'opening': {'workspace_id': f['workspace'], 'title': 'Source rows ' + name,
                        'participants': [self.writer, self.viewer]}}, {'draft_id': draft}, {'draft_revision': 0}, sender=self.writer)
        self.act(f, 'submission.prepare', {'draft_id': draft, 'submission_id': draft,
                                         'send_operation_id': topic + '-send'},
                 {'topic_id': topic}, {'draft_revision': 1}, sender=self.writer)
        # The stable send identity belongs to the prepared submission.
        receipt = self.command('topic.create_and_send', topic + '-send', {'submission_id': draft},
                               {'topic_id': topic}, {}, self.writer)
        assert receipt['status'] == 'committed', receipt
        return topic

    def post(self, f, body, reply=None):
        return self.act(f, 'message.post', dict(body=body, addressees=[self.viewer], intent='tell',
                                              **({'reply_to': reply, 'reply_without_quote': 'Synthetic cabin reply for source-cover checks'} if reply else {})),
                        {'topic_id': f['topic']}, sender=self.writer if reply else self.viewer)['message_id']

    def file(self, f, title, sources, workspace=None, sender=None):
        return self.act(f, 'pipeline.item_add', {'title': title, 'section': 'now', 'size': 'small',
                                               'sources': [{'message_id': m} for m in sources]},
                        {'workspace_id': workspace or f['workspace']}, sender=sender)['number']

    def start(self, f, number, topic, stage):
        return self.act(f, 'pipeline.piece_start', {'numbers': [number], 'topic_id': topic, 'stage_id': stage},
                        {'workspace_id': f['workspace']})['piece_id']

    def seed(self, key):
        f = {'key': key, 'workspace': key + '-w'}
        self.act(f, 'workspace.create', {'id': f['workspace'], 'title': 'Synthetic source rows',
                                       'team': [self.writer, self.private_owner]})
        f['topic'] = self.topic(f, 'source')
        f['work_topic'] = self.topic(f, 'work')
        f['root'] = self.post(f, 'Which weekend suits the cabin trip?')
        f['answer'] = self.post(f, 'The cabin decision stays in this delivered reply.', f['root'])
        f['lone'] = self.post(f, 'A singleton source with the same actual linked items.')
        f['joined'] = self.post(f, 'A separately filed report to join later.')
        f['unrelated'] = self.post(f, 'Unrelated dossier must keep its own identity.')
        for source, payload in [(f['root'], f['answer']), (f['lone'], f['lone'])]:
            self.act(f, 'stack.cover', {'stands': 'Cabin is booked',
                                      'payload': {'text': 'Cabin decision', 'message_id': payload, 'kind': 'decision'},
                                      'waiting': [{'text': 'Choose the cabin', 'default': 'Keep the current booking'}]},
                     {'message_id': source}, {'cover_revision': 0}, sender=self.writer)
        self.settings(f)
        self.stages(f)
        f['first'] = self.file(f, 'Make the reader clearer', [f['root'], f['lone']])
        f['second'] = self.file(f, 'Speed up the feed', [f['root'], f['lone']])
        f['first_piece'] = self.start(f, f['first'], f['work_topic'], 'build')
        f['second_piece'] = self.start(f, f['second'], f['topic'], 'review')
        return f

    def read(self, f):
        covers = {name: self.view('dossier_cover', {'message_id': f[name]})
                  for name in ('root', 'lone', 'joined', 'unrelated')}
        items = [self.view('pipeline_item', {'workspace_id': f['workspace'], 'number': f[k]})['item']
                 for k in ('first', 'second')]
        return {'covers': covers, 'items': items, 'release_records': self.view('releases', {'limit': 10})['items']}

    def transition(self, f, action):
        target = {'piece_id': f.get('release_piece', f['first_piece'])}
        if action == 'review-round':
            self.stages(f, rounds=True)
            self.act(f, 'pipeline.stage_enter', {'stage_id': 'review', 'round': 2, 'left_outcome': 'passed'}, target)
        elif action == 'wait':
            self.act(f, 'pipeline.stage_enter', {'stage_id': 'wait', 'left_outcome': 'passed'}, target)
        elif action == 'done':
            self.act(f, 'pipeline.piece_finish', {}, {'piece_id': f['second_piece']})
        elif action == 'combine':
            self.settings(f, ships_in_releases=True)
            self.stages(f, rounds=True, releases=True)
            f['release_piece'] = self.act(f, 'pipeline.combine', {'piece_ids': [f['first_piece']],
                                                               'topic_id': f['work_topic']},
                                         {'workspace_id': f['workspace']})['piece_id']
        elif action == 'stage-named-live':
            self.act(f, 'pipeline.stage_enter', {'stage_id': 'live-name', 'left_outcome': 'passed'}, target)
        elif action == 'record-live':
            result = self.store().record_release({'release': 757, 'commit': '7' * 40,
                                                 'deployed_at': '2026-11-18T12:00:00-08:00',
                                                 'items': [f['first']], 'source': 'backfill'})
            assert result['recorded'], result
        elif action == 'join-private':
            self.act(f, 'pipeline.source_add', {'sources': [{'message_id': f['joined']}]},
                     {'workspace_id': f['workspace'], 'number': f['first']},
                     {'item_revision': self.view('pipeline_item', {'workspace_id': f['workspace'], 'number': f['first']})['item']['version']})
            f['third'] = self.file(f, 'A distinct joined report', [f['joined']])
            self.act(f, 'stack.join', {'into': f['root']}, {'message_id': f['joined']},
                     {'join_revision': 0}, sender=self.writer)
            f['private_workspace'] = f['key'] + '-private'
            self.act(f, 'workspace.create', {'id': f['private_workspace'], 'title': 'Private destination', 'team': []}, sender=self.private_owner)
            self.act(f, 'pipeline.configure', {'enabled': True}, {'workspace_id': f['private_workspace']},
                     {'pipeline_revision': 0}, sender=self.private_owner)
            f['private_number'] = self.file(f, 'Secret destination title 757', [f['root']],
                                            f['private_workspace'], self.private_owner)
        elif action == 'split':
            self.act(f, 'stack.join', {'into': None}, {'message_id': f['joined']},
                     {'join_revision': 1}, sender=self.writer)
        else:
            raise ValueError(action)
        return f


def native_control(store, command, viewer, request):
    fixture = SourceItem757(store, command, viewer, 'aim-core', 'fixture-other-person')
    # Callers supply a unique key for each operation, keeping operation identities
    # stable within that call without reusing identities for later transitions.
    if request['action'] == 'seed':
        f = fixture.seed(request['key'])
    else:
        f = dict(request['fixture'])
        fixture.serial = request['serial'] * 100
        if request['action'] != 'read':
            f = fixture.transition(f, request['action'])
    result = {'fixture': f, 'readback': fixture.read(f)}
    if 'private_workspace' in f:
        result['private_owner_cover'] = fixture.view('dossier_cover', {'message_id': f['root']}, 'fixture-other-person')
    return result
