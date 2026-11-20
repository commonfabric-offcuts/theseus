from __future__ import annotations

"""The host-authored native Codex permission profile (662)."""

import hashlib
import json
import os
from pathlib import Path
import pwd


def permission_profile(config, socket_path):
    canonical = lambda value: os.path.realpath(str(value))
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    profiles = Path(canonical(Path(config.profile_path).parent))
    instance_roots = {str(profiles), canonical(config.profile.db_path.parent)}
    instance_roots.update(str(parent) for parent in profiles.parents if parent.name == 'instances')
    codex_home = canonical(config.destination['codex_home'])
    credentials = {canonical(home / name) for name in ('.codex', '.config', '.ssh', '.aws', '.kube', 'Library/Keychains')}
    credentials.add(codex_home)
    credentials.add(canonical(config.profile.authority_path))
    cwd = canonical(config.cwd)
    if os.path.commonpath([cwd, canonical(socket_path)]) == cwd:
        raise ValueError('work_directory_reaches_broker')
    for root in instance_roots | credentials:
        if os.path.commonpath([cwd, root]) == cwd or root in credentials and os.path.commonpath([cwd, root]) == root:
            raise ValueError('work_directory_reaches_credentials')
    filesystem = {root: 'deny' for root in instance_roots | credentials}
    # Override the inherited symbolic grants themselves. An absolute read rule
    # at the same resolved path loses to :workspace's inherited temp write rule.
    filesystem.update({':slash_tmp': 'read', ':tmpdir': 'read',
                       canonical(config.profile.db_path): 'read', str(profiles / (config.profile.actor_id + '.outbox')): 'write',
                       cwd: 'write', canonical(socket_path): 'read'})
    # Codex activates its Unix allowlist only with the network policy enabled.
    # The caller also enables the proxy: no allowed domains means no outbound
    # hosts, while this one local socket remains reachable.
    policy = {'extends': ':workspace', 'filesystem': filesystem,
              'network': {'enabled': True, 'domains': {}, 'unix_sockets': {socket_path: 'allow'}}}
    identity = hashlib.sha256(json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:24]
    return 'theseus-' + identity, policy
