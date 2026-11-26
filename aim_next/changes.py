from __future__ import annotations

from .contract import LIMITS, Refusal, _identifier, _json, _page_size


_CURSOR_FIELDS = {"v", "kind", "instance_id", "authority_id", "authority_epoch",
                  "actor_id", "scope", "after_seq"}


def _scope(value):
    if (not isinstance(value, dict) or set(value) != {"kind", "id"}
            or value["kind"] not in ("actor", "topic", "workspace")):
        raise Refusal("INVALID_ARGUMENT", "One exact actor, topic or workspace scope is required")
    _identifier(value["id"], "scope id")
    return dict(value)


def _position(value):
    if type(value) is not int or not 0 <= value <= 9223372036854775807:
        raise Refusal("INVALID_ARGUMENT", "Invalid change position")
    return value


def _cursor(value):
    if not isinstance(value, dict):
        raise Refusal("INVALID_ARGUMENT", "Invalid changes cursor")
    kind = value.get("kind")
    fields = _CURSOR_FIELDS | ({"through_seq", "covered_versions"} if kind == "continuation" else set())
    if (set(value) != fields or kind not in ("checkpoint", "continuation")
            or type(value["v"]) is not int or value["v"] != 1):
        raise Refusal("INVALID_ARGUMENT", "Invalid changes cursor fields")
    for key in ("instance_id", "authority_id", "authority_epoch", "actor_id"):
        _identifier(value[key], key)
    scope = _scope(value["scope"])
    _position(value["after_seq"])
    if kind == "continuation":
        if _position(value["through_seq"]) < value["after_seq"]:
            raise Refusal("INVALID_ARGUMENT", "Invalid changes window")
        versions = value["covered_versions"]
        keys = set() if scope["kind"] == "actor" else {scope["kind"], "notebook"}
        if not isinstance(versions, dict) or set(versions) != keys:
            raise Refusal("INVALID_ARGUMENT", "Invalid changes window versions")
        for version in versions.values():
            _position(version)
    return value


