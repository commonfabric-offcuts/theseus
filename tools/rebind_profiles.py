from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from aim_next.profile_rebinding import stage
from aim_next.recovery_io import RecoveryError, read_record


def main(argv=None):
    argv=sys.argv[1:] if argv is None else argv
    if len(argv)!=1:
        print('usage: rebind_profiles.py /absolute/private/request.json',file=sys.stderr)
        return 2
    try:
        request,_=read_record(argv[0])
        result=stage(request)
        # The full private manifest remains in control_path; stdout is a receipt.
        print(json.dumps({k:result[k] for k in
            ('v','status','staging_id','activation_id','handoff_id','routes_ready')},sort_keys=True))
        return 0
    except RecoveryError as error:
        print(json.dumps({'status':'refused','code':error.code,'retryable':error.retryable}),file=sys.stderr)
        return 75 if error.retryable else 2
    except (OSError,ValueError):
        print('{"status":"refused","code":"INPUT_UNAVAILABLE"}',file=sys.stderr)
        return 2


if __name__=='__main__':
    raise SystemExit(main())
