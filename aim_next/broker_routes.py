from __future__ import annotations

from dataclasses import dataclass
import grp
import os
import pwd
from pathlib import Path
import stat
import uuid

from .profile import Profile, load_profile
from .route_pins import HOSTED_KIND, QUEUE_KIND, RoutePinError
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


@dataclass(frozen=True)
class HostedConfig:
    config_path: str
    profile_path: str
    profile: Profile
    cli: str
    codex_executable: str
    destination: dict
    cwd: str
    model: object
    writable_roots: tuple
    permission_mode: str = "workspace"
    reasoning_effort: object = None
    instructions: str = ""
    protected_homes: tuple = ()


HOSTED_FIELDS = frozenset(('v','kind','actor_id','profile','cli','codex_executable','codex_home',
                           'thread_id','cwd','model','writable_roots'))
HOSTED_V2_FIELDS = HOSTED_FIELDS | {'permission_mode', 'reasoning_effort', 'instructions'}


def hosted_options(permission_mode, reasoning_effort, instructions):
    _require(permission_mode in ('workspace', 'full'), 'invalid_permission_mode')
    _require(reasoning_effort is None or reasoning_effort in ('low', 'medium', 'high', 'xhigh'), 'invalid_reasoning_effort')
    _require(isinstance(instructions, str) and len(instructions.encode('utf-8')) <= 16384 and '\x00' not in instructions,
             'invalid_instructions')
    return permission_mode, reasoning_effort, instructions


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


def _codex_executable(value, applications=None):
    """Selected installed child only; generic broker invocation stays strict.

    This installation trusts local administrators as well as root/the owner.
    The one reviewed writable ancestor is exactly root:admin /Applications
    with mode 040775. A firmlink spelling does not inherit that exception.
    applications=(path, uid, gid) names that ancestor in place of the real one.
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
                folder,owner,group = applications or ('/Applications',0,grp.getgrnam('admin').gr_gid)
                _require(str(parent)==folder and info.st_mode==stat.S_IFDIR|0o775
                         and info.st_uid==owner and info.st_gid==group,
                         'invalid_executable')
    except (OSError,KeyError) as error:
        raise BrokerConfigError('invalid_executable') from error
    return path


def profile_binding(profile):
    return dict(instance_id=profile.instance_id,actor_id=profile.actor_id,
                db_path=str(profile.db_path),authority_id=profile.authority_id,
                authority_epoch=profile.authority_epoch)


def _destination(value, kind=QUEUE_KIND):
    _require(type(value) is dict and set(value) == {
        'kind','protocol_version','codex_home','thread_id'})
    _require(value['kind']==kind and type(value['protocol_version']) is int
             and value['protocol_version']==1)
    try:
        _require(isinstance(value['thread_id'],str)
                 and str(uuid.UUID(value['thread_id'])) == value['thread_id'])
    except (ValueError,TypeError,AttributeError) as error:
        raise BrokerConfigError('invalid_destination') from error
    root = value['codex_home']
    try:
        _require(adapter._absolute(root) and 0<len(root.encode('utf-8'))<=4096,
                 'invalid_destination')
    except UnicodeError as error:
        raise BrokerConfigError('invalid_destination') from error
    # Core resolves the supplied root and compares it with the immutable pin.
    # Missing/replaced roots must retain its typed pin refusal, not become
    # ordinary configuration absence before the parent can classify them.
    return dict(value,codex_home=root)


def load_config(path, *, expected_binding=None, profile_path=None):
    """Compare once and capture Core's returned pin; performs no effects.

    Core/Profile exceptions intentionally propagate with their typing/cause.
    The caller owns startup, post-claim and child-specific failure handling.
    The installed Codex is always checked against the real /Applications.
    """
    return _load_config(path, expected_binding=expected_binding, profile_path=profile_path)


def _load_config(path, *, expected_binding=None, profile_path=None, applications=None):
    """load_config, with applications=(path, uid, gid) standing for /Applications; tests only."""
    path,value = _private(path)
    _require(set(value)=={'v','profile','codex_executable','destination'}
             and type(value['v']) is int and value['v']==1)
    selected_profile = _path(value['profile'])
    if profile_path is not None and selected_profile != profile_path:
        raise BrokerBindingError()
    executable = _codex_executable(value['codex_executable'],applications)
    destination = _destination(value['destination'])
    profile = load_profile(selected_profile)
    if expected_binding is not None and profile_binding(profile) != expected_binding:
        raise BrokerBindingError()
    pin = profile.store().read_route_pin(profile.actor_id,destination)
    # Do not reread the config, inherit ambient CODEX_HOME, or return the
    # caller-supplied destination after the authoritative comparison.
    return BrokerConfig(path,selected_profile,profile,executable,dict(pin['destination']))


def writable_roots(profile_path, profile):
    """Legacy config roots, retained to validate existing pinned route files.

    Workspace execution uses hosted_permissions' narrower native profile:
    only cwd/outbox writes and denied store/credential roots.
    The database-directory entry here is never sent as an execution grant.
    """
    return (str(profile.db_path.parent), str(Path(profile_path).parent/(profile.actor_id+'.outbox')))


def desktop_codex_home():
    """The owner's own Codex home, from the password database rather than $HOME, so an altered environment cannot hide it."""
    return os.path.realpath(os.path.join(pwd.getpwuid(os.getuid()).pw_dir, '.codex'))


def hosted_home(value):
    """A hosted CODEX_HOME is never the desktop app's ~/.codex or inside it (design §8.3): no shared sessions or refresh."""
    home, desktop = os.path.realpath(value), desktop_codex_home()
    _require(home != desktop and not home.startswith(desktop.rstrip(os.sep) + os.sep), 'invalid_codex_home')
    return value


