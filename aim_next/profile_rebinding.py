from __future__ import annotations

from contextlib import contextmanager
import copy
import fcntl
import hashlib
import os
from pathlib import Path
import uuid

from . import broker_routes as routes
from . import recovery_io as io
from .profile import BINDING_FIELDS, ProfileError, load_profile, profile_bytes, read_binding, write_profile
from .route_pins import RoutePinError


FIELDS = frozenset(('v','staging_id','control_path','activation_request_path','confirmed_result_path',
                    'source_handoff_path','profiles','runner_actor','route_map_path',
                    'broker_executable','states'))
RESULT_FIELDS = frozenset(('v','status','durability_confirmed','activation_id','request_digest',
                          'handoff_id','source_handoff_digest','bundle_digest',
                          'destination_identity_digest','source_commit','history_complete','binding'))


def _need(value, code='REBIND_INVALID'):
    io.require(value, code)


def _uuid(value):
    try:
        return isinstance(value,str) and str(uuid.UUID(value))==value
    except (ValueError,AttributeError):
        return False


def _sha(value):
    return isinstance(value,str) and len(value)==64 and all(c in '0123456789abcdef' for c in value)


def _path(value):
    path=io.canonical(value)
    io.checked(path.parent, directory=True)
    return path


def _envelope(value):
    _need(type(value) is dict and set(value)==RESULT_FIELDS)
    _need(type(value['v']) is int and value['v']==1 and value['status']=='activated'
          and value['durability_confirmed'] is True)
    _need(_uuid(value['activation_id']) and _uuid(value['handoff_id']))
    for key in ('request_digest','source_handoff_digest','bundle_digest','destination_identity_digest'):
        _need(_sha(value[key]))
    pair=value['source_commit']
    _need(type(pair) is dict and set(pair)=={'commit_seq','commit_id'}
          and type(pair['commit_seq']) is int and pair['commit_seq']>=0
          and io.identifier(pair['commit_id']) and type(value['history_complete']) is bool)
    binding=value['binding']
    _need(type(binding) is dict and set(binding)==BINDING_FIELDS|{'instance_id','db_path'})
    for key in ('instance_id','authority_id','authority_epoch'):
        _need(io.identifier(binding[key]))
    io.canonical(binding['db_path']);io.canonical(binding['authority_path'])


def _activate(request):
    try:
        from .transfer import activate
    except ImportError as error:
        raise io.RecoveryError('TRANSFER_UNAVAILABLE') from error
    return activate(request)


def _check_route(actor,path,runner,executable):
    if routes.is_hosted(path):
        return routes.preflight_hosted(path,actor,runner)
    _need(isinstance(executable,str),'BROKER_EXECUTABLE_REQUIRED')
    return routes.preflight_route(path,actor,runner,selected_executable=executable)


def _read(path, inputs):
    path=_path(str(path))
    value,digest=io.read_record(path)
    prior=inputs.setdefault(str(path),digest)
    _need(prior==digest,'REBIND_INPUT_CHANGED')
    return value


def _unchanged(inputs):
    for name,digest in inputs.items():
        _need(io.read_record(_path(name))[1]==digest,'REBIND_INPUT_CHANGED')


