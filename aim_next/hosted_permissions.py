from __future__ import annotations

"""The host-authored native Codex permission profile (662)."""

import hashlib
import json
import os
from pathlib import Path
import pwd
import tempfile


PROXY_SENTINEL = 'theseus-proxy-denied\n'
PROXY_PROBE = '''import os,socket,sys,urllib.request,urllib.error,urllib.parse
proxy=os.environ.get('HTTP_PROXY')
if not proxy or urllib.parse.urlsplit(proxy).hostname not in ('localhost','127.0.0.1','::1'): sys.exit(10)
try: socket.create_connection(('127.0.0.1',9),0.5)
except PermissionError: pass
except OSError: sys.exit(11)
else: sys.exit(12)
urllib.request.proxy_bypass=lambda host:False
try: urllib.request.build_opener(urllib.request.ProxyHandler({'http':proxy})).open('http://localhost:9/',timeout=1)
except urllib.error.HTTPError as error:
 if error.code!=403: sys.exit(13)
except Exception: sys.exit(14)
else: sys.exit(15)
print('theseus-proxy-denied')
'''


def _toml(value):
    if type(value) is dict:
        return '{' + ','.join(json.dumps(key) + '=' + _toml(item) for key, item in value.items()) + '}'
    return json.dumps(value)


def startup_overrides(profiles):
    return ('-c', 'features.network_proxy=true', '-c', 'default_permissions=":read-only"',
            '-c', 'permissions=' + _toml(profiles)) if profiles else ()


def proxy_configuration(result, name, policy):
    if type(result) is not dict or type(result.get('config')) is not dict:
        return False
    config = result['config']
    if type(config.get('permissions')) is not dict or type(config.get('features')) is not dict:
        return False
    selected = config['permissions'].get(name)
    if type(selected) is not dict or type(selected.get('network')) is not dict or type(selected.get('filesystem')) is not dict:
        return False
    network = selected['network']
    filesystem = dict(selected['filesystem'])
    # The native config response includes this optional non-path metadata.
    if filesystem.get('glob_scan_max_depth') is None:
        filesystem.pop('glob_scan_max_depth', None)
    return (config.get('features', {}).get('network_proxy') is True
            and selected.get('extends') == ':workspace' and filesystem == policy['filesystem']
            and network.get('enabled') is True and network.get('domains', {}) == {}
            and network.get('unix_sockets', {}) == policy['network']['unix_sockets']
            and not any(network.get(key) for key in ('allow_local_binding', 'dangerously_allow_all_unix_sockets',
                                                     'dangerously_allow_non_loopback_proxy')))


def proxy_probe(name, cwd):
    return dict(command=['/usr/bin/python3', '-I', '-c', PROXY_PROBE], cwd=cwd,
                permissionProfile=name, timeoutMs=3000, outputBytesCap=1024)


def proxy_result(result, error):
    return (error is None and type(result) is dict and type(result.get('exitCode')) is int
            and result['exitCode'] == 0 and result.get('stdout') == PROXY_SENTINEL)


def credential_roots(config):
    canonical = lambda value: os.path.realpath(str(value))
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    profiles = Path(canonical(Path(config.profile_path).parent))
    instance_roots = {str(profiles), canonical(config.profile.db_path.parent)}
    instance_roots.update(str(parent) for parent in profiles.parents if parent.name == 'instances')
    codex_home = canonical(config.destination['codex_home'])
    credentials = {canonical(home / name) for name in ('.codex', '.config', '.ssh', '.aws', '.kube', 'Library/Keychains')}
    credentials.add(codex_home)
    credentials.add(canonical(home / '.local/share/theseus/codex-home'))
    credentials.update(canonical(path) for path in getattr(config, 'protected_homes', ()))
    credentials.add(canonical(config.profile.authority_path))
    return instance_roots, credentials


def validate_workspace(config, socket_path=None):
    canonical = lambda value: os.path.realpath(str(value))
    instance_roots, credentials = credential_roots(config)
    cwd = canonical(config.cwd)
    broker_path = socket_path or os.path.join('/private/tmp' if os.path.isdir('/private/tmp') else tempfile.gettempdir(),
                                              'theseus-core-placeholder/core.sock')
    if os.path.commonpath([cwd, canonical(broker_path)]) == cwd:
        raise ValueError('work_directory_reaches_broker')
    for root in instance_roots | credentials:
        if os.path.commonpath([cwd, root]) == cwd or root in credentials and os.path.commonpath([cwd, root]) == root:
            raise ValueError('work_directory_reaches_credentials')


def permission_profile(config, socket_path):
    canonical = lambda value: os.path.realpath(str(value))
    instance_roots, credentials = credential_roots(config)
    validate_workspace(config, socket_path)
    cwd = canonical(config.cwd)
    profiles = Path(canonical(Path(config.profile_path).parent))
    filesystem = {root: 'deny' for root in instance_roots | credentials}
    # Override the inherited symbolic grants themselves. An absolute read rule
    # at the same resolved path loses to :workspace's inherited temp write rule.
    filesystem.update({':slash_tmp': 'read', ':tmpdir': 'read',
                       canonical(config.profile.db_path): 'deny', str(profiles / (config.profile.actor_id + '.outbox')): 'write',
                       cwd: 'write', canonical(socket_path): 'read'})
    # Codex activates its Unix allowlist only with the network policy enabled.
    # The caller also enables the proxy: no allowed domains means no outbound
    # hosts, while this one local socket remains reachable.
    policy = {'extends': ':workspace', 'filesystem': filesystem,
              'network': {'enabled': True, 'domains': {}, 'unix_sockets': {socket_path: 'allow'}}}
    identity = hashlib.sha256(json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:24]
    return 'theseus-' + identity, policy
