"""
Fix PostgreSQL serial sequences and add any missing table columns.
"""
from sqlalchemy import create_engine, text

LOCAL_URL = "postgresql://postgres@127.0.0.1:5432/rims_db"

def fix():
    engine = create_engine(LOCAL_URL)
    with engine.connect() as conn:
        print("Checking missing columns...")
        # 1. notifications.tenant_id
        try:
            conn.execute(text("""
                ALTER TABLE public.notifications 
                ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;
            """))
            conn.commit()
            print("  [+] notifications.tenant_id verified/added.")
        except Exception as e:
            print("  [!] notifications.tenant_id error:", e)
            conn.rollback()

        # 2. Reset and synchronize all serial sequences
        print("\nResetting all PostgreSQL serial sequences to MAX(id) + 1...")
        seq_query = text("""
            SELECT table_name, column_name, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' 
              AND column_default LIKE 'nextval%'
            ORDER BY table_name;
        """)
        seq_cols = conn.execute(seq_query).fetchall()

        for table, col, default_expr in seq_cols:
            try:
                max_val = conn.execute(text(f'SELECT COALESCE(MAX("{col}"), 0) FROM public."{table}"')).fetchone()[0]
                new_seq_val = max(max_val, 1)
                conn.execute(text(f"SELECT setval(pg_get_serial_sequence('public.\"{table}\"', '{col}'), {new_seq_val})"))
                conn.commit()
                print(f"  [+] Reset sequence for public.{table}.{col}: max={max_val}, nextval will be {new_seq_val + 1}")
            except Exception as e:
                print(f"  [!] Failed resetting sequence for {table}.{col}: {e}")
                conn.rollback()

    print("\nDatabase sequence and column fixes complete.")

if __name__ == "__main__":
    fix()
