"""
Check every table and column in Supabase and add any missing column to local rims_db.
"""
from sqlalchemy import create_engine, text

SUPABASE_URL = "postgresql://postgres.ngcyionbvgrsphuiwrtm:pushpa121835A@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
LOCAL_URL = "postgresql://postgres@127.0.0.1:5432/rims_db"

def sync_columns():
    src = create_engine(SUPABASE_URL)
    dst = create_engine(LOCAL_URL)

    with src.connect() as s, dst.connect() as d:
        src_cols = s.execute(text("""
            SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position;
        """)).fetchall()

        dst_cols = d.execute(text("""
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public';
        """)).fetchall()
        dst_set = {(r[0], r[1]) for r in dst_cols}

        added = 0
        for r in src_cols:
            table, col, data_type, udt_name, is_null, col_default = r
            if (table, col) not in dst_set:
                col_type = udt_name if udt_name in ("jsonb", "uuid") else data_type
                if col_type == "USER-DEFINED":
                    col_type = udt_name
                print(f"Adding {table}.{col} ({col_type})...")
                try:
                    d.execute(text(f'ALTER TABLE public."{table}" ADD COLUMN IF NOT EXISTS "{col}" {col_type}'))
                    d.commit()
                    added += 1
                except Exception as e:
                    print(f"  Error adding {table}.{col}: {e}")
                    d.rollback()

        print(f"Added {added} missing columns.")

if __name__ == "__main__":
    sync_columns()
