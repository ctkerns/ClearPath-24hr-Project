"""Products (PRD F8, US-66, section 9): the financial products a workspace markets. Managers keep the list.

Materials, rules, disclosures, building blocks, rate sheet rows and routing rules refer to a product by its ID,
a slug such as "personal_loan". Each workspace has its own list, so the primary key is (workspace_id, id),
the same as the library's text IDs: two workspaces can both have "personal_loan".
The ID never changes, so a rename breaks no reference. There is no delete: an inactive product cannot be chosen
for new records, and existing records keep it.
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, now_default
from app.models.core import User


class Product(Base):
    __tablename__ = "products"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, server_default="")
    active: Mapped[bool] = mapped_column(server_default=text("true"))
    created_at: Mapped[datetime] = now_default()
    # Null for the products that the migration made from the old fixed list
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    created_by: Mapped[User | None] = relationship()


# Names are unique in a workspace, ignoring case (the API also trims them).
Index("uq_products_workspace_name", Product.workspace_id, func.lower(Product.name), unique=True)
