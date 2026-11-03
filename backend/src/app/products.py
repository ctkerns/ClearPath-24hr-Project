"""Products (PRD F8, US-66, Library > Products): the list of financial products of each workspace.

Every internal user reads it, because every picker and filter shows it. Only Managers and higher change it,
the same as the rest of the library (section 4, R3). There is no delete: deactivation takes its place.

The other areas check the products of a record on write with `check_products`: an unknown product, or an
inactive one that the record did not already have, gives 422 (F8: existing records keep an inactive product).
"""

import re
import uuid
from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import APIModel, InternalUser, Manager, conflict, not_found
from app.audit import changes, record
from app.db import get_db
from app.material_access import now
from app.models import User
from app.models.library import BuildingBlock, Disclosure, RateSheet, Rule
from app.models.materials import Material, MaterialStatus
from app.models.products import Product
from app.models.routing import RoutingRule
from app.prereview import sheet_on

router = APIRouter(prefix="/api/library/products", tags=["library"])
Db = Annotated[AsyncSession, Depends(get_db)]

# A product ID in a request body or a filter. The server checks it against the workspace's list.
ProductId = Annotated[str, Field(min_length=1, max_length=32)]
ID_LENGTH = 32
Name = Annotated[str, Field(min_length=1, max_length=100)]
Description = Annotated[str, Field(min_length=1, max_length=1000)]


# ---- For the other areas ----


def unique(ids: Iterable[str]) -> list[str]:
    """The IDs once each, in the order given."""
    return list(dict.fromkeys(ids))


async def product_names(db: AsyncSession, workspace_id: uuid.UUID) -> dict[str, str]:
    """Every product of the workspace, active or not, as {id: name}."""
    return dict((await db.execute(select(Product.id, Product.name).where(Product.workspace_id == workspace_id))).all())


async def check_products(db: AsyncSession, workspace_id: uuid.UUID, ids: Iterable[str], had: Iterable[str] = ()) -> None:
    """422 for a product that is not in the workspace's list, or an inactive one that is not in `had`
    (the products the record has now). Existing records keep an inactive product (PRD F8)."""
    wanted = set(ids)
    if not wanted:
        return
    rows = {
        p.id: p
        for p in await db.scalars(select(Product).where(Product.workspace_id == workspace_id, Product.id.in_(wanted)))
    }
    unknown = sorted(wanted - rows.keys())
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown product: {', '.join(unknown)}")
    kept = set(had)
    inactive = sorted(rows[i].name for i in wanted if not rows[i].active and i not in kept)
    if inactive:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{', '.join(inactive)} {'is' if len(inactive) == 1 else 'are'} inactive. Choose an active product.",
        )


# ---- The API ----


class ProductUsage(APIModel):
    """Records that name the product explicitly. An empty list ("every product") does not count."""

    materials: int = 0
    materials_in_review: int = 0
    rules: int = 0
    disclosures: int = 0
    blocks: int = 0
    rate_sheet_rows: int = 0  # on the current sheet
    routing_rules: int = 0


class ProductOut(APIModel):
    id: str
    name: str
    description: str
    active: bool
    created_at: datetime
    created_by: str  # a name; "System" for the products the migration made from the old fixed list
    usage: ProductUsage

    @classmethod
    def of(cls, p: Product, usage: ProductUsage | None = None) -> "ProductOut":
        return cls(
            id=p.id,
            name=p.name,
            description=p.description,
            active=p.active,
            created_at=p.created_at,
            created_by=p.created_by.name if p.created_by else "System",
            usage=usage or ProductUsage(),
        )


async def usage_of(db: AsyncSession, viewer: User) -> dict[str, ProductUsage]:
    """The usage of every product that something uses, by ID."""
    ws = viewer.workspace_id
    usage: dict[str, ProductUsage] = {}

    def of(product_id: str) -> ProductUsage:
        return usage.setdefault(product_id, ProductUsage())

    in_review = func.count().filter(Material.status.in_([MaterialStatus.SUBMITTED, MaterialStatus.IN_REVIEW]))
    for product_id, total, waiting in await db.execute(
        select(Material.product, func.count(), in_review).where(Material.workspace_id == ws).group_by(Material.product)
    ):
        of(product_id).materials = total
        of(product_id).materials_in_review = waiting

    for table, field in ((Rule, "rules"), (Disclosure, "disclosures"), (BuildingBlock, "blocks"), (RoutingRule, "routing_rules")):
        counts = Counter(p for lists in await db.scalars(select(table.products).where(table.workspace_id == ws)) for p in set(lists))
        for product_id, n in counts.items():
            setattr(of(product_id), field, n)

    sheets = list(
        await db.scalars(
            select(RateSheet)
            .where(RateSheet.workspace_id == ws)
            .options(selectinload(RateSheet.rows))
            .order_by(RateSheet.effective_date.desc(), RateSheet.uploaded_at.desc())
        )
    )
    # The sheet that the rate check uses today (app.prereview)
    if sheet := sheet_on(sheets, now().date()):
        for product_id, n in Counter(r.product for r in sheet.rows).items():
            of(product_id).rate_sheet_rows = n
    return usage


