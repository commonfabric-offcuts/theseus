from __future__ import annotations

import unittest
import json
import subprocess
from unittest.mock import patch

from aim_next import Store
from aim_next.contract import LIMITS, _json
from aim_next.migrations import MigrationError, STEPS, migrate
from aim_next.store import StoreOpenError
from aim_next.workspace_links import LINK_SCHEMA, canonical_url
import test_store as fixtures


class OutcomeLinksCase(unittest.TestCase):
    setUp = fixtures.StoreCase.setUp
    command = fixtures.StoreCase.command
    sql = fixtures.StoreCase.sql
    workspace = fixtures.StoreCase.workspace

    def saved(self, url="https://example.test/work", title="Working page", removed=False,
              revision=0, actor="owner", workspace="w1", op=None):
        return self.command("workspace.link_set", {"url": url, "title": title, "removed": removed},
                            {"workspace_id": workspace}, {"link_revision": revision}, actor=actor, op=op)

    def read(self, actor="owner", workspace="w1", **args):
        return self.store.view(actor, "workspace_links", dict(args, workspace_id=workspace))

    def test_link_changes_keep_outcome_settings_and_list_identity_independent(self):
        self.workspace()
        before = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']
        list_keys = self.sql("SELECT key,value FROM metadata WHERE key LIKE 'outcome_list:%' ORDER BY key")
        start = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
        added = self.saved(actor='agent-b')
        self.assertEqual(added['status'], 'committed')
        self.assertEqual(self.saved(title='Teammate rename', revision=1, actor='agent-a')['status'], 'committed')
        self.assertEqual(self.saved(title='Teammate rename', removed=True, revision=2, actor='agent-b')['status'], 'committed')
        after_links = self.sql("SELECT key,value FROM metadata WHERE key LIKE 'outcome_list:%' ORDER BY key")
        # A real settings save retains the fence read before those three writes.
        edited = self.command('workspace.update', {'title': 'Owner settings kept'}, {'workspace_id': 'w1'},
                              {'workspace_revision': before['version']})
        self.assertEqual(edited['status'], 'committed', edited)
        self.assertEqual(edited['result']['version'], before['version'] + 1)
        seq = str(added['result']['link']['seq'])
        for scope in ('workspace',):
            changes = self.sql("SELECT resource_kind,resource_id,version FROM changes WHERE seq>? AND scope_kind=? AND scope_id='w1' AND resource_kind!='workspace' ORDER BY seq", (start, scope))
            self.assertEqual(changes, [('workspace_link', seq, version) for version in (1, 2, 3)])
        self.assertEqual(self.sql("SELECT resource_kind FROM changes WHERE seq>? AND scope_kind='outcome' AND scope_id='w1' AND resource_kind!='workspace'", (start,)), [])
        # Only the settings save can change its list hint; no Links write does.
        self.assertEqual(after_links, list_keys)
        mark = self.sql('SELECT max(seq) FROM changes')[0][0]
        self.assertFalse(self.saved(title='Teammate rename', removed=True, revision=3)['result']['changed'])
        self.assertEqual(self.sql('SELECT max(seq) FROM changes')[0][0], mark)

    def test_distinct_link_rows_share_no_change_identity_and_replay_emits_nothing(self):
        self.workspace()
        conversation = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        scopes = [{'kind': 'workspace', 'id': 'w1'}]
        checkpoints = [self.store.view('owner', 'changes', {'scope': scope})['checkpoint'] for scope in scopes]
        first = self.saved(op='first-link')
        second = self.saved(url='https://second.test/', op='second-link')
        first_id, second_id = (str(result['result']['link']['seq']) for result in (first, second))
        self.assertNotEqual(first_id, second_id)
        for scope, checkpoint in zip(scopes, checkpoints):
            page = self.store.view('owner', 'changes', {'scope': scope, 'cursor': checkpoint})
            self.assertEqual([(item['resource_kind'], item['resource_id'], item['version']) for item in page['items']],
                             [('workspace_link', first_id, 1), ('workspace_link', second_id, 1)])
        end = self.sql('SELECT max(seq) FROM changes')[0][0]
        self.assertEqual(self.saved(op='first-link'), first)
        self.assertEqual(self.sql('SELECT max(seq) FROM changes')[0][0], end)

    def test_link_activity_never_reaches_team_or_topic_only_topic_changes(self):
        self.workspace()
        self.sql("INSERT INTO topics(id,workspace_id,title,creator_id,version) VALUES ('topic-only','w1','Only topic','agent-b',1)")
        self.sql("INSERT INTO topic_participants(topic_id,actor_id,active,epoch) VALUES ('topic-only','agent-b',1,1)")
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='agent-b'")
        scope = {'kind': 'topic', 'id': 'topic-only'}
        cursors = {actor: self.store.view(actor, 'changes', {'scope': scope})['checkpoint'] for actor in ('owner', 'agent-b')}
        self.assertEqual(self.read('agent-b')['error']['code'], 'FORBIDDEN')
        self.saved(actor='agent-a')
        self.saved(title='Team-only rename', revision=1, actor='agent-a')
        self.saved(title='Team-only rename', revision=2, removed=True, actor='agent-a')
        for actor, cursor in cursors.items():
            page = self.store.view(actor, 'changes', {'scope': scope, 'cursor': cursor})
            self.assertEqual(page['items'], [], 'strict old topic consumers and denied Link readers see no Link key')

    def test_host_refusal_explains_contextual_joiner_limit_without_credentials_blame(self):
        self.workspace()
        href = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(new URL('http://نامه\\u200cای.com/').href))"], text=True))
        refusal = self.saved(url=href)['error']
        self.assertEqual(refusal['code'], 'INVALID_ARGUMENT')
        self.assertRegex(refusal['message'], 'host|joiner')
        self.assertNotRegex(refusal['message'], 'username|password')

    def test_browser_rtl_digit_alabel_supports_add_rename_and_remove(self):
        self.workspace()
        href = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(new URL('http://مثال1.com/').href))"], text=True))
        self.assertEqual(href, 'http://xn--1-ymcl5hc.com/')
        self.assertEqual(canonical_url(href), href)
        for version, title, removed in [(0, 'RTL site', False), (1, 'Renamed RTL site', False), (2, 'Renamed RTL site', True)]:
            result = self.saved(url=href, title=title, revision=version, removed=removed)
            self.assertEqual(result['status'], 'committed', result)
            self.assertEqual(result['result']['link']['url'], href)
        self.assertEqual(self.read()['items'][0]['revision'], 3)

    def test_title_refusal_explains_invisible_or_control_characters(self):
        self.workspace()
        for title in ['Copied\ttitle', 'Copied\u200etitle']:
            result = self.saved(title=title)
            self.assertEqual(result['error']['code'], 'INVALID_ARGUMENT')
            self.assertRegex(result['error']['message'], 'control|direction|invisible|tab')

    def test_browser_href_is_a_core_fixed_point_for_url_components(self):
        # Independent browser URL implementation, not a copy of Core's encoder.
        script = r"""
const inputs = ['https://host/?', 'https://host/#', 'https://host/?#'];
const chars = Array.from({length:94}, (_,n)=>String.fromCharCode(n+33)).filter(c=>c!=='\\');
for(const c of chars.concat(['界','ß','☕','😀','%2f','%','%zz']))
  for(const prefix of ['https://host/a','https://host/?q=','https://host/#f']) inputs.push(prefix+c+'z');
for(const host of ['xn--fa-hia.de','xn--53h.example','مثال1.com','مثال١.com','אחד2.com','אחד٢.com','127.0.0.1','[2001:db8::1]','host..','_srv.host','-host','host-'])
  for(const suffix of ['/?ids[]=1','/docs/[slug]','/?{}|^`','/#a#b','/?','#']) inputs.push('https://'+host+suffix);
let seed=15423;
for(let n=0;n<512;n++) {let word='';for(let j=0;j<24;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;word+=chars[seed%chars.length];}inputs.push('https://host/'+word+'?'+word+'#'+word);}
console.log(JSON.stringify([...new Set(inputs.map(raw=>new URL(raw).href))]));
"""
        hrefs = json.loads(subprocess.check_output(["node", "-e", script], text=True))
        differences = []
        for href in hrefs:
            try:
                actual = canonical_url(href)
            except Exception as error:
                actual = type(error).__name__ + ': ' + str(error)
            if actual != href:
                differences.append((href, actual))
        self.assertEqual(differences[:12], [], "%d browser/Core spelling differences" % len(differences))
        self.assertGreater(len(hrefs), 800)

    def test_browser_invalid_hosts_never_poison_saved_collection(self):
        self.workspace()
        self.saved()
        invalid = ['999.1.1.1', '1.2.3.4.5', 'a<b', 'a>b', 'a|b', 'a^b', 'a[b',
                   'host.123', '1.2.3.256', '0x100000000', '09', 'xn--', 'xn--a',
                   'a%00b', 'a%3Cb', '[fe80::1%25en0]']
        for host in invalid:
            with self.subTest(host=host):
                self.assertEqual(self.saved(url='http://'+host+'/').get('error', {}).get('code'), 'INVALID_ARGUMENT')
        self.assertEqual(len(self.read()['items']), 1)
        # Browser-valid IPv4 variants are retained as their canonical host.
        for raw, href in [('127.1','127.0.0.1'), ('0x7f.1','127.0.0.1'), ('0177.0.0.1','127.0.0.1'), ('2130706433','127.0.0.1')]:
            self.assertEqual(canonical_url('http://'+raw+'/'), 'http://'+href+'/')

    def test_title_controls_and_direction_marks_refuse_without_a_partial_row(self):
        self.workspace()
        for char in ['\n', '\t', '\x00', '\x7f', '\x85', '\u061c', '\u200e', '\u200f', '\u202a', '\u202e', '\u2066', '\u2069']:
            with self.subTest(char=repr(char)):
                self.assertEqual(self.saved(title='Before'+char+'after').get('error', {}).get('code'), 'INVALID_ARGUMENT')
        self.assertEqual(self.read()['items'], [])

    def test_scope_is_outcome_team_and_never_topic_only_or_coordinator_only(self):
        self.workspace()
        self.assertEqual(self.saved(actor="agent-b")["status"], "committed")
        # Isolated access fixtures retain a topic grant but remove outcome access.
        self.sql("INSERT INTO topics(id,workspace_id,title,creator_id,version) VALUES ('topic-only','w1','Only topic','agent-b',1)")
        self.sql("INSERT INTO topic_participants(topic_id,actor_id,active,epoch) VALUES ('topic-only','agent-b',1,1)")
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id IN ('agent-a','agent-b')")
        self.assertEqual(self.read("agent-a")["error"]["code"], "FORBIDDEN", "coordinator alone does not grant reading")
        self.assertEqual(self.read("agent-b")["error"]["code"], "FORBIDDEN", "topic participation is narrower")
        for actor in ("agent-a", "agent-b"):
            self.assertEqual(self.saved(revision=1, actor=actor)["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.sql("SELECT revision FROM workspace_links"), [(1,)])

    def test_current_row_revision_prevents_overwrite_and_replay_preserves_old_receipt(self):
        self.workspace()
        first = self.saved(op="first")
        second = self.saved(title="New title", revision=1)
        self.assertEqual(second["result"]["link"]["revision"], 2)
        self.assertEqual(self.saved(op="first"), first)
        refused = self.saved(title="Stale title", revision=1)
        self.assertEqual(refused["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(self.read()["items"][0]["title"], "New title")
        self.assertFalse(self.saved(title="New title", revision=2)["result"]["changed"])
        self.assertEqual(self.read()["items"][0]["revision"], 2)

    def test_removed_preview_override_is_shared_retained_and_can_be_restored(self):
        self.workspace()
        self.assertEqual(self.saved(removed=True)["status"], "committed")
        self.assertTrue(self.read("agent-a")["items"][0]["removed"])
        self.assertEqual(self.saved(revision=1)["status"], "committed")
        self.assertFalse(self.read("agent-b")["items"][0]["removed"])

    def test_authority_missing_revision_and_closed_outcome_keep_records(self):
        self.workspace()
        self.saved()
        args = {"url": "https://example.test/work", "title": "Late", "removed": True}
        missing = self.command("workspace.link_set", args, {"workspace_id": "w1"})
        self.assertEqual(missing["error"]["code"], "INVALID_ARGUMENT")
        envelope = {"v": 1, "instance_id": "test-instance", "operation_id": "old-authority",
                    "kind": "workspace.link_set", "target": {"workspace_id": "w1"}, "args": args,
                    "expected": {"link_revision": 1, "authority": dict(self.pin, authority_epoch="retired")}}
        self.assertEqual(self.store.command("owner", envelope)["error"]["code"], "AUTHORITY_CHANGED")
        current = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        ended = self.command("outcome.end_set", {"state": "archived"}, {"workspace_id": "w1"}, {"workspace_revision": current})
        self.assertEqual(ended["status"], "committed", ended)
        self.assertFalse(self.read()["reader_may_write"])
        self.assertEqual(self.saved(title="Late", revision=1)["status"], "rejected")
        self.assertEqual(self.read()["items"][0]["title"], "Working page")

    def test_canonical_url_validation_bounds_and_no_partial_rows(self):
        self.workspace()
        first = self.saved(url="HTTPS://Example.TEST:443", title="  Home  ")
        self.assertEqual(first["result"]["link"]["url"], "https://example.test/")
        self.assertEqual(first["result"]["link"]["title"], "Home")
        invalid = ["javascript:alert(1)", "file:///tmp/x", "https://user:secret@example.test/", "https://",
                   "https://example.test/x\ny", "https://example.test/x y", "https://example.test/\\x", "http://example.test:bad"]
        for url in invalid:
            with self.subTest(url=url):
                self.assertEqual(self.saved(url=url)["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.saved(title="界" * 500)["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(len(self.read()["items"]), 1)
        self.assertEqual(self.store.view("owner", "capabilities", {})["limits"]["workspace_links"], LIMITS["workspace_links"])

    def test_scoped_pages_byte_budget_and_limit_include_tombstones(self):
        self.workspace()
        for n in range(6):
            self.assertEqual(self.saved(url="https://example.test/%d" % n, title="界" * 200, removed=n == 0)["status"], "committed")
        seen, cursor = [], None
        with patch.dict(LIMITS, summary_utf8_bytes=1900):
            for _ in range(8):
                page = self.read(limit=3, **({"cursor": cursor} if cursor is not None else {}))
                self.assertLessEqual(len(_json(page).encode("utf-8")), 1900)
                seen.extend(row["url"] for row in page["items"])
                cursor = page["next_cursor"]
                if cursor is None:
                    break
        self.assertEqual(len(set(seen)), 6)
        with patch.dict(LIMITS, workspace_links=6):
            self.assertEqual(self.saved(url="https://example.test/seventh")["error"]["code"], "TOO_MANY_LINKS")
        for args in ({"actor": "agent-b"}, {"limit": 0}, {"cursor": True}):
            self.assertEqual(self.store.view("owner", "workspace_links", dict(args, workspace_id="w1"))["error"]["code"], "INVALID_ARGUMENT")

    def test_migration_roundtrip_is_explicit_and_occupied_downgrade_keeps_rows(self):
        self.workspace()
        step = next(step for step in STEPS if step[2] is LINK_SCHEMA)
        self.assertEqual(step[:2], ("65", "66"))
        self.assertTrue(migrate(self.path, "test-instance", self.binding, target="65")["migrated"])
        with self.assertRaises(StoreOpenError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("65",)])
        self.assertTrue(migrate(self.path, "test-instance", self.binding, target="66")["migrated"])
        self.assertEqual(self.saved(removed=True)["status"], "committed")
        before = self.sql("SELECT * FROM workspace_links"), self.sql("SELECT * FROM metadata ORDER BY key")
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding, target="65")
        self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual((self.sql("SELECT * FROM workspace_links"), self.sql("SELECT * FROM metadata ORDER BY key")), before)

    def test_an_added_link_is_core_kept_shared_and_replayed_once(self):
        self.workspace()
        first = self.command("workspace.link_set", {
            "url": "https://example.test/work", "title": "Working page", "removed": False,
        }, {"workspace_id": "w1"}, {"link_revision": 0}, op="one-shared-link")
        self.assertEqual(first["status"], "committed", first)
        reopened = Store(self.path, "test-instance", expected_binding=self.binding)
        answer = reopened.view("agent-b", "workspace_links", {"workspace_id": "w1", "limit": 20})
        self.assertNotIn("error", answer, answer)
        self.assertEqual([(row["url"], row["title"], row["revision"], row["removed"])
                          for row in answer["items"]],
                         [("https://example.test/work", "Working page", 1, False)])
        self.assertTrue(answer["reader_may_write"])
        self.assertEqual(self.command("workspace.link_set", {
            "url": "https://example.test/work", "title": "Working page", "removed": False,
        }, {"workspace_id": "w1"}, {"link_revision": 0}, op="one-shared-link"), first)
        self.assertEqual(self.sql("SELECT count(*) FROM workspace_links WHERE workspace_id='w1'"), [(1,)])


if __name__ == "__main__":
    unittest.main()
