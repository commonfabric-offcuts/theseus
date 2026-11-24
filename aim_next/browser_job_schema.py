from __future__ import annotations

"""The isolated-base69→70 typed browser-job delivery migration (1200)."""

from .message_edit import DELIVERY_COLUMNS, _rebuilt_deliveries
from .refresh_delivery import REQUEST_GUARD
from .answer_delivery import ANSWER_INDEX, ANSWER_GUARD
from .removal import REMOVAL_DELIVERIES, REMOVAL_GUARD


TABLES = [
    "CREATE TABLE browser_jobs (id TEXT PRIMARY KEY, release_number INTEGER NOT NULL REFERENCES releases(number), "
    "source_sha TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), check_id TEXT NOT NULL, "
    "definition TEXT NOT NULL, original_definition TEXT NOT NULL, owner_id TEXT REFERENCES actors(id), "
    "recipient_id TEXT REFERENCES actors(id), topic_id TEXT REFERENCES topics(id), mapping_problem TEXT, "
    "state TEXT NOT NULL CHECK(state IN ('pending','running','unknown','passed','failed','unrun')), "
    "attempt_id TEXT UNIQUE, claim_operation TEXT, child TEXT, result TEXT, fix_piece_id TEXT REFERENCES pipeline_pieces(id), "
    "version INTEGER NOT NULL CHECK(version>0), created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, "
    "UNIQUE(release_number,source_sha,workspace_id,check_id))",
    "CREATE INDEX browser_jobs_outcome ON browser_jobs(workspace_id,id)",
    "CREATE INDEX browser_jobs_release ON browser_jobs(release_number,workspace_id,id)",
    "CREATE TRIGGER browser_job_source BEFORE INSERT ON browser_jobs WHEN NOT EXISTS "
    "(SELECT 1 FROM releases r WHERE r.number=NEW.release_number AND r.commit_sha=NEW.source_sha) "
    "BEGIN SELECT RAISE(ABORT,'a browser job names its exact release source'); END",
    "CREATE TRIGGER browser_job_identity BEFORE UPDATE ON browser_jobs WHEN NEW.id IS NOT OLD.id OR "
    "NEW.release_number IS NOT OLD.release_number OR NEW.source_sha IS NOT OLD.source_sha OR "
    "NEW.workspace_id IS NOT OLD.workspace_id OR NEW.check_id IS NOT OLD.check_id OR "
    "NEW.original_definition IS NOT OLD.original_definition OR NEW.created_ms IS NOT OLD.created_ms OR "
    "json_extract(NEW.definition,'$.check') IS NOT json_extract(OLD.definition,'$.check') OR "
    "(OLD.attempt_id IS NOT NULL AND (NEW.attempt_id IS NOT OLD.attempt_id OR NEW.claim_operation IS NOT OLD.claim_operation)) OR "
    "(OLD.state IN ('passed','failed','unrun') AND (NEW.state IS NOT OLD.state OR NEW.result IS NOT OLD.result OR "
    "NEW.child IS NOT OLD.child OR NEW.owner_id IS NOT OLD.owner_id)) "
    "BEGIN SELECT RAISE(ABORT,'a browser job keeps its source and attempt/result identity'); END",
    "CREATE TRIGGER browser_job_kept BEFORE DELETE ON browser_jobs BEGIN SELECT RAISE(ABORT,'a browser job is retained'); END",
]

DELIVERIES = REMOVAL_DELIVERIES.replace(
    'UNIQUE(request_id),', 'browser_job_id TEXT REFERENCES browser_jobs(id), UNIQUE(browser_job_id,recipient_id), UNIQUE(request_id),'
).replace('(retraction_id IS NOT NULL)=1)', '(retraction_id IS NOT NULL)+(browser_job_id IS NOT NULL)=1)')
GUARD = (
    "CREATE TRIGGER browser_job_delivery_recipient BEFORE INSERT ON deliveries WHEN NEW.browser_job_id IS NOT NULL AND NOT EXISTS "
    "(SELECT 1 FROM browser_jobs j JOIN actors a ON a.id=j.recipient_id JOIN delivery_groups g ON g.id=NEW.group_id "
    "WHERE j.id=NEW.browser_job_id AND j.recipient_id=NEW.recipient_id AND j.topic_id=NEW.topic_id AND a.kind='agent' "
    "AND g.recipient_id=NEW.recipient_id AND g.kind='browser_job' AND NEW.revision=1) "
    "BEGIN SELECT RAISE(ABORT,'a browser job delivery belongs to its assigned recipient'); END"
)
KEPT = DELIVERY_COLUMNS + ',revision,request_id,answer_id,retraction_id'
UP = TABLES + _rebuilt_deliveries(DELIVERIES, KEPT) + REQUEST_GUARD + [ANSWER_INDEX, ANSWER_GUARD] + REMOVAL_GUARD + [GUARD]
DOWN = (_rebuilt_deliveries(REMOVAL_DELIVERIES, KEPT) + REQUEST_GUARD + [ANSWER_INDEX, ANSWER_GUARD] + REMOVAL_GUARD +
        ['DROP TABLE browser_jobs'])
OCCUPIED = "SELECT EXISTS (SELECT 1 FROM browser_jobs) OR EXISTS (SELECT 1 FROM metadata WHERE key LIKE 'browser_catalog.v1:%')"