async def load_product(db: AsyncSession, viewer: User, product_id: str) -> Product:
    p = await db.scalar(
        select(Product)
        .where(Product.workspace_id == viewer.workspace_id, Product.id == product_id)
        .options(selectinload(Product.created_by))
        .execution_options(populate_existing=True)
    )
    if p is None:
        raise not_found("Product not found")
    return p


async def product_saved(db: AsyncSession, viewer: User, product_id: str) -> ProductOut:
    await db.commit()
    usage = await usage_of(db, viewer)
    return ProductOut.of(await load_product(db, viewer, product_id), usage.get(product_id))


@router.get("")
async def list_products(viewer: InternalUser, db: Db) -> list[ProductOut]:
    """Every product, active first, then by name."""
    rows = await db.scalars(
        select(Product)
        .where(Product.workspace_id == viewer.workspace_id)
        .options(selectinload(Product.created_by))
        .order_by(Product.active.desc(), func.lower(Product.name))
    )
    usage = await usage_of(db, viewer)
    return [ProductOut.of(p, usage.get(p.id)) for p in rows]


class ProductInput(APIModel):
    name: Name
    description: Description


class ProductChange(APIModel):
    name: Name | None = None
    description: Description | None = None
    active: bool | None = None


def clean(value: str, what: str) -> str:
    value = value.strip()
    if not value:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Add a {what}")
    return value


async def check_name_free(db: AsyncSession, viewer: User, name: str, except_id: str | None = None) -> None:
    """Names are unique in the workspace, ignoring case. The name is already trimmed."""
    query = select(Product.id).where(Product.workspace_id == viewer.workspace_id, func.lower(Product.name) == name.lower())
    if except_id is not None:
        query = query.where(Product.id != except_id)
    if await db.scalar(query):
        raise conflict("Another product already has this name")


def slug_of(name: str) -> str:
    """"Auto loan" → "auto_loan". Letters and digits only, joined by underscores."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug[: ID_LENGTH - 4].rstrip("_") or "product"  # room for a suffix such as "_12"


async def new_id(db: AsyncSession, viewer: User, name: str) -> str:
    """The slug of the name, with a suffix ("_2", "_3", ...) if a product of the workspace has it already."""
    base = slug_of(name)
    taken = set(
        await db.scalars(
            select(Product.id).where(Product.workspace_id == viewer.workspace_id, Product.id.like(f"{base}%"))
        )
    )
    candidate, n = base, 1
    while candidate in taken:
        n += 1
        candidate = f"{base}_{n}"
    return candidate


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_product(body: ProductInput, viewer: Manager, db: Db) -> ProductOut:
    """The server makes the ID from the name. It never changes after this."""
    name, description = clean(body.name, "name"), clean(body.description, "description")
    await check_name_free(db, viewer, name)
    p = Product(
        workspace_id=viewer.workspace_id,
        id=await new_id(db, viewer, name),
        name=name,
        description=description,
        active=True,
        created_by_id=viewer.id,
    )
    db.add(p)
    record(db, viewer, "product", p.id, "created", {"name": name, "description": description})
    return await product_saved(db, viewer, p.id)


@router.patch("/{product_id}")
async def edit_product(product_id: str, body: ProductChange, viewer: Manager, db: Db) -> ProductOut:
    """A rename keeps the ID. Deactivation changes no other record: materials in review keep their review,
    library records keep the ID, and the rate sheet keeps its rows (PRD F8)."""
    p = await load_product(db, viewer, product_id)
    before = {"name": p.name, "description": p.description, "active": p.active}
    if body.name is not None:
        name = clean(body.name, "name")
        await check_name_free(db, viewer, name, p.id)
        p.name = name
    if body.description is not None:
        p.description = clean(body.description, "description")
    if body.active is not None:
        p.active = body.active
    after = {"name": p.name, "description": p.description, "active": p.active}
    if diff := changes(before, after):
        if set(diff) == {"active"}:
            record(db, viewer, "product", p.id, "reactivated" if p.active else "deactivated")
        else:
            record(db, viewer, "product", p.id, "updated", diff)
    return await product_saved(db, viewer, p.id)
