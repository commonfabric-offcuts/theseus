from __future__ import annotations

from dataclasses import dataclass
import grp
import os
from pathlib import Path
import stat
import uuid

from .profile import Profile, load_profile
from . import wake_adapter as adapter


class BrokerConfigError(adapter.RouteUnavailable):
    """Protected configuration cannot be used; not a storage/pin verdict."""


class BrokerBindingError(BrokerConfigError):
    def __init__(self):
        super().__init__('route_binding_changed')


@dataclass(frozen=True)
class BrokerConfig:
    config_path: str
    profile_path: str
    profile: Profile
    codex_executable: str
    destination: dict


def _require(value, code='invalid_broker_config'):
    if not value:
        raise BrokerConfigError(code)


def _path(value):
    try:
        value = os.fspath(value)
        _require(isinstance(value,str) and 0 < len(value.encode('utf-8')) <= 4096
                 and '\x00' not in value and Path(value).is_absolute())
        resolved = Path(value).resolve(strict=True)
        _require(str(resolved) == value)
        return value
    except (OSError,ValueError,TypeError,UnicodeError,RuntimeError) as error:
        raise BrokerConfigError('invalid_broker_config') from error


def _private(path):
    path = _path(path)
    try:
        value = adapter._read_route(path)
    except adapter.RouteUnavailable as error:
        raise BrokerConfigError('invalid_broker_config') from error
    _require(type(value) is dict)
    return path,value


def _executable(value):
    path = _path(value)
    try:
        _require(not stat.S_ISLNK(os.lstat(path).st_mode))
        # This keeps the existing regular/executable/owner/mode and trusted
        # parent-directory checks; generic route semantics are unchanged.
        _require(adapter._executable(path) == path)
    except (OSError,adapter.RouteUnavailable) as error:
        raise BrokerConfigError('invalid_executable') from error
    return path


def _codex_executable(value):
    """Selected installed child only; generic broker invocation stays strict.

    This installation trusts local administrators as well as root/the owner.
    The one reviewed writable ancestor is exactly root:admin /Applications
    with mode 040775. A firmlink spelling does not inherit that exception.
    """
    path = _path(value)
    try:
        info = os.lstat(path)
        _require(stat.S_ISREG(info.st_mode) and info.st_uid in (0,os.getuid())
                 and not info.st_mode & 0o022 and os.access(path,os.X_OK),
                 'invalid_executable')
        for parent in Path(path).parents:
            info = parent.stat()
            _require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0,os.getuid())
                     and not info.st_mode & 0o002,'invalid_executable')
            if info.st_mode & 0o020:
                _require(str(parent)=='/Applications' and info.st_mode==stat.S_IFDIR|0o775
                         and info.st_uid==0 and info.st_gid==grp.getgrnam('admin').gr_gid,
                         'invalid_executable')
    except (OSError,KeyError) as error:
        raise BrokerConfigError('invalid_executable') from error
    return path


def profile_binding(profile):
    return dict(instance_id=profile.instance_id,actor_id=profile.actor_id,
                db_path=str(profile.db_path),authority_id=profile.authority_id,
                authority_epoch=profile.authority_epoch)


def _destination(value):
    _require(type(value) is dict and set(value) == {
        'kind','protocol_version','codex_home','thread_id'})
    _require(value['kind']=='codex-queue-stdio' and type(value['protocol_version']) is int
             and value['protocol_version']==1)
    try:
        _require(isinstance(value['thread_id'],str)
                 and str(uuid.UUID(value['thread_id'])) == value['thread_id'])
    except (ValueError,TypeError,AttributeError) as error:
        raise BrokerConfigError('invalid_destination') from error
    root = _path(value['codex_home'])
    _require(Path(root).is_dir(),'invalid_destination')
    return dict(value,codex_home=root)


def load_config(path, *, expected_binding=None, profile_path=None):
    """Compare once and capture Core's returned pin; performs no effects.

    Core/Profile exceptions intentionally propagate with their typing/cause.
    The caller owns startup, post-claim and child-specific failure handling.
    """
    path,value = _private(path)
    _require(set(value)=={'v','profile','codex_executable','destination'}
             and type(value['v']) is int and value['v']==1)
    selected_profile = _path(value['profile'])
    if profile_path is not None and selected_profile != profile_path:
        raise BrokerBindingError()
    executable = _codex_executable(value['codex_executable'])
    destination = _destination(value['destination'])
    profile = load_profile(selected_profile)
    if expected_binding is not None and profile_binding(profile) != expected_binding:
        raise BrokerBindingError()
    pin = profile.store().read_route_pin(profile.actor_id,destination)
    # Do not reread the config, inherit ambient CODEX_HOME, or return the
    # caller-supplied destination after the authoritative comparison.
    return BrokerConfig(path,selected_profile,profile,executable,dict(pin['destination']))


def _route(path, selected_executable):
    path,value = _private(path)
    _require(set(value)=={'v','profile','argv'} and type(value['v']) is int and value['v']==1)
    profile = _path(value['profile'])
    argv = value['argv']
    _require(type(argv) is list and len(argv)==3 and argv[0]==selected_executable
             and argv[1]=='--config')
    _executable(argv[0])
    config = _path(argv[2])
    return path,profile,config


def preflight_route(path, actor_id, runner_profile, *, selected_executable, claim=None):
    """Selected Codex route only; missing files remain preparation refusals.

    A successful preflight is not a dispatch lease. The invocation layer must
    still validate its real guard and remaining claim/singleton lifetimes.
    """
    _require(adapter._identity(actor_id),'invalid_actor')
    selected_executable = _executable(selected_executable)
    path,profile_path,config_path = _route(path,selected_executable)
    expected = dict(profile_binding(runner_profile),actor_id=actor_id)
    if claim is not None:
        try:
            captured = adapter._claim(claim)
        except adapter.RouteUnavailable as error:
            raise BrokerBindingError() from error
        if captured != expected or claim['recipient_id'] != actor_id:
            raise BrokerBindingError()
    config = load_config(config_path,expected_binding=expected,profile_path=profile_path)
    # Authority path is not in the wire hint, but both explicit profiles name
    # it and the local parent must compare it as well.
    if config.profile.binding != runner_profile.binding:
        raise BrokerBindingError()
    return config


def load_route_map(path, runner_profile, *, selected_executable):
    """Validate the explicit startup map, then return immutable path choices.

    Dispatch must preflight its selected path again against its captured claim.
    There is no directory scan, route discovery or global pin uniqueness rule.
    """
    _,value = _private(path)
    _require(set(value)=={'v','routes'} and type(value['v']) is int and value['v']==1
             and type(value['routes']) is dict)
    selected_executable = _executable(selected_executable)
    routes,configs,destinations = set(),set(),set()
    result = {}
    for actor,path in value['routes'].items():
        _require(adapter._identity(actor),'invalid_actor')
        route,_,config_path = _route(path,selected_executable)
        _require(route not in routes,'duplicate_route')
        _require(config_path not in configs,'duplicate_config')
        routes.add(route);configs.add(config_path)
        config = preflight_route(route,actor,runner_profile,selected_executable=selected_executable)
        destination = (config.destination['codex_home'],config.destination['thread_id'])
        _require(destination not in destinations,'duplicate_destination')
        destinations.add(destination)
        result[actor] = route
    return result
