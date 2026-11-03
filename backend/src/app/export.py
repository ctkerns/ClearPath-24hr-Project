"""Regulator export (PRD F15, P1): a ZIP with the materials, versions, decisions, findings, comments, issues,
uploaded files, and audit log for a date range and optional filters.

Who: internal users, Viewer and higher (PRD section 4: Viewers "run regulator exports"). Affiliates get 403 (R4).

What the range means: a material is in the export when at least one of its versions was *submitted* in the range
(days in the workspace's time zone, app.clock, both ends included). The export then has the whole material: every version, decision, and history entry,
also the ones outside the range, so a reader sees each decision in its context. `versions.csv` marks which versions
are in the range. The submission date was chosen over the decision date because every version has one, also a
version that waits for review or was never decided.

History comes only from the audit log (`audit_events`), the same rows and the same text as the History tab of the
material page (`app.materials.EventOut`), so the export and the page always agree.

`manifest.json` lists every other file of the ZIP with its SHA-256, so a regulator can check that nothing changed.
Running an export records an audit entry (entity "export", action "exported") in the same transaction as its reads
(PRD R1: the audit log records every action).

The ZIP is built in a spooled temporary file (in memory while small, then on disk) and streamed, so a large export
does not stay in memory. Per-table CSV rows go to their own spooled files while the materials are read, because a
ZIP can write only one entry at a time.
"""

import asyncio
import csv
import hashlib
import io
import json
import re
import shutil
import tempfile
import uuid
import zipfile
from collections import defaultdict
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path
from typing import IO, Any

from fastapi import APIRouter
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import clock, material_list
from app.api import APIModel, InternalUser
from app.audit import actor_name, history, record
from app.config import settings
from app.material_access import Db, now, visible
from app.material_list import MaterialMatch
from app.materials import HISTORY_TYPE, EventOut, expire_approvals, name_of, plain
from app.models import Workspace
from app.models.audit import AuditEvent
from app.models.materials import (
    Channel,
    Comment,
    Decision,
    Finding,
    GroupReview,
    Issue,
    IssueAction,
    IssueComment,
    Material,
    MaterialFile,
    MaterialStatus,
    MaterialVersion,
    Outcome,
    Product,
)

router = APIRouter(prefix="/api/exports", tags=["exports"])

# The longest date range of one export: two years, like the metrics page's history.
MAX_RANGE_DAYS = 732
MAX_MATERIAL_IDS = 500
SPOOL_BYTES = 8 * 1024 * 1024  # a spooled file moves to disk above this size
CHUNK = 1024 * 1024
FORMAT_VERSION = 1


class ExportFilters(APIModel):
    """The body of an export. JSON: {dateFrom, dateTo, channel?, product?, status?, materialIds?, listFilters?}.
    `listFilters` is the Materials list's search and filters (its URL search params, app.material_list), for
    "only the materials that match the list's filters": every page of the list, not only the loaded one."""

    date_from: date
    date_to: date
    channel: Channel | None = None
    product: Product | None = None
    status: MaterialStatus | None = None  # the material's status now
    material_ids: list[uuid.UUID] = Field(default=[], max_length=MAX_MATERIAL_IDS)
    list_filters: MaterialMatch | None = None

    @model_validator(mode="after")
    def check(self) -> ExportFilters:
        if self.date_to < self.date_from:
            raise ValueError("The end date is before the start date")
        if (self.date_to - self.date_from).days + 1 > MAX_RANGE_DAYS:
            raise ValueError(f"Choose a range of at most {MAX_RANGE_DAYS} days")
        self.material_ids = list(dict.fromkeys(self.material_ids))  # without duplicates, in the given order
        return self


# ---- Formatting ----


