"""Seeds the demo materials, their review, and their issues (PRD F2 to F6, F10, F12).

The seed files refer to people, groups and affiliates by name, like the core seed files.
The material history and the issue activity are audit entries (app.audit), with their past times. Names that are
no user, such as "Monitoring" or "Rule check", become system actors. Issue comments go to issue_comments.
"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import OtherActor, entry
from app.config import settings
from app.models import Affiliate, User, Workspace
from app.models.materials import (
    ActionKind,
    Channel,
    Comment,
    Decision,
    Finding,
    FindingSource,
    FindingStatus,
    GroupReview,
    GroupState,
    Issue,
    IssueAction,
    IssueComment,
    IssueKind,
    IssueSource,
    IssueStatus,
    LiveItem,
    LiveStatus,
    Material,
    MaterialFile,
    MaterialStatus,
    MaterialVersion,
    Outcome,
    Product,
    ReviewPath,
    Severity,
)
from app.seed.context import SeedContext, load, parse_time


async def create(ctx: SeedContext) -> None:
    materials: dict[str, Material] = {}
    for row in load("materials.json", "materials"):
        material = Material(
            id=uuid.UUID(row["id"]),
            workspace_id=ctx.workspace.id,
            title=row["title"],
            channel=Channel(row["channel"]),
            product=Product(row["product"]),
            status=MaterialStatus(row["status"]),
            live_status=LiveStatus(row["liveStatus"]),
            source=row.get("source"),
            owner_id=ctx.users[row["owner"]].id,
            affiliate_id=(await affiliate(ctx, row["affiliate"], row["owner"])).id if row.get("affiliate") else None,
            approval_id=row.get("approvalId"),
            expires_at=date.fromisoformat(row["expiresAt"]) if row.get("expiresAt") else None,
            submitted_at=parse_time(row.get("submittedAt")),
            updated_at=parse_time(row["updatedAt"]),
            seeded=True,
            reviews=[
                GroupReview(workspace_id=ctx.workspace.id, group_id=ctx.groups[g["name"]].id, position=i, state=GroupState(g["state"]))
                for i, g in enumerate(row["groups"])
            ],
        )
        materials[row["id"]] = material
        ctx.db.add(material)
    await ctx.db.flush()

    for detail in load("material-details.json", "details"):
        await add_detail(ctx, materials[detail["id"]], detail)

    details = {d["id"]: d for d in load("issue-details.json", "details")}
    for row in load("issues.json", "issues"):
        add_issue(ctx, row, details.get(row["id"]))
    await ctx.db.flush()
    ctx.extra["materials"] = materials


async def affiliate(ctx: SeedContext, name: str, manager: str) -> Affiliate:
    """The affiliate company. Some companies in the material seed have no users yet, so they are made here."""
    if name not in ctx.affiliates:
        company = Affiliate(workspace_id=ctx.workspace.id, name=name, manager_id=ctx.users[manager].id, seeded=True)
        ctx.db.add(company)
        await ctx.db.flush()
        ctx.affiliates[name] = company
    return ctx.affiliates[name]


def person(ctx: SeedContext, name: str | None) -> User | None:
    """A user by name. System actors such as "Monitoring" are not users."""
    return ctx.users.get(name) if name else None


def actor(ctx: SeedContext, name: str) -> User | OtherActor:
    return person(ctx, name) or OtherActor(ctx.workspace.id, name)


# The kind of line in the material seed file, and its audit action. A decision's action comes from its text.
HISTORY_ACTION = {
    "submitted": "submitted",
    "prereview": "prereviewed",
    "routed": "routed",
    "comment": "commented",
    "live": "live_checked",
    "issue": "issue_raised",
    "expired": "approval_expired",
}
DECISION_ACTION = (
    ("Approved with conditions", "approved_with_conditions"),
    ("Approved", "approved"),
    ("Requested changes", "changes_requested"),
    ("Rejected", "rejected"),
    ("Escalated", "escalated"),
    ("Retracted", "approval_retracted"),
)


def history_action(e: dict[str, Any]) -> str:
    if e["type"] != "decision":
        return HISTORY_ACTION[e["type"]]
    return next((action for start, action in DECISION_ACTION if e["text"].startswith(start)), "decided")


def issue_action(text: str) -> str:
    """The audit action of a seeded issue line. Monitoring lines that are none of the app's actions are "monitored"."""
    if text.startswith("Changed the status to"):
        return "status_changed"
    if text.startswith("Marked done:"):
        return "action_done"
    if text.startswith("Sent the correction notice"):
        return "notice_sent"
    if text.startswith("Raised this issue"):
        return "raised"
    return "opened" if "Opened this issue" in text else "monitored"


