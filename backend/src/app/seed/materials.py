"""Seeds the demo materials, their review, and their issues (PRD F2 to F6, F10, F12).

The seed files refer to people, groups and affiliates by name, like the core seed files.
"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Affiliate, User, Workspace
from app.models.materials import (
    ActionKind,
    Channel,
    Comment,
    Decision,
    EventType,
    Finding,
    FindingSource,
    FindingStatus,
    GroupReview,
    GroupState,
    Issue,
    IssueAction,
    IssueEvent,
    IssueKind,
    IssueSource,
    IssueStatus,
    LiveItem,
    LiveStatus,
    Material,
    MaterialEvent,
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
            submitted_by_id=ctx.users[v["submittedBy"]].id,
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
        # Outdated findings came from the version before the current one.
        number = current - 1 if status is FindingStatus.OUTDATED and current - 1 in versions else current
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
                version_number=current,
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
        db.add(
            MaterialEvent(
                workspace_id=ws,
                material_id=material.id,
                at=parse_time(e["at"]),
                actor_id=actor.id if (actor := person(ctx, e["actor"])) else None,
                actor_name=e["actor"],
                type=EventType(e["type"]),
                text=e["text"],
            )
        )
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
        activity=[],
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
            actor = person(ctx, e["actor"])
            issue.activity.append(
                IssueEvent(
                    workspace_id=ws,
                    at=parse_time(e["at"]),
                    actor_id=actor.id if actor else None,
                    actor_name=e["actor"],
                    text=e["text"],
                    is_comment=e.get("comment", False),
                )
            )
    else:
        # Issues without a detail file get the one event that every issue has: who opened it.
        actor = opened_by.name if opened_by else "Monitoring"
        verb = "Raised" if source is IssueSource.REVIEWER else "Opened"
        issue.activity.append(
            IssueEvent(
                workspace_id=ws,
                at=issue.opened_at,
                actor_id=opened_by.id if opened_by else None,
                actor_name=actor,
                text=f"{verb} this issue and assigned it to {owner.name}.",
            )
        )
    ctx.db.add(issue)


async def delete_all(db: AsyncSession, workspace: Workspace) -> None:
    """Versions, findings, reviews, comments, history, live items, and issue rows go with their material
    (ON DELETE CASCADE). Uploaded files go from the disk too."""
    ws = workspace.id
    for file_id in await db.scalars(select(MaterialFile.id).where(MaterialFile.workspace_id == ws)):
        (settings.upload_dir / str(file_id)).unlink(missing_ok=True)
    await db.execute(delete(MaterialFile).where(MaterialFile.workspace_id == ws))
    await db.execute(delete(Issue).where(Issue.workspace_id == ws))
    await db.execute(delete(Material).where(Material.workspace_id == ws))

