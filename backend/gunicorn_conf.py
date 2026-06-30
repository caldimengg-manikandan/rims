import multiprocessing
import os

# Gunicorn configuration for production FastAPI deployment
# No source code modification required.

# Server socket
bind = f"0.0.0.0:{os.environ.get('PORT', '10000')}"
backlog = 2048

# Worker processes
db_url = os.environ.get("DATABASE_URL", "")
is_pgbouncer = "6543" in db_url or "pgbouncer" in db_url.lower()

# Enforce max 2 workers if not using PgBouncer to prevent DB connection pool exhaustion
if is_pgbouncer:
    workers = multiprocessing.cpu_count() * 2 + 1
else:
    workers = min(2, multiprocessing.cpu_count() * 2 + 1)

# Allow manual override via environment variable if needed
if os.environ.get("GUNICORN_WORKERS"):
    try:
        workers = int(os.environ["GUNICORN_WORKERS"])
    except ValueError:
        pass

worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = 30
keepalive = 5

# Logging
accesslog = "-"   # stdout — Render captures this automatically
errorlog = "-"    # stderr — Render captures this automatically
loglevel = "info"

# Process naming
proc_name = "ars_backend_prod"

# Performance tuning
max_requests = 1000
max_requests_jitter = 50
preload_app = True

# Assign a unique 0-indexed WORKER_ID to each worker process
def post_fork(server, worker):
    os.environ["WORKER_ID"] = str(worker.age - 1)
    # Dispose SQLAlchemy engine connection pool after fork to prevent shared sockets
    try:
        from app.infrastructure.database import engine
        engine.dispose()
    except Exception:
        pass

