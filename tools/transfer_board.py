#!/usr/bin/python3 -I
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aim_next import recovery_io as io
from aim_next.transfer import export_source, source_readback


def main(argv=None):
    parser = argparse.ArgumentParser(description='Explicit judged board-transfer operations; never starts services')
    parser.add_argument('operation', choices=('export-source', 'source-readback'))
    parser.add_argument('request', help='private, original immutable request JSON; never an actor profile')
    args = parser.parse_args(argv)
    try:
        request, _ = io.read_record(io.canonical(args.request))
        result = (export_source if args.operation == 'export-source' else source_readback)(request)
        print(json.dumps(result, sort_keys=True))
        return 0
    except io.RecoveryError as error:
        print(json.dumps(dict(error=error.code, retryable=error.retryable, evidence=error.evidence)), file=sys.stderr)
        return 75 if error.retryable else 2


if __name__ == '__main__':
    sys.exit(main())
