import sys
import os
sys.path.insert(0, os.path.abspath('backend'))
from app.infrastructure.database import SessionLocal
from app.domain.models import User, Tenant
from app.core.auth import hash_password

db = SessionLocal()
try:
    for email, name, pwd in [
        ("acme.admin@calrims.local", "Acme Super Admin", "AcmeAdmin@2026!"),
        ("nexus.admin@calrims.local", "Nexus Super Admin", "NexusAdmin@2026!")
    ]:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                email=email,
                password_hash=hash_password(pwd),
                full_name=name,
                role="super_admin",
                is_active=True,
                is_verified=True,
                approval_status="approved"
            )
            db.add(user)
        else:
            user.role = "super_admin"
            user.is_active = True
            user.approval_status = "approved"
            user.password_hash = hash_password(pwd)
    db.commit()
    print("PROVISIONED_SUCCESSFULLY")
finally:
    db.close()
