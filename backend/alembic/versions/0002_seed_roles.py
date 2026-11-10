"""seed roles and permissions

Revision ID: 0002
Revises: 0001
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.services.onboarding import ensure_roles
    session = Session(bind=op.get_bind())
    ensure_roles(session)
    session.flush()


def downgrade() -> None:
    op.execute("DELETE FROM role_permissions")
    op.execute("DELETE FROM roles")
    op.execute("DELETE FROM permissions")
