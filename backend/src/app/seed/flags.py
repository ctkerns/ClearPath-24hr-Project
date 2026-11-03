"""Seeds the demo flags for re-review (PRD F7), from material-flags.json, with their history entries.

A flag belongs to a material version, so this area comes after the materials. The rows go with their
material on a reset (ON DELETE CASCADE); `delete_all` removes them first anyway, so the order does not matter.
"""

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import entry
from app.models import Workspace
from app.models.flags import FlagKind, FlagResolution, MaterialFlag
from app.seed.context import SeedContext, load, parse_time


async def create(ctx: SeedContext) -> None:
    for row in load("material-flags.json", "flags"):
        material_id = uuid.UUID(row["material"])
        by = ctx.users[row["createdBy"]]
        resolver = ctx.users[row["resolvedBy"]] if row.get("resolvedBy") else None
        flag = MaterialFlag(
            id=uuid.UUID(row["id"]),
            workspace_id=ctx.workspace.id,
            material_id=material_id,
            version_id=ctx.extra["versions"][(material_id, row["version"])],
            kind=FlagKind(row["kind"]),
            source_id=row["sourceId"],
            source_version=row.get("sourceVersion"),
            summary=row["summary"],
            data=row.get("data", {}),
            created_by_id=by.id,
            created_at=parse_time(row["createdAt"]),
            resolved_at=parse_time(row.get("resolvedAt")),
            resolved_by_id=resolver.id if resolver else None,
            resolution=FlagResolution(row["resolution"]) if row.get("resolution") else None,
            resolution_note=row.get("note"),
            seeded=True,
        )
        ctx.db.add(flag)
        # The same history entries as app.flags writes
        ctx.db.add(entry(by, "material", material_id, "flagged", {
            "flagId": flag.id, "kind": flag.kind, "sourceId": flag.source_id, "sourceVersion": flag.source_version,
            "version": row["version"], **flag.data,
            "text": f"Flagged version {row['version']} for re-review: {flag.summary}",
        }, at=flag.created_at))
        if resolver and flag.resolution is FlagResolution.NO_CHANGE:
            ctx.db.add(entry(resolver, "material", material_id, "flag_resolved", {
                "flagId": flag.id, "resolution": flag.resolution, "note": flag.resolution_note,
                "text": f"Re-reviewed, no change needed: {flag.summary} Note: {flag.resolution_note}",
            }, at=flag.resolved_at))


async def delete_all(db: AsyncSession, workspace: Workspace) -> None:
    await db.execute(delete(MaterialFlag).where(MaterialFlag.workspace_id == workspace.id))