async def add_detail(ctx: SeedContext, material: Material, d: dict[str, Any]) -> None:
    ws = ctx.workspace.id
    db = ctx.db
    # The seed links findings by short IDs (f1); the database gives each finding a UUID.
    finding_ids = {f["id"]: uuid.uuid4() for f in d["findings"]}

    def relink(segment: Any) -> Any:
        if isinstance(segment, dict):
            return {"text": segment["text"], "finding": str(finding_ids[segment["finding"]])}
        return segment

    versions: dict[int, MaterialVersion] = {}
    for v in d["versions"]:
        current = v.get("current", False)
        version = MaterialVersion(
            workspace_id=ws,
            material_id=material.id,
            number=v["number"],
            submitted_at=parse_time(v["submittedAt"]),
            submitted_by_id=by.id if (by := person(ctx, v.get("submittedBy"))) else None,  # none: found live
            path=ReviewPath(v["path"]),
            outcome=Outcome(v["outcome"]) if v.get("outcome") else None,
            outcome_by=v.get("outcomeBy"),
            details=d["details"] if current else {},
            fields=(
                [{**f, "segments": [relink(s) for s in f["segments"]]} for f in d["fields"]]
                if current
                else [{"label": f["label"], "segments": [f["text"]]} for f in v.get("fields", [])]
            ),
            checklist=(
                [{**r, "finding": str(finding_ids[r["finding"]])} if r.get("finding") else r for r in d["checklist"]]
                if current
                else []
            ),
        )
        versions[version.number] = version
        db.add(version)
    await db.flush()
    ctx.extra.setdefault("versions", {}).update({(material.id, n): v.id for n, v in versions.items()})

    current = d["version"]
    for i, f in enumerate(d["findings"]):
        status = FindingStatus(f["status"])
        # Outdated findings came from an earlier version: the one named, else the version before the current one.
        if status is FindingStatus.OUTDATED:
            number = f.get("version") or (current - 1 if current - 1 in versions else current)
        else:
            number = current
        db.add(
            Finding(
                id=finding_ids[f["id"]],
                workspace_id=ws,
                material_id=material.id,
                version_id=versions[number].id,
                position=i,
                source=FindingSource(f["source"]),
                severity=Severity(f["severity"]),
                rule_id=f["ruleId"],
                status=status,
                flagged_text=f["text"],
                explanation=f["explanation"],
                suggestion=f.get("suggestion"),
            )
        )

    # The detail file knows more about each required group than the list file.
    reviews = {r.group_id: r for r in material.reviews}
    for g in d["groups"]:
        group = ctx.groups[g["name"]]
        review = reviews.get(group.id)
        if review is None:
            review = GroupReview(workspace_id=ws, group_id=group.id, position=len(material.reviews))
            material.reviews.append(review)
        review.state = GroupState(g["state"])
        review.reason = g["reason"]
        review.decided_by_id = by.id if (by := person(ctx, g.get("by"))) else None
        review.decided_at = parse_time(g.get("at"))
        review.escalated_by_id = by.id if (by := person(ctx, g.get("escalatedBy"))) else None
    if d.get("conditions"):
        next(r for r in material.reviews if r.state is GroupState.APPROVED).conditions = d["conditions"]

    for c in d["comments"]:
        db.add(
            Comment(
                workspace_id=ws,
                material_id=material.id,
                version_number=c.get("version", current),
                author_id=ctx.users[c["author"]].id,
                role=c["role"],
                at=parse_time(c["at"]),
                body=c["body"],
                decision=Decision(c["decision"]) if c.get("decision") else None,
                anchor_field=c["anchor"]["field"] if c.get("anchor") else None,
                anchor_text=c["anchor"]["text"] if c.get("anchor") else None,
            )
        )
    for e in d["history"]:
        at = parse_time(e["at"])
        data: dict[str, Any] = {"text": e["text"]}
        if e["type"] in ("submitted", "routed", "comment", "decision"):  # the version it was about: the last one by then
            data["version"] = max((v["number"] for v in d["versions"] if parse_time(v["submittedAt"]) <= at), default=None)
        db.add(entry(actor(ctx, e["actor"]), "material", material.id, history_action(e), data, at=at))
    for item in d["live"]:
        db.add(
            LiveItem(
                workspace_id=ws,
                material_id=material.id,
                connector=item["connector"],
                external_id=item["externalId"],
                match=item["match"],
                status=LiveStatus(item["status"]),
                found_at=parse_time(item["foundAt"]),
                checked_at=parse_time(item["checkedAt"]),
                paused=item.get("paused", False),
                fields=item["fields"],
            )
        )
    await db.flush()


