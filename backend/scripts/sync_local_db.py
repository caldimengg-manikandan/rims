"""
Sync database schema and seed data from Supabase to local PostgreSQL (rims_db).
Adds any missing columns, cleans constraints, and copies all records row-by-row.
"""
import json
from sqlalchemy import create_engine, text

SUPABASE_URL = "postgresql://postgres.ngcyionbvgrsphuiwrtm:pushpa121835A@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
LOCAL_URL = "postgresql://postgres@127.0.0.1:5432/rims_db"

TABLES_TO_SYNC = [
    "tenants",
    "users",
    "global_settings",
    "question_bank",
    "question_sets",
    "coding_problems",
    "coding_question_sets",
    "coding_question_set_items",
    "coding_test_cases",
    "jobs",
    "applications",
    "interviews",
]

def align_schema(src_conn, dst_conn):
    """Ensure dst_conn has all columns present in src_conn for every table."""
    print("Aligning local schema columns with source...")
    # Drop legacy check constraints that restrict newer enum statuses
    for drop_sql in [
        "ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS check_applications_status",
        "ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check",
        "ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS check_jobs_status",
        "ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check",
    ]:
        try:
            dst_conn.execute(text(drop_sql))
            dst_conn.commit()
        except Exception:
            dst_conn.rollback()

    for table in TABLES_TO_SYNC:
        src_cols = src_conn.execute(text("""
            SELECT column_name, data_type, udt_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :t
        """), {"t": table}).fetchall()
        if not src_cols:
            continue

        dst_cols = dst_conn.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :t
        """), {"t": table}).fetchall()
        dst_col_names = {r[0] for r in dst_cols}

        for col in src_cols:
            col_name, data_type, udt_name, is_nullable, col_default = col
            if col_name not in dst_col_names:
                col_type = udt_name if udt_name in ("jsonb", "uuid") else data_type
                if col_type == "USER-DEFINED":
                    col_type = udt_name
                print(f"  [+] Adding column {table}.{col_name} ({col_type}) to local DB...")
                try:
                    dst_conn.execute(text(f'ALTER TABLE public.{table} ADD COLUMN IF NOT EXISTS "{col_name}" {col_type}'))
                    dst_conn.commit()
                except Exception as e:
                    print(f"      Failed to add column {col_name}: {e}")
                    dst_conn.rollback()

def sync_data():
    print("Connecting to source (Supabase)...")
    src_engine = create_engine(SUPABASE_URL)
    print("Connecting to target (Local rims_db)...")
    dst_engine = create_engine(LOCAL_URL)

    with src_engine.connect() as src_conn, dst_engine.connect() as dst_conn:
        align_schema(src_conn, dst_conn)

        for table in TABLES_TO_SYNC:
            try:
                rows = src_conn.execute(text(f"SELECT * FROM public.{table}")).fetchall()
                if not rows:
                    print(f"  [i] Table {table} is empty in source.")
                    continue

                col_res = src_conn.execute(
                    text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=:t ORDER BY ordinal_position"),
                    {"t": table}
                ).fetchall()
                col_names = [r[0] for r in col_res]
                json_cols = {r[0] for r in col_res if r[1] in ("json", "jsonb")}

                cols_str = ", ".join([f'"{c}"' for c in col_names])
                placeholders = ", ".join([f":{c}" for c in col_names])

                pk_res = dst_conn.execute(
                    text(f"""
                        SELECT kcu.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                          AND tc.table_schema = kcu.table_schema
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                          AND tc.table_name = :t
                    """),
                    {"t": table}
                ).fetchall()
                pk_cols = [r[0] for r in pk_res]

                if pk_cols:
                    pk_clause = f"({', '.join([f'\"{c}\"' for c in pk_cols])})"
                    insert_sql = f"INSERT INTO public.{table} ({cols_str}) VALUES ({placeholders}) ON CONFLICT {pk_clause} DO NOTHING"
                else:
                    insert_sql = f"INSERT INTO public.{table} ({cols_str}) VALUES ({placeholders})"

                inserted_count = 0
                for row in rows:
                    row_dict = {}
                    for k, v in zip(col_names, row):
                        if (isinstance(v, (dict, list)) or k in json_cols) and v is not None:
                            row_dict[k] = json.dumps(v)
                        else:
                            row_dict[k] = v
                    try:
                        res = dst_conn.execute(text(insert_sql), row_dict)
                        dst_conn.commit()
                        if res.rowcount > 0:
                            inserted_count += 1
                    except Exception as row_err:
                        dst_conn.rollback()

                print(f"  [+] Synced {table}: {inserted_count} new / {len(rows)} total rows.")
            except Exception as e:
                print(f"  [!] Error syncing {table}: {e}")
                dst_conn.rollback()

    print("Data sync completed successfully.")

if __name__ == "__main__":
    sync_data()
