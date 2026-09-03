"""
Uvicorn launcher with SO_REUSEADDR forced at the socket level.
This bypasses Windows TIME_WAIT zombie sockets on port 10000.
"""
import socket
import uvicorn

if __name__ == "__main__":
    # Pre-create a socket with SO_REUSEADDR so Windows releases TIME_WAIT sockets.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", 10000))
    sock.set_inheritable(True)

    config = uvicorn.Config(
        "app.main:app",
        host="0.0.0.0",
        port=10000,
        workers=1,          # workers > 1 requires CLI; use 1 with pre-bound socket
        log_level="info",
        timeout_graceful_shutdown=0,
    )
    server = uvicorn.Server(config)

    import os
    pid_file = ".backend.pid"
    with open(pid_file, "w") as f:
        f.write(str(os.getpid()))

    import asyncio
    try:
        asyncio.run(server.serve(sockets=[sock]))
    finally:
        if os.path.exists(pid_file):
            try:
                os.remove(pid_file)
            except Exception:
                pass
