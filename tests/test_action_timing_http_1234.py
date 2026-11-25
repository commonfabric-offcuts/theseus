from __future__ import annotations

import re
import test_http


class ActionTimingHTTP(test_http.HTTPContractTests):
    def test_request_reports_only_bounded_server_spans_and_static_assets_do_not_inherit_them(self):
        status, headers, _body = self.request('/api/view?__aim_timing=request-one', {"name": "topic", "args": {}})
        self.assertEqual(status, 200)
        header = headers.get('Server-Timing')
        self.assertIsNotNone(header)
        self.assertRegex(header, r'^aim_admission;dur=[0-9.]+, aim_store;dur=[0-9.]+$')
        for duration in re.findall(r'dur=([0-9.]+)', header):
            self.assertGreaterEqual(float(duration), 0)
            self.assertLessEqual(float(duration), 3600000)
        status, headers, _body = self.request('/app.js', method='GET', authenticated=False)
        self.assertEqual(status, 200)
        self.assertNotIn('Server-Timing', headers)
        self.assertTrue(any(call[0] == 'view' and call[2] == 'topic' for call in self.store.calls))


for _name in dir(test_http.HTTPContractTests):
    if _name.startswith('test_'):
        setattr(ActionTimingHTTP, _name, None)