class Changes:
    def _change_access(self, db, actor, scope):
        """The scope's versions, and the scopes its keys are read from: a topic's own,
        and its outcome's record keys (Store._outcome_change)."""
        if scope["kind"] == "actor":
            if scope["id"] != actor:
                raise Refusal("FORBIDDEN", "Only your own private changes are readable")
            return {}, [scope]
        if scope["kind"] == "topic":
            record = self._topic(db, actor, scope["id"])
            return {"topic": record["version"]}, [scope, {"kind": "outcome", "id": record["workspace_id"]}]
        record = self._workspace(db, actor, scope["id"])
        return {"workspace": record["version"]}, [scope]

    def _view_changes(self, db, actor, args):
        if "windows" in args:
            return self._page_change_windows(db, actor, args)
        if set(args) - {"scope", "cursor", "limit"}:
            raise Refusal("INVALID_ARGUMENT", "Use one exact scope or a bounded set of windows")
        scope, limit = _scope(args.get("scope")), _page_size(args)
        cursor = _cursor(args["cursor"]) if "cursor" in args else None
        identity = dict(v=1, instance_id=self.instance_id, actor_id=actor, scope=scope,
                        authority_id=self.binding["authority_id"], authority_epoch=self.binding["authority_epoch"])
        if cursor is not None and any(cursor[key] != value for key, value in identity.items()):
            raise Refusal("RESYNC_REQUIRED", "Changes cursor belongs to another actor, scope or authority; explicitly reload this scope")
        # Every continuation rechecks current access. A cursor never grants it.
        versions, sources = self._change_access(db, actor, scope)
        # The global right edge is constant work even for an empty scope.
        # AUTOINCREMENT and transaction-local _change writes prevent seq reuse
        # or publication after an already observed committed upper boundary.
        head = db.execute("SELECT coalesce(max(seq),0) FROM changes").fetchone()[0]
        if cursor is not None and max(cursor["after_seq"], cursor.get("through_seq", 0)) > head:
            raise Refusal("RESYNC_REQUIRED", "Changes cursor is ahead of this history; explicitly reload this scope")
        if scope["kind"] != "actor":
            notebook = db.execute("SELECT version FROM memory_notebooks WHERE scope_kind=? AND scope_id=?",
                                  (scope["kind"], scope["id"])).fetchone()
            versions["notebook"] = notebook[0] if notebook else 0
        upper = cursor["through_seq"] if cursor is not None and cursor["kind"] == "continuation" else head
        if cursor is not None and cursor["kind"] == "continuation":
            versions = dict(cursor["covered_versions"])

        def response(items, more=False):
            continuation = (dict(identity, kind="continuation", after_seq=items[-1]["seq"],
                                 through_seq=upper, covered_versions=versions) if more else None)
            return {"instance_id": self.instance_id, "scope": scope, "baseline": cursor is None,
                    "items": list(items), "has_more": more, "continuation": continuation,
                    "checkpoint": None if more else dict(identity, kind="checkpoint", after_seq=upper),
                    "covered_versions": None if more else versions}

        if cursor is None:
            return response([])
        # No retention/pruning exists. Global gaps and a zero/old position are
        # valid; a future pruning feature must persist an explicit history floor.
        # Each source is read in its own index range, so a page still reads at most
        # limit + 1 keys from each; the first limit + 1 of them all are a page's.
        rows = sorted((row for source in sources for row in db.execute(
            "SELECT seq,resource_kind,resource_id,version FROM changes WHERE scope_kind=? AND scope_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?",
            (source["kind"], source["id"], cursor["after_seq"], upper, limit + 1)).fetchall()), key=lambda row: row["seq"])[:limit + 1]
        items = []
        for row in rows[:limit]:
            items.append(dict(row))
            candidate = response(items, len(rows) > len(items))
            if len(_json(candidate).encode("utf-8")) > LIMITS["summary_utf8_bytes"]:
                items.pop()
                if not items:
                    raise Refusal("VIEW_TOO_LARGE", "A change key cannot fit in the bounded response")
                return response(items, True)
        return response(items, len(rows) > len(items))

    def _page_change_windows(self, db, actor, args):
        """One snapshot of explicitly named canonical scopes, with changed rail rows.

        Total selected keys stay within one normal page. Each continuation
        remains its scope's exact, independently reauthorized fixed window.
        No records or private keys are returned if any scope refuses.
        """
        windows = args.get('windows')
        if (set(args) - {'windows', 'limit', 'project'} or type(windows) is not list
                or not 1 <= len(windows) <= LIMITS['page_max'] or type(args.get('project', False)) is not bool):
            raise Refusal('INVALID_ARGUMENT', 'Name one bounded set of change windows')
        seen = set()
        for window in windows:
            if type(window) is not dict or set(window) not in ({'scope'}, {'scope','cursor'}):
                raise Refusal('INVALID_ARGUMENT', 'Use an exact scope and its original cursor')
            scope = _scope(window['scope'])
            key = (scope['kind'], scope['id'])
            if key in seen:
                raise Refusal('INVALID_ARGUMENT', 'Name each change scope once')
            seen.add(key)
        limit = min(_page_size(args), max(1, LIMITS['page_max'] // len(windows)))
        pages = [self._view_changes(db, actor, dict(window, limit=limit)) for window in windows]
        answer = dict(instance_id=self.instance_id, windows=pages, topics=[], counts=[], affected_topics=[], attention_changed=False)
        if args.get('project'):
            personal = [item for page in pages if page['scope']['kind']=='actor' for item in page['items']]
            answer['attention_changed'] = any(item['resource_kind'] in ('waiting','participation','question','withdrawal') for item in personal)
            deliveries = sorted({item['resource_id'] for item in personal if item['resource_kind']=='delivery'})
            affected = set()
            if deliveries:
                for row in db.execute('SELECT d.topic_id,EXISTS(SELECT 1 FROM delivery_reasons r WHERE r.delivery_id=d.id '
                                      "AND r.reason!='subscription') AS direct FROM deliveries d WHERE d.recipient_id=? AND d.id IN (%s)"
                                      % ','.join('?'*len(deliveries)), (actor,)+tuple(deliveries)):
                    affected.add(row['topic_id'])
                    answer['attention_changed'] |= bool(row['direct'])
            messages = sorted({item['resource_id'] for item in personal if item['resource_kind'] in ('mark','source_cover_read')})
            if messages:
                affected.update(row[0] for row in db.execute('SELECT topic_id FROM messages WHERE id IN (%s)' % ','.join('?'*len(messages)), tuple(messages)))
            changed = {item['resource_id'] for page in pages if page['scope']['kind']=='workspace'
                       for item in page['items'] if item['resource_kind']=='topic'}
            spaces = {page['scope']['id'] for page in pages if page['scope']['kind']=='workspace'}
            if affected:
                affected = {row['id'] for row in db.execute('SELECT id,workspace_id FROM topics WHERE id IN (%s)' % ','.join('?'*len(affected)), tuple(sorted(affected))) if row['workspace_id'] in spaces}
                changed.update(affected)
                answer['affected_topics'] = sorted(affected)
            if not answer['attention_changed'] and (deliveries or messages):
                totals = self._unread(db, actor)
                answer['attention_counts'] = dict(commit_seq=int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0]),
                                                 unread=sum(row[0] for row in totals.values()),
                                                 addressed=sum(row[1] for row in totals.values()))
            if changed:
                from .store import _TOPIC_SUMMARY
                # The IDs came only from authorized workspace scopes, but a
                # projection still checks current topic access before reading.
                for ident in changed:
                    self._topic(db, actor, ident)
                rows = db.execute('SELECT t.*,s.message_count,m.seq AS latest_seq FROM topics t ' + _TOPIC_SUMMARY +
                                  'WHERE t.id IN (%s)' % ','.join('?'*len(changed)), tuple(sorted(changed))).fetchall()
                workspaces = sorted({row['workspace_id'] for row in rows})
                builds = set().union(*(self._build_topics(db, ident) for ident in workspaces))
                answer['topics'] = self._topic_items(db, actor, rows, builds)
                answer['counts'] = self._view_workspace_counts(db, actor, {'workspace_ids':workspaces})['items'] if workspaces else []
        if len(_json(answer).encode('utf-8')) > LIMITS['summary_utf8_bytes']:
            raise Refusal('VIEW_TOO_LARGE', 'These change windows and rows exceed the bounded page; retain their cursors')
        return answer
