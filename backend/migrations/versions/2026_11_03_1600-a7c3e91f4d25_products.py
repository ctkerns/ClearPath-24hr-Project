"""products

Products become a table per workspace (PRD F8, US-66) instead of a fixed list in the code.

- Every workspace gets one row for each value of the old list, with the same IDs, so no existing record changes.
- materials.product stays VARCHAR(32). Its CHECK constraint (the old list; the column was a non-native enum,
  so there is no Postgres enum type) goes, and a foreign key to the workspace's products takes its place.
- integrations.default_product_id: the product that imported materials get (PRD section 9). Nullable.

Downgrade puts the old list back. It stops if a material has a product that is not on the old list.

Revision ID: a7c3e91f4d25
Revises: 7d3f9a2c6e18
Create Date: 2026-11-03 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e91f4d25'
down_revision: Union[str, Sequence[str], None] = '7d3f9a2c6e18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The old fixed list, with a name and a short description for each
OLD_PRODUCTS = [
    ("personal_loan", "Personal loan", "Unsecured fixed-rate installment loans."),
    ("credit_card", "Credit card", "Consumer credit cards."),
    ("mortgage", "Mortgage", "Home purchase and refinance loans."),
    ("heloc", "HELOC", "Home equity lines of credit."),
    ("auto_loan", "Auto loan", "Loans for new and used vehicles."),
    ("savings", "Savings", "Savings accounts and share certificates."),
]
OLD_IDS = [p[0] for p in OLD_PRODUCTS]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'products',
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), server_default='', nullable=False),
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by_id', sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_products_created_by_id_users'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_products_workspace_id_workspaces')),
        sa.PrimaryKeyConstraint('workspace_id', 'id', name=op.f('pk_products')),
    )
    op.create_index('uq_products_workspace_name', 'products', ['workspace_id', sa.text('lower(name)')], unique=True)

    # One row per old value in every workspace that exists now, with the same IDs
    products = sa.table(
        'products', sa.column('workspace_id', sa.Uuid()), sa.column('id', sa.String()),
        sa.column('name', sa.String()), sa.column('description', sa.Text()),
    )
    values = sa.values(
        sa.column('id', sa.String()), sa.column('name', sa.String()), sa.column('description', sa.Text()),
        name='old_products',
    ).data(OLD_PRODUCTS)
    workspaces = sa.table('workspaces', sa.column('id', sa.Uuid()))
    op.execute(
        products.insert().from_select(
            ['workspace_id', 'id', 'name', 'description'],
            sa.select(workspaces.c.id, values.c.id, values.c.name, values.c.description).select_from(workspaces.join(values, sa.true())),
        )
    )

    op.execute('ALTER TABLE materials DROP CONSTRAINT IF EXISTS ck_materials_product')
    op.create_foreign_key(
        'fk_materials_product_products', 'materials', 'products', ['workspace_id', 'product'], ['workspace_id', 'id']
    )

    op.add_column('integrations', sa.Column('default_product_id', sa.String(length=32), nullable=True))
    op.create_foreign_key(
        'fk_integrations_default_product_id_products', 'integrations', 'products',
        ['workspace_id', 'default_product_id'], ['workspace_id', 'id'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    others = conn.execute(
        sa.text('SELECT DISTINCT product FROM materials WHERE product <> ALL(:ids)'), {'ids': OLD_IDS}
    ).scalars().all()
    if others:
        raise RuntimeError(
            f"Cannot downgrade: materials use products that are not on the old list: {', '.join(sorted(others))}"
        )
    op.drop_constraint('fk_integrations_default_product_id_products', 'integrations', type_='foreignkey')
    op.drop_column('integrations', 'default_product_id')
    op.drop_constraint('fk_materials_product_products', 'materials', type_='foreignkey')
    op.create_check_constraint(op.f('ck_materials_product'), 'materials', sa.column('product').in_(OLD_IDS))
    op.drop_index('uq_products_workspace_name', table_name='products')
    op.drop_table('products')