def _put(path,payload,create=None):
    """Never overwrite. Existing bytes are owned by the previously checked intent."""
    if path.exists() or path.is_symlink():
        with io.opened(path) as fd:
            before=io.facts(os.fstat(fd))
            data=os.read(fd,len(payload)+1)
            _need(data==payload and io.facts(os.fstat(fd))==before,'REBIND_OUTPUT_CONFLICT')
            io.full_flush(fd)
    else:
        if create is not None:
            create()
        else:
            fd=os.open(str(path),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb') as stream:
                io.check_info(os.fstat(stream.fileno()))
                stream.write(payload);stream.flush();io.full_flush(stream.fileno())
        with io.opened(path) as fd:
            _need(os.read(fd,len(payload)+1)==payload,'REBIND_OUTPUT_CONFLICT')
            io.full_flush(fd)
    io.flush_path(path.parent,directory=True)


@contextmanager
def _control(path):
    if not path.exists():
        path.mkdir(mode=0o700)
        io.flush_path(path.parent,directory=True)
    io.checked(path,directory=True)
    lock=path/'lock'
    fd=os.open(str(lock),os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
    try:
        io.check_info(os.fstat(fd))
        _need(io.identity(os.fstat(fd))==io.identity(io.checked(lock)))
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise io.RecoveryError('REBIND_BUSY',retryable=True) from error
        io.full_flush(fd);io.flush_path(path,directory=True)
        yield
    finally:
        os.close(fd)


def _prepare(request):
    _need(type(request) is dict and set(request)==FIELDS)
    _need(type(request['v']) is int and request['v']==1 and _uuid(request['staging_id']))
    control=_path(request['control_path'])
    profiles=request['profiles'];states=request['states']
    _need(type(profiles) is dict and 0<len(profiles)<=128 and type(states) is dict
          and set(states)==set(profiles) and request['runner_actor'] in profiles)
    for actor,state in states.items():
        _need(io.identifier(actor) and type(state) is dict
              and set(state)=={'enabled','stopped','blocked'}
              and type(state['enabled']) is bool and type(state['stopped']) is bool
              and (state['blocked'] is None or io.identifier(state['blocked'])))
    inputs={}
    activation=_read(request['activation_request_path'],inputs)
    expected=_read(request['confirmed_result_path'],inputs);_envelope(expected)
    _need(activation.get('activation_id')==expected['activation_id'])
    _read(request['source_handoff_path'],inputs)
    _need(inputs[request['source_handoff_path']]==expected['source_handoff_digest'],
          'REBIND_HANDOFF_MISMATCH')
    binding=expected['binding']
    suffix='.rebind-'+request['staging_id']
    payloads={};kinds={};mapping={};objects={}

    def output(source,value,kind):
        target=_path(str(source)+suffix)
        _need(str(target) not in inputs and str(source) not in kinds,'REBIND_PATH_COLLISION')
        mapping[str(source)]=str(target);kinds[str(source)]=kind
        payloads[str(target)]=value
        return str(target)

    for actor,name in profiles.items():
        raw=_read(name,inputs)
        profile=read_binding(name)
        _need(profile.actor_id==actor and profile.instance_id==binding['instance_id'],
              'REBIND_PROFILE_IDENTITY')
        output(name,profile_bytes(Path(binding['db_path']),binding['instance_id'],actor,
                                  {k:binding[k] for k in BINDING_FIELDS}),'profile')
        objects[name]=raw

    original_map=_read(request['route_map_path'],inputs)
    _need(set(original_map)=={'v','routes'} and type(original_map['v']) is int
          and original_map['v']==1 and type(original_map['routes']) is dict
          and set(original_map['routes'])<=set(profiles))

    def config(name,actor,hosted):
        value=_read(name,inputs)
        _need(value.get('profile')==profiles[actor],'REBIND_ROUTE_IDENTITY')
        changed=copy.deepcopy(value);changed['profile']=mapping[profiles[actor]]
        if hosted:
            _need(value.get('actor_id')==actor and type(value.get('writable_roots')) is list)
            old=read_binding(profiles[actor])
            _need(set(value['writable_roots'])==set(routes.writable_roots(profiles[actor],old)))
            changed['writable_roots']=[str(Path(binding['db_path']).parent),
                                     str(Path(profiles[actor]).parent/(actor+'.outbox'))]
        return output(name,io.encode(changed),'config')

    new_map={}
    for actor,name in original_map['routes'].items():
        value=_read(name,inputs)
        if value.get('kind')==routes.HOSTED_KIND:
            new_map[actor]=config(name,actor,True)
        else:
            _need(set(value)=={'v','profile','argv'} and type(value['v']) is int and value['v']==1
                  and value['profile']==profiles[actor] and type(value['argv']) is list
                  and len(value['argv'])==3 and value['argv'][1]=='--config'
                  and value['argv'][0]==request['broker_executable'])
            cfg=config(value['argv'][2],actor,False)
            changed=copy.deepcopy(value);changed['profile']=mapping[profiles[actor]]
            changed['argv'][2]=cfg
            new_map[actor]=output(name,io.encode(changed),'route')
    output(request['route_map_path'],io.encode({'v':1,'routes':new_map}),'map')
    _need(len(payloads)<=512 and not any(control==Path(p) or control in Path(p).parents for p in inputs))
    _need(not (set(inputs)&set(payloads)),'REBIND_PATH_COLLISION')
    intent=dict(v=1,request=request,inputs=inputs,
                outputs={p:hashlib.sha256(b).hexdigest() for p,b in payloads.items()})
    return control,activation,expected,inputs,payloads,mapping,kinds,new_map,intent


def stage(request, *, confirm=None, route_check=None, checkpoint=None):
    """Prepare exclusive profiles/routes. No installation, dispatch or request replay."""
    try:
        request=copy.deepcopy(request)
        (control,activation,expected,inputs,payloads,mapping,kinds,new_map,intent)=_prepare(request)
        with _control(control):
            intent_path=control/'intent.json'
            if not intent_path.exists():
                _need(not any(Path(p).exists() or Path(p).is_symlink() for p in payloads),
                      'REBIND_OUTPUT_EXISTS')
            _put(intent_path,io.encode(intent))
            fresh=(confirm or _activate)(copy.deepcopy(activation))
            _need(type(fresh) is dict and fresh==expected,'REBIND_CONFIRMATION_MISMATCH')
            _envelope(fresh)
            _unchanged(inputs)
            binding=fresh['binding']
            for actor,name in request['profiles'].items():
                path=Path(mapping[name])
                _put(path,payloads[str(path)],create=lambda p=path,a=actor:write_profile(
                    p,binding['db_path'],binding['instance_id'],a,
                    binding={k:binding[k] for k in BINDING_FIELDS}))
                load_profile(path)
            if checkpoint:checkpoint('profiles')
            for source,kind in kinds.items():
                if kind!='profile':
                    name=mapping[source];_put(Path(name),payloads[name])
            runner=load_profile(mapping[request['profiles'][request['runner_actor']]])
            actors={};destinations=set();ready=True
            for actor,state in request['states'].items():
                info={'state':copy.deepcopy(state),'profile':mapping[request['profiles'][actor]],
                      'route_status':'not_configured'}
                if actor in new_map:
                    info['route']=new_map[actor]
                    if not state['enabled'] or state['stopped'] or state['blocked'] is not None:
                        info['route_status']='held';ready=False
                    else:
                        try:
                            config=(route_check or _check_route)(actor,new_map[actor],runner,
                                                                request['broker_executable'])
                            destination=config.destination
                            st=Path(destination['codex_home']).stat()
                            key=(st.st_dev,st.st_ino,destination['thread_id'])
                            _need(key not in destinations,'REBIND_DUPLICATE_DESTINATION')
                            destinations.add(key);info['route_status']='validated'
                        except (RoutePinError,routes.BrokerConfigError,ProfileError) as error:
                            ready=False;info['route_status']='blocked'
                            info['route_code']=getattr(error,'code',None) or 'ROUTE_VALIDATION_FAILED'
                actors[actor]=info
            _unchanged(inputs)
            for name,payload in payloads.items():
                _put(Path(name),payload)
            manifest=dict(v=1,status='staged',staging_id=request['staging_id'],
                activation_id=fresh['activation_id'],handoff_id=fresh['handoff_id'],
                request_digest=fresh['request_digest'],source_commit=fresh['source_commit'],
                history_complete=fresh['history_complete'],routes_ready=ready,actors=actors,
                route_map=mapping[request['route_map_path']],outputs=intent['outputs'])
            _put(control/'manifest.json',io.encode(manifest))
            if checkpoint:checkpoint('manifest')
            return manifest
    except (OSError,ValueError,TypeError,KeyError,ProfileError) as error:
        if isinstance(error,InterruptedError):
            raise
        raise io.RecoveryError('REBIND_UNCONFIRMED') from error
