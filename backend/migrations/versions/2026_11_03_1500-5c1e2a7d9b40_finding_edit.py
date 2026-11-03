"""finding edit

The exact fix of a finding, when there is one: {"op": "replace" | "append", "text": ...}.
The new-version form applies it with one click. Existing findings get none, so they keep only their advice.

Revision ID: 5c1e2a7d9b40
Revises: 3115f88e1b45
Create Date: 2026-11-03 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '5c1e2a7d9b40'
down_revision: Union[str, Sequence[str], None] = '3115f88e1b45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('material_findings', sa.Column('edit', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('material_findings', 'edit')
