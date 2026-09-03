import sys
import os
sys.path.insert(0, os.path.abspath('backend'))
from app.infrastructure.database import SessionLocal
from app.domain.models import User, Tenant
from sqlalchemy import text

db = SessionLocal()
try:
    tenants = db.execute(text("SELECT id, name, slug FROM public.tenants")).fetchall()
    print("Tenants:")
    for t in tenants:
        print(f"  {t[1]} ({t[2]}) - ID: {t[0]}")
    users = db.query(User).filter(User.role.in_(["super_admin", "hr"])).all()
    print("\nUsers:")
    for u in users:
        print(f"  {u.email} ({u.role}) - Status: {u.approval_status}")
finally:
    db.close()