def hosted_outbox(outbox):
    """An agent's outbox is a real directory at exactly its own path: no symlink, no other spelling."""
    try:
        _require(stat.S_ISDIR(os.lstat(outbox).st_mode) and str(Path(outbox).resolve(strict=True))==outbox,
                 'invalid_writable_roots')
    except (OSError,RuntimeError) as error:
        raise BrokerConfigError('invalid_writable_roots') from error
    return outbox


def load_hosted_config(path, *, expected_binding=None):
    """Validate one hosted route config and compare Core's pin; performs no effects.

    Core/Profile exceptions propagate with their typing, as for load_config.
    """
    path,value = _private(path)
    _require(type(value.get('v')) is int and
             ((value['v']==1 and set(value)==HOSTED_FIELDS) or (value['v']==2 and set(value)==HOSTED_V2_FIELDS))
             and value['kind']==HOSTED_KIND)
    options = hosted_options(value.get('permission_mode', 'workspace'), value.get('reasoning_effort'), value.get('instructions', ''))
    _require(adapter._identity(value['actor_id']),'invalid_actor')
    selected_profile = _path(value['profile'])
    try:
        cli = _executable(value['cli'])
    except BrokerConfigError as error:
        raise BrokerConfigError('invalid_cli') from error
    executable = _codex_executable(value['codex_executable'])
    cwd = _path(value['cwd'])
    _require(os.path.isdir(cwd),'invalid_cwd')
    model = value['model']
    _require(model is None or (adapter._identity(model) and model.isprintable()),'invalid_model')
    destination = _destination(dict(kind=value['kind'],protocol_version=1,codex_home=value['codex_home'],
                                    thread_id=value['thread_id']),HOSTED_KIND)
    hosted_home(destination['codex_home'])
    profile = load_profile(selected_profile)
    if profile.actor_id != value['actor_id']:
        raise BrokerBindingError()
    if expected_binding is not None and profile_binding(profile) != expected_binding:
        raise BrokerBindingError()
    # Exactly these two, so a typo or an extra entry cannot widen the sandbox.
    roots = writable_roots(selected_profile,profile)
    supplied = value['writable_roots']
    _require(type(supplied) is list and len(supplied)==2 and all(isinstance(root,str) for root in supplied)
             and set(supplied)==set(roots),'invalid_writable_roots')
    hosted_outbox(roots[1])
    pin = profile.store().resolve_hosted_route(profile.actor_id,destination)
    config = HostedConfig(path,selected_profile,profile,cli,executable,dict(pin['destination']),cwd,model,roots,*options)
    if config.permission_mode == 'workspace':
        from .hosted_permissions import validate_workspace
        try:
            validate_workspace(config)
        except ValueError as error:
            raise BrokerConfigError('invalid_cwd') from error
    return config


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


def is_hosted(path):
    """Whether this map entry names a hosted route config (its own `kind`) rather than a broker route."""
    _,value = _private(path)
    return value.get('kind')==HOSTED_KIND


def preflight_hosted(path, actor_id, runner_profile):
    """A hosted route's per-claim check: its config, the actor's binding and Core's pin."""
    _require(adapter._identity(actor_id),'invalid_actor')
    expected = dict(profile_binding(runner_profile),actor_id=actor_id)
    config = load_hosted_config(path,expected_binding=expected)
    if config.profile.binding != runner_profile.binding:
        raise BrokerBindingError()
    return config


def load_route_map(path, runner_profile, *, selected_executable):
    """The startup map's broker and hosted routes together, as {actor: path}."""
    return load_route_table(path,runner_profile,selected_executable=selected_executable)[0]


def load_route_table(path, runner_profile, *, selected_executable):
    """Validate the explicit startup map, then return immutable path choices.

    Returns ({actor: path}, frozenset of hosted actors). An entry whose file
    has kind codex-hosted-stdio is a hosted config; any other entry is a
    broker route, and only then must the selected broker executable be
    trusted. Dispatch must preflight its selected path again against its
    captured claim. There is no directory scan, route discovery or global pin
    uniqueness rule.
    """
    _,value = _private(path)
    _require(set(value)=={'v','routes'} and type(value['v']) is int and value['v']==1
             and type(value['routes']) is dict)
    routes,configs,destinations = set(),set(),set()
    result,hosted = {},set()
    for actor,path in value['routes'].items():
        _require(adapter._identity(actor),'invalid_actor')
        if is_hosted(path):
            route = config_path = _path(path)
            try:
                config = preflight_hosted(route,actor,runner_profile)
            except RoutePinError as error:
                if error.code == 'SEAT_ENDED':
                    continue
                raise
            hosted.add(actor)
        else:
            selected_executable = _executable(selected_executable)
            route,_,config_path = _route(path,selected_executable)
            config = None
        _require(route not in routes,'duplicate_route')
        _require(config_path not in configs,'duplicate_config')
        routes.add(route);configs.add(config_path)
        if config is None:
            config = preflight_route(route,actor,runner_profile,selected_executable=selected_executable)
        try:
            root_info = Path(config.destination['codex_home']).stat()
            if not stat.S_ISDIR(root_info.st_mode):
                raise BrokerBindingError()
        except OSError as error:
            raise BrokerBindingError() from error
        # Startup map uniqueness is physical identity, including case aliases
        # and macOS firmlinks. This does not change Core's persistent path pin.
        destination = (root_info.st_dev,root_info.st_ino,config.destination['thread_id'])
        _require(destination not in destinations,'duplicate_destination')
        destinations.add(destination)
        result[actor] = route
    return result,frozenset(hosted)
