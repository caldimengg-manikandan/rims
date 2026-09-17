"""
Uvicorn launcher with SO_REUSEADDR forced at the socket level.
This bypasses Windows TIME_WAIT zombie sockets on port 10000.
"""
import socket
import uvicorn



if __name__ == "__main__":
    import os
    pid_file = ".backend.pid"
    with open(pid_file, "w") as f:
        f.write(str(os.getpid()))

    try:
        uvicorn.run(
            "app.main:app",
            host="0.0.0.0",
            port=10000,
            reload=True,
            reload_dirs=["app"],
            log_level="info",
            timeout_graceful_shutdown=0,
        )
    finally:
        if os.path.exists(pid_file):
            try:
                os.remove(pid_file)
            except Exception:
                pass

