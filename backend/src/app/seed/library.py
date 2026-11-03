"""Seeds the policy library (PRD F7, F8, F9): rules, disclosures, building blocks, rate sheets, regulatory changes.

The IDs are the same as in the frontend demo data, because materials refer to rule and disclosure IDs.
"""

import uuid
from datetime import date

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Workspace
from app.models.library import (
    BlockKind,
    BuildingBlock,
    CheckLayer,
    Disclosure,
    DisclosureVersion,
    RateKind,
    RateSheet,
    RateSheetRow,
    RegChange,
    RegChangeEdit,
    RegChangeStatus,
    Rule,
    RuleKind,
    RuleVersion,
    Severity,
)
from app.seed.context import SeedContext, load, parse_time


async def create(ctx: SeedContext) -> None:
    db = ctx.db
    ws = ctx.workspace.id
    people = {name: u.id for name, u in ctx.users.items()}

    rules: dict[str, Rule] = {}
    for r in load("rules.json", "rules"):
        citation = r.get("citation")
        rule = Rule(
            workspace_id=ws,
            id=r["id"],
            version=r["version"],
            title=r["title"],
            kind=RuleKind(r["kind"]),
            text=r["text"],
            jurisdiction=r["jurisdiction"],
            products=r["products"],
            channels=r["channels"],
            citation_label=citation["label"] if citation else None,
            citation_url=citation["url"] if citation else None,
            effective_date=date.fromisoformat(r["effectiveDate"]),
            owner_id=people[r["owner"]],
            severity=Severity(r["severity"]),
            layer=CheckLayer(r["layer"]),
            check=r["check"],
            seeded=True,
            versions=[
                RuleVersion(
                    version=v["version"],
                    effective_date=date.fromisoformat(v["effectiveDate"]),
                    by_id=people[v["by"]],
                    note=v["note"],
                )
                for v in r["versions"]
            ],
        )
        rules[rule.id] = rule
        db.add(rule)

    for d in load("disclosures.json", "disclosures"):
        db.add(
            Disclosure(
                workspace_id=ws,
                id=d["id"],
                title=d["title"],
                version=d["version"],
                text=d["text"],
                products=d["products"],
                states=None if d["states"] == "all" else d["states"],
                placement=d["placement"],
                effective_date=date.fromisoformat(d["effectiveDate"]),
                owner_id=people[d["owner"]],
                seeded=True,
                versions=[
                    DisclosureVersion(
                        version=v["version"],
                        effective_date=date.fromisoformat(v["effectiveDate"]),
                        by_id=people[v["by"]],
                        note=v["note"],
                        text=v["text"],
                    )
                    for v in d["versions"]
                ],
            )
        )

    for b in load("building-blocks.json", "blocks"):
        db.add(
            BuildingBlock(
                id=uuid.UUID(b["id"]),
                workspace_id=ws,
                kind=BlockKind(b["kind"]),
                text=b["text"],
                products=b["products"],
                states=None if b["states"] == "all" else b["states"],
                approved_by_id=people[b["approvedBy"]],
                approved_at=date.fromisoformat(b["approvedAt"]),
                expires_at=date.fromisoformat(b["expiresAt"]),
                saved_from_id=uuid.UUID(b["savedFrom"]["id"]),
                saved_from_title=b["savedFrom"]["title"],
                used_in=b["usedIn"],
                seeded=True,
            )
        )

    for s in load("rate-sheet.json", "sheets"):
        db.add(
            RateSheet(
                workspace_id=ws,
                id=s["id"],
                effective_date=date.fromisoformat(s["effectiveDate"]),
                uploaded_at=parse_time(s["uploadedAt"]),
                uploaded_by_id=people[s["uploadedBy"]],
                file=s["file"],
                seeded=True,
                rows=[
                    RateSheetRow(
                        position=i,
                        key=row["key"],
                        product=row["product"],
                        offer=row["offer"],
                        rate=RateKind(row["rate"]),
                        min=row["min"],
                        max=row["max"],
                        fees=row["fees"],
                    )
                    for i, row in enumerate(s["rows"])
                ],
            )
        )
    await db.flush()  # the rules first, because the change edits refer to them

    for c in load("regulatory-changes.json", "changes"):
        db.add(
            RegChange(
                workspace_id=ws,
                id=c["id"],
                title=c["title"],
                summary=c["summary"],
                source=c["source"],
                agency=c["agency"],
                citation_label=c["citation"]["label"],
                citation_url=c["citation"]["url"],
                published_at=date.fromisoformat(c["publishedAt"]),
                effective_date=date.fromisoformat(c["effectiveDate"]),
                status=RegChangeStatus(c["status"]),
                reviewing_by_id=people[c["reviewingBy"]] if c.get("reviewingBy") else None,
                decided_by_id=people[c["decidedBy"]] if c.get("decidedBy") else None,
                decided_at=parse_time(c.get("decidedAt")),
                decision_note=c.get("decisionNote"),
                seeded=True,
                edits=[
                    RegChangeEdit(position=i, rule_id=e["ruleId"], before=e["before"], after=e["after"])
                    for i, e in enumerate(c["edits"])
                ],
            )
        )
    ctx.extra["rules"] = rules


async def delete_all(db: AsyncSession, workspace: Workspace) -> None:
    """Versions, rows and edits go with their parent rows (ON DELETE CASCADE)."""
    ws = workspace.id
    for table in (RegChange, RateSheet, BuildingBlock, Rule, Disclosure):
        await db.execute(delete(table).where(table.workspace_id == ws))
