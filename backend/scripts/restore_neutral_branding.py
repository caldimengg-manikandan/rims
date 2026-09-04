"""
Restore neutral platform defaults in global_settings and scope Amazon branding
exclusively to the Amazon tenant in tenants table.
"""
import json
from sqlalchemy import create_engine, text
from cryptography.fernet import Fernet
from app.core.config import get_settings

def run():
    settings = get_settings()
    fernet = Fernet(settings.encryption_key.encode())
    engine = create_engine("postgresql://postgres@127.0.0.1:5432/rims_db")

    with engine.connect() as conn:
        print("1. Restoring neutral CALRIMS defaults in global_settings...")
        neutral_defaults = {
            "company_name": "CALDIM",
            "product_name": "CAL-RIMS",
            "company_logo_url": "/calrims/logo.png",
            "dark_logo_url": "/calrims/logo-dark.png",
            "favicon_url": "/calrims/logo.png",
            "footer_text": "Powered by CALDIM. Built for teams who care about who they hire.",
            "support_email": "support@caldimproducts.com",
            "theme_color": "#2563eb",
            "terms_url": "/calrims/terms/",
            "privacy_url": "/calrims/privacy/",
            "seo_title_default": "CAL-RIMS - AI-Powered Recruitment Intelligence System",
            "seo_description_default": "CAL-RIMS is an AI-powered automated recruitment platform for seamless hiring, empowering teams to find, evaluate, and hire top-tier talent efficiently.",
            "hr_name": "HR Team",
            "hr_email": "hr@caldimproducts.com",
            "hr_phone": "+1 555 000 0000",
        }

        for k, v in neutral_defaults.items():
            enc_v = fernet.encrypt(v.encode()).decode()
            exists = conn.execute(text("SELECT id FROM global_settings WHERE key = :k"), {"k": k}).fetchone()
            if exists:
                conn.execute(
                    text("UPDATE global_settings SET value = :v, updated_at = NOW() WHERE key = :k"),
                    {"v": enc_v, "k": k}
                )
            else:
                conn.execute(
                    text("INSERT INTO global_settings (key, value, created_at, updated_at) VALUES (:k, :v, NOW(), NOW())"),
                    {"k": k, "v": enc_v}
                )
        conn.commit()
        print("   [+] global_settings reset to neutral CALRIMS defaults.")

        print("2. Scoping Amazon branding exclusively to the Amazon tenant...")
        amazon_branding = {
            "company_name": "Amazon",
            "product_name": "Amazon Recruitment Portal",
            "company_logo_url": "https://upload.wikimedia.org/wikipedia/commons/d/de/Amazon_icon.png?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original",
            "favicon_url": "https://upload.wikimedia.org/wikipedia/commons/d/de/Amazon_icon.png?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original",
            "dark_logo_url": "https://i.pinimg.com/originals/29/f6/41/29f641b507ccb60bb7a62a830b988736.jpg",
            "theme_color": "#06b6d4",
            "footer_text": "Amazon Recruitment Operations. Confidential and Proprietary.",
            "support_email": "recruiting-support@amazon.com",
        }

        amazon_tenant = conn.execute(text("SELECT id, settings FROM tenants WHERE slug = 'amazon'")).fetchone()
        if amazon_tenant:
            current_settings = amazon_tenant[1] or {}
            if not isinstance(current_settings, dict):
                current_settings = {}
            current_settings["branding"] = amazon_branding
            current_settings["primaryColor"] = "#06b6d4"

            conn.execute(
                text("""
                    UPDATE tenants 
                    SET logo_url = :logo, 
                        settings = CAST(:settings AS jsonb), 
                        updated_at = NOW() 
                    WHERE slug = 'amazon'
                """),
                {
                    "logo": amazon_branding["company_logo_url"],
                    "settings": json.dumps(current_settings)
                }
            )
            conn.commit()
            print("   [+] Amazon tenant settings updated with Amazon branding.")

        print("3. Ensuring Default Organization has clean settings...")
        default_tenant = conn.execute(text("SELECT id, settings FROM tenants WHERE slug = 'default'")).fetchone()
        if default_tenant:
            current_settings = default_tenant[1] or {}
            if isinstance(current_settings, dict) and "branding" in current_settings:
                del current_settings["branding"]
            conn.execute(
                text("UPDATE tenants SET logo_url = NULL, settings = CAST(:settings AS jsonb), updated_at = NOW() WHERE slug = 'default'"),
                {"settings": json.dumps(current_settings if isinstance(current_settings, dict) else {})}
            )
            conn.commit()
            print("   [+] Default Organization verified clean (neutral fallback).")

    print("\n[SUCCESS] Neutral branding restored.")

if __name__ == "__main__":
    run()