def add_issue(ctx: SeedContext, row: dict[str, Any], d: dict[str, Any] | None) -> None:
    ws = ctx.workspace.id
    owner = ctx.users[row["owner"]]
    opened_by = person(ctx, row.get("openedBy"))
    source = IssueSource(row["source"])
    issue = Issue(
        id=uuid.UUID(row["id"]),
        workspace_id=ws,
        material_id=uuid.UUID(row["material"]["id"]),
        title=row["title"],
        severity=Severity(row["severity"]),
        status=IssueStatus(row["status"]),
        source=source,
        kind=IssueKind(row["kind"]) if row.get("kind") else None,
        owner_id=owner.id,
        opened_by_id=opened_by.id if opened_by else None,
        opened_at=parse_time(row["openedAt"]),
        due_at=parse_time(row["dueAt"]),
        resolved_at=parse_time(row.get("resolvedAt")),
        seeded=True,
        summary="",
        actions=[],
        comments=[],
    )
    if d:
        issue.summary = d["summary"]
        if rule := d.get("rule"):
            issue.rule_id, issue.rule_title = rule["id"], rule["title"]
        issue.condition = d.get("condition")
        issue.live_item = d.get("liveItem")
        issue.approved = d.get("approved")
        if issue.approved:
            issue.approved_version_id = ctx.extra["versions"].get((issue.material_id, issue.approved["version"]))
        issue.notice = d.get("notice")
        for i, a in enumerate(d["actions"]):
            done_by = person(ctx, a.get("doneBy"))
            issue.actions.append(
                IssueAction(
                    workspace_id=ws,
                    position=i,
                    kind=ActionKind(a["kind"]),
                    label=a["label"],
                    done_at=parse_time(a.get("doneAt")) if a["done"] else None,
                    done_by_id=done_by.id if done_by else None,
                    done_by_name=a.get("doneBy"),
                )
            )
        for e in d["activity"]:
            at = parse_time(e["at"])
            if e.get("comment"):
                author = ctx.users[e["actor"]]
                c = IssueComment(id=uuid.uuid7(), workspace_id=ws, author_id=author.id, at=at, body=e["text"])
                issue.comments.append(c)
                ctx.db.add(entry(author, "issue", issue.id, "commented", {"commentId": c.id}, at=at))
            else:
                ctx.db.add(entry(actor(ctx, e["actor"]), "issue", issue.id, issue_action(e["text"]), {"text": e["text"]}, at=at))
    else:
        # Issues without a detail file get the one event that every issue has: who opened it.
        verb = "Raised" if source is IssueSource.REVIEWER else "Opened"
        text = f"{verb} this issue and assigned it to {owner.name}."
        by = opened_by or OtherActor(ws, "Monitoring")
        ctx.db.add(entry(by, "issue", issue.id, verb.lower(), {"text": text}, at=issue.opened_at))
    ctx.db.add(issue)


async def delete_all(db: AsyncSession, workspace: Workspace) -> None:
    """Versions, findings, reviews, comments, live items, and issue rows go with their material
    (ON DELETE CASCADE). Uploaded files go from the disk too. The history is in the audit log: seed.audit
    deletes it, before this runs."""
    ws = workspace.id
    for file_id in await db.scalars(select(MaterialFile.id).where(MaterialFile.workspace_id == ws)):
        (settings.upload_dir / str(file_id)).unlink(missing_ok=True)
    await db.execute(delete(MaterialFile).where(MaterialFile.workspace_id == ws))
    await db.execute(delete(Issue).where(Issue.workspace_id == ws))
    await db.execute(delete(Material).where(Material.workspace_id == ws))

