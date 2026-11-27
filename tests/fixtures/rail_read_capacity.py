"""An isolated Core, real HTTP adapter and commit stream for item 38."""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
import threading
import time

source, scratch, count = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
web = dict(arg.split("=", 1) for arg in sys.argv[4:])
sys.path[:0] = [str(source), str(source / "tests"), str(source / "tests/fixtures")]
from aim_next import Store
from aim_next.server import create_server
from fixtures.scale_1250 import Seed
from fixtures.ui_http import FreshnessControls


class RailSeed(Seed):
    def topic(self, name):
        if name != "target":
            return super().topic(name)
        # Waiting for… needs an item covering a real agent-owned Build topic.
        draft = "target-opening"
        body = "Opening target"
        self.command("draft.save", {"source_ref": {"kind": "new_topic", "id": draft, "workspace_id": "w"},
                     "topic_id": name, "generation": draft, "body": body,
                     "opening": {"workspace_id": "w", "title": "Rail capacity target",
                                 "participants": ["reader", "owner"]}},
                     {"draft_id": draft}, {"draft_revision": 0}, actor="worker")
        self.command("submission.prepare", {"draft_id": draft, "submission_id": draft,
                     "send_operation_id": draft}, {"topic_id": name}, {"draft_revision": 1}, actor="worker")
        result = self.store.command("worker", {"v": 1, "instance_id": self.instance, "operation_id": draft,
            "kind": "topic.create_and_send", "target": {"topic_id": name}, "args": {"submission_id": draft},
            "expected": {"authority": {key: self.binding[key] for key in ("authority_id", "authority_epoch")}}})
        assert result["status"] == "committed", result
        return self.remember(name, body, result["result"])


def add_link(seed, suffix, title):
    url = "https://example.invalid/saved/" + suffix
    seed.command("workspace.link_set", {"url": url, "title": title, "removed": False},
                 {"workspace_id": "w"}, {"link_revision": 0})
    return url


def fill_sections(seed):
    workspace = {"workspace_id": "w"}
    revision = seed.view("pipeline", workspace)["pipeline"]["version"]
    seed.command("pipeline.stages_set", {"stages": [{"stage_id": "build", "name": "Build"}]},
                 workspace, {"pipeline_revision": revision})
    item = seed.command("pipeline.item_add", {"title": "Rail timing fixture", "section": "now", "size": "small", "raised_by": "reader",
                        "sources": [{"note": "Real filled rail sections"}]}, workspace)
    seed.command("pipeline.piece_start", {"numbers": [item["number"]], "topic_id": "target", "stage_id": "build"}, workspace)
    seed.command("memory.create", {"title": "Rail timing notebook", "body": "Section paint fixture.", "attachments": [], "references": []},
                 {"item_id": "rail-timing-note", "owner_scope": {"kind": "topic", "id": "target"}}, {"item_revision": 0})

    # A stored skill descriptor and a real linked-tool command populate Skills.
    tools = seed.root / "empty-tools"
    skill = tools / "skills" / "timing-fixture"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("# Timing fixture\n\nAn isolated rail timing example.\n")
    (tools / "skills" / "timing-fixture.json").write_text(json.dumps({
        "id": "timing-fixture", "kind": "skill", "name": "Timing fixture", "summary": "An isolated rail timing example",
        "home": "w", "files": ["skills/timing-fixture/SKILL.md"], "check": None}))
    seed.store = Store(seed.path, seed.instance, expected_binding=seed.binding, tools=tools)
    seed.command("tool.link", {"tool_id": "timing-fixture", "linked": True}, {"topic_id": "target"})

    # Publish the test image through the same media admission and link it to a real message.
    image = (source / "tests" / "fixtures" / "media" / "one.png").read_bytes()
    seed.command("media.begin", {"name": "Rail timing.png", "content_type": "image/png",
                 "size_bytes": len(image), "sha256": sha256(image).hexdigest(), "publish_operation_id": "rail-publish-image"},
                 {"media_id": "rail-timing-image"}, {"media_revision": 0})
    published = seed.store.publish_media("owner", {"v": 1, "instance_id": seed.instance, "kind": "media.publish",
        "operation_id": "rail-publish-image", "target": {"media_id": "rail-timing-image"}, "args": {},
        "expected": {"media_revision": 1, "authority": {key: seed.binding[key] for key in ("authority_id", "authority_epoch")}}},
        BytesIO(image))
    assert published["status"] == "committed", published
    seed.command("message.post", {"body": "Rail timing specimens. [Pull request](https://github.com/example/fixture/pull/1)",
                 "attachments": [{"id": "rail-timing-image"}], "reply_to": seed.first}, {"topic_id": "target"})


