from __future__ import annotations

import unittest
from unittest import mock

from aim_next import Store
import test_seat_cli_1002 as base


class EndCLI(base.SeatCLI):
    def test_end_uses_same_saved_operation_after_lost_readback_and_rejects_other_seat(self):
        self.assertEqual(self.invoke('seat-add','w1','Scribe','--role','-')[0],0)
        identity=self.sql('SELECT id FROM hosted_seats')[0][0]
        original=Store.view
        reads=0
        def unavailable(store,actor,name,args):
            nonlocal reads
            if name=='hosted_seat':
                reads+=1
                if reads==2:
                    return {'instance_id':store.instance_id,'error':{'code':'DATABASE_BUSY','message':'Scratch lost readback','retryable':True}}
            return original(store,actor,name,args)
        args=('seat-end','w1',identity,'--operation','end-exact-cli')
        with mock.patch.object(Store,'view',unavailable):
            code,out,error=self.invoke(*args)
        self.assertEqual(code,1,(out,error));self.assertIn('READ_BACK_UNCONFIRMED',error)
        request=self.profiles['owner'].parent/'owner.outbox'/'end-exact-cli.request.json'
        raw=request.read_bytes()
        retried=self.invoke(*args);self.assertEqual(retried[0],0,retried)
        self.assertEqual(request.read_bytes(),raw)
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_seat_events WHERE state='ending'"),[(1,)])
        changed=self.invoke('seat-end','w1','another-seat','--operation','end-exact-cli')
        self.assertNotEqual(changed[0],0);self.assertIn('OPERATION_PAYLOAD_MISMATCH',changed[1]+changed[2])

for _name in base.SeatCLI.__dict__:
    if _name.startswith('test_'):
        setattr(EndCLI,_name,None)

if __name__ == '__main__':
    unittest.main()
