"""The deploy's 06-migrate record in a landing's output, read strictly. A landing reports one of three recorded
shapes: the skip ({"skipped": true, "schema": N, "why": ...}), a migrate run that found nothing to do (exit 0, ok,
migrated false, from_version equal to schema_version) or a completed step (exit 0, ok, migrated true, a later
schema_version). Anything else, an error answer, a refused exit, a record that is both skipped and migrated, or more
than one record, is not read as any of them."""
import json, re

DIGITS = re.compile(r'^\d+$')


def read(land_text):
    """(from, to) schema versions, equal when no step ran; None when the record is missing or unrecognized."""
    found = re.findall(r'^06-migrate (\{.*\})$', land_text, re.M)
    if len(found) != 1:
        return None
    try:
        record = json.loads(found[0])
    except ValueError:
        return None
    if not isinstance(record, dict):
        return None
    if set(record) == {'skipped', 'schema', 'why'}:
        schema = record['schema']
        good = record['skipped'] is True and isinstance(schema, str) and DIGITS.match(schema)
        return (schema, schema) if good else None
    if set(record) != {'exit', 'stdout', 'stderr'} or record['exit'] != 0:
        return None
    try:
        out = json.loads(record['stdout'])
    except (TypeError, ValueError):
        return None
    if not isinstance(out, dict) or out.get('ok') is not True or 'error' in out:
        return None
    old, new, migrated = out.get('from_version'), out.get('schema_version'), out.get('migrated')
    if not all(isinstance(v, str) and DIGITS.match(v) for v in (old, new)):
        return None
    if (migrated is False and old == new) or (migrated is True and int(new) > int(old)):
        return (old, new)
    return None
