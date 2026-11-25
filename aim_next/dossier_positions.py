from __future__ import annotations

"""Lossless response-local wire packing, after authoritative read selection (1271)."""

FORMAT = "root-table-v1"


def pack_positions(answer, args, *, byte_limit=None):
    if args.get("position_format") != FORMAT:
        return answer
    rows, positions = [], {}
    for item in answer["items"]:
        position = item["stack_position"]
        root = position["root_id"]
        positions[root] = position
        row = dict(item)
        del row["stack_position"]
        row["stack_position_ref"] = root
        acts = row.get("acts")
        if (row.get("id") == root and acts is not None and position["cover"] is not None
                and acts.get("cover") == position["cover"]):
            row["acts"] = dict(acts)
            del row["acts"]["cover"]
            row["acts"]["cover_ref"] = root
        rows.append(row)
    packed = dict(answer, items=rows, position_format=FORMAT, positions=positions)
    if byte_limit is not None:
        # Keep selected rows/cursors and markers. A one-row table can cost more
        # than the legacy shape; its overhead must not break the existing bound.
        from .contract import _json
        from .message_edit import plain
        if len(_json(plain(packed)).encode("utf-8")) > byte_limit:
            return answer
    return packed
