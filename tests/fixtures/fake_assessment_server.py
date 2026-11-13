#!/usr/bin/python3 -I
from __future__ import annotations

"""Native wire/restart fixture. Never calls a model, uses credentials, or accesses live Theseus."""
import os
from pathlib import Path
import sys
import uuid

sys.path.insert(0,str(Path(__file__).resolve().parent))
from fake_codex_app_server import Fake


class AssessmentFake(Fake):
    def settings(self,params,thread_id,status=None,widened=False):
        result = super().settings(params,thread_id,status,widened)
        if params.get('sandbox') == 'read-only':
            result['sandbox'] = {'type':'readOnly'}
        return result

    def on_turn_start(self,request,params):
        thread = params['threadId']
        turn = {'id':str(uuid.uuid4()),'status':'completed','items':[]}
        self.state['threads'][thread]['turns'].append(turn)
        self.save()
        if self.once('assessment_die_after_finish'):
            os._exit(7)
        # Exercise completion arriving before the turn/start response.
        self.notify('turn/completed',{'threadId':thread,'turn':turn})
        self.send({'id':request['id'],'result':{'turn':turn}})

    def on_thread_items_list(self,request,params):
        import json
        item = {'id':str(uuid.uuid4()),'type':'agentMessage','phase':'final_answer',
                'text':json.dumps(self.script['report'])}
        self.send({'id':request['id'],'result':{'data':[{'turnId':params['turnId'],'item':item}], 'nextCursor':None}})


sys.exit(AssessmentFake().run())
