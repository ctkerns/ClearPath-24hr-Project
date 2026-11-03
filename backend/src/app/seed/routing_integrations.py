"""Seeds the Routing and Integrations tabs (PRD F6, F11): routing rules and settings, connectors and their accounts.

Uses the users and reviewer groups from core, so it comes after core in AREAS.
"""

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Workspace
from app.models.integrations import Integration, IntegrationAccount, IntegrationErrorCode, IntegrationStatus, Provider
from app.models.routing import NoMaterialChangeType, RoutingRule, RoutingRuleGroup, RoutingSettings, RuleSource
from app.seed.context import SeedContext, load, parse_time


async def create(ctx: SeedContext) -> None:
    db = ctx.db
    ws = ctx.workspace.id

    routing = load("routing.json", "routing")
    lighter = routing["lighterPathGroupId"]
    db.add(
        RoutingSettings(
            workspace_id=ws,
            lighter_path_group_id=uuid.UUID(lighter) if lighter else None,
            enabled_change_types=[t.value for t in NoMaterialChangeType if routing["noMaterialChangeTypes"][t.value]],
            seeded=True,
        )
    )
    for position, r in enumerate(routing["rules"], start=1):
        c = r["conditions"]
        by = ctx.users[r["updatedBy"]].id
        db.add(
            RoutingRule(
                id=uuid.UUID(r["id"]),
                workspace_id=ws,
                position=position,
                name=r["name"],
                enabled=r["enabled"],
                products=c["products"],
                channels=c["channels"],
                source=RuleSource(c["source"]) if c.get("source") else None,
                affiliate_history=c.get("affiliateHistory", False),
                nationwide=c.get("nationwide", False),
                states=c["states"],
                note=r.get("note"),
                created_at=parse_time(r["updatedAt"]),
                created_by_id=by,
                updated_at=parse_time(r["updatedAt"]),
                updated_by_id=by,
                seeded=True,
                required=[RoutingRuleGroup(group_id=uuid.UUID(g), position=i) for i, g in enumerate(r["requiredGroupIds"])],
            )
        )

    for row in load("integrations.json", "integrations"):
        error = row.get("error")
        db.add(
            Integration(
                id=uuid.UUID(row["id"]),
                workspace_id=ws,
                provider=Provider(row["provider"]),
                status=IntegrationStatus(row["status"]),
                verified=row["verified"],
                last_sync_at=parse_time(row.get("lastSyncAt")),
                error_code=IntegrationErrorCode(error["code"]) if error else None,
                error_at=parse_time(error["at"]) if error else None,
                available=row["available"],
                seeded=True,
                accounts=[
                    IntegrationAccount(
                        id=uuid.UUID(a["id"]),
                        workspace_id=ws,
                        name=a["name"],
                        detail=a["detail"],
                        default_owner_id=uuid.UUID(a["defaultOwnerId"]) if a.get("defaultOwnerId") else None,
                        seeded=True,
                    )
                    for a in row["accounts"]
                ],
            )
        )
    await db.flush()


async def delete_all(db: AsyncSession, workspace: Workspace) -> None:
    """Rule groups and accounts go with their rule and connector (ON DELETE CASCADE)."""
    ws = workspace.id
    await db.execute(delete(Integration).where(Integration.workspace_id == ws))
    await db.execute(delete(RoutingRule).where(RoutingRule.workspace_id == ws))
    await db.execute(delete(RoutingSettings).where(RoutingSettings.workspace_id == ws))