def iso(value: datetime | date | None) -> str | None:
    """UTC ISO 8601, for example 2026-11-03T14:05:00Z. A date stays a date."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return value.isoformat()


# A spreadsheet runs a cell that starts with one of these as a formula. Tab and CR also start one in some apps.
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def cell(value: Any) -> Any:
    """One CSV cell. Material text is user content, so a text cell that a spreadsheet would read as a formula
    gets a leading apostrophe (OWASP "CSV injection"). Lists and dicts become JSON."""
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return iso(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        value = json.dumps(jsonable_encoder(value), ensure_ascii=False, sort_keys=True)
    if isinstance(value, str) and value.startswith(FORMULA_START):
        return "'" + value
    return value


def safe_name(name: str) -> str:
    """A file name that is safe as one part of a ZIP path: no folders, no "..", no control characters."""
    name = re.sub(r"[\x00-\x1f/\\:*?\"<>|]+", "_", name).strip(" .")
    return name[:150] or "file"


def to_json(obj: Any) -> bytes:
    return json.dumps(jsonable_encoder(obj), ensure_ascii=False, indent=2).encode()


# ---- The ZIP ----


class HashingWriter(io.RawIOBase):
    """Writes to a ZIP entry and keeps its SHA-256 and size."""

    def __init__(self, target: IO[bytes]):
        self.target, self.sha, self.size = target, hashlib.sha256(), 0

    def writable(self) -> bool:
        return True

    def write(self, b) -> int:  # type: ignore[override]
        self.sha.update(b)
        self.size += len(b)
        self.target.write(b)
        return len(b)


class ExportZip:
    """The ZIP being written, and the SHA-256 of each entry for the manifest."""

    def __init__(self, out: IO[bytes]):
        self.zip = zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED)
        self.files: list[dict[str, Any]] = []

    def _entry(self, path: str, source: IO[bytes]) -> dict[str, Any]:
        with self.zip.open(path, "w", force_zip64=True) as target:
            w = HashingWriter(target)
            shutil.copyfileobj(source, w, CHUNK)  # type: ignore[misc]
        info = {"path": path, "size": w.size, "sha256": w.sha.hexdigest()}
        self.files.append(info)
        return info

    def add_bytes(self, path: str, data: bytes) -> dict[str, Any]:
        return self._entry(path, io.BytesIO(data))

    def add_file(self, path: str, source: Path) -> dict[str, Any] | None:
        """None when the file is missing on disk."""
        try:
            with source.open("rb") as f:
                return self._entry(path, f)
        except FileNotFoundError:
            return None

    def add_spooled(self, path: str, source: IO[bytes]) -> dict[str, Any]:
        source.seek(0)
        return self._entry(path, source)

    def close(self) -> None:
        self.zip.close()


class Table:
    """One CSV (and its JSON copy), written to spooled temporary files while the materials are read."""

    def __init__(self, name: str, columns: list[str]):
        self.name, self.columns, self.count = name, columns, 0
        self.csv_file = tempfile.SpooledTemporaryFile(SPOOL_BYTES)
        self.json_file = tempfile.SpooledTemporaryFile(SPOOL_BYTES)
        self._text = io.TextIOWrapper(self.csv_file, encoding="utf-8", newline="")  # type: ignore[arg-type]
        self._csv = csv.writer(self._text)
        self._csv.writerow(columns)
        self.json_file.write(b"[")

    def add(self, row: dict[str, Any]) -> None:
        self._csv.writerow([cell(row.get(c)) for c in self.columns])
        self.json_file.write((b",\n" if self.count else b"\n") + json.dumps(jsonable_encoder(row), ensure_ascii=False).encode())
        self.count += 1

    def write_to(self, out: ExportZip) -> None:
        self._text.flush()
        self.json_file.write(b"\n]\n")
        out.add_spooled(f"{self.name}.csv", self.csv_file)
        out.add_spooled(f"{self.name}.json", self.json_file)
        self._text.detach()
        self.csv_file.close()
        self.json_file.close()


def tables() -> dict[str, Table]:
    common = ["materialId", "materialRef"]  # materialRef: the folder name under materials/
    return {
        t.name: t
        for t in (
            Table("materials", [
                "materialId", "materialRef", "title", "channel", "product", "status", "liveStatus", "source", "owner",
                "affiliate", "approvalId", "expiresAt", "createdAt", "updatedAt", "versionCount",
            ]),
            Table("versions", [
                *common, "version", "current", "inRange", "submittedAt", "submittedBy", "submittedById", "path",
                "outcome", "outcomeBy", "approvalId", "expiresAt", "details", "content", "files",
            ]),
            Table("decisions", [
                *common, "commentId", "version", "decision", "by", "byId", "groups", "at", "conditions",
                "overrideReason", "text",
            ]),
            Table("group-reviews", [
                *common, "version", "group", "state", "reason", "decidedBy", "decidedAt", "conditions", "escalatedBy",
            ]),
            Table("findings", [
                *common, "findingId", "version", "source", "ruleId", "severity", "status", "flaggedText",
                "explanation", "suggestion",
            ]),
            Table("comments", [
                *common, "commentId", "version", "author", "role", "at", "decision", "anchorField", "anchorText", "body",
            ]),
            Table("issues", [
                *common, "issueId", "title", "kind", "severity", "status", "source", "owner", "openedBy", "openedAt",
                "dueAt", "resolvedAt", "ruleId", "ruleTitle", "condition", "summary",
            ]),
            Table("audit-log", [
                *common, "id", "at", "actor", "actorId", "entity", "entityId", "action", "historyType", "text", "data",
            ]),
            Table("library-audit-log", ["id", "at", "actor", "actorId", "entity", "entityId", "action", "data"]),
        )
    }


# ---- Reading ----


def approvals_by_version(m: Material, events: list[AuditEvent]) -> dict[int, dict[str, Any]]:
    """The Approval ID and expiry of each approved version. The material keeps only its last approval, so older
    ones come from the audit entries that gave them (PRD section 5: one Approval ID for each approved version)."""
    found: dict[int, dict[str, Any]] = {}
    for e in events:
        data = e.data or {}
        if data.get("approvalId") and isinstance(data.get("version"), int):
            found[data["version"]] = {"approvalId": data["approvalId"], "expiresAt": data.get("expiresAt")}
    if m.approval_id:  # seeded approvals may have no entry with the ID
        number = m.approval_id.rsplit("-v", 1)[-1]
        if number.isdigit():
            found.setdefault(int(number), {"approvalId": m.approval_id, "expiresAt": iso(m.expires_at)})
    return found


def override_of(c: Comment, data: dict[str, Any]) -> str | None:
    """The reason a Reviewer gave to approve with an open High finding (PRD F6)."""
    if data.get("override"):
        return data["override"]
    for line in c.body.splitlines():
        if line.startswith("Override: "):
            return line.removeprefix("Override: ")
    return None


def audit_row(e: AuditEvent, history_type: str | None, text: str | None) -> dict[str, Any]:
    return {
        "id": e.id,
        "at": iso(e.created_at),
        "actor": actor_name(e),
        "actorId": e.actor_id,
        "entity": e.entity,
        "entityId": e.entity_id,
        "action": e.action,
        "historyType": history_type,
        "text": text,
        "data": e.data,
    }


def history_line(e: AuditEvent) -> dict[str, Any]:
    """Exactly the line that GET /api/materials/{id} returns in `history`."""
    return EventOut.of(e).model_dump(mode="json", by_alias=True, exclude_none=True)


async def export_material(
    db: AsyncSession, m: Material, start: datetime, end: datetime, out: ExportZip, t: dict[str, Table], missing: list[dict[str, Any]],
    rule_ids: set[str],
) -> None:
    ws = m.workspace_id
    ref = safe_name(m.approval_id or str(m.id))
    folder = f"materials/{ref}"
    base = {"materialId": m.id, "materialRef": ref}

    events = await history(db, ws, "material", m.id)
    by_comment = {str((e.data or {}).get("commentId")): e for e in events if (e.data or {}).get("commentId")}
    approvals = approvals_by_version(m, events)
    findings = list(await db.scalars(select(Finding).where(Finding.material_id == m.id).order_by(Finding.position, Finding.id)))
    comments = list(
        await db.scalars(
            select(Comment).where(Comment.material_id == m.id).options(selectinload(Comment.author)).order_by(Comment.at, Comment.id)
        )
    )
    issues = list(
        await db.scalars(
            select(Issue)
            .where(Issue.material_id == m.id, Issue.workspace_id == ws)
            .options(
                selectinload(Issue.owner),
                selectinload(Issue.opened_by),
                selectinload(Issue.actions),
                selectinload(Issue.comments).selectinload(IssueComment.author),
            )
            .order_by(Issue.opened_at, Issue.id)
        )
    )
    files = list(
        await db.scalars(
            select(MaterialFile)
            .where(MaterialFile.version_id.in_([v.id for v in m.versions]), MaterialFile.workspace_id == ws)
            .order_by(MaterialFile.created_at, MaterialFile.id)
        )
    )
    files_of: dict[uuid.UUID, list[MaterialFile]] = defaultdict(list)
    for f in files:
        files_of[f.version_id].append(f)  # type: ignore[index]
    findings_of: dict[uuid.UUID, list[Finding]] = defaultdict(list)
    for f in findings:
        findings_of[f.version_id].append(f)
        rule_ids.add(f.rule_id)
    number_of = {v.id: v.number for v in m.versions}
    current = m.versions[-1] if m.versions else None

    # Versions and their files
    versions_out = []
    for v in m.versions:
        version_files = []
        for f in files_of[v.id]:
            path = f"{folder}/v{v.number}/files/{f.id}-{safe_name(f.name)}"
            info = await asyncio.to_thread(out.add_file, path, settings.upload_dir / str(f.id))
            entry = {"id": f.id, "name": f.name, "contentType": f.content_type, "size": f.size}
            if info is None:
                entry["missing"] = True
                missing.append({**base, "version": v.number, "fileId": f.id, "name": f.name})
            else:
                entry |= {"path": path, "sha256": info["sha256"]}
            version_files.append(entry)
        approval = approvals.get(v.number, {}) if v.outcome is Outcome.APPROVED else {}
        row = {
            "version": v.number,
            "current": v is current,
            "inRange": start <= v.submitted_at < end,
            "submittedAt": iso(v.submitted_at),
            "submittedBy": name_of(v.submitted_by),
            "submittedById": v.submitted_by_id,
            "path": v.path,
            "outcome": v.outcome,
            "outcomeBy": v.outcome_by,
            "approvalId": approval.get("approvalId"),
            "expiresAt": approval.get("expiresAt"),
            "details": v.details,
        }
        content = plain(v.fields)
        t["versions"].add(base | row | {
            "content": "\n\n".join(f"{c.label}: {c.text}" for c in content),
            "files": [f["name"] for f in version_files],
        })
        versions_out.append(row | {
            "fields": [{"label": c.label, "text": c.text, **({"kind": raw["kind"]} if raw.get("kind") else {})}
                       for c, raw in zip(content, v.fields, strict=True)],
            "checklist": v.checklist,
            "findings": [
                {
                    "id": f.id, "source": f.source, "ruleId": f.rule_id, "severity": f.severity, "status": f.status,
                    "flaggedText": f.flagged_text, "explanation": f.explanation, "suggestion": f.suggestion,
                }
                for f in findings_of[v.id]
            ],
            "files": version_files,
        })
        for f in findings_of[v.id]:
            t["findings"].add(base | {
                "findingId": f.id, "version": v.number, "source": f.source, "ruleId": f.rule_id, "severity": f.severity,
                "status": f.status, "flaggedText": f.flagged_text, "explanation": f.explanation, "suggestion": f.suggestion,
            })

    # Decisions: a decision is a comment with a decision (like a pull request review); its audit entry has the
    # conditions and override reason. The required groups of the current version are their own table.
    decisions_out, comments_out = [], []
    for c in comments:
        data = (by_comment.get(str(c.id)).data or {}) if str(c.id) in by_comment else {}  # type: ignore[union-attr]
        comment = {
            "commentId": c.id, "version": c.version_number, "author": c.author.name, "role": c.role, "at": iso(c.at),
            "decision": c.decision, "anchorField": c.anchor_field, "anchorText": c.anchor_text, "body": c.body,
        }
        t["comments"].add(base | comment)
        comments_out.append(comment)
        if c.decision is None:
            continue
        conditions = data.get("conditions") or (c.body if c.decision is Decision.APPROVE_CONDITIONS else None)
        decision = {
            "commentId": c.id, "version": c.version_number, "decision": c.decision, "by": c.author.name,
            "byId": c.author_id, "groups": data.get("groups") or [g for g in c.role.split(", ") if g], "at": iso(c.at),
            "conditions": conditions, "overrideReason": override_of(c, data), "text": c.body,
        }
        t["decisions"].add(base | decision)
        decisions_out.append(decision)
    groups_out = []
    for r in m.reviews:
        g = {
            "version": current.number if current else None, "group": r.group.name, "state": r.state, "reason": r.reason,
            "decidedBy": r.decided_by.name if r.decided_by else None, "decidedAt": iso(r.decided_at),
            "conditions": r.conditions, "escalatedBy": r.escalated_by.name if r.escalated_by else None,
        }
        t["group-reviews"].add(base | g)
        groups_out.append(g)

    # The material's history, then each issue's, all from the audit log
    for e in events:
        line = history_line(e)
        t["audit-log"].add(base | audit_row(e, HISTORY_TYPE.get(e.action, "decision"), line["text"]))
    issues_out = []
    for i in issues:
        if i.rule_id:
            rule_ids.add(i.rule_id)
        issue_events = await history(db, ws, "issue", i.id)
        for e in issue_events:
            t["audit-log"].add(base | audit_row(e, None, (e.data or {}).get("text")))
        issue = {
            "issueId": i.id, "title": i.title, "kind": i.kind, "severity": i.severity, "status": i.status,
            "source": i.source, "owner": i.owner.name, "openedBy": i.opened_by.name if i.opened_by else None,
            "openedAt": iso(i.opened_at), "dueAt": iso(i.due_at), "resolvedAt": iso(i.resolved_at),
            "ruleId": i.rule_id, "ruleTitle": i.rule_title, "condition": i.condition, "summary": i.summary,
        }
        t["issues"].add(base | issue)
        issues_out.append(issue | {
            "approvedVersion": number_of.get(i.approved_version_id) if i.approved_version_id else None,
            "presentAtApproval": i.present_at_approval,
            "liveItem": i.live_item,
            "approved": i.approved,
            "notice": i.notice,
            "actions": [
                {"kind": a.kind, "label": a.label, "doneAt": iso(a.done_at), "doneBy": a.done_by_name} for a in i.actions
            ],
            "comments": [{"author": c.author.name, "at": iso(c.at), "body": c.body} for c in i.comments],
            "auditLog": [audit_row(e, None, (e.data or {}).get("text")) for e in issue_events],
        })

    material = {
        "id": m.id, "title": m.title, "channel": m.channel, "product": m.product, "status": m.status,
        "liveStatus": m.live_status, "source": m.source, "owner": m.owner.name,
        "affiliate": m.affiliate.name if m.affiliate else None, "approvalId": m.approval_id,
        "expiresAt": iso(m.expires_at), "createdAt": iso(m.created_at), "updatedAt": iso(m.updated_at),
    }
    t["materials"].add({"materialId": m.id, "materialRef": ref} | {k: v for k, v in material.items() if k != "id"}
                       | {"versionCount": len(m.versions)})
    out.add_bytes(f"{folder}/material.json", to_json({
        **material,
        "versions": versions_out,
        "requiredGroups": groups_out,
        "decisions": decisions_out,
        "comments": comments_out,
        "issues": issues_out,
        # The History tab, line for line (GET /api/materials/{id} `history`)
        "history": [history_line(e) for e in events],
        "auditLog": [audit_row(e, HISTORY_TYPE.get(e.action, "decision"), history_line(e)["text"]) for e in events],
    }))


# The rows of one material. The export drops them from the session before the next material; users stay.
MATERIAL_ROWS = (Material, MaterialVersion, GroupReview, Finding, Comment, Issue, IssueAction, IssueComment, MaterialFile, AuditEvent)


def drop_rows(db: AsyncSession) -> None:
    for obj in list(db.identity_map.values()):
        if isinstance(obj, MATERIAL_ROWS) and obj in db:
            db.expunge(obj)


def stream(spool: IO[bytes]) -> Iterator[bytes]:
    try:
        spool.seek(0)
        while chunk := spool.read(CHUNK):
            yield chunk
    finally:
        spool.close()


@router.post("/regulator")
async def regulator_export(body: ExportFilters, viewer: InternalUser, db: Db) -> StreamingResponse:
    """Returns the ZIP as a download. POST, not GET: it writes an audit entry, so it gets the same-origin
    check of every change (app.main), and the material ids go in the body instead of a long URL."""
    await expire_approvals(db, viewer)  # the same statuses as the list and the material page (PRD F15)
    ws = viewer.workspace_id
    started = now()
    export_id = uuid.uuid4()
    workspace = await db.get_one(Workspace, ws)
    start, end = clock.day_start(workspace, body.date_from), clock.day_end(workspace, body.date_to)

    in_range = select(MaterialVersion.material_id).where(
        MaterialVersion.workspace_id == ws, MaterialVersion.submitted_at >= start, MaterialVersion.submitted_at < end
    )
    query = select(Material).where(*visible(viewer), Material.id.in_(in_range))
    if body.channel:
        query = query.where(Material.channel == body.channel)
    if body.product:
        query = query.where(Material.product == body.product)
    if body.status:
        query = query.where(Material.status == body.status)
    if body.material_ids:
        query = query.where(Material.id.in_(body.material_ids))
    if body.list_filters:
        query = query.where(Material.id.in_(material_list.filtered(viewer, body.list_filters, Material.id)))
    ids = list(await db.scalars(query.with_only_columns(Material.id).order_by(Material.created_at, Material.id)))

    spool = tempfile.SpooledTemporaryFile(SPOOL_BYTES)
    out = ExportZip(spool)
    t = tables()
    missing: list[dict[str, Any]] = []
    rule_ids: set[str] = set()
    try:
        # One material at a time, so memory holds one material's rows, not the whole export.
        for material_id in ids:
            m = await db.scalar(
                select(Material)
                .where(Material.id == material_id, *visible(viewer))
                .options(
                    selectinload(Material.owner),
                    selectinload(Material.affiliate),
                    selectinload(Material.reviews).selectinload(GroupReview.group),
                    selectinload(Material.reviews).selectinload(GroupReview.decided_by),
                    selectinload(Material.reviews).selectinload(GroupReview.escalated_by),
                    selectinload(Material.versions).selectinload(MaterialVersion.submitted_by),
                )
            )
            if m is not None:
                await export_material(db, m, start, end, out, t, missing, rule_ids)
            drop_rows(db)

        # The workspace-level history of the rules and disclosures that the exported findings and issues name
        if rule_ids:
            for e in await db.scalars(
                select(AuditEvent)
                .where(AuditEvent.workspace_id == ws, AuditEvent.entity.in_(("rule", "disclosure")), AuditEvent.entity_id.in_(rule_ids))
                .options(selectinload(AuditEvent.actor))
                .order_by(AuditEvent.created_at, AuditEvent.id)
            ):
                row = audit_row(e, None, None)
                del row["historyType"], row["text"]
                t["library-audit-log"].add(row)

        for table in t.values():
            table.write_to(out)

        counts = {name: table.count for name, table in t.items()} | {
            "files": len([f for f in out.files if f["path"].startswith("materials/") and "/files/" in f["path"]]),
            "missingFiles": len(missing),
        }
        filters = body.model_dump(mode="json", by_alias=True, exclude_none=True)
        if body.list_filters:  # only the list filters that are set
            filters["listFilters"] = body.list_filters.model_dump(mode="json", by_alias=True, exclude_defaults=True)
        manifest = {
            "format": "clearpath-regulator-export",
            "formatVersion": FORMAT_VERSION,
            "exportId": export_id,
            "workspace": {"id": ws, "name": workspace.name},
            "exportedAt": iso(started),
            "exportedBy": {"id": viewer.id, "name": viewer.name, "email": viewer.email, "role": viewer.role},
            "filters": filters,
            "dateRange": {
                "appliesTo": "version.submittedAt",
                "from": iso(start),
                "toExclusive": iso(end),
                "timeZone": workspace.time_zone,
                "note": "A material is included when at least one of its versions was submitted in the range "
                "(days in the workspace's time zone; from and toExclusive are in UTC). "
                "Its other versions, decisions, and history are included too; versions.csv marks inRange.",
            },
            "counts": counts,
            "missingFiles": missing,
            "notes": [
                "All times are UTC, ISO 8601.",
                (
                    "History comes from the append-only audit log; materials/*/material.json `history` equals the "
                    "History tab of the material page."
                ),
                (
                    "CSV cells that start with =, +, -, @, tab, or carriage return have a leading apostrophe "
                    "(spreadsheet formula injection). The .json copies keep the original text."
                ),
                "files lists every other file of this ZIP with its SHA-256; manifest.json itself is not listed.",
            ],
            "files": out.files,
        }
        out.add_bytes("manifest.json", to_json(manifest))
        out.close()
    except BaseException:
        spool.close()
        raise

    # PRD R1: the export itself is an audit entry, committed with the reads above (one transaction).
    record(db, viewer, "export", export_id, "exported", {"kind": "regulator", "filters": filters, "counts": counts})
    await db.commit()

    size = spool.tell()
    filename = f"clearpath-export-{clock.day_of(workspace, started).isoformat()}.zip"
    return StreamingResponse(
        stream(spool),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(size),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
