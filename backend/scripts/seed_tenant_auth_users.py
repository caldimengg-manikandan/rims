import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.infrastructure.database import SessionLocal
from app.domain.models import User, Tenant
from app.core.auth import hash_password

def seed_users():
    with SessionLocal() as db:
        # 1. Fetch tenants
        default_tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
        amazon_tenant = db.query(Tenant).filter(Tenant.slug == "amazon").first()
        acme_tenant = db.query(Tenant).filter(Tenant.slug == "acme").first()
        aether_tenant = db.query(Tenant).filter(Tenant.slug == "aether").first()
        nexus_tenant = db.query(Tenant).filter(Tenant.slug == "nexus").first()

        assert default_tenant, "default tenant not found"
        assert amazon_tenant, "amazon tenant not found"
        assert acme_tenant, "acme tenant not found"

        users_to_seed = [
            # Root Admins (Platform Authority above all tenants)
            {
                "email": "caldiminternship@gmail.com",
                "role": "root-admin",
                "full_name": "CALRIMS Root Admin",
                "tenant_id": None,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            {
                "email": "aashifanshaf786@gmail.com",
                "role": "root-admin",
                "full_name": "Aashif Root Admin",
                "tenant_id": None,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            {
                "email": "test.admin@calrims.local",
                "role": "root-admin",
                "full_name": "Platform Test Root Admin",
                "tenant_id": None,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            # Amazon Tenant Accounts (super_admin = Tenant Admin, hr = Tenant HR)
            {
                "email": "amazon.admin@calrims.local",
                "role": "super_admin",
                "full_name": "Amazon Tenant Admin",
                "tenant_id": amazon_tenant.id,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            {
                "email": "amazon.hr@calrims.local",
                "role": "hr",
                "full_name": "Amazon HR Lead",
                "tenant_id": amazon_tenant.id,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            # Acme Tenant Accounts
            {
                "email": "acme.admin@calrims.local",
                "role": "super_admin",
                "full_name": "Acme Tenant Admin",
                "tenant_id": acme_tenant.id,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            {
                "email": "acme.hr@calrims.local",
                "role": "hr",
                "full_name": "Acme HR Lead",
                "tenant_id": acme_tenant.id,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            # Aether Tenant Accounts
            {
                "email": "aether.admin@calrims.local",
                "role": "super_admin",
                "full_name": "Aether Tenant Admin",
                "tenant_id": aether_tenant.id if aether_tenant else None,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            {
                "email": "aether.hr@calrims.local",
                "role": "hr",
                "full_name": "Aether HR Lead",
                "tenant_id": aether_tenant.id if aether_tenant else None,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
            # Default Organization HR
            {
                "email": "default.hr@calrims.local",
                "role": "hr",
                "full_name": "Default HR Lead",
                "tenant_id": default_tenant.id,
                "is_verified": True,
                "approval_status": "approved",
                "is_active": True,
            },
        ]

        pwd_hash = hash_password("Password@123")
        admin_hash = hash_password("00000000")

        for u_data in users_to_seed:
            user = db.query(User).filter(User.email == u_data["email"]).first()
            user_pwd = admin_hash if u_data["email"] in ("caldiminternship@gmail.com", "caldimintership@gmail.com") else pwd_hash
            if not user:
                user = User(
                    email=u_data["email"],
                    password_hash=user_pwd,
                    role=u_data["role"],
                    full_name=u_data["full_name"],
                    tenant_id=u_data["tenant_id"],
                    is_verified=u_data["is_verified"],
                    approval_status=u_data["approval_status"],
                    is_active=u_data["is_active"],
                )
                db.add(user)
                print(f"Created user: {u_data['email']} with role {u_data['role']} and tenant {u_data['tenant_id']}")
            else:
                user.password_hash = user_pwd
                user.tenant_id = u_data["tenant_id"]
                user.role = u_data["role"]
                user.is_verified = True
                user.approval_status = "approved"
                user.is_active = True
                user.login_attempt_count = 0
                user.login_locked_until = None
                print(f"Updated user: {u_data['email']} with role {u_data['role']} and tenant {u_data['tenant_id']}")

        db.commit()
        print("All users seeded and verified successfully!")

if __name__ == "__main__":
    seed_users()