def serve(seed, web_root):
    control = FreshnessControls()
    server = create_server(lambda: seed.store, seed.instance, "reader", Path(web_root),
                           live=(str(seed.path), (str(seed.root / "control/authority.json"),)))
    assert server.live_feed and server.read_admission, "Require actual commit stream and read admission"
    control.install(server, lambda: seed.store)
    observe = server.read_admission.observer
    views_by_ticket = {}

    class ObservedRequest(server.RequestHandlerClass):
        def handle_one_request(self):
            control.local.view = None
            return super().handle_one_request()

        def _body(self):
            value = super()._body()
            if self.path.partition("?")[0] == "/api/view":
                control.local.view = value.get("name")
            return value

    def observe_view(value):
        # A queue advance can settle someone else's ticket. Attribute later
        # events to the original request recorded on its first observation.
        view = views_by_ticket.setdefault(value["request_id"], getattr(control.local, "view", None))
        observe(dict(value, view=view))

    server.RequestHandlerClass = ObservedRequest
    server.read_admission.observer = observe_view
    refuse_connection = server.refuse_connection

    def observe_connection_refusal(request):
        control.record({"event": "connection-full", "at": time.monotonic()})
        return refuse_connection(request)

    server.refuse_connection = observe_connection_refusal
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    return server, control, thread


def respond(request, seed, servers):
    method = request["method"]
    if method == "ready":
        return {label: {"origin": server.origin, "capability": server.read_admission.capability()}
                for label, (server, _, _) in servers.items()}
    if method == "feed":
        label = request["label"]
        url = "https://example.invalid/previews/" + request["run"]
        before = time.time_ns() // 1_000_000
        seed.post("target", label + ". [" + label + " link](" + url + ")", seed.first, ["reader"])
        return {"url": url, "started_at_ms": before, "committed_at_ms": time.time_ns() // 1_000_000}
    if method == "link":
        before = time.time_ns() // 1_000_000
        url = add_link(seed, request["run"], request["label"])
        return {"url": url, "started_at_ms": before, "committed_at_ms": time.time_ns() // 1_000_000}
    if method == "dim":
        previous = seed.view("rail_dimming", {})
        value = previous["value"]
        value["selected"] = 1 if value["selected"] != 1 else 2
        value["sets"][value["selected"] - 1]["outcomes"] = [["w", True]]
        receipt = seed.command("rail.dimming_set", {"value": value}, {},
                               {"dim_revision": previous["dim_revision"]}, actor="reader")
        return {"selected": value["selected"], "revision": receipt["dim_revision"],
                "committed_at_ms": time.time_ns() // 1_000_000}
    if method in ("admission_events", "read_delay", "read_fault", "read_fault_clear"):
        server, control, _ = servers[request["variant"]]
        return control.control(request, server)
    raise ValueError(method)


seed = RailSeed(scratch, count)
fill_sections(seed)
add_link(seed, "warm", "Existing outcome link")
seed.post("target", "Warm feed with [a preview](https://example.invalid/previews/warm).", seed.first)
servers = {label: serve(seed, root) for label, root in web.items()}
try:
    for line in sys.stdin:
        request = json.loads(line)
        try:
            result = respond(request, seed, servers)
            response = {"id": request["id"], "answer": result}
        except Exception as error:
            response = {"id": request["id"], "failure": str(error)}
        print(json.dumps(response), flush=True)
finally:
    for server, _, thread in servers.values():
        server.shutdown()
        server.server_close()
        thread.join(5)
        assert not thread.is_alive()
